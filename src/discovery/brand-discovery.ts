import type { CheerioAPI } from 'cheerio';
import type { BrandCandidate } from '../types.js';
import {
    brandNameFromDomain, hasDeniedPath, isDeniedDomain, normaliseUrl, registrableDomain, sameSite,
} from '../util/domain.js';
import { collapseWhitespace, truncate, uniq } from '../util/text.js';

/** Anchor texts that carry no brand information. */
const GENERIC_ANCHORS = /^(here|click here|link|website|site|visit|visit site|shop|shop now|buy|buy now|learn more|read more|see more|view|more|official site|official website|check price|see price|image|photo|source|\d+)$/i;

const CONTENT_SELECTORS = [
    'article', 'main', '[role="main"]', '.post-content', '.entry-content', '.article-body',
    '.post-body', '#content', '.content', '.blog-post',
];

export interface DiscoveryOptions {
    selector?: string;
    includeDomains: string[];
    excludeDomains: string[];
    maxBrands: number;
}

/** Picks the densest plausible content region so nav/footer links score lower. */
function contentRoot($: CheerioAPI, selector?: string): string {
    if (selector && $(selector).length > 0) return selector;
    for (const candidate of CONTENT_SELECTORS) {
        const node = $(candidate);
        if (node.length > 0 && node.find('a[href]').length >= 3) return candidate;
    }
    return 'body';
}

interface Accumulator {
    domain: string;
    urls: Map<string, number>;
    anchorTexts: string[];
    headingNames: string[];
    score: number;
    mentions: number;
}

function anchorQuality(text: string): number {
    const clean = collapseWhitespace(text);
    if (!clean) return -4;
    if (GENERIC_ANCHORS.test(clean)) return -6;
    const words = clean.split(/\s+/);
    if (words.length > 8) return -2;
    let score = 6;
    if (words.length <= 4) score += 4;
    // Brand names are almost always capitalised in editorial copy.
    if (/^[A-Z0-9]/.test(clean)) score += 3;
    if (/[A-Z]/.test(clean.slice(1))) score += 1;
    if (/[.!?]$/.test(clean)) score -= 3;
    return score;
}

/**
 * Extracts brand candidates from a source page.
 *
 * The heuristics are deliberately conservative: it is far cheaper for a user
 * to widen the net with `brandLinkSelector` than to sift 400 boilerplate links.
 */
export function discoverBrands($: CheerioAPI, pageUrl: string, opts: DiscoveryOptions): BrandCandidate[] {
    const root = contentRoot($, opts.selector);
    const accumulators = new Map<string, Accumulator>();
    const include = opts.includeDomains.map((d) => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);

    $(`${root} a[href]`).each((_, el) => {
        const node = $(el);
        const href = node.attr('href');
        if (!href) return;

        const abs = normaliseUrl(href, pageUrl);
        if (!abs) return;
        if (sameSite(abs, pageUrl)) return;
        if (hasDeniedPath(abs)) return;

        const domain = registrableDomain(abs);
        if (!domain) return;
        if (isDeniedDomain(domain, opts.excludeDomains)) return;
        if (include.length > 0 && !include.some((d) => domain === d || domain.endsWith(`.${d}`))) return;

        const text = collapseWhitespace(node.text());
        const fresh: Accumulator = {
            domain, urls: new Map(), anchorTexts: [], headingNames: [], score: 0, mentions: 0,
        };
        const acc = accumulators.get(domain) ?? fresh;

        acc.mentions += 1;
        acc.urls.set(abs, (acc.urls.get(abs) ?? 0) + 1);
        acc.score += anchorQuality(text);
        if (text && !GENERIC_ANCHORS.test(text) && text.length <= 80) acc.anchorTexts.push(text);

        // A link sitting inside (or directly under) a heading is nearly always
        // the subject of that section — the strongest brand-link signal there is.
        const heading = node.closest('h1, h2, h3, h4');
        if (heading.length > 0) {
            acc.score += 12;
            acc.headingNames.push(collapseWhitespace(heading.text()));
        } else {
            const prevHeading = node.parentsUntil(root).prevAll('h2, h3, h4').first();
            if (prevHeading.length > 0) {
                acc.score += 3;
                acc.headingNames.push(collapseWhitespace(prevHeading.text()));
            }
        }

        if (node.closest('li').length > 0) acc.score += 2;
        if (node.find('img').length > 0) acc.score += 2;
        if (node.closest('nav, footer, header, aside').length > 0) acc.score -= 10;
        if (/sponsored|affiliate|advertisement/i.test(node.attr('rel') ?? '')) acc.score += 1;

        accumulators.set(domain, acc);
    });

    const candidates: BrandCandidate[] = [];
    for (const acc of accumulators.values()) {
        // Repeated links to the same domain across a listicle are a positive
        // signal, but with heavy diminishing returns so a footer badge cannot win.
        const mentionBonus = Math.min(10, Math.log2(acc.mentions + 1) * 4);
        const rawScore = acc.score + mentionBonus;
        if (rawScore <= 0) continue;

        const url = pickBestUrl(acc.urls);
        if (!url) continue;

        candidates.push({
            url,
            domain: acc.domain,
            name: pickBrandName(acc),
            sourceUrl: pageUrl,
            anchorTexts: uniq(acc.anchorTexts).slice(0, 8),
            mentions: acc.mentions,
            discoveryScore: Math.round(Math.max(0, Math.min(100, rawScore * 2.5))),
        });
    }

    candidates.sort((a, b) => b.discoveryScore - a.discoveryScore || a.domain.localeCompare(b.domain));
    return candidates.slice(0, opts.maxBrands);
}

