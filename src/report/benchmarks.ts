import type { BrandReport } from '../types.js';
import { ANGLE_LIBRARY } from '../analyze/angle-library.js';
import { share } from '../util/text.js';

/**
 * The cross-brand layer.
 *
 * Any single brand's report answers "what is this brand doing". These
 * functions answer the questions that actually drive decisions: what is
 * normal for this niche, where does this brand break from normal, which
 * brands are really competing for the same attention, and what is nobody
 * doing. None of it needs another request — it is all re-reading what the run
 * already collected.
 */

export interface MixEntry { key: string; label: string; share: number; }

export interface NicheBenchmark {
    niche: string;
    brandCount: number;
    adCount: number;
    /** Medians across the brands in this niche, where the signal exists. */
    medianPrice?: number;
    medianGuaranteeDays?: number;
    medianDiscountPercent?: number;
    medianReviewCount?: number;
    medianSophistication?: number;
    medianAdsPerBrand: number;
    medianLaunchesPerMonth?: number;
    /** Percentage of brands in the niche doing each of these. */
    subscriptionShare: number;
    paidMediaShare: number;
    reviewProgrammeShare: number;
    bnplShare: number;
    /** Percentage of the niche's ads carrying each angle/format/stage/funnel. */
    angleMix: MixEntry[];
    formatMix: MixEntry[];
    awarenessMix: MixEntry[];
    funnelMix: MixEntry[];
    postureMix: MixEntry[];
    /** Tools most of the niche has installed. Where the category standard is. */
    commonTools: Array<{ tool: string; brandShare: number }>;
    /** Angles the niche barely touches — the creative gaps. */
    angleWhitespace: Array<{ angle: string; label: string; share: number; description: string }>;
}

/** Below this many ads in a niche, angle shares are noise, not a pattern. */
const MIN_ADS_FOR_WHITESPACE = 10;

function median(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : sorted[mid] ?? 0;
    return Math.round(value * 100) / 100;
}

function defined<T>(values: Array<T | undefined>): T[] {
    return values.filter((v): v is T => v !== undefined && v !== null);
}

function mixFrom(counts: Map<string, { label: string; count: number }>, total: number): MixEntry[] {
    return [...counts.entries()]
        .map(([key, { label, count }]) => ({ key, label, share: share(count, total) }))
        .sort((a, b) => b.share - a.share);
}

function tally(map: Map<string, { label: string; count: number }>, key: string, label: string, by = 1): void {
    const existing = map.get(key);
    if (existing) existing.count += by;
    else map.set(key, { label, count: by });
}

