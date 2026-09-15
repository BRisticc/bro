import type { AdRecord } from '../types.js';

export interface AdSearchQuery {
    /** Every term to look up for one brand. Providers batch these as they can. */
    terms: string[];
    /** ISO-3166 alpha-2 codes. */
    countries: string[];
    activeStatus: 'ALL' | 'ACTIVE' | 'INACTIVE';
    /** Target number of ads to return across all terms. */
    limit: number;
}

export interface AdsProvider {
    readonly name: string;
    /** Warnings surfaced to the run report, e.g. "impressions unavailable". */
    readonly warnings: string[];
    /**
     * Searches the Ad Library for one brand.
     *
     * Takes every term at once rather than one per call: the Apify provider
     * turns a brand's whole term list into a single nested actor run, which is
     * the difference between one run per brand and one run per product name.
     */
    search(query: AdSearchQuery): Promise<AdRecord[]>;
}

export class NoOpAdsProvider implements AdsProvider {
    readonly name = 'none';

    readonly warnings = ['Ad research was disabled (adsProvider: "none"); reports contain classification only.'];

    async search(): Promise<AdRecord[]> {
        return [];
    }
}

/** EU/EEA codes. Outside these, Meta's public API only covers political ads. */
export const EU_COUNTRIES = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
]);

/**
 * Best-effort attribution of a batched result back to the term that found it.
 * Providers that lose per-term provenance (anything batching into one run)
 * use this so `matchedQuery` stays meaningful.
 */
export function attributeTerm(ad: AdRecord, terms: string[]): string | undefined {
    const haystack = `${ad.pageName ?? ''} ${ad.title ?? ''} ${ad.bodyText}`.toLowerCase();
    let best: { term: string; length: number } | undefined;
    for (const term of terms) {
        const needle = term.toLowerCase().trim();
        if (!needle || !haystack.includes(needle)) continue;
        if (!best || needle.length > best.length) best = { term, length: needle.length };
    }
    return best?.term ?? terms[0];
}
