import type { CheerioAPI } from 'cheerio';
import { fetchJson, fetchPage, type FetchOptions } from '../util/http.js';
import { collapseWhitespace, truncate, uniq, wordCount } from '../util/text.js';
import { extractJsonLd, extractTextCorpus, load } from './extractors.js';

/**
 * Product and checkout-stage intelligence.
 *
 * A deliberate boundary runs through this file. Everything here is read from
 * pages the brand publishes for anyone to load. The checkout page proper is
 * not: it exists only behind a cart, so reaching it means programmatically
 * adding an item to a stranger's store — creating a session, an abandoned-cart
 * record and an analytics event on someone else's business. That is not
 * reading a public page, so the actor does not do it. What can be established
 * without side effects — the cart mechanics, the payment methods, the apps in
 * the checkout stack, the real shipping and returns terms — is gathered here,
 * and `checkoutNote` states plainly what was not reachable and why.
 */

export interface ProductPageIntel {
    url: string;
    ok: boolean;
    error?: string;
    title?: string;
    price?: number;
    compareAtPrice?: number;
    /** Discount implied by the struck-through price, which is the real offer. */
    discountPercent?: number;
    currency?: string;
    available?: boolean;
    variantCount?: number;
    optionNames: string[];
    subscriptionOffered: boolean;
    subscriptionDiscountPercent?: number;
    reviewCount?: number;
    reviewRating?: number;
    guaranteeDays?: number;
    /** Bundle or quantity-break offers on the page. */
    bundleTiers: string[];
    /** Trust marks and risk-reversal badges in the buy box area. */
    trustSignals: string[];
    imageCount: number;
    hasVideo: boolean;
    descriptionWordCount: number;
    /** Apps detected that shape the buying experience. */
    conversionApps: string[];
}

interface ShopifyProductJs {
    title?: string;
    price?: number;
    compare_at_price?: number | null;
    available?: boolean;
    variants?: Array<{ price?: number; available?: boolean }>;
    options?: Array<{ name?: string } | string>;
    description?: string;
    media?: unknown[];
    images?: unknown[];
}

const CONVERSION_APPS: Array<[string, RegExp]> = [
    ['Rebuy', /rebuyengine\.com/i],
    ['Zipify OCU', /zipify|oneclickupsell/i],
    ['ReConvert', /reconvert/i],
    ['AfterSell', /aftersell/i],
    ['Bold Upsell', /boldapps|bold-upsell/i],
    ['Recharge', /rechargepayments|rechargeapps/i],
    ['Skio', /skio\.com/i],
    ['Okendo', /okendo\.io/i],
    ['Yotpo', /yotpo\.com/i],
    ['Judge.me', /judge\.me/i],
    ['Loox', /loox\.io/i],
    ['Stamped', /stamped\.io/i],
    ['Gorgias', /gorgias\.(chat|com)/i],
    ['Klaviyo', /klaviyo/i],
    ['Postscript', /postscript\.io/i],
    ['Shop Pay', /shop_pay|shopifycloud\/shop-js/i],
    ['Klarna', /klarna/i],
    ['Afterpay', /afterpay/i],
    ['Affirm', /affirm\.com/i],
    ['Sezzle', /sezzle/i],
    ['PayPal', /paypal\.com|paypalobjects/i],
    ['Amazon Pay', /amazonpay|payments-amazon/i],
    ['Google Pay', /pay\.google\.com|googlepay/i],
    ['Apple Pay', /apple-pay|applepay/i],
];

const TRUST_PATTERNS: Array<[string, RegExp]> = [
    ['money-back guarantee', /money.?back guarantee/i],
    ['free shipping', /free shipping/i],
    ['free returns', /free returns/i],
    ['cancel anytime', /cancel any ?time/i],
    ['secure checkout', /secure checkout|ssl secured/i],
    ['third-party tested', /third.?party tested/i],
    ['made in USA', /made in (the )?usa/i],
    ['vegan', /\bvegan\b/i],
    ['cruelty-free', /cruelty.?free/i],
    ['subscribe and save', /subscribe (and|&) save/i],
];

function detectApps(html: string, patterns: Array<[string, RegExp]>): string[] {
    return uniq(patterns.filter(([, re]) => re.test(html)).map(([name]) => name));
}

function firstNumber(text: string, re: RegExp): number | undefined {
    re.lastIndex = 0;
    const match = re.exec(text);
    if (!match?.[1]) return undefined;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : undefined;
}

