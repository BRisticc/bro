import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { EcommercePlatform, ProductRecord } from '../types.js';
import { normaliseUrl } from '../util/domain.js';
import { collapseWhitespace, looksLikeProductName, truncate, uniq } from '../util/text.js';

export function load(html: string): CheerioAPI {
    return cheerio.load(html);
}

export interface MetaInfo {
    siteTitle?: string;
    siteName?: string;
    description?: string;
    tagline?: string;
}

export function extractMeta($: CheerioAPI): MetaInfo {
    const pick = (...selectors: string[]): string | undefined => {
        for (const sel of selectors) {
            const value = collapseWhitespace($(sel).first().attr('content') ?? '');
            if (value) return value;
        }
        return undefined;
    };

    const siteTitle = collapseWhitespace($('title').first().text()) || undefined;
    const siteName = pick('meta[property="og:site_name"]', 'meta[name="application-name"]');
    const description = pick(
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
    );
    // The first h1 is, on a homepage, usually the positioning line.
    const h1 = collapseWhitespace($('h1').first().text());
    const tagline = h1 && h1.length <= 140 ? h1 : undefined;

    const info: MetaInfo = {};
    if (siteTitle) info.siteTitle = truncate(siteTitle, 200);
    if (siteName) info.siteName = truncate(siteName, 120);
    if (description) info.description = truncate(description, 500);
    if (tagline) info.tagline = tagline;
    return info;
}

export function extractJsonLd($: CheerioAPI): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim();
        if (!raw) return;
        try {
            const parsed: unknown = JSON.parse(raw);
            const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
            while (queue.length > 0) {
                const node = queue.shift();
                if (!node || typeof node !== 'object') continue;
                const record = node as Record<string, unknown>;
                out.push(record);
                const graph = record['@graph'];
                if (Array.isArray(graph)) queue.push(...graph);
            }
        } catch { /* malformed JSON-LD is extremely common; skip it */ }
    });
    return out;
}

function jsonLdType(node: Record<string, unknown>): string[] {
    const t = node['@type'];
    if (typeof t === 'string') return [t];
    if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
    return [];
}

export function organisationFromJsonLd(nodes: Record<string, unknown>[]): { name?: string; description?: string } {
    for (const node of nodes) {
        const types = jsonLdType(node).map((t) => t.toLowerCase());
        if (!types.some((t) => ['organization', 'corporation', 'brand', 'website', 'localbusiness', 'onlinestore'].includes(t))) continue;
        const name = typeof node.name === 'string' ? collapseWhitespace(node.name) : undefined;
        const description = typeof node.description === 'string' ? collapseWhitespace(node.description) : undefined;
        if (name || description) {
            const out: { name?: string; description?: string } = {};
            if (name) out.name = truncate(name, 120);
            if (description) out.description = truncate(description, 500);
            return out;
        }
    }
    return {};
}

export function productsFromJsonLd(nodes: Record<string, unknown>[], baseUrl: string): ProductRecord[] {
    const products: ProductRecord[] = [];
    for (const node of nodes) {
        if (!jsonLdType(node).some((t) => t.toLowerCase() === 'product')) continue;
        const name = typeof node.name === 'string' ? collapseWhitespace(node.name) : '';
        if (!looksLikeProductName(name)) continue;
        const product: ProductRecord = { name: truncate(name, 90) };

        const url = typeof node.url === 'string' ? normaliseUrl(node.url, baseUrl) : null;
        if (url) product.url = url;
        if (typeof node.description === 'string') product.description = truncate(collapseWhitespace(node.description), 300);

        const offers = node.offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        if (offer && typeof offer === 'object') {
            const o = offer as Record<string, unknown>;
            const price = Number(o.price ?? o.lowPrice);
            if (Number.isFinite(price) && price > 0) product.price = price;
            if (typeof o.priceCurrency === 'string') product.currency = o.priceCurrency;
        }
        products.push(product);
    }
    return products;
}

const PLATFORM_FINGERPRINTS: Array<[EcommercePlatform, RegExp]> = [
    ['shopify', /cdn\.shopify\.com|Shopify\.(theme|shop|routes)\b|window\.Shopify\b|shopify-section|myshopify\.com/i],
    ['woocommerce', /woocommerce|wp-content\/plugins\/woocommerce/i],
    ['bigcommerce', /bigcommerce\.com|cdn\d*\.bigcommerce/i],
    ['magento', /Magento|mage\/cookies|static\/version\d+/i],
    ['squarespace', /squarespace\.com|static1\.squarespace/i],
    ['wix', /wix\.com|wixstatic\.com|parastorage\.com/i],
];

export function detectPlatform(html: string): EcommercePlatform {
    for (const [platform, re] of PLATFORM_FINGERPRINTS) {
        if (re.test(html)) return platform;
    }
    return 'unknown';
}

