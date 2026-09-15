import type { AngleHit } from '../types.js';
import { analyseCopy } from '../analyze/copy-analyzer.js';
import type { LandingPageGroup } from '../analyze/landing-pages.js';
import { fetchPage, mapWithConcurrency, type FetchOptions } from '../util/http.js';
import { collapseWhitespace, truncate, uniq, wordCount } from '../util/text.js';
import { extractCommerceSignals } from './commerce-signals.js';
import { extractTextCorpus, load } from './extractors.js';

/**
 * Opens the pages a brand's ads point at and reads them.
 *
 * Everything else in this actor is inference from the ad record. This is the
 * one place that looks at the page itself, which is the only way to answer
 * whether the promise the ad makes survives the click.
 */

export type PageShape = 'article' | 'listicle' | 'product-page' | 'quiz' | 'lead-form' | 'landing-page' | 'unknown';

export interface LandingTeardown {
    url: string;
    ok: boolean;
    statusCode?: number;
    error?: string;
    title?: string;
    h1?: string;
    /** Section headings in order — the page's argument structure. */
    headings: string[];
    wordCount: number;
    shape: PageShape;
    /** Price shown on the page, which can differ from the site's list price. */
    price?: number;
    currency?: string;
    guaranteeDays?: number;
    reviewCount?: number;
    reviewRating?: number;
    maxDiscountPercent?: number;
    /** Count of call-to-action elements. */
    ctaCount: number;
    hasForm: boolean;
    /** Angles the page itself runs, using the same detector as the ads. */
    pageAngles: AngleHit[];
    /**
     * How much the page's angles overlap the angles of the ads pointing at it,
     * 0-100. A low score with high ad spend is a message-match leak.
     */
    messageMatch?: number;
    messageMatchNote?: string;
}

function detectShape($: ReturnType<typeof load>, text: string, words: number): PageShape {
    const hasPrice = /[$£€]\s?\d/.test(text);
    const hasCart = /\b(add to (cart|bag)|buy now|select size|in stock|sold out)\b/i.test(text);
    const numberedHeadings = $('h2, h3').filter((_, el) => /^\s*\d+[.)]/.test($(el).text())).length;
    const inputs = $('input, select, textarea').length;

    if (numberedHeadings >= 3) return 'listicle';
    if (hasPrice && hasCart) return 'product-page';
    if (/\b(question \d|step \d of|take the quiz|find your)\b/i.test(text) && inputs >= 2) return 'quiz';
    if (inputs >= 3 && words < 600) return 'lead-form';
    // Structure carries more signal than raw length: an advertorial is many
    // paragraphs of continuous prose. A single word threshold misses a tight
    // 400-word editorial and catches a long spec-sheet PDP.
    const paragraphs = $('p').length;
    if ((paragraphs >= 8 && words >= 350) || (words >= 900 && paragraphs >= 5)) return 'article';
    if (words > 0) return 'landing-page';
    return 'unknown';
}

/** Jaccard overlap of two angle sets, as a percentage. */
function angleOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const key of setA) if (setB.has(key)) intersection += 1;
    const union = new Set([...setA, ...setB]).size;
    return Math.round((intersection / union) * 100);
}

export interface TeardownOptions extends FetchOptions {
    concurrency: number;
    maxPages: number;
}

async function teardownOne(page: LandingPageGroup, opts: FetchOptions): Promise<LandingTeardown> {
    const base: LandingTeardown = {
        url: page.url, ok: false, headings: [], wordCount: 0, shape: 'unknown',
        ctaCount: 0, hasForm: false, pageAngles: [],
    };

    let html: string;
    try {
        const res = await fetchPage(page.url, opts);
        base.statusCode = res.statusCode;
        if (res.statusCode >= 400) {
            base.error = `HTTP ${res.statusCode}`;
            return base;
        }
        html = res.body;
    } catch (err) {
        base.error = (err as Error).message;
        return base;
    }

    const $ = load(html);
    const title = collapseWhitespace($('title').first().text());
    const h1 = collapseWhitespace($('h1').first().text());
    const headings: string[] = [];
    $('h1, h2, h3').each((_, el) => {
        const text = collapseWhitespace($(el).text());
        if (text && text.length <= 160) headings.push(text);
    });

    const ctaCount = $('a, button').filter((_, el) => (
        /\b(shop|buy|order|get|start|try|claim|add to (cart|bag)|book|apply|subscribe|join)\b/i.test($(el).text())
    )).length;
    const hasForm = $('form').length > 0 || $('input[type="email"], input[type="tel"]').length > 0;

    // extractTextCorpus strips chrome, so take it before reusing $ elsewhere.
    const corpus = extractTextCorpus(load(html), 40000);
    const words = wordCount(corpus);

    const commerce = extractCommerceSignals(load(html), corpus, []);
    // The page's own copy goes through the ad analyser: the angle detector does
    // not care whether the words came from an ad or a page.
    const analysis = analyseCopy({
        id: page.url, provider: 'landing', publisherPlatforms: [], countries: [], languages: [],
        bodyText: truncate(corpus, 8000), mediaType: 'unknown',
        ...(title ? { title } : {}),
    });

    const teardown: LandingTeardown = {
        ...base,
        ok: true,
        headings: uniq(headings).slice(0, 20),
        wordCount: words,
        shape: detectShape($, corpus, words),
        ctaCount,
        hasForm,
        pageAngles: analysis.angles,
    };
    if (title) teardown.title = truncate(title, 200);
    if (h1) teardown.h1 = truncate(h1, 200);
    if (commerce.priceMin !== undefined) teardown.price = commerce.priceMin;
    if (commerce.currency) teardown.currency = commerce.currency;
    if (commerce.guaranteeDays !== undefined) teardown.guaranteeDays = commerce.guaranteeDays;
    if (commerce.reviewCount !== undefined) teardown.reviewCount = commerce.reviewCount;
    if (commerce.reviewRating !== undefined) teardown.reviewRating = commerce.reviewRating;
    if (commerce.maxDiscountPercent !== undefined) teardown.maxDiscountPercent = commerce.maxDiscountPercent;

    const adAngles = page.angles.map((a) => a.angle);
    const pageAngleKeys = teardown.pageAngles.map((a) => a.angle);
    if (adAngles.length > 0 && pageAngleKeys.length > 0) {
        teardown.messageMatch = angleOverlap(adAngles, pageAngleKeys);
        const shared = adAngles.filter((a) => pageAngleKeys.includes(a));
        const dropped = page.angles.filter((a) => !pageAngleKeys.includes(a.angle)).map((a) => a.label);
        teardown.messageMatchNote = shared.length === 0
            ? `the page runs none of the angles its ads run — the ads promise ${dropped.slice(0, 2).join(' and ')} and the page does not continue it`
            : dropped.length > 0
                ? `carries ${shared.length} of the ads' angles but drops ${dropped.slice(0, 2).join(' and ')}`
                : 'the page continues every angle its ads run';
    } else if (adAngles.length > 0) {
        teardown.messageMatch = 0;
        teardown.messageMatchNote = 'no angle detected on the page, while its ads run several';
    }

    return teardown;
}

/**
 * Tears down a brand's highest-exposure destinations.
 *
 * Capped and ordered by exposure so the request budget goes to the pages the
 * brand is actually spending behind, not to every one-off URL.
 */
export async function teardownLandingPages(
    pages: LandingPageGroup[],
    opts: TeardownOptions,
): Promise<LandingTeardown[]> {
    const targets = pages.slice(0, opts.maxPages);
    if (targets.length === 0) return [];
    return mapWithConcurrency(targets, opts.concurrency, async (page) => teardownOne(page, opts));
}