function priceFromJsonLd($: CheerioAPI): { price?: number; currency?: string } {
    for (const node of extractJsonLd($)) {
        const offers = node.offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        if (!offer || typeof offer !== 'object') continue;
        const record = offer as Record<string, unknown>;
        const price = Number(record.price ?? record.lowPrice);
        if (!Number.isFinite(price) || price <= 0) continue;
        const out: { price?: number; currency?: string } = { price };
        if (typeof record.priceCurrency === 'string') out.currency = record.priceCurrency;
        return out;
    }
    return {};
}

/**
 * Reads one product page.
 *
 * On Shopify the `.js` endpoint beside every product URL returns the same
 * structured record the storefront uses — exact price, compare-at price and
 * variant availability — which beats parsing rendered markup. Everything else
 * falls back to JSON-LD and then to the page text.
 */
export async function readProductPage(url: string, opts: FetchOptions): Promise<ProductPageIntel> {
    const intel: ProductPageIntel = {
        url, ok: false, optionNames: [], subscriptionOffered: false,
        bundleTiers: [], trustSignals: [], imageCount: 0, hasVideo: false,
        descriptionWordCount: 0, conversionApps: [],
    };

    let html: string;
    try {
        const res = await fetchPage(url, opts);
        if (res.statusCode >= 400) {
            intel.error = `HTTP ${res.statusCode}`;
            return intel;
        }
        html = res.body;
    } catch (err) {
        intel.error = (err as Error).message;
        return intel;
    }

    intel.ok = true;
    const $ = load(html);
    const text = extractTextCorpus(load(html), 30000);

    // Shopify's storefront product JSON, where it exists.
    if (/\/products\//i.test(url)) {
        const jsUrl = `${url.split('?')[0]?.replace(/\/$/, '')}.js`;
        const product = await fetchJson<ShopifyProductJs>(jsUrl, opts);
        if (product && typeof product.price === 'number') {
            // Shopify reports money in cents.
            intel.price = product.price / 100;
            if (typeof product.compare_at_price === 'number' && product.compare_at_price > product.price) {
                intel.compareAtPrice = product.compare_at_price / 100;
                intel.discountPercent = Math.round((1 - product.price / product.compare_at_price) * 100);
            }
            if (product.title) intel.title = truncate(collapseWhitespace(product.title), 160);
            if (typeof product.available === 'boolean') intel.available = product.available;
            if (Array.isArray(product.variants)) intel.variantCount = product.variants.length;
            if (Array.isArray(product.options)) {
                intel.optionNames = product.options
                    .map((o) => (typeof o === 'string' ? o : o?.name))
                    .filter((n): n is string => Boolean(n));
            }
            if (Array.isArray(product.media)) intel.imageCount = product.media.length;
            else if (Array.isArray(product.images)) intel.imageCount = product.images.length;
            if (product.description) {
                intel.descriptionWordCount = wordCount(load(product.description).text());
            }
        }
    }

    if (intel.price === undefined) {
        const fromLd = priceFromJsonLd($);
        if (fromLd.price !== undefined) intel.price = fromLd.price;
        if (fromLd.currency) intel.currency = fromLd.currency;
    }
    if (!intel.title) {
        const h1 = collapseWhitespace($('h1').first().text());
        if (h1) intel.title = truncate(h1, 160);
    }
    if (intel.imageCount === 0) intel.imageCount = $('img').length;
    if (intel.descriptionWordCount === 0) intel.descriptionWordCount = wordCount(text);
    intel.hasVideo = $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length > 0;

    intel.subscriptionOffered = /\b(subscribe (and|&) save|subscription|deliver every|auto.?ship)\b/i.test(text);
    const subDiscount = firstNumber(text, /subscribe (?:and|&) save\s*(\d{1,2})\s?%|save\s*(\d{1,2})\s?%\s*(?:on|with) subscription/gi);
    if (subDiscount !== undefined) intel.subscriptionDiscountPercent = subDiscount;

    const reviewCount = firstNumber(text, /([\d][\d,]*)\s*(?:verified\s*)?(?:reviews|ratings)/gi);
    if (reviewCount !== undefined) intel.reviewCount = reviewCount;
    const rating = firstNumber(text, /\b([45](?:\.\d)?)\s*(?:\/|out of)\s*5\b/gi);
    if (rating !== undefined) intel.reviewRating = rating;
    const guarantee = firstNumber(text, /(\d{1,3})[\s-]?(?:day|night)s?\s*(?:money.?back|guarantee|trial|risk.?free)/gi);
    if (guarantee !== undefined) intel.guaranteeDays = guarantee;

    intel.bundleTiers = uniq(
        (text.match(/\b(?:buy|get)\s*\d+\s*(?:,|and|&)?\s*(?:get|save)\s*\d+\s*%?|\d+[\s-]?(?:pack|month supply|bottle bundle)/gi) ?? [])
            .map((m) => collapseWhitespace(m)),
    ).slice(0, 6);

    intel.trustSignals = TRUST_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
    intel.conversionApps = detectApps(html, CONVERSION_APPS);

    return intel;
}

