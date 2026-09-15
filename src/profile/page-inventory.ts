import type { FetchOptions } from '../util/http.js';
import { fetchPage } from '../util/http.js';
import { normaliseUrl, registrableDomain } from '../util/domain.js';
import { share, uniq } from '../util/text.js';

/**
 * Discovers every page a brand publishes, from the brand's own declaration.
 *
 * Ads tell you what a brand spends on; they are a subset. robots.txt and the
 * sitemaps it points at tell you what exists — products, collections,
 * advertorials, landing pages, policies — without guessing a single URL. The
 * gap between the two is the finding: a brand with twenty advertorials and ad
 * spend behind three has seventeen it built and abandoned, or seventeen it is
 * about to test.
 */

export type PageKind =
    | 'product' | 'collection' | 'article' | 'landing' | 'quiz' | 'policy'
    | 'cart' | 'checkout' | 'account' | 'home' | 'other';

const KIND_RULES: Array<{ kind: PageKind; re: RegExp }> = [
    { kind: 'product', re: /\/(products?|item|sku)\/[^/]+$/i },
    { kind: 'collection', re: /\/(collections?|category|categories|shop|catalog)(\/|$)/i },
    { kind: 'article', re: /\/(blogs?|articles?|news|stories|journal|learn|guides?)\//i },
    { kind: 'quiz', re: /\/(quiz|assessment|find-your|match|consultation)/i },
    { kind: 'policy', re: /\/(policies|policy|terms|privacy|refund|shipping-policy|legal|returns)/i },
    { kind: 'cart', re: /\/cart(\/|$|\.js)/i },
    { kind: 'checkout', re: /\/(checkouts?|thank[_-]?you|order-confirmation)(\/|$)/i },
    { kind: 'account', re: /\/(account|login|register|orders)(\/|$)/i },
    { kind: 'landing', re: /\/(pages|lp|landing|offer|promo|deal|special|get-started|try)(\/|$)/i },
];

export function classifyPageKind(url: string): PageKind {
    let path: string;
    try {
        path = new URL(url).pathname;
    } catch {
        return 'other';
    }
    if (path === '/' || path === '') return 'home';
    for (const { kind, re } of KIND_RULES) {
        if (re.test(path)) return kind;
    }
    return 'other';
}

export interface PageInventory {
    /** Sitemaps actually read. */
    sitemapsRead: string[];
    /** Total URLs discovered, before the per-kind cap. */
    totalUrls: number;
    counts: Array<{ kind: PageKind; count: number; share: number }>;
    /** A sample of URLs per kind, so the numbers can be spot-checked. */
    samples: Partial<Record<PageKind, string[]>>;
    /** Pages the brand publishes but puts no ad spend behind. */
    unadvertised: Array<{ kind: PageKind; count: number; examples: string[] }>;
    /** Pages its ads point at that are not in the sitemap — unlisted funnels. */
    unlistedAdDestinations: string[];
    notes: string[];
}

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

function extractLocs(xml: string): string[] {
    LOC_RE.lastIndex = 0;
    const out: string[] = [];
    let match: RegExpExecArray | null = LOC_RE.exec(xml);
    while (match !== null) {
        if (match[1]) out.push(match[1].replace(/&amp;/g, '&'));
        match = LOC_RE.exec(xml);
    }
    return out;
}

function isSitemapIndex(xml: string): boolean {
    return /<sitemapindex[\s>]/i.test(xml);
}

/** Sitemap URLs declared in robots.txt, which is where a brand states them. */
async function sitemapsFromRobots(origin: string, opts: FetchOptions): Promise<string[]> {
    try {
        const res = await fetchPage(new URL('/robots.txt', origin).toString(), opts);
        if (res.statusCode >= 400) return [];
        return uniq(
            res.body
                .split(/\r?\n/)
                .map((line) => /^\s*sitemap:\s*(\S+)/i.exec(line)?.[1])
                .filter((url): url is string => Boolean(url)),
        );
    } catch {
        return [];
    }
}

export interface InventoryOptions extends FetchOptions {
    /** Hard cap on sitemap documents fetched, including the index. */
    maxSitemaps: number;
    /** Hard cap on URLs kept. */
    maxUrls: number;
    /** Ad destinations, so the gap between published and advertised is known. */
    adDestinations?: string[];
}

export async function buildPageInventory(
    siteUrl: string,
    opts: InventoryOptions,
): Promise<PageInventory> {
    const inventory: PageInventory = {
        sitemapsRead: [], totalUrls: 0, counts: [], samples: {},
        unadvertised: [], unlistedAdDestinations: [], notes: [],
    };

    const domain = registrableDomain(siteUrl);
    if (!domain) {
        inventory.notes.push('could not read the site origin');
        return inventory;
    }

    const declared = await sitemapsFromRobots(siteUrl, opts);
    // Shopify, WooCommerce and most CMSes serve one of these even when
    // robots.txt stays silent about it.
    const candidates = uniq([
        ...declared,
        new URL('/sitemap.xml', siteUrl).toString(),
        new URL('/sitemap_index.xml', siteUrl).toString(),
    ]);

    const queue = [...candidates];
    const seenSitemaps = new Set<string>();
    const urls = new Set<string>();

    while (queue.length > 0 && inventory.sitemapsRead.length < opts.maxSitemaps && urls.size < opts.maxUrls) {
        const next = queue.shift();
        if (!next || seenSitemaps.has(next)) continue;
        seenSitemaps.add(next);

        let xml: string;
        try {
            const res = await fetchPage(next, opts);
            if (res.statusCode >= 400) continue;
            xml = res.body;
        } catch {
            continue;
        }
        if (!xml.includes('<loc')) continue;

        inventory.sitemapsRead.push(next);
        const locs = extractLocs(xml);

        if (isSitemapIndex(xml)) {
            // Child sitemaps are queued, never followed off-domain.
            for (const loc of locs) {
                if (registrableDomain(loc) === domain) queue.push(loc);
            }
            continue;
        }

        for (const loc of locs) {
            if (urls.size >= opts.maxUrls) break;
            const clean = normaliseUrl(loc);
            if (!clean || registrableDomain(clean) !== domain) continue;
            urls.add(clean);
        }
    }

    if (inventory.sitemapsRead.length === 0) {
        inventory.notes.push('no readable sitemap — page inventory is limited to what the ads point at');
        return inventory;
    }
    if (urls.size >= opts.maxUrls) {
        inventory.notes.push(`URL cap of ${opts.maxUrls} reached; counts are a floor, not a total`);
    }

    const byKind = new Map<PageKind, string[]>();
    for (const url of urls) {
        const kind = classifyPageKind(url);
        const list = byKind.get(kind) ?? [];
        list.push(url);
        byKind.set(kind, list);
    }

    inventory.totalUrls = urls.size;
    inventory.counts = [...byKind.entries()]
        .map(([kind, list]) => ({ kind, count: list.length, share: share(list.length, urls.size) }))
        .sort((a, b) => b.count - a.count);
    for (const [kind, list] of byKind) {
        inventory.samples[kind] = list.slice(0, 5);
    }

    const advertised = new Set((opts.adDestinations ?? []).map((u) => normaliseUrl(u) ?? u));
    if (advertised.size > 0) {
        for (const [kind, list] of byKind) {
            if (!['article', 'landing', 'quiz', 'product'].includes(kind)) continue;
            const unadvertised = list.filter((u) => !advertised.has(u));
            if (unadvertised.length === 0) continue;
            inventory.unadvertised.push({ kind, count: unadvertised.length, examples: unadvertised.slice(0, 5) });
        }
        inventory.unadvertised.sort((a, b) => b.count - a.count);

        // A destination absent from the sitemap is usually a funnel page the
        // brand deliberately keeps unindexed — often its best one.
        inventory.unlistedAdDestinations = [...advertised]
            .filter((u) => registrableDomain(u) === domain && !urls.has(u))
            .slice(0, 10);
    }

    return inventory;
}
