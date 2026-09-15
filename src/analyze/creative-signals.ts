import type { AdRecord, RankedAd } from '../types.js';
import { share } from '../util/text.js';

/**
 * Where an ad sends the click. The funnel type is one of the most useful
 * competitive facts there is and nobody publishes it — but the destination
 * URL gives it away, and we already have that URL on every ad.
 */
export type FunnelType =
    | 'advertorial' | 'listicle' | 'quiz' | 'product-page' | 'collection'
    | 'homepage' | 'landing-page' | 'lead-form' | 'app-store' | 'offsite' | 'unknown';

const FUNNEL_RULES: Array<{ type: FunnelType; re: RegExp }> = [
    { type: 'quiz', re: /\/(quiz|assessment|find-?your|match|consultation|diagnos)/i },
    { type: 'advertorial', re: /\/(blogs?|articles?|story|stories|read|learn|news|advertorial|why-|how-|the-truth)/i },
    { type: 'listicle', re: /\/(top-?\d|best-?\d|\d+-(reasons|ways|things|signs|mistakes)|listicle|ranked|comparison|vs-)/i },
    { type: 'lead-form', re: /\/(apply|book|schedule|demo|contact|get-?(a-)?quote|signup|sign-up|register|waitlist)/i },
    { type: 'app-store', re: /(apps\.apple\.com|play\.google\.com|itunes\.apple\.com)/i },
    { type: 'product-page', re: /\/(products?|item|sku|p)\/[^/]+/i },
    { type: 'collection', re: /\/(collections?|shop|category|categories|all-products|bestsellers)/i },
    { type: 'landing-page', re: /\/(lp|landing|offer|promo|deal|special|get-?started|try|start)/i },
];