export interface CheckoutIntel {
    /** Currency the storefront prices in. */
    currency?: string;
    /** Cart is a slide-out drawer, a dedicated page, or unknown. */
    cartStyle: 'drawer' | 'page' | 'unknown';
    /** Free-shipping bar threshold shown in the cart, when stated. */
    freeShippingThreshold?: number;
    /** Payment methods offered at the storefront. */
    paymentMethods: string[];
    /** Buy-now-pay-later providers present. */
    bnpl: string[];
    /** Apps that shape cart and post-purchase flow. */
    checkoutStack: string[];
    /** Returns window in days, from the refund policy. */
    returnWindowDays?: number;
    restockingFee: boolean;
    /** Shipping terms as stated in the shipping policy. */
    shippingNote?: string;
    policiesRead: string[];
    /** Why the checkout page itself is not in this report. */
    checkoutNote: string;
}

const BNPL = ['Klarna', 'Afterpay', 'Affirm', 'Sezzle'];

/**
 * Everything about the buying flow that can be established without creating
 * state on the brand's store.
 */
export async function readCheckoutIntel(siteUrl: string, opts: FetchOptions): Promise<CheckoutIntel> {
    const intel: CheckoutIntel = {
        cartStyle: 'unknown', paymentMethods: [], bnpl: [], checkoutStack: [],
        restockingFee: false, policiesRead: [],
        checkoutNote: 'The checkout page itself exists only behind a cart, so reaching it would mean '
            + 'adding an item to this store programmatically — creating a session and an abandoned-cart '
            + 'record on someone else\'s business. This report covers what is readable without that.',
    };

    let html = '';
    try {
        const res = await fetchPage(siteUrl, opts);
        if (res.statusCode < 400) html = res.body;
    } catch { /* fall through with what we have */ }

    if (html) {
        const apps = detectApps(html, CONVERSION_APPS);
        intel.paymentMethods = apps.filter((a) => /pay|klarna|afterpay|affirm|sezzle/i.test(a));
        intel.bnpl = apps.filter((a) => BNPL.includes(a));
        intel.checkoutStack = apps.filter((a) => !intel.paymentMethods.includes(a));
        // A cart drawer is markup on every page; a cart page is a link to /cart.
        intel.cartStyle = /cart-drawer|drawer__cart|mini-cart|cart-flyout|slide-cart/i.test(html)
            ? 'drawer'
            : /href=["'][^"']*\/cart["']/i.test(html) ? 'page' : 'unknown';
    }

    // Shopify serves an empty-cart JSON for anyone, which states the currency
    // without creating anything.
    const cart = await fetchJson<{ currency?: string }>(new URL('/cart.js', siteUrl).toString(), opts);
    if (cart?.currency) intel.currency = cart.currency;

    const thresholdSource = html;
    const threshold = firstNumber(
        thresholdSource,
        /free shipping (?:for orders over|on orders over|on orders above|over|above)\s*[$£€]?\s*([\d,]+)/gi,
    );
    if (threshold !== undefined) intel.freeShippingThreshold = threshold;

    for (const path of ['/policies/refund-policy', '/policies/shipping-policy', '/pages/returns', '/pages/shipping']) {
        try {
            const res = await fetchPage(new URL(path, siteUrl).toString(), opts);
            if (res.statusCode >= 400) continue;
            const text = extractTextCorpus(load(res.body), 20000);
            if (wordCount(text) < 40) continue;
            intel.policiesRead.push(path);

            if (intel.returnWindowDays === undefined) {
                const window = firstNumber(text, /(\d{1,3})\s*(?:calendar\s*|business\s*)?days?\s*(?:of|from|after|to)\b[^.]{0,40}(?:return|refund|exchange)/gi)
                    ?? firstNumber(text, /return[^.]{0,40}?within\s*(\d{1,3})\s*days/gi);
                if (window !== undefined) intel.returnWindowDays = window;
            }
            if (/restocking fee/i.test(text)) intel.restockingFee = true;
            if (!intel.shippingNote && /ship/i.test(text)) {
                const sentence = text.split(/(?<=[.!?])\s+/).find((s) => /free shipping|shipping (cost|rate|fee)|flat rate/i.test(s));
                if (sentence) intel.shippingNote = truncate(sentence, 240);
            }
        } catch { /* a missing policy page is itself unremarkable */ }
    }

    return intel;
}
