import type { BrandCandidate, BrandProfile, ProductRecord } from '../types.js';
import { fetchJson, fetchPage, type FetchOptions } from '../util/http.js';
import { collapseWhitespace, truncate, uniq } from '../util/text.js';
import {
    detectPlatform, extractJsonLd, extractMeta, extractProductsFromHtml, extractSocials,
    extractTextCorpus, internalPagesToFetch, load, organisationFromJsonLd, parseShopifyProducts,
    productsFromJsonLd,
} from './extractors.js';
import { detectTechStack } from './tech-stack.js';
import { extractCommerceSignals } from './commerce-signals.js';

export type ProfileDepth = 'fast' | 'standard' | 'deep';

export interface ProfileOptions extends FetchOptions {
    depth: ProfileDepth;
    maxProducts: number;
}

const EXTRA_PAGES_BY_DEPTH: Record<ProfileDepth, number> = { fast: 0, standard: 2, deep: 5 };

function dedupeProducts(products: ProductRecord[], limit: number): ProductRecord[] {
    const seen = new Map<string, ProductRecord>();
    for (const product of products) {
        const key = product.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!key) continue;
        const existing = seen.get(key);
        // Prefer the richer record when the same product shows up twice.
        if (!existing || (!existing.description && product.description) || (!existing.price && product.price)) {
            seen.set(key, { ...existing, ...product });
        }
    }
    return [...seen.values()].slice(0, limit);
}

function priceRangeOf(products: ProductRecord[]): BrandProfile['priceRange'] {
    const priced = products.filter((p) => typeof p.price === 'number' && p.price > 0);
    if (priced.length === 0) return undefined;
    const prices = priced.map((p) => p.price as number);
    return {
        min: Math.min(...prices),
        max: Math.max(...prices),
        currency: priced.find((p) => p.currency)?.currency ?? 'USD',
    };
}

/**
 * Visits a brand's own site and pulls everything the classifier and the ad
 * search need: name, positioning copy, product names, platform, socials.
 *
 * Never throws — a brand whose site is down still gets a profile with the
 * failure recorded in `fetchErrors`, because a dead site is itself a finding.
 */
export async function profileBrand(candidate: BrandCandidate, opts: ProfileOptions): Promise<BrandProfile> {
    const profile: BrandProfile = {
        ...candidate,
        brandName: candidate.name,
        products: [],
        platform: 'unknown',
        socials: {},
        corpus: '',
        pagesFetched: [],
        fetchErrors: [],
    };

    let homepageHtml = '';
    try {
        const res = await fetchPage(candidate.url, opts);
        if (res.statusCode >= 400) {
            profile.fetchErrors.push(`homepage HTTP ${res.statusCode}`);
        } else if (!/html/i.test(res.contentType) && !res.body.includes('<')) {
            profile.fetchErrors.push(`homepage returned ${res.contentType || 'non-HTML'}`);
        } else {
            homepageHtml = res.body;
            profile.pagesFetched.push(res.url);
        }
    } catch (err) {
        profile.fetchErrors.push(`homepage fetch failed: ${(err as Error).message}`);
        return profile;
    }

    if (!homepageHtml) return profile;

    profile.platform = detectPlatform(homepageHtml);

    const $ = load(homepageHtml);
    const jsonLd = extractJsonLd($);
    const org = organisationFromJsonLd(jsonLd);
    const meta = extractMeta($);

    // Name precedence: the brand's own structured data beats og:site_name,
    // which beats the listicle's anchor text, which beats the domain stem.
    profile.brandName = truncate(
        org.name || meta.siteName || candidate.name || '',
        60,
    ) || candidate.name;
    if (meta.siteTitle) profile.siteTitle = meta.siteTitle;
    const description = org.description || meta.description;
    if (description) profile.description = description;
    if (meta.tagline) profile.tagline = meta.tagline;

    profile.socials = extractSocials($);

    const collected: ProductRecord[] = [
        ...productsFromJsonLd(jsonLd, candidate.url),
        ...extractProductsFromHtml($, candidate.url, opts.maxProducts),
    ];

    const corpusParts: string[] = [extractTextCorpus($)];
    const extraPageCount = EXTRA_PAGES_BY_DEPTH[opts.depth];

    if (opts.depth !== 'fast' && profile.platform === 'shopify' && opts.maxProducts > 0) {
        const shopifyUrl = new URL('/products.json?limit=250', candidate.url).toString();
        const payload = await fetchJson<unknown>(shopifyUrl, opts);
        const { products, extraText } = parseShopifyProducts(payload, candidate.url, opts.maxProducts);
        if (products.length > 0) {
            collected.push(...products);
            profile.pagesFetched.push(shopifyUrl);
        }
        if (extraText) corpusParts.push(extraText);
    }

    if (extraPageCount > 0) {
        const pageUrls = internalPagesToFetch($, candidate.url, extraPageCount);
        for (const url of pageUrls) {
            try {
                const res = await fetchPage(url, opts);
                if (res.statusCode >= 400) continue;
                const $$ = load(res.body);
                collected.push(...extractProductsFromHtml($$, url, opts.maxProducts));
                collected.push(...productsFromJsonLd(extractJsonLd($$), url));
                corpusParts.push(extractTextCorpus($$, 15000));
                profile.pagesFetched.push(res.url);
            } catch (err) {
                profile.fetchErrors.push(`${url}: ${(err as Error).message}`);
            }
        }
    }

    profile.products = dedupeProducts(collected, opts.maxProducts);
    const range = priceRangeOf(profile.products);
    if (range) profile.priceRange = range;
    profile.corpus = truncate(collapseWhitespace(uniq(corpusParts).join(' \n ')), 60000);

    // Both read the page we already have in memory — no extra requests.
    profile.techStack = detectTechStack(homepageHtml);
    profile.commerce = extractCommerceSignals(load(homepageHtml), profile.corpus, profile.products);

    return profile;
}