export function computeBenchmarks(brands: BrandReport[]): NicheBenchmark[] {
    const byNiche = new Map<string, BrandReport[]>();
    for (const brand of brands) {
        const list = byNiche.get(brand.niche) ?? [];
        list.push(brand);
        byNiche.set(brand.niche, list);
    }

    const benchmarks: NicheBenchmark[] = [];

    for (const [niche, list] of byNiche) {
        const adTotal = list.reduce((sum, b) => sum + b.adCount, 0);

        const angleCounts = new Map<string, { label: string; count: number }>();
        const formatCounts = new Map<string, { label: string; count: number }>();
        const awarenessCounts = new Map<string, { label: string; count: number }>();
        const funnelCounts = new Map<string, { label: string; count: number }>();
        const postureCounts = new Map<string, { label: string; count: number }>();
        const toolCounts = new Map<string, number>();

        for (const brand of list) {
            for (const angle of brand.angleBreakdown) tally(angleCounts, angle.angle, angle.label, angle.adCount);
            for (const format of brand.formatBreakdown) tally(formatCounts, format.format, format.format, format.adCount);
            for (const stage of brand.awarenessBreakdown) tally(awarenessCounts, stage.stage, stage.stage, stage.adCount);
            for (const funnel of brand.creative?.funnelMix ?? []) tally(funnelCounts, funnel.funnel, funnel.funnel, funnel.adCount);
            if (brand.creative) tally(postureCounts, brand.creative.posture, brand.creative.posture, 1);
            for (const tool of brand.techStack?.all ?? []) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
        }

        const angleMix = mixFrom(angleCounts, adTotal);
        const seen = new Set(angleMix.map((a) => a.key));

        // Whitespace is both "used by almost nobody" and "used by literally
        // nobody" — the second is easy to miss if you only rank what appeared.
        // But below a real sample of ads it is not whitespace, it is just an
        // empty dataset: with no ads every angle reads as 0% and the whole
        // library would be reported as an opportunity.
        const whitespace = adTotal < MIN_ADS_FOR_WHITESPACE ? [] : [
            ...angleMix.filter((a) => a.share < 8).map((a) => ({ angle: a.key, label: a.label, share: a.share })),
            ...ANGLE_LIBRARY.filter((a) => !seen.has(a.key)).map((a) => ({ angle: a.key, label: a.label, share: 0 })),
        ]
            .sort((a, b) => a.share - b.share)
            .slice(0, 8)
            .map((a) => ({
                ...a,
                description: ANGLE_LIBRARY.find((x) => x.key === a.angle)?.description ?? '',
            }));

        const benchmark: NicheBenchmark = {
            niche,
            brandCount: list.length,
            adCount: adTotal,
            medianAdsPerBrand: median(list.map((b) => b.adCount)) ?? 0,
            subscriptionShare: share(list.filter((b) => b.commerce?.subscriptionOffered).length, list.length),
            paidMediaShare: share(list.filter((b) => b.techStack?.paidMediaTracking).length, list.length),
            reviewProgrammeShare: share(list.filter((b) => b.techStack?.reviewProgramme).length, list.length),
            bnplShare: share(list.filter((b) => b.techStack?.bnpl).length, list.length),
            angleMix,
            formatMix: mixFrom(formatCounts, adTotal),
            awarenessMix: mixFrom(awarenessCounts, adTotal),
            funnelMix: mixFrom(funnelCounts, adTotal),
            postureMix: mixFrom(postureCounts, list.length),
            commonTools: [...toolCounts.entries()]
                .map(([tool, count]) => ({ tool, brandShare: share(count, list.length) }))
                .sort((a, b) => b.brandShare - a.brandShare)
                .slice(0, 12),
            angleWhitespace: whitespace,
        };

        const assign = <K extends keyof NicheBenchmark>(key: K, value: NicheBenchmark[K] | undefined): void => {
            if (value !== undefined) benchmark[key] = value;
        };
        assign('medianPrice', median(defined(list.map((b) => b.commerce?.priceMedian))));
        assign('medianGuaranteeDays', median(defined(list.map((b) => b.commerce?.guaranteeDays))));
        assign('medianDiscountPercent', median(defined(list.map((b) => b.commerce?.maxDiscountPercent))));
        assign('medianReviewCount', median(defined(list.map((b) => b.commerce?.reviewCount))));
        assign('medianSophistication', median(defined(list.map((b) => b.techStack?.sophisticationScore))));
        if (adTotal > 0) {
            assign('medianLaunchesPerMonth', median(defined(
                list.filter((b) => b.adCount > 0).map((b) => b.creative?.launchesPerMonth),
            )));
        }

        benchmarks.push(benchmark);
    }

    return benchmarks.sort((a, b) => b.brandCount - a.brandCount);
}

export interface BrandDeviation {
    signal: string;
    brandValue: string;
    nicheValue: string;
    direction: 'above' | 'below' | 'absent' | 'unique';
    /** Why it matters, in one line. */
    note: string;
}

/** Only report a numeric gap when it is big enough to act on. */
function numericDeviation(
    signal: string,
    brandValue: number | undefined,
    nicheValue: number | undefined,
    note: (dir: 'above' | 'below', ratio: number) => string,
    minRatio = 1.4,
    unit = '',
): BrandDeviation | null {
    if (brandValue === undefined || nicheValue === undefined || nicheValue <= 0) return null;
    const ratio = brandValue / nicheValue;
    if (ratio >= minRatio) {
        return {
            signal,
            brandValue: `${brandValue}${unit}`,
            nicheValue: `${nicheValue}${unit}`,
            direction: 'above',
            note: note('above', ratio),
        };
    }
    if (ratio <= 1 / minRatio) {
        return {
            signal,
            brandValue: `${brandValue}${unit}`,
            nicheValue: `${nicheValue}${unit}`,
            direction: 'below',
            note: note('below', ratio),
        };
    }
    return null;
}

/**
 * Where this brand breaks from its niche. This is the part a human reads
 * first: not "what does this brand do" but "what does it do differently".
 */
/**
 * A niche of one or two brands has no norms to deviate from — its "median" is
 * just the brand itself, or the other one. Reporting deviations there invents
 * findings out of a sample size of two.
 */
const MIN_BRANDS_FOR_NORMS = 3;

