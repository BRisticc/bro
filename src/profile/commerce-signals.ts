import type { CheerioAPI } from 'cheerio';
import type { ProductRecord } from '../types.js';
import { collapseWhitespace, normalise, truncate, uniq } from '../util/text.js';

/**
 * The commercial shape of a brand, read off its own site.
 *
 * These are the numbers a competitor actually cares about — what it costs,
 * what the guarantee is, how loud the social proof is — and unlike the angle
 * analysis they are directly comparable brand to brand.
 */
export interface CommerceSignals {
    /** Cheapest, dearest and median product price seen. */
    priceMin?: number;
    priceMax?: number;
    priceMedian?: number;
    currency?: string;
    /** How many distinct products we saw. A range-breadth proxy. */
    productCount: number;
    /** Subscribe-and-save or similar is offered on-site. */
    subscriptionOffered: boolean;
    /** Free shipping threshold in the site's currency, when stated. */
    freeShippingThreshold?: number;
    freeShippingUnconditional: boolean;
    /** Money-back guarantee window in days, when stated. */
    guaranteeDays?: number;
    /** Largest advertised discount, in percent. */
    maxDiscountPercent?: number;
    /** Highest review count claimed anywhere on the page. */
    reviewCount?: number;
    /** Star rating claimed, out of 5. */
    reviewRating?: number;
    /** Publications named in an "as seen in" strip. */
    pressMentions: string[];
    /** Certifications and trust marks stated in copy. */
    certifications: string[];
    /** Year the brand says it started, when stated. */
    foundedYear?: number;
}

const PRESS_NAMES = [
    'Forbes', 'Vogue', 'GQ', 'Cosmopolitan', 'Allure', 'Men\'s Health', 'Women\'s Health',
    'The New York Times', 'New York Times', 'Wall Street Journal', 'Bloomberg', 'TechCrunch',
    'Buzzfeed', 'Refinery29', 'Harper\'s Bazaar', 'Elle', 'Esquire', 'Wired', 'Goop',
    'Shape', 'Well+Good', 'Healthline', 'Runner\'s World', 'Business Insider', 'Fast Company',
];

const CERTIFICATIONS = [
    'NSF Certified', 'Informed Sport', 'Informed Choice', 'GMP', 'cGMP', 'USDA Organic',
    'Non-GMO Project', 'B Corp', 'Leaping Bunny', 'Certified Vegan', 'Climate Neutral',
    'Clean Label Project', 'Soil Association', 'Third-Party Tested', 'FSC', 'EWG Verified',
];

function median(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : sorted[mid] ?? 0;
    return Math.round(value * 100) / 100;
}

/** Reads "12,480 reviews" / "over 40k happy customers" as a number. */
function parseCount(raw: string): number {
    const clean = raw.replace(/[,\s]/g, '').toLowerCase();
    const match = /^([\d.]+)([km])?$/.exec(clean);
    if (!match) return 0;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return 0;
    if (match[2] === 'k') return Math.round(base * 1_000);
    if (match[2] === 'm') return Math.round(base * 1_000_000);
    return Math.round(base);
}

function firstNumber(text: string, re: RegExp, transform = (n: number) => n): number | undefined {
    re.lastIndex = 0;
    const match = re.exec(text);
    if (!match?.[1]) return undefined;
    const value = transform(Number(match[1].replace(/,/g, '')));
    return Number.isFinite(value) ? value : undefined;
}