export function classifyFunnel(landingUrl: string | undefined, brandDomain?: string): FunnelType {
    if (!landingUrl) return 'unknown';

    let parsed: URL;
    try {
        parsed = new URL(landingUrl);
    } catch {
        return 'unknown';
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (brandDomain && host !== brandDomain && !host.endsWith(`.${brandDomain}`)) {
        // Still classify app stores; anything else off-domain is a third party.
        if (/apps\.apple\.com|play\.google\.com/i.test(host)) return 'app-store';
        return 'offsite';
    }

    const path = parsed.pathname;
    // Order matters: /blogs/news/top-5-reasons should read as a listicle, not
    // a generic advertorial, so the more specific rules are tested first.
    for (const { type, re } of [...FUNNEL_RULES].sort((a, b) => (a.type === 'advertorial' ? 1 : 0) - (b.type === 'advertorial' ? 1 : 0))) {
        if (re.test(path) || re.test(host)) return type;
    }

    if (path === '/' || path === '') return 'homepage';
    return 'landing-page';
}

/** How the brand is behaving in the ad account right now. */
export type ScalingPosture = 'scaling' | 'testing' | 'steady' | 'stale' | 'absent';

export interface CreativeSignals {
    adCount: number;
    /** Ads whose delivery started in the last 30 days. */
    launchedLast30Days: number;
    /** Ads launched per month over the observed window. */
    launchesPerMonth: number;
    /** Days since the newest ad started. High means the account has gone quiet. */
    daysSinceNewestAd?: number;
    /** Median days an ad has been running — a proxy for how long winners last. */
    medianRunDays?: number;
    /** Longest-running ad, in days. The brand's most proven creative. */
    longestRunDays?: number;
    /** Ads still delivering. */
    activeAds: number;
    /** Total creative variants across all ads, where the provider reports them. */
    totalVariants: number;
    /** Mix of media types, as percentages. */
    mediaMix: Array<{ mediaType: string; share: number }>;
    /** Mix of publisher platforms, as percentages. */
    platformMix: Array<{ platform: string; share: number }>;
    /** Mix of funnel destinations, as percentages. */
    funnelMix: Array<{ funnel: FunnelType; adCount: number; share: number }>;
    posture: ScalingPosture;
    /** Plain-English reading of the posture. */
    postureReason: string;
}

function medianOf(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? Math.round((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2))
        : sorted[mid] ?? 0;
}

function daysSince(iso: string | undefined, now: number): number | undefined {
    if (!iso) return undefined;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return undefined;
    return Math.max(0, Math.round((now - t) / 86_400_000));
}

function mixOf(counts: Map<string, number>, total: number): Array<{ key: string; share: number }> {
    return [...counts.entries()]
        .map(([key, count]) => ({ key, share: share(count, total) }))
        .sort((a, b) => b.share - a.share);
}

/**
 * Reads the ad set as a whole rather than ad by ad.
 *
 * The posture is the headline: a brand with many recent launches and long
 * runners is scaling; lots of recent launches that all die young is testing;
 * nothing new for months is stale. That single word is often more actionable
 * than the angle breakdown, because it says whether the brand is a live
 * competitor or a coasting one.
 */
export function analyseCreativeSignals(
    ads: RankedAd[] | AdRecord[],
    brandDomain?: string,
    now: number = Date.now(),
): CreativeSignals {
    const total = ads.length;

    if (total === 0) {
        return {
            adCount: 0, launchedLast30Days: 0, launchesPerMonth: 0, activeAds: 0, totalVariants: 0,
            mediaMix: [], platformMix: [], funnelMix: [],
            posture: 'absent',
            postureReason: 'no ads found in the Ad Library',
        };
    }

    const ages = ads.map((ad) => daysSince(ad.startDate, now)).filter((d): d is number => d !== undefined);
    const runDays = ads.map((ad) => ad.daysRunning).filter((d): d is number => typeof d === 'number');
    const launchedLast30Days = ages.filter((d) => d <= 30).length;
    const daysSinceNewestAd = ages.length > 0 ? Math.min(...ages) : undefined;
    const observedWindow = ages.length > 0 ? Math.max(30, Math.max(...ages)) : 30;

    const mediaCounts = new Map<string, number>();
    const platformCounts = new Map<string, number>();
    const funnelCounts = new Map<FunnelType, number>();
    let totalVariants = 0;
    let activeAds = 0;

    for (const ad of ads) {
        mediaCounts.set(ad.mediaType, (mediaCounts.get(ad.mediaType) ?? 0) + 1);
        for (const platform of ad.publisherPlatforms.length > 0 ? ad.publisherPlatforms : ['unknown']) {
            platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
        }
        const funnel = classifyFunnel(ad.landingUrl, brandDomain);
        funnelCounts.set(funnel, (funnelCounts.get(funnel) ?? 0) + 1);
        totalVariants += ad.variantCount ?? 1;
        if (ad.isActive) activeAds += 1;
    }

    const medianRunDays = medianOf(runDays);
    const longestRunDays = runDays.length > 0 ? Math.max(...runDays) : undefined;
    const launchesPerMonth = Math.round((total / observedWindow) * 30 * 10) / 10;

    let posture: ScalingPosture;
    let postureReason: string;
    const hasLongRunner = (longestRunDays ?? 0) >= 90;
    const quiet = (daysSinceNewestAd ?? 999) > 60;

    if (quiet) {
        posture = 'stale';
        postureReason = `newest ad started ${daysSinceNewestAd} days ago — the account has gone quiet`;
    } else if (launchedLast30Days >= 5 && hasLongRunner) {
        posture = 'scaling';
        postureReason = `${launchedLast30Days} launches in 30 days with a ${longestRunDays}-day runner still live`;
    } else if (launchedLast30Days >= 5) {
        posture = 'testing';
        postureReason = `${launchedLast30Days} launches in 30 days but nothing has run past 90 days yet`;
    } else if (hasLongRunner) {
        posture = 'steady';
        postureReason = `few new launches, but a ${longestRunDays}-day runner is still delivering`;
    } else {
        posture = 'testing';
        postureReason = `${total} ad${total === 1 ? '' : 's'} observed, none established yet`;
    }

    const signals: CreativeSignals = {
        adCount: total,
        launchedLast30Days,
        launchesPerMonth,
        activeAds,
        totalVariants,
        mediaMix: mixOf(mediaCounts, total).map((m) => ({ mediaType: m.key, share: m.share })),
        platformMix: mixOf(platformCounts, total).map((m) => ({ platform: m.key, share: m.share })),
        funnelMix: [...funnelCounts.entries()]
            .map(([funnel, adCount]) => ({ funnel, adCount, share: share(adCount, total) }))
            .sort((a, b) => b.adCount - a.adCount),
        posture,
        postureReason,
    };

    if (daysSinceNewestAd !== undefined) signals.daysSinceNewestAd = daysSinceNewestAd;
    if (medianRunDays !== undefined) signals.medianRunDays = medianRunDays;
    if (longestRunDays !== undefined) signals.longestRunDays = longestRunDays;

    return signals;
}
