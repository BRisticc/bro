import type { RankedAd } from '../types.js';
import { classifyFunnel, type FunnelType } from './creative-signals.js';
import { share, truncate, uniq } from '../util/text.js';

/**
 * Groups a brand's ads by where they actually send the click.
 *
 * A brand running twelve ads at four landing pages is running four funnels,
 * not one, and the split tells you which page it is spending behind. Sibling
 * pages under the same directory, or the same path with different query
 * parameters, are the brand's own split tests — visible here and nowhere else.
 */

export interface LandingPageGroup {
    /** Canonical URL: tracking parameters removed, meaningful ones kept. */
    url: string;
    path: string;
    funnel: FunnelType;
    adCount: number;
    /** Percentage of the brand's ads pointing here. */
    adShare: number;
    /** Sum of exposure across the ads pointing here — the spend proxy. */
    totalExposure: number;
    medianExposure: number;
    topExposure: number;
    activeAds: number;
    /** Earliest and latest delivery start among the ads pointing here. */
    firstSeen?: string;
    lastSeen?: string;
    /** Longest run of any ad pointing here. */
    longestRunDays?: number;
    /** Angles used to drive traffic to this page, most common first. */
    angles: Array<{ angle: string; label: string; adCount: number }>;
    /** Hooks of the highest-exposure ads pointing here. */
    topHooks: string[];
    /** Distinct URLs that collapsed into this group — the brand's own variants. */
    variants: string[];
}

export interface LandingPageMap {
    /** Distinct destinations, ordered by exposure invested in them. */
    pages: LandingPageGroup[];
    /** Destinations that look like split tests of one another. */
    splitTests: Array<{ directory: string; pages: string[]; adCount: number }>;
    /** Ads whose destination the provider did not report. */
    unknownDestinationAds: number;
    /** How concentrated the spend is: share on the single biggest page. */
    topPageShare: number;
}

const TRACKING_PARAM = /^(utm_|fbclid|gclid|msclkid|ttclid|twclid|igshid|mc_cid|mc_eid|_ga|ref|referrer|campaign_id|ad_id|adset|placement)/i;

/**
 * Canonical form of a landing URL.
 *
 * Tracking parameters are dropped because they differ per ad and would split
 * one page into a dozen. Everything else is kept and sorted, because
 * `?variant=b` or `?plan=annual` genuinely is a different page.
 */
export function canonicalLandingUrl(raw: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...parsed.searchParams.keys()]) {
        if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    // Trailing slashes are not a different page.
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : sorted[mid] ?? 0;
    return Math.round(value * 10) / 10;
}

function directoryOf(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 1) return '/';
    return `/${parts.slice(0, -1).join('/')}`;
}

export function mapLandingPages(ads: RankedAd[], brandDomain?: string): LandingPageMap {
    const groups = new Map<string, RankedAd[]>();
    let unknown = 0;

    for (const ad of ads) {
        const canonical = ad.landingUrl ? canonicalLandingUrl(ad.landingUrl) : null;
        if (!canonical) {
            unknown += 1;
            continue;
        }
        const list = groups.get(canonical) ?? [];
        list.push(ad);
        groups.set(canonical, list);
    }

    const total = ads.length;
    const pages: LandingPageGroup[] = [];

    for (const [url, groupAds] of groups) {
        const exposures = groupAds.map((a) => a.exposure.score);
        const starts = groupAds.map((a) => a.startDate).filter((d): d is string => Boolean(d)).sort();
        const runs = groupAds.map((a) => a.daysRunning).filter((d): d is number => typeof d === 'number');

        const angleCounts = new Map<string, { label: string; adCount: number }>();
        for (const ad of groupAds) {
            for (const hit of ad.analysis.angles) {
                const entry = angleCounts.get(hit.angle) ?? { label: hit.label, adCount: 0 };
                entry.adCount += 1;
                angleCounts.set(hit.angle, entry);
            }
        }

        let path = url;
        try {
            path = new URL(url).pathname;
        } catch { /* keep the full URL */ }

        const group: LandingPageGroup = {
            url,
            path,
            funnel: classifyFunnel(url, brandDomain),
            adCount: groupAds.length,
            adShare: share(groupAds.length, total),
            totalExposure: Math.round(exposures.reduce((a, b) => a + b, 0) * 10) / 10,
            medianExposure: median(exposures),
            topExposure: Math.max(...exposures),
            activeAds: groupAds.filter((a) => a.isActive).length,
            angles: [...angleCounts.entries()]
                .map(([angle, e]) => ({ angle, label: e.label, adCount: e.adCount }))
                .sort((a, b) => b.adCount - a.adCount)
                .slice(0, 5),
            topHooks: [...groupAds]
                .sort((a, b) => b.exposure.score - a.exposure.score)
                .slice(0, 3)
                .map((a) => truncate(a.analysis.hook, 140)),
            variants: uniq(groupAds.map((a) => a.landingUrl).filter((u): u is string => Boolean(u))).slice(0, 6),
        };

        if (starts[0]) group.firstSeen = starts[0];
        if (starts[starts.length - 1]) group.lastSeen = starts[starts.length - 1];
        if (runs.length > 0) group.longestRunDays = Math.max(...runs);

        pages.push(group);
    }

    // Spend follows exposure, so ordering by it puts the page the brand is
    // actually backing at the top rather than the one with most ad records.
    pages.sort((a, b) => b.totalExposure - a.totalExposure || b.adCount - a.adCount);

    const byDirectory = new Map<string, LandingPageGroup[]>();
    for (const page of pages) {
        const dir = directoryOf(page.path);
        const list = byDirectory.get(dir) ?? [];
        list.push(page);
        byDirectory.set(dir, list);
    }

    const splitTests = [...byDirectory.entries()]
        .filter(([, list]) => list.length >= 2)
        .map(([directory, list]) => ({
            directory,
            pages: list.map((p) => p.path),
            adCount: list.reduce((sum, p) => sum + p.adCount, 0),
        }))
        .sort((a, b) => b.adCount - a.adCount);

    return {
        pages,
        splitTests,
        unknownDestinationAds: unknown,
        topPageShare: pages[0]?.adShare ?? 0,
    };
}