export function extractCommerceSignals(
    $: CheerioAPI,
    corpus: string,
    products: ProductRecord[],
): CommerceSignals {
    const rawText = collapseWhitespace(`${corpus} ${$('body').text()}`);
    const text = normalise(rawText);

    const prices = products
        .map((p) => p.price)
        .filter((p): p is number => typeof p === 'number' && p > 0);

    const signals: CommerceSignals = {
        productCount: products.length,
        subscriptionOffered: /\b(subscribe (and|&) save|subscription|auto.?(ship|deliver)|deliver every|cancel any ?time)\b/.test(text),
        freeShippingUnconditional: /\bfree shipping\b(?!\s*(on|over|above|for orders))/.test(text),
        pressMentions: [],
        certifications: [],
    };

    if (prices.length > 0) {
        signals.priceMin = Math.min(...prices);
        signals.priceMax = Math.max(...prices);
        const mid = median(prices);
        if (mid !== undefined) signals.priceMedian = mid;
        const currency = products.find((p) => p.currency)?.currency;
        if (currency) signals.currency = currency;
    }

    // Alternation is longest-first on purpose: with "on" first, "free shipping
    // on orders over $50" matches "on" and then fails to find a number.
    const threshold = firstNumber(text, /free shipping (?:for orders over|on orders over|on orders above|over|above|on)\s*[$£€]?\s*([\d,]+)/gi);
    if (threshold !== undefined) signals.freeShippingThreshold = threshold;

    const guarantee = firstNumber(text, /([\d]{1,3})[\s-]?(?:day|night)s?\s*(?:money.?back|guarantee|trial|promise|risk.?free)/gi);
    if (guarantee !== undefined) signals.guaranteeDays = guarantee;

    // Take the loudest discount on the page: that is the one the brand leads with.
    const discounts = [...rawText.matchAll(/(\d{1,2})\s?%\s?off/gi)]
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n) && n > 0 && n < 100);
    if (discounts.length > 0) signals.maxDiscountPercent = Math.max(...discounts);

    const reviewCounts = [...rawText.matchAll(/([\d][\d,.]*\s?[km]?)\+?\s*(?:verified\s*)?(?:reviews|ratings|customers|happy customers)/gi)]
        .map((m) => parseCount(m[1] ?? ''))
        .filter((n) => n > 0);
    if (reviewCounts.length > 0) signals.reviewCount = Math.max(...reviewCounts);

    const rating = firstNumber(rawText, /\b([45](?:\.\d)?)\s*(?:\/|out of)\s*5\b/gi);
    if (rating !== undefined && rating >= 1 && rating <= 5) signals.reviewRating = rating;

    signals.pressMentions = uniq(PRESS_NAMES.filter((name) => rawText.includes(name))).slice(0, 10);
    signals.certifications = uniq(CERTIFICATIONS.filter((cert) => new RegExp(cert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(rawText))).slice(0, 10);

    const founded = firstNumber(rawText, /\b(?:since|est(?:ablished)?\.?|founded in)\s*(19\d{2}|20[0-2]\d)\b/gi);
    if (founded !== undefined) signals.foundedYear = founded;

    return signals;
}

/** Price tier relative to a niche median. Used for cross-brand positioning. */
export function priceTier(brandMedian: number | undefined, nicheMedian: number | undefined): string | null {
    if (brandMedian === undefined || nicheMedian === undefined || nicheMedian <= 0) return null;
    const ratio = brandMedian / nicheMedian;
    if (ratio >= 1.5) return 'premium';
    if (ratio >= 1.15) return 'above-market';
    if (ratio <= 0.66) return 'value';
    if (ratio <= 0.85) return 'below-market';
    return 'at-market';
}

export function summariseCommerce(signals: CommerceSignals): string {
    const bits: string[] = [];
    if (signals.priceMedian !== undefined) {
        bits.push(`median ${signals.priceMedian}${signals.currency ? ` ${signals.currency}` : ''}`);
    }
    if (signals.productCount > 0) bits.push(`${signals.productCount} products`);
    if (signals.subscriptionOffered) bits.push('subscription');
    if (signals.guaranteeDays !== undefined) bits.push(`${signals.guaranteeDays}-day guarantee`);
    if (signals.maxDiscountPercent !== undefined) bits.push(`up to ${signals.maxDiscountPercent}% off`);
    if (signals.reviewCount !== undefined) bits.push(`${signals.reviewCount.toLocaleString('en-US')} reviews`);
    if (signals.reviewRating !== undefined) bits.push(`${signals.reviewRating}/5`);
    return truncate(bits.join(' · '), 240) || 'no commercial signals found';
}