const SOCIAL_PATTERNS: Array<[string, RegExp]> = [
    ['instagram', /instagram\.com\/[A-Za-z0-9_.]+/i],
    ['facebook', /facebook\.com\/[A-Za-z0-9_.\-]+/i],
    ['tiktok', /tiktok\.com\/@[A-Za-z0-9_.]+/i],
    ['youtube', /youtube\.com\/(@[A-Za-z0-9_.\-]+|c\/[A-Za-z0-9_.\-]+|channel\/[A-Za-z0-9_\-]+)/i],
    ['twitter', /(?:twitter|x)\.com\/[A-Za-z0-9_]+/i],
    ['pinterest', /pinterest\.[a-z.]+\/[A-Za-z0-9_\-]+/i],
    ['linkedin', /linkedin\.com\/company\/[A-Za-z0-9_\-]+/i],
];

export function extractSocials($: CheerioAPI): Record<string, string> {
    const socials: Record<string, string> = {};
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        for (const [network, re] of SOCIAL_PATTERNS) {
            if (socials[network]) continue;
            const match = re.exec(href);
            if (match) socials[network] = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
        }
    });
    return socials;
}

/** Product links on a storefront follow very consistent URL shapes. */
const PRODUCT_URL_RE = /\/(products?|item|shop|collections\/[^/]+\/products)\/[^/?#]+/i;

export function extractProductsFromHtml($: CheerioAPI, baseUrl: string, limit: number): ProductRecord[] {
    const seen = new Map<string, ProductRecord>();

    $('a[href]').each((_, el) => {
        if (seen.size >= limit * 4) return;
        const node = $(el);
        const href = node.attr('href') ?? '';
        if (!PRODUCT_URL_RE.test(href)) return;
        const url = normaliseUrl(href, baseUrl);
        if (!url) return;

        const name = collapseWhitespace(
            node.attr('title')
            || node.text()
            || node.find('img').attr('alt')
            || '',
        );
        if (!looksLikeProductName(name)) return;
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, { name: truncate(name, 90), url });
    });

    return [...seen.values()].slice(0, limit);
}

interface ShopifyProductsResponse {
    products?: Array<{
        title?: string;
        handle?: string;
        body_html?: string;
        product_type?: string;
        tags?: string[] | string;
        variants?: Array<{ price?: string; }>;
    }>;
}

/** Shopify exposes /products.json publicly — by far the cleanest product source. */
export function parseShopifyProducts(
    payload: unknown,
    baseUrl: string,
    limit: number,
): { products: ProductRecord[]; extraText: string } {
    const data = payload as ShopifyProductsResponse | null;
    if (!data || !Array.isArray(data.products)) return { products: [], extraText: '' };

    const products: ProductRecord[] = [];
    const textBits: string[] = [];

    for (const raw of data.products.slice(0, limit * 3)) {
        const name = collapseWhitespace(raw.title ?? '');
        if (!looksLikeProductName(name)) continue;

        const product: ProductRecord = { name: truncate(name, 90) };
        if (raw.handle) {
            const url = normaliseUrl(`/products/${raw.handle}`, baseUrl);
            if (url) product.url = url;
        }
        const price = Number(raw.variants?.[0]?.price);
        if (Number.isFinite(price) && price > 0) product.price = price;

        if (raw.body_html) {
            const text = collapseWhitespace(cheerio.load(raw.body_html).text());
            if (text) {
                product.description = truncate(text, 300);
                textBits.push(text);
            }
        }
        if (raw.product_type) textBits.push(raw.product_type);
        if (Array.isArray(raw.tags)) textBits.push(raw.tags.join(' '));
        else if (typeof raw.tags === 'string') textBits.push(raw.tags);

        products.push(product);
        if (products.length >= limit) break;
    }

    return { products, extraText: truncate(textBits.join(' '), 20000) };
}

/** Visible page text with chrome removed, capped so one huge page cannot dominate. */
export function extractTextCorpus($: CheerioAPI, maxChars = 30000): string {
    const $$ = $;
    $$('script, style, noscript, svg, iframe, template').remove();
    const body = collapseWhitespace($$('body').text());
    return truncate(body, maxChars);
}

/** Candidate on-site URLs worth fetching for extra classification signal. */
export function internalPagesToFetch($: CheerioAPI, baseUrl: string, limit: number): string[] {
    const wanted = /\/(about|about-us|our-story|story|science|how-it-works|why|mission|shop|collections|products|all-products|bestsellers|faq|ingredients|benefits)(\/|$|\?)/i;
    const urls: string[] = [];
    $('a[href]').each((_, el) => {
        if (urls.length >= limit * 3) return;
        const href = $(el).attr('href') ?? '';
        if (!wanted.test(href)) return;
        const abs = normaliseUrl(href, baseUrl);
        if (!abs) return;
        try {
            if (new URL(abs).hostname !== new URL(baseUrl).hostname) return;
        } catch { return; }
        urls.push(abs);
    });
    return uniq(urls).slice(0, limit);
}
