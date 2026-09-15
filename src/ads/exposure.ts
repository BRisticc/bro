import type { AdRecord, ExposureScore } from '../types.js';

export type RankBy = 'composite' | 'impressions' | 'reach' | 'longevity' | 'spend';

/** log10-based scaling so 1M reach does not make 100k look like zero. */
function logScale(value: number, ceiling: number): number {
    if (value <= 0) return 0;
    return Math.min(1, Math.log10(1 + value) / Math.log10(1 + ceiling));
}

function midpoint(min?: number, max?: number): number | undefined {
    if (min === undefined && max === undefined) return undefined;
    if (min !== undefined && max !== undefined) return (min + max) / 2;
    return min ?? max;
}

function formatCount(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(Math.round(value));
}

/**
 * Turns whatever exposure signals an ad happens to carry into one comparable
 * 0-100 score.
 *
 * Meta does not publish impressions for commercial ads, so on most runs the
 * real inputs are EU reach, how long the ad has been running and how many
 * creative variants share the copy. Longevity is the honest workhorse here:
 * advertisers switch off ads that do not work, so an ad still running after
 * three months is a winner even when no impression figure exists.
 *
 * Two rules keep the number honest. `signals` records which inputs were
 * actually available, so nobody mistakes an inference for a measurement. And
 * an ad carrying no *measured* exposure figure (impressions, reach or spend)
 * is capped below the top of the range: persistence is strong evidence, but
 * it should never outrank an ad whose reach is actually published.
 */
const UNMEASURED_CEILING = 85;
export function scoreExposure(ad: AdRecord, rankBy: RankBy = 'composite'): ExposureScore {
    const signals: string[] = [];
    const basisParts: string[] = [];

    const impressions = midpoint(ad.impressionsMin, ad.impressionsMax);
    const spend = midpoint(ad.spendMin, ad.spendMax);
    const reach = ad.euTotalReach;
    const days = ad.daysRunning;
    const variants = ad.variantCount;

    if (impressions !== undefined) {
        signals.push('impressions');
        basisParts.push(`~${formatCount(impressions)} impressions`);
    }
    if (reach !== undefined) {
        signals.push('eu-reach');
        basisParts.push(`EU reach ${formatCount(reach)}`);
    }
    if (spend !== undefined) {
        signals.push('spend');
        basisParts.push(`~${formatCount(spend)} ${ad.currency ?? ''} spend`.trim());
    }
    if (days !== undefined) {
        signals.push('longevity');
        basisParts.push(`running ${days} day${days === 1 ? '' : 's'}`);
    }
    if (variants !== undefined) {
        signals.push('variants');
        basisParts.push(`${variants} creative variants`);
    }
    if (ad.isActive) {
        signals.push('active');
        basisParts.push('still active');
    }

    const impressionScore = impressions !== undefined ? logScale(impressions, 10_000_000) : null;
    const reachScore = reach !== undefined ? logScale(reach, 5_000_000) : null;
    const spendScore = spend !== undefined ? logScale(spend, 500_000) : null;
    // 180 days is treated as a fully mature winner.
    const longevityScore = days !== undefined ? Math.min(1, days / 180) : null;
    const variantScore = variants !== undefined ? logScale(variants, 50) : null;

    let score: number;
    switch (rankBy) {
        case 'impressions':
            score = (impressionScore ?? reachScore ?? longevityScore ?? 0) * 100;
            break;
        case 'reach':
            score = (reachScore ?? impressionScore ?? longevityScore ?? 0) * 100;
            break;
        case 'spend':
            score = (spendScore ?? impressionScore ?? longevityScore ?? 0) * 100;
            break;
        case 'longevity':
            score = (longevityScore ?? 0) * 100;
            break;
        case 'composite':
        default: {
            // Weight each signal only if present, then renormalise, so an ad
            // with rich data is not penalised against one with none.
            const weighted: Array<[number | null, number]> = [
                [impressionScore, 0.35],
                [reachScore, 0.3],
                [spendScore, 0.1],
                [longevityScore, 0.2],
                [variantScore, 0.1],
            ];
            let total = 0;
            let weightSum = 0;
            for (const [value, weight] of weighted) {
                if (value === null) continue;
                total += value * weight;
                weightSum += weight;
            }
            score = weightSum > 0 ? (total / weightSum) * 100 : 0;
            if (ad.isActive) score = Math.min(100, score * 1.05);
            break;
        }
    }

    const hasMeasuredExposure = impressions !== undefined || reach !== undefined || spend !== undefined;
    const ceiling = hasMeasuredExposure ? 100 : UNMEASURED_CEILING;

    return {
        score: Math.round(Math.max(0, Math.min(ceiling, score)) * 10) / 10,
        signals,
        basis: basisParts.length > 0 ? basisParts.join('; ') : 'no exposure signals published for this ad',
    };
}

export function rankAds<T extends AdRecord>(ads: T[], rankBy: RankBy): Array<T & { exposure: ExposureScore }> {
    return ads
        .map((ad) => ({ ...ad, exposure: scoreExposure(ad, rankBy) }))
        .sort((a, b) => b.exposure.score - a.exposure.score);
}
