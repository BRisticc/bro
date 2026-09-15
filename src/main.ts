import { Actor, log } from 'apify';
import type { BrandCandidate, BrandReport, ClassifiedBrand } from './types.js';
import { InputError, parseInput, resolveAdsProvider, startUrlStrings, type ActorInput } from './input.js';
import { detectDiscoveryMode, discoverBrands, selfCandidate } from './discovery/brand-discovery.js';
import { load } from './profile/extractors.js';
import { profileBrand } from './profile/brand-profiler.js';
import { buildCorpus, classifyBrand } from './classify/classifier.js';
import { BUILT_IN_TAXONOMY, mergeTaxonomy } from './classify/taxonomy.js';
import { researchBrandAds } from './ads/ad-research.js';
import { teardownLandingPages } from './profile/landing-teardown.js';
import { buildPageInventory } from './profile/page-inventory.js';
import { readCheckoutIntel, readProductPage } from './profile/commerce-pages.js';
import { ApifyActorAdsProvider } from './ads/apify-actor-provider.js';
import { MetaGraphAdsProvider } from './ads/meta-graph-provider.js';
import { NoOpAdsProvider, type AdsProvider } from './ads/provider.js';
import { refineClassification, summariseAngles } from './llm/anthropic.js';
import { buildBrandReport, buildRunReport } from './report/report-builder.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import { fetchPage, mapWithConcurrency, type FetchOptions } from './util/http.js';
import { proxySessionId } from './util/proxy.js';
import { truncate } from './util/text.js';

await Actor.init();

