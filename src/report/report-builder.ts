import type { AwarenessStage, BrandReport, ClassifiedBrand, RunReport } from '../types.js';
import type { BrandAdResearch } from '../ads/ad-research.js';
import { ANGLE_BY_KEY } from '../analyze/angle-library.js';
import { analyseCreativeSignals } from '../analyze/creative-signals.js';
import { buildBrandVocabulary, distinctiveTerms } from '../analyze/vocabulary.js';
import { computeBenchmarks, computeDeviations, creativeCompetitors } from './benchmarks.js';
import { share, truncate } from '../util/text.js';

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** Collapses one brand's profile, classification and ad research into a dataset row. */
export function buildBrandReport(
    brand: ClassifiedBrand,
    research: BrandAdResearch,
    adsProvider: string,
): BrandReport {
    const { ads } = research;
    const total = ads.length;

    // Angle breakdown: count an ad once per angle it exhibits, so an ad that
    // stacks problem-agitation and social proof is credited to both.
    const angleStats = new Map<string, { label: string; count: number; exposures: number[] }>();
    for (const ad of ads) {
        for (const hit of ad.analysis.angles) {
            const entry = angleStats.get(hit.angle)
                ?? { label: hit.label, count: 0, exposures: [] };
            entry.count += 1;
            entry.exposures.push(ad.exposure.score);
            angleStats.set(hit.angle, entry);
        }
    }

    const angleBreakdown = [...angleStats.entries()]
        .map(([angle, entry]) => ({
            angle,
            label: entry.label,
            adCount: entry.count,
            share: share(entry.count, total),
            avgExposure: average(entry.exposures),
        }))
        .sort((a, b) => b.adCount - a.adCount || b.avgExposure - a.avgExposure);

    const awarenessCounts = new Map<AwarenessStage, number>();
    const formatCounts = new Map<string, number>();
    const offerCounts = new Map<string, { kind: string; detail: string; count: number }>();

    for (const ad of ads) {
        awarenessCounts.set(ad.analysis.awarenessStage, (awarenessCounts.get(ad.analysis.awarenessStage) ?? 0) + 1);
        formatCounts.set(ad.analysis.format, (formatCounts.get(ad.analysis.format) ?? 0) + 1);
        for (const offer of ad.analysis.offers) {
            const key = `${offer.kind}:${offer.detail.toLowerCase()}`;
            const existing = offerCounts.get(key);
            if (existing) existing.count += 1;
            else offerCounts.set(key, { kind: offer.kind, detail: offer.detail, count: 1 });
        }
    }

    // The primary angle is the one carried by the highest-exposure ads, not
    // simply the most frequent — a long tail of cheap ads should not outvote
    // the creative the brand is actually spending behind.
    const topAngle = [...angleBreakdown]
        .sort((a, b) => (b.avgExposure * b.adCount) - (a.avgExposure * a.adCount))[0]?.angle ?? null;

    const notes: string[] = [...brand.fetchErrors, ...research.errors];
    if (total === 0 && adsProvider !== 'none') {
        notes.push('No ads found in the Ad Library for this brand. It may not advertise on Meta, may run ads under a different page name, or may be outside the searched countries.');
    }

    const report: BrandReport = {
        brandName: brand.brandName,
        domain: brand.domain,
        websiteUrl: brand.url,
        sourceUrl: brand.sourceUrl,
        niche: brand.classification.niche,
        subNiche: brand.classification.subNiche,
        audience: brand.classification.audience,
        classificationConfidence: brand.classification.confidence,
        unclassified: brand.classification.unclassified,
        classificationEvidence: brand.classification.evidence,
        classificationAlternatives: brand.classification.alternatives,
        platform: brand.platform,
        socials: brand.socials,
        products: brand.products,
        adCount: total,
        adsProvider,
        adQueries: research.queries,
        exposureScore: average(ads.map((a) => a.exposure.score)),
        topAngle,
        angleBreakdown,
        awarenessBreakdown: [...awarenessCounts.entries()]
            .map(([stage, count]) => ({ stage, adCount: count, share: share(count, total) }))
            .sort((a, b) => b.adCount - a.adCount),
        formatBreakdown: [...formatCounts.entries()]
            .map(([format, count]) => ({ format, adCount: count, share: share(count, total) }))
            .sort((a, b) => b.adCount - a.adCount),
        topHooks: ads.slice(0, 10).map((ad) => {
            const hook: { hook: string; exposure: number; snapshotUrl?: string } = {
                hook: ad.analysis.hook,
                exposure: ad.exposure.score,
            };
            if (ad.snapshotUrl) hook.snapshotUrl = ad.snapshotUrl;
            return hook;
        }),
        commonOffers: [...offerCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        ads,
        creative: analyseCreativeSignals(ads, brand.domain),
        vocabulary: buildBrandVocabulary(ads, {
            brandName: brand.brandName,
            productNames: brand.products.map((p) => p.name),
        }),
        // Filled in by buildRunReport, once every brand is known.
        deviations: [],
        creativeCompetitors: [],
        notes,
        scrapedAt: new Date().toISOString(),
    };

    if (brand.techStack) report.techStack = brand.techStack;
    if (brand.commerce) report.commerce = brand.commerce;
    if (brand.classification.llmNote) report.llmNote = brand.classification.llmNote;
    if (brand.description) report.description = brand.description;
    if (brand.tagline) report.tagline = brand.tagline;
    if (brand.priceRange) report.priceRange = brand.priceRange;

    return report;
}

export interface RunReportMeta {
    sourceUrls: string[];
    brandsDiscovered: number;
    adsProvider: string;
    warnings: string[];
}

/** Rolls per-brand reports up into the cross-brand niche and angle view. */
export function buildRunReport(brands: BrandReport[], meta: RunReportMeta): RunReport {
    interface NicheBucket {
        brands: BrandReport[];
        subNiches: Map<string, BrandReport[]>;
    }
    const nicheMap = new Map<string, NicheBucket>();

    for (const brand of brands) {
        const fresh: NicheBucket = { brands: [], subNiches: new Map() };
        const entry = nicheMap.get(brand.niche) ?? fresh;
        entry.brands.push(brand);
        const subList = entry.subNiches.get(brand.subNiche) ?? [];
        subList.push(brand);
        entry.subNiches.set(brand.subNiche, subList);
        nicheMap.set(brand.niche, entry);
    }

    const niches = [...nicheMap.entries()]
        .map(([niche, entry]) => {
            const nicheAdTotal = entry.brands.reduce((sum, b) => sum + b.adCount, 0);
            const angleTotals = new Map<string, { label: string; count: number }>();
            for (const brand of entry.brands) {
                for (const angle of brand.angleBreakdown) {
                    const existing = angleTotals.get(angle.angle) ?? { label: angle.label, count: 0 };
                    existing.count += angle.adCount;
                    angleTotals.set(angle.angle, existing);
                }
            }
            return {
                niche,
                brandCount: entry.brands.length,
                brands: entry.brands.map((b) => b.brandName),
                subNiches: [...entry.subNiches.entries()]
                    .map(([subNiche, list]) => ({
                        subNiche,
                        brandCount: list.length,
                        brands: list.map((b) => b.brandName),
                    }))
                    .sort((a, b) => b.brandCount - a.brandCount),
                topAngles: [...angleTotals.entries()]
                    .map(([angle, t]) => ({ angle, label: t.label, adCount: t.count, share: share(t.count, nicheAdTotal) }))
                    .sort((a, b) => b.adCount - a.adCount)
                    .slice(0, 8),
            };
        })
        .sort((a, b) => b.brandCount - a.brandCount);

    const leaderboard = new Map<string, { label: string; adCount: number; brands: Set<string>; exposures: number[] }>();
    for (const brand of brands) {
        for (const angle of brand.angleBreakdown) {
            const entry = leaderboard.get(angle.angle)
                ?? { label: angle.label, adCount: 0, brands: new Set<string>(), exposures: [] };
            entry.adCount += angle.adCount;
            entry.brands.add(brand.brandName);
            entry.exposures.push(angle.avgExposure);
            leaderboard.set(angle.angle, entry);
        }
    }

    const topAdsOverall = brands
        .flatMap((brand) => brand.ads.map((ad) => ({
            brand: brand.brandName,
            hook: truncate(ad.analysis.hook, 180),
            angle: ad.analysis.primaryAngle,
            exposure: ad.exposure.score,
            ...(ad.snapshotUrl ? { snapshotUrl: ad.snapshotUrl } : {}),
        })))
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 25);

    // Cross-brand pass: every brand is now measured against its own niche and
    // against the other brands' creative fingerprints.
    const benchmarks = computeBenchmarks(brands);
    const benchmarkByNiche = new Map(benchmarks.map((b) => [b.niche, b]));
    for (const brand of brands) {
        const benchmark = benchmarkByNiche.get(brand.niche);
        if (benchmark) brand.deviations = computeDeviations(brand, benchmark);
        // Distinctive wording only means anything against a baseline, so it is
        // computed here rather than per brand in isolation.
        if (benchmark && brand.vocabulary) {
            brand.vocabulary.distinctive = distinctiveTerms(
                brand.vocabulary, benchmark.vocabulary, 8, brand.domain,
            );
        }
        brand.creativeCompetitors = creativeCompetitors(brand, brands);
    }

    return {
        generatedAt: new Date().toISOString(),
        sourceUrls: meta.sourceUrls,
        brandsDiscovered: meta.brandsDiscovered,
        brandsProfiled: brands.length,
        brandsWithAds: brands.filter((b) => b.adCount > 0).length,
        adsAnalysed: brands.reduce((sum, b) => sum + b.adCount, 0),
        adsProvider: meta.adsProvider,
        niches,
        angleLeaderboard: [...leaderboard.entries()]
            .map(([angle, entry]) => ({
                angle,
                label: entry.label,
                adCount: entry.adCount,
                brandCount: entry.brands.size,
                avgExposure: average(entry.exposures),
            }))
            .sort((a, b) => b.adCount - a.adCount),
        topAdsOverall,
        benchmarks,
        warnings: meta.warnings,
        brands,
    };
}

export function angleDescription(key: string): string {
    return ANGLE_BY_KEY.get(key)?.description ?? '';
}