/** Prefers the shallowest URL on the domain — that is the brand's front door. */
function pickBestUrl(urls: Map<string, number>): string | null {
    let best: { url: string; depth: number; count: number } | null = null;
    for (const [url, count] of urls) {
        let depth = 99;
        try {
            depth = new URL(url).pathname.split('/').filter(Boolean).length;
        } catch { /* keep depth 99 */ }
        if (!best || depth < best.depth || (depth === best.depth && count > best.count)) {
            best = { url, depth, count };
        }
    }
    return best?.url ?? null;
}

function pickBrandName(acc: Accumulator): string {
    const stem = (acc.domain.split('.')[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // A heading that contains the domain stem is the most reliable name source:
    // "3. Hims — best for hair loss" tells us more than the anchor "Hims.com".
    for (const heading of acc.headingNames) {
        const stripped = heading.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (stem.length >= 4 && stripped.includes(stem)) {
            const cleaned = heading.replace(/^\s*\d+[.)]\s*/, '').split(/[—–|:]/)[0];
            if (cleaned && collapseWhitespace(cleaned).length >= 2) return truncate(cleaned, 60);
        }
    }

    for (const text of acc.anchorTexts) {
        const stripped = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (stem.length >= 4 && stripped.includes(stem)) return truncate(text, 60);
    }

    const shortest = [...acc.anchorTexts].sort((a, b) => a.length - b.length)[0];
    if (shortest && shortest.length >= 2 && shortest.split(/\s+/).length <= 5) return truncate(shortest, 60);

    return brandNameFromDomain(acc.domain);
}

/**
 * Decides whether a page is a list of brands or a single brand's own site.
 * Three or more distinct external domains that survived filtering means
 * the page is talking *about* brands.
 */
export function detectDiscoveryMode($: CheerioAPI, pageUrl: string, opts: DiscoveryOptions): 'outbound-links' | 'single-brand' {
    const found = discoverBrands($, pageUrl, { ...opts, maxBrands: 100 });
    return found.length >= 3 ? 'outbound-links' : 'single-brand';
}

/** Builds the single candidate representing the source page's own site. */
export function selfCandidate($: CheerioAPI, pageUrl: string): BrandCandidate | null {
    const domain = registrableDomain(pageUrl);
    if (!domain) return null;
    const name = collapseWhitespace(
        $('meta[property="og:site_name"]').attr('content')
        ?? $('meta[name="application-name"]').attr('content')
        ?? $('title').first().text().split(/[|\-–—]/)[0]
        ?? '',
    ) || brandNameFromDomain(domain);
    return {
        url: pageUrl,
        domain,
        name: truncate(name, 60),
        sourceUrl: pageUrl,
        anchorTexts: [],
        mentions: 1,
        discoveryScore: 100,
    };
}
