import { log } from 'apify';
import type { AdRecord, ClassifiedBrand, RankedAd } from '../types.js';
import { analyseCopy } from '../analyze/copy-analyzer.js';
import type { AdSearchStrategy } from '../input.js';
import { collapseWhitespace, uniq } from '../util/text.js';
import { rankAds, type RankBy } from './exposure.js';
import { dedupeAds } from './normalise.js';
import type { AdsProvider } from './provider.js';

export interface AdResearchOptions {
    provider: AdsProvider;
    strategy: AdSearchStrategy;
    countries: string[];
    activeStatus: 'ALL' | 'ACTIVE' | 'INACTIVE';
    adsPerBrand: number;
    rankBy: RankBy;
    maxProductQueries: number;
    /** Drop ads scoring below this before analysis. 0 keeps everything. */
    minExposureScore?: number;
}

/** Product names that are really categories make terrible Ad Library queries. */
function usefulProductQuery(name: string, brandName: string): boolean {
    const clean = collapseWhitespace(name);
    if (clean.length < 4 || clean.length > 60) return false;
    if (clean.toLowerCase() === brandName.toLowerCase()) return false;
    if (/^(gift card|e-?gift|sample|bundle|subscription|shop all|all products)/i.test(clean)) return false;
    return true;
}

/**
 * Builds the Ad Library search terms for a brand.
 *
 * Product queries are prefixed with the brand name when the product name is
 * generic ("Daily Greens"), because a bare generic term returns every
 * competitor's ads instead of this brand's.
 */
export function buildQueries(brand: ClassifiedBrand, strategy: AdSearchStrategy, maxProducts: number): string[] {
    const brandName = collapseWhitespace(brand.brandName || brand.name);
    const queries: string[] = [];

    if (strategy === 'brand' || strategy === 'brand+products') {
        if (brandName) queries.push(brandName);
    }

    if (strategy !== 'brand' && maxProducts > 0) {
        const productQueries = brand.products
            .map((p) => collapseWhitespace(p.name))
            .filter((name) => usefulProductQuery(name, brandName))
            .slice(0, maxProducts)
            .map((name) => {
                const isGeneric = name.split(/\s+/).length <= 3
                    && !name.toLowerCase().includes(brandName.toLowerCase());
                return isGeneric && brandName ? `${brandName} ${name}` : name;
            });
        queries.push(...productQueries);
    }

    return uniq(queries.filter(Boolean));
}

export interface BrandAdResearch {
    queries: string[];
    ads: RankedAd[];
    errors: string[];
}

/**
 * Runs every query for one brand, merges and ranks the results by exposure,
 * keeps the top N, then analyses the copy of those.
 *
 * Ranking happens before analysis on purpose: "target the highest-exposure
 * ads first" means the copy budget goes to the ads that actually ran at scale.
 */
export async function researchBrandAds(
    brand: ClassifiedBrand,
    opts: AdResearchOptions,
): Promise<BrandAdResearch> {
    const queries = buildQueries(brand, opts.strategy, opts.maxProductQueries);
    const errors: string[] = [];
    const collected: AdRecord[] = [];

    if (queries.length > 0) {
        try {
            const results = await opts.provider.search({
                terms: queries,
                countries: opts.countries,
                activeStatus: opts.activeStatus,
                // Over-fetch so ranking has something to choose from.
                limit: Math.min(500, Math.max(opts.adsPerBrand * 3, 30)),
            });
            log.debug(`Ad search for ${brand.brandName} (${queries.length} terms) -> ${results.length} ads`);
            collected.push(...results);
        } catch (err) {
            const message = (err as Error).message;
            errors.push(`ad search failed: ${message}`);
            log.warning(`Ad search failed for ${brand.brandName}: ${message}`);
        }
    }

    const floor = opts.minExposureScore ?? 0;
    const allRanked = rankAds(dedupeAds(collected), opts.rankBy);
    // Filter before the cap, so a floor of 60 returns the top N ads that clear
    // 60 rather than whatever survives inside an arbitrary first N.
    const kept = floor > 0 ? allRanked.filter((ad) => ad.exposure.score >= floor) : allRanked;
    const ranked = kept.slice(0, opts.adsPerBrand);
    const ads: RankedAd[] = ranked.map((ad) => ({ ...ad, analysis: analyseCopy(ad) }));

    if (floor > 0 && allRanked.length > 0 && kept.length === 0) {
        errors.push(
            `all ${allRanked.length} ads scored below the minExposureScore of ${floor}; `
            + 'lower it or widen adCountries — exposure scores are only comparable within a run',
        );
    }

    return { queries, ads, errors };
}
