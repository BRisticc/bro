import { gotScraping } from 'crawlee';
import type { AdRecord } from '../types.js';
import { normaliseAdRecord } from './normalise.js';
import { EU_COUNTRIES, type AdSearchQuery, type AdsProvider } from './provider.js';

const GRAPH_VERSION = 'v21.0';

const FIELDS = [
    'id', 'ad_creation_time', 'ad_delivery_start_time', 'ad_delivery_stop_time',
    'ad_creative_bodies', 'ad_creative_link_captions', 'ad_creative_link_descriptions',
    'ad_creative_link_titles', 'ad_snapshot_url', 'page_id', 'page_name',
    'publisher_platforms', 'languages', 'currency', 'impressions', 'spend',
    'eu_total_reach', 'target_ages', 'target_gender',
].join(',');

interface GraphResponse {
    data?: Record<string, unknown>[];
    paging?: { next?: string };
    error?: { message?: string; code?: number; type?: string };
}

export interface MetaGraphOptions {
    accessToken: string;
    timeoutSecs: number;
    retries: number;
    proxyUrl?: string;
}

/**
 * The official Meta Ad Library API.
 *
 * Two hard limits are worth understanding before reading the numbers:
 *  - `impressions` and `spend` are published only for political / issue ads.
 *  - For everything else, results are restricted to ads that reached the EU,
 *    where `eu_total_reach` is the exposure figure on offer.
 * Both are surfaced as warnings rather than silently producing empty columns.
 */
export class MetaGraphAdsProvider implements AdsProvider {
    readonly name = 'meta-graph';

    readonly warnings: string[] = [];

    private readonly opts: MetaGraphOptions;

    constructor(opts: MetaGraphOptions) {
        this.opts = opts;
    }

    async search(query: AdSearchQuery): Promise<AdRecord[]> {
        const collected: AdRecord[] = [];
        const perTerm = Math.max(10, Math.ceil(query.limit / Math.max(1, query.terms.length)));
        for (const term of query.terms) {
            if (collected.length >= query.limit) break;
            collected.push(...await this.searchTerm(term, query, perTerm));
        }
        return collected.slice(0, query.limit);
    }

    private async searchTerm(term: string, query: AdSearchQuery, limit: number): Promise<AdRecord[]> {
        const countries = query.countries.length > 0 ? query.countries : ['US'];
        const targetsEu = countries.some((c) => EU_COUNTRIES.has(c.toUpperCase()));
        const adType = targetsEu ? 'ALL' : 'POLITICAL_AND_ISSUE_ADS';

        if (!targetsEu && !this.warnings.some((w) => w.startsWith('No EU country'))) {
            this.warnings.push(
                'No EU country in adCountries: the Meta Ad Library API can only return political/issue ads '
                + 'for non-EU targeting. Add an EU code (e.g. "DE", "FR") or use the apify-actor provider '
                + 'to cover commercial ads.',
            );
        }

        const params = new URLSearchParams({
            access_token: this.opts.accessToken,
            search_terms: term,
            ad_reached_countries: JSON.stringify(countries.map((c) => c.toUpperCase())),
            ad_active_status: query.activeStatus,
            ad_type: adType,
            fields: FIELDS,
            limit: String(Math.min(100, Math.max(10, limit))),
        });

        let url: string | undefined = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive?${params.toString()}`;
        const collected: AdRecord[] = [];
        let pages = 0;

        while (url && collected.length < limit && pages < 10) {
            pages += 1;
            const response = await gotScraping({
                url,
                timeout: { request: this.opts.timeoutSecs * 1000 },
                proxyUrl: this.opts.proxyUrl,
                throwHttpErrors: false,
                retry: { limit: this.opts.retries },
                responseType: 'text',
            });

            let payload: GraphResponse;
            try {
                payload = JSON.parse(String(response.body)) as GraphResponse;
            } catch {
                this.warnings.push(`Meta Ad Library returned non-JSON (HTTP ${response.statusCode}) for "${term}".`);
                break;
            }

            if (payload.error) {
                this.warnings.push(`Meta Ad Library error for "${term}": ${payload.error.message ?? 'unknown error'}`);
                break;
            }

            for (const raw of payload.data ?? []) {
                const record = normaliseAdRecord(raw, this.name, term);
                if (record) collected.push(record);
            }

            url = payload.paging?.next;
        }

        return collected.slice(0, limit);
    }
}
