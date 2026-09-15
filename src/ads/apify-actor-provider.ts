import { Actor, log } from 'apify';
import type { AdRecord } from '../types.js';
import { normaliseAdRecord } from './normalise.js';
import { attributeTerm, type AdSearchQuery, type AdsProvider } from './provider.js';

export interface ApifyActorOptions {
    actorId: string;
    extraInput?: Record<string, unknown>;
    memoryMbytes?: number;
    timeoutSecs?: number;
}

/** The public Ad Library search URL for a term. */
export function adLibraryUrl(term: string, country: string, activeStatus: string): string {
    const params = new URLSearchParams({
        active_status: activeStatus.toLowerCase(),
        ad_type: 'all',
        country: country.toUpperCase(),
        q: term,
        search_type: 'keyword_unordered',
        media_type: 'all',
    });
    return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/**
 * Delegates Ad Library scraping to an existing Apify actor
 * (apify/facebook-ads-scraper by default).
 *
 * This is the provider that reaches commercial ads worldwide, which the
 * official API does not. Every term for a brand goes into ONE nested run —
 * one run per brand, not one per product name, which is the difference
 * between a few compute units and a few hundred.
 *
 * Each ads actor has its own input and output shape, so the input below sets
 * the fields they broadly agree on and `adsApifyActorInput` is merged last so
 * any actor-specific option wins.
 */
export class ApifyActorAdsProvider implements AdsProvider {
    readonly name = 'apify-actor';

    readonly warnings: string[] = [];

    private readonly opts: ApifyActorOptions;

    constructor(opts: ApifyActorOptions) {
        this.opts = opts;
    }

    async search(query: AdSearchQuery): Promise<AdRecord[]> {
        const terms = query.terms.filter(Boolean);
        if (terms.length === 0) return [];

        const countries = query.countries.length > 0 ? query.countries : ['US'];
        const urls: string[] = [];
        for (const term of terms) {
            for (const country of countries) {
                urls.push(adLibraryUrl(term, country, query.activeStatus));
            }
        }

        const input: Record<string, unknown> = {
            startUrls: urls.map((url) => ({ url, method: 'GET' as const })),
            urls,
            searchTerms: terms,
            count: query.limit,
            resultsLimit: query.limit,
            maxItems: query.limit,
            activeStatus: query.activeStatus.toLowerCase(),
            countryCode: countries[0],
            ...(this.opts.extraInput ?? {}),
        };

        try {
            const callOptions: Parameters<typeof Actor.call>[2] = {};
            if (this.opts.memoryMbytes) callOptions.memory = this.opts.memoryMbytes;
            if (this.opts.timeoutSecs) callOptions.timeout = this.opts.timeoutSecs;

            const run = await Actor.call(this.opts.actorId, input, callOptions);
            if (!run?.defaultDatasetId) {
                this.warnings.push(`Ad Library actor "${this.opts.actorId}" returned no dataset for ${terms[0]}.`);
                return [];
            }

            const { items } = await Actor.apifyClient
                .dataset(run.defaultDatasetId)
                .listItems({ limit: query.limit });

            const records: AdRecord[] = [];
            for (const item of items) {
                const record = normaliseAdRecord(item as Record<string, unknown>, this.name, terms[0] ?? '');
                if (!record) continue;
                const attributed = attributeTerm(record, terms);
                if (attributed) record.matchedQuery = attributed;
                records.push(record);
            }

            if (records.length === 0 && items.length > 0) {
                this.warnings.push(
                    `Ad Library actor "${this.opts.actorId}" returned ${items.length} items but none matched a known `
                    + 'ad shape. Inspect that actor\'s output and map its fields via adsApifyActorInput.',
                );
            }
            return records;
        } catch (err) {
            const message = (err as Error).message;
            log.warning(`Ad Library actor call failed: ${message}`);
            this.warnings.push(`Ad Library actor call failed for "${terms[0]}": ${message}`);
            return [];
        }
    }
}