export function computeDeviations(brand: BrandReport, benchmark: NicheBenchmark): BrandDeviation[] {
    if (benchmark.brandCount < MIN_BRANDS_FOR_NORMS) return [];

    const out: Array<BrandDeviation | null> = [];
    const pct = (n: number): string => `${Math.round(n * 100)}%`;

    out.push(numericDeviation(
        'Price', brand.commerce?.priceMedian, benchmark.medianPrice,
        (dir, ratio) => `prices ${pct(Math.abs(ratio - 1))} ${dir} the ${benchmark.niche} median — check whether the copy justifies it`,
    ));
    out.push(numericDeviation(
        'Discount depth', brand.commerce?.maxDiscountPercent, benchmark.medianDiscountPercent,
        (dir) => `discounts ${dir} the category norm`, 1.4, '%',
    ));
    out.push(numericDeviation(
        'Guarantee', brand.commerce?.guaranteeDays, benchmark.medianGuaranteeDays,
        (dir) => `guarantee window is ${dir} the category norm`, 1.4, ' days',
    ));
    out.push(numericDeviation(
        'Social proof volume', brand.commerce?.reviewCount, benchmark.medianReviewCount,
        (dir) => `review count is ${dir} the category norm`, 2,
    ));
    out.push(numericDeviation(
        'Ad volume', brand.adCount, benchmark.medianAdsPerBrand,
        (dir) => `running ${dir} as many ads as the typical brand here`, 1.8,
    ));
    out.push(numericDeviation(
        'Stack maturity', brand.techStack?.sophisticationScore, benchmark.medianSophistication,
        (dir) => `growth stack is ${dir} the category norm`, 1.4,
    ));

    // Categorical gaps: doing none of a thing most of the niche does.
    if (benchmark.subscriptionShare >= 60 && brand.commerce && !brand.commerce.subscriptionOffered) {
        out.push({
            signal: 'Subscription', brandValue: 'not offered',
            nicheValue: `${benchmark.subscriptionShare}% of the niche offers it`,
            direction: 'absent', note: 'the category monetises on repeat purchase and this brand does not',
        });
    }
    if (benchmark.paidMediaShare >= 60 && brand.techStack && !brand.techStack.paidMediaTracking) {
        out.push({
            signal: 'Paid media', brandValue: 'no ad pixel detected',
            nicheValue: `${benchmark.paidMediaShare}% of the niche tracks paid`,
            direction: 'absent', note: 'not set up to buy traffic while its competitors are',
        });
    }
    if (benchmark.reviewProgrammeShare >= 60 && brand.techStack && !brand.techStack.reviewProgramme) {
        out.push({
            signal: 'Reviews', brandValue: 'no review tool',
            nicheValue: `${benchmark.reviewProgrammeShare}% of the niche runs one`,
            direction: 'absent', note: 'collecting less social proof than the category standard',
        });
    }

    // Running an angle the niche has essentially abandoned, or vice versa.
    const nicheTop = benchmark.angleMix[0];
    const brandTop = brand.angleBreakdown[0];
    if (nicheTop && brandTop && brandTop.angle !== nicheTop.key) {
        out.push({
            signal: 'Lead angle', brandValue: brandTop.label,
            nicheValue: `${nicheTop.label} (${nicheTop.share}% of category ads)`,
            direction: 'unique',
            note: 'leads on a different angle from the category — deliberate differentiation or a blind spot',
        });
    }

    if (brand.creative && brand.creative.posture === 'stale') {
        out.push({
            signal: 'Creative freshness', brandValue: brand.creative.postureReason,
            nicheValue: `${benchmark.postureMix.find((p) => p.key === 'scaling')?.share ?? 0}% of the niche is scaling`,
            direction: 'below', note: 'competitors are shipping creative and this one is not',
        });
    }

    return out.filter((d): d is BrandDeviation => d !== null);
}

/**
 * Brands competing for the same attention, by creative fingerprint rather
 * than by product. Two supplement brands can sell different things and still
 * fight over the same feed slot because they run the same angle, format and
 * awareness stage — that is who you are actually bidding against.
 */
export function creativeCompetitors(
    brand: BrandReport,
    all: BrandReport[],
    limit = 3,
): Array<{ brand: string; similarity: number; sharedAngles: string[] }> {
    const vectorOf = (b: BrandReport): Map<string, number> => {
        const v = new Map<string, number>();
        for (const a of b.angleBreakdown) v.set(`angle:${a.angle}`, a.share);
        for (const f of b.formatBreakdown) v.set(`format:${f.format}`, f.share);
        for (const s of b.awarenessBreakdown) v.set(`aware:${s.stage}`, s.share);
        return v;
    };

    const mine = vectorOf(brand);
    if (mine.size === 0) return [];

    const scored = all
        .filter((other) => other.domain !== brand.domain && other.adCount > 0)
        .map((other) => {
            const theirs = vectorOf(other);
            let dot = 0;
            let normA = 0;
            let normB = 0;
            for (const [key, value] of mine) {
                dot += value * (theirs.get(key) ?? 0);
                normA += value * value;
            }
            for (const value of theirs.values()) normB += value * value;
            const similarity = normA > 0 && normB > 0
                ? Math.round((dot / (Math.sqrt(normA) * Math.sqrt(normB))) * 1000) / 10
                : 0;

            const sharedAngles = brand.angleBreakdown
                .filter((a) => other.angleBreakdown.some((o) => o.angle === a.angle))
                .slice(0, 4)
                .map((a) => a.label);

            return { brand: other.brandName, similarity, sharedAngles };
        })
        .filter((s) => s.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit);
}