try {
    const input = parseInput(await Actor.getInput<Record<string, unknown>>());
    const sourceUrls = startUrlStrings(input);
    if (sourceUrls.length === 0) {
        throw new InputError('No usable http(s) URL in startUrls.');
    }

    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

    const fetchOptions = async (sessionLabel: string): Promise<FetchOptions> => {
        const opts: FetchOptions = {
            timeoutSecs: input.requestTimeoutSecs,
            retries: input.maxRequestRetries,
        };
        const proxyUrl = await proxyConfiguration?.newUrl(proxySessionId(sessionLabel));
        if (proxyUrl) opts.proxyUrl = proxyUrl;
        return opts;
    };

    const warnings: string[] = [];

    // ---------------------------------------------------------------- 1. discover
    log.info(`Stage 1/5 — discovering brands on ${sourceUrls.length} source page(s)`);
    const candidatesByDomain = new Map<string, BrandCandidate>();

    for (const sourceUrl of sourceUrls) {
        try {
            const res = await fetchPage(sourceUrl, await fetchOptions('source'));
            if (res.statusCode >= 400) {
                warnings.push(`Source page ${sourceUrl} returned HTTP ${res.statusCode}.`);
                continue;
            }
            const $ = load(res.body);
            const discoveryOptions = {
                includeDomains: input.includeDomains,
                excludeDomains: input.excludeDomains,
                maxBrands: input.maxBrands,
                ...(input.brandLinkSelector ? { selector: input.brandLinkSelector } : {}),
            };

            const mode = input.discoveryMode === 'auto'
                ? detectDiscoveryMode($, res.url, discoveryOptions)
                : input.discoveryMode;
            log.info(`  ${sourceUrl} → mode "${mode}"`);

            const found = mode === 'single-brand'
                ? [selfCandidate($, res.url)].filter((c): c is BrandCandidate => c !== null)
                : discoverBrands($, res.url, discoveryOptions);

            if (found.length === 0) {
                warnings.push(
                    `No brands found on ${sourceUrl}. Try setting brandLinkSelector to the region of the page `
                    + 'that lists the brands, or set discoveryMode to "single-brand".',
                );
            }

            for (const candidate of found) {
                const existing = candidatesByDomain.get(candidate.domain);
                if (!existing || candidate.discoveryScore > existing.discoveryScore) {
                    candidatesByDomain.set(candidate.domain, candidate);
                }
            }
        } catch (err) {
            warnings.push(`Source page ${sourceUrl} failed: ${(err as Error).message}`);
            log.warning(`Failed to read source page ${sourceUrl}: ${(err as Error).message}`);
        }
    }

    const candidates = [...candidatesByDomain.values()]
        .sort((a, b) => b.discoveryScore - a.discoveryScore)
        .slice(0, input.maxBrands);

    log.info(`Discovered ${candidates.length} brand(s): ${candidates.map((c) => c.domain).join(', ') || 'none'}`);

    if (candidates.length === 0) {
        await Actor.setValue('REPORT.json', buildRunReport([], {
            sourceUrls, brandsDiscovered: 0, adsProvider: 'none', warnings,
        }));
        log.warning('Nothing to profile — exiting.');
        await Actor.exit();
    }

    // ---------------------------------------------------------------- 2. profile
    log.info(`Stage 2/5 — profiling ${candidates.length} brand site(s) (depth: ${input.profileDepth})`);
    const profiles = await mapWithConcurrency(candidates, input.maxConcurrency, async (candidate, index) => {
        const opts = await fetchOptions(`brand-${index}`);
        const profile = await profileBrand(candidate, {
            ...opts,
            depth: input.profileDepth,
            maxProducts: input.maxProductsPerBrand,
        });
        log.info(`  ${profile.domain} → "${profile.brandName}" · ${profile.products.length} products · ${profile.platform}`);
        return profile;
    });

    // ---------------------------------------------------------------- 3. classify
    log.info('Stage 3/5 — classifying into niche / sub-niche');
    const taxonomy = mergeTaxonomy(BUILT_IN_TAXONOMY, input.customTaxonomy ?? null);
    const classifyOptions = { taxonomy, minConfidence: input.minClassificationConfidence };

    const classified: ClassifiedBrand[] = profiles.map((profile) => ({
        ...profile,
        classification: classifyBrand(profile, classifyOptions),
    }));

    for (const brand of classified) {
        log.info(`  ${brand.brandName} → ${brand.classification.niche} / ${brand.classification.subNiche}`
            + `${brand.classification.audience ? ` (${brand.classification.audience})` : ''}`
            + ` [${brand.classification.confidence}]`);
    }

    if (input.useLlm && input.llmApiKey) {
        const llmOptions = { apiKey: input.llmApiKey, model: input.llmModel, timeoutSecs: input.requestTimeoutSecs };
        const nicheNames = Object.keys(taxonomy);
        await mapWithConcurrency(classified, Math.min(4, input.maxConcurrency), async (brand) => {
            const refinement = await refineClassification(
                brand.brandName,
                buildCorpus(brand),
                {
                    niche: brand.classification.niche,
                    subNiche: brand.classification.subNiche,
                    audience: brand.classification.audience,
                },
                nicheNames,
                llmOptions,
            );
            if (!refinement) return;
            const changed: string[] = [];
            if (refinement.niche && refinement.niche !== brand.classification.niche) {
                changed.push(`niche ${brand.classification.niche} → ${refinement.niche}`);
                brand.classification.niche = refinement.niche;
            }
            if (refinement.subNiche && refinement.subNiche !== brand.classification.subNiche) {
                changed.push(`sub-niche ${brand.classification.subNiche} → ${refinement.subNiche}`);
                brand.classification.subNiche = refinement.subNiche;
            }
            if (refinement.audience) brand.classification.audience = refinement.audience;
            brand.classification.llmNote = [refinement.note, changed.length > 0 ? `Changed: ${changed.join('; ')}` : '']
                .filter(Boolean).join(' ');
        });
    }

    // ---------------------------------------------------------------- 4. ads
    const hasApifyToken = Boolean(process.env.APIFY_TOKEN || Actor.isAtHome());
    const providerName = resolveAdsProvider(input, hasApifyToken);
    log.info(`Stage 4/5 — Ad Library research via "${providerName}"`);

    let provider: AdsProvider;
    switch (providerName) {
        case 'meta-graph': {
            if (!input.metaAccessToken) {
                warnings.push('adsProvider "meta-graph" selected but metaAccessToken is missing; skipping ad research.');
                provider = new NoOpAdsProvider();
                break;
            }
            const graphOptions = {
                accessToken: input.metaAccessToken,
                timeoutSecs: input.requestTimeoutSecs,
                retries: input.maxRequestRetries,
            };
            const proxyUrl = await proxyConfiguration?.newUrl(proxySessionId('ads'));
            provider = new MetaGraphAdsProvider(proxyUrl ? { ...graphOptions, proxyUrl } : graphOptions);
            break;
        }
        case 'apify-actor':
            provider = new ApifyActorAdsProvider({
                actorId: input.adsApifyActorId,
                ...(input.adsApifyActorInput ? { extraInput: input.adsApifyActorInput } : {}),
            });
            break;
        default:
            provider = new NoOpAdsProvider();
            break;
    }

    const maxProductQueries = input.adSearchStrategy === 'brand'
        ? 0
        : Math.min(input.maxProductsPerBrand, 5);

    // Nested actor runs are heavy, so the Apify provider gets a tighter lane.
    const adConcurrency = provider.name === 'apify-actor'
        ? Math.min(3, input.maxConcurrency)
        : input.maxConcurrency;

    const reports: BrandReport[] = await mapWithConcurrency(classified, adConcurrency, async (brand) => {
        const research = await researchBrandAds(brand, {
            provider,
            strategy: input.adSearchStrategy,
            countries: input.adCountries,
            activeStatus: input.adActiveStatus,
            adsPerBrand: input.adsPerBrand,
            rankBy: input.rankBy,
            maxProductQueries,
            minExposureScore: input.minExposureScore,
        });
        log.info(`  ${brand.brandName} → ${research.ads.length} ad(s) analysed`);
        return buildBrandReport(brand, research, provider.name, input.provenWinnerMinDays);
    });

    const wantsDeepPages = input.discoverPageInventory || input.analyseProductPages || input.analyseCheckout;
    if (wantsDeepPages) {
        log.info('Stage 4c/5 — reading published pages (inventory, products, checkout)');
        await mapWithConcurrency(reports, input.maxConcurrency, async (report, index) => {
            const opts = await fetchOptions(`pages_${index}`);

            if (input.discoverPageInventory) {
                const adDestinations = (report.landingPages?.pages ?? []).map((p) => p.url);
                report.pageInventory = await buildPageInventory(report.websiteUrl, {
                    ...opts,
                    maxSitemaps: 12,
                    maxUrls: input.maxSitemapUrls,
                    adDestinations,
                });
                log.info(`  ${report.brandName} → ${report.pageInventory.totalUrls} published page(s)`);
            }

            if (input.analyseProductPages) {
                // Prefer product URLs the ads point at, then the sitemap, then
                // whatever the profiler found: spend first, breadth second.
                const advertised = (report.landingPages?.pages ?? [])
                    .filter((p) => p.funnel === 'product-page')
                    .map((p) => p.url);
                const fromSitemap = report.pageInventory?.samples.product ?? [];
                const fromProfile = report.products
                    .map((p) => p.url)
                    .filter((u): u is string => Boolean(u));
                const targets = [...new Set([...advertised, ...fromSitemap, ...fromProfile])]
                    .slice(0, input.maxProductPagesPerBrand);
                if (targets.length > 0) {
                    report.productPages = await mapWithConcurrency(
                        targets,
                        Math.min(3, input.maxConcurrency),
                        async (url) => readProductPage(url, opts),
                    );
                    log.info(`  ${report.brandName} → ${report.productPages.filter((p) => p.ok).length} product page(s) read`);
                }
            }

            if (input.analyseCheckout) {
                report.checkout = await readCheckoutIntel(report.websiteUrl, opts);
            }
        });
    }

    if (input.analyseLandingPages) {
        const targets = reports.filter((r) => (r.landingPages?.pages.length ?? 0) > 0);
        log.info(`Stage 4b/5 — opening landing pages for ${targets.length} brand(s)`);
        await mapWithConcurrency(targets, input.maxConcurrency, async (report, index) => {
            const opts = await fetchOptions(`landing-${index}`);
            const teardowns = await teardownLandingPages(report.landingPages?.pages ?? [], {
                ...opts,
                concurrency: Math.min(3, input.maxConcurrency),
                maxPages: input.maxLandingPagesPerBrand,
            });
            report.landingTeardowns = teardowns;
            const reached = teardowns.filter((t) => t.ok).length;
            log.info(`  ${report.brandName} → ${reached}/${teardowns.length} landing page(s) read`);
        });
    }

    if (input.useLlm && input.llmApiKey) {
        const llmOptions = { apiKey: input.llmApiKey, model: input.llmModel, timeoutSecs: input.requestTimeoutSecs };
        await mapWithConcurrency(reports, Math.min(4, input.maxConcurrency), async (report) => {
            if (report.adCount === 0) return;
            const summary = await summariseAngles(
                report.brandName,
                `${report.niche} / ${report.subNiche}`,
                report.topHooks.map((h) => h.hook),
                report.angleBreakdown.map((a) => a.label),
                llmOptions,
            );
            if (!summary) return;
            const note = [summary.positioning, summary.summary].filter(Boolean).join(' ');
            if (note) report.llmNote = truncate([report.llmNote, note].filter(Boolean).join(' — '), 900);
        });
    }

    // ---------------------------------------------------------------- 5. output
    log.info('Stage 5/5 — writing reports');
    warnings.push(...provider.warnings);

    if (provider.name !== 'none' && reports.every((r) => r.adCount === 0)) {
        warnings.push(
            'No ads were returned for any brand. Check that the ad provider is configured correctly, that '
            + 'adCountries covers where these brands advertise, and that the brand names match their Meta page names.',
        );
    }

    await Actor.pushData(reports);

    const runReport = buildRunReport(reports, {
        sourceUrls,
        brandsDiscovered: candidates.length,
        adsProvider: provider.name,
        warnings,
    });

    if (input.outputFormats.includes('json')) {
        await Actor.setValue('REPORT.json', runReport);
    }
    if (input.outputFormats.includes('markdown')) {
        await Actor.setValue('REPORT.md', renderMarkdown(runReport), { contentType: 'text/markdown; charset=utf-8' });
    }
    if (input.outputFormats.includes('html')) {
        await Actor.setValue('REPORT.html', renderHtml(runReport), { contentType: 'text/html; charset=utf-8' });
    }

    log.info(
        `Done. ${runReport.brandsProfiled} brands across ${runReport.niches.length} niches, `
        + `${runReport.adsAnalysed} ads analysed. Reports are in the key-value store.`,
    );
    for (const warning of warnings) log.warning(warning);

    await Actor.exit();
} catch (err) {
    if (err instanceof InputError) {
        log.error(`Invalid input: ${err.message}`);
        await Actor.fail(err.message);
    } else {
        throw err;
    }
}
