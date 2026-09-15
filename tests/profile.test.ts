import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    detectPlatform, extractJsonLd, extractMeta, extractProductsFromHtml, extractSocials,
    extractTextCorpus, internalPagesToFetch, load, organisationFromJsonLd, parseShopifyProducts,
    productsFromJsonLd,
} from '../src/profile/extractors.js';

const PAGE = `<!doctype html><html><head>
<title>Iron Peak — Testosterone support</title>
<meta name="description" content="A testosterone booster for men over 40.">
<meta property="og:site_name" content="Iron Peak">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","name":"Iron Peak Labs","description":"Men's performance supplements."},
 {"@type":"Product","name":"Daily Test","url":"/products/daily-test","offers":{"@type":"Offer","price":"49.00","priceCurrency":"USD"}}]}</script>
<script>window.Shopify = {shop:"ironpeak.myshopify.com"};</script>
</head><body>
<h1>Built for men over 40</h1>
<nav><a href="/about-us">About us</a><a href="/collections/all">Shop all</a><a href="/login">Login</a></nav>
<a href="/products/daily-test">Daily Test</a>
<a href="/products/sleep-stack" title="Sleep Stack">Learn more</a>
<a href="/products/daily-test">Add to cart</a>
<a href="https://instagram.com/ironpeak">Instagram</a>
<a href="https://www.tiktok.com/@ironpeak">TikTok</a>
<style>.x{color:red}</style>
<p>Clinically dosed tongkat ali.</p>
</body></html>`;

const $ = load(PAGE);
const BASE = 'https://ironpeak.com/';

describe('page extractors', () => {
    it('reads title, description and tagline', () => {
        const meta = extractMeta($);
        assert.equal(meta.siteName, 'Iron Peak');
        assert.equal(meta.description, 'A testosterone booster for men over 40.');
        assert.equal(meta.tagline, 'Built for men over 40');
    });

    it('walks @graph when reading JSON-LD', () => {
        assert.equal(extractJsonLd($).length, 3, 'the graph node itself plus both members');
        assert.equal(organisationFromJsonLd(extractJsonLd($)).name, 'Iron Peak Labs');
    });

    it('survives malformed JSON-LD', () => {
        const broken = load('<script type="application/ld+json">{not json}</script>');
        assert.deepEqual(extractJsonLd(broken), []);
    });

    it('reads products with price and absolute URL from JSON-LD', () => {
        const products = productsFromJsonLd(extractJsonLd($), BASE);
        assert.equal(products[0]?.name, 'Daily Test');
        assert.equal(products[0]?.price, 49);
        assert.equal(products[0]?.url, 'https://ironpeak.com/products/daily-test');
    });

    it('finds products from storefront link shapes and skips CTA text', () => {
        const names = extractProductsFromHtml($, BASE, 10).map((p) => p.name);
        assert.ok(names.includes('Daily Test'));
        assert.ok(names.includes('Sleep Stack'), 'title attribute wins over "Learn more"');
        assert.ok(!names.includes('Add to cart'));
    });

    it('detects the storefront platform from several Shopify fingerprints', () => {
        assert.equal(detectPlatform(PAGE), 'shopify');
        assert.equal(detectPlatform('<img src="https://cdn.shopify.com/s/files/1/logo.png">'), 'shopify');
        assert.equal(detectPlatform('<script>window.Shopify = {};</script>'), 'shopify');
        assert.equal(detectPlatform('<link href="/wp-content/plugins/woocommerce/style.css">'), 'woocommerce');
        assert.equal(detectPlatform('<html><body>plain</body></html>'), 'unknown');
    });

    it('collects social profiles', () => {
        const socials = extractSocials($);
        assert.equal(socials.instagram, 'https://instagram.com/ironpeak');
        assert.ok(socials.tiktok?.includes('@ironpeak'));
    });

    it('strips script and style text from the corpus', () => {
        const corpus = extractTextCorpus(load(PAGE));
        assert.ok(corpus.includes('Clinically dosed tongkat ali'));
        assert.ok(!corpus.includes('var Shopify'));
        assert.ok(!corpus.includes('color:red'));
    });

    it('picks on-site pages worth a second fetch and skips login', () => {
        const pages = internalPagesToFetch($, BASE, 5);
        assert.ok(pages.some((u) => u.endsWith('/about-us')));
        assert.ok(pages.some((u) => u.includes('/collections/all')));
        assert.ok(!pages.some((u) => u.includes('/login')));
    });
});

describe('shopify products.json', () => {
    it('maps products, prices and description text', () => {
        const { products, extraText } = parseShopifyProducts({
            products: [
                { title: 'Daily Test', handle: 'daily-test', body_html: '<p>Supports <b>testosterone</b>.</p>', variants: [{ price: '49.00' }], tags: ['mens', 'test'] },
                { title: 'Sleep Stack', handle: 'sleep-stack', variants: [{ price: '39.00' }] },
            ],
        }, 'https://ironpeak.com', 10);

        assert.equal(products.length, 2);
        assert.equal(products[0]?.price, 49);
        assert.equal(products[0]?.url, 'https://ironpeak.com/products/daily-test');
        assert.equal(products[0]?.description, 'Supports testosterone.');
        assert.ok(extraText.includes('testosterone'));
        assert.ok(extraText.includes('mens'));
    });

    it('respects the product limit', () => {
        const many = { products: Array.from({ length: 20 }, (_, i) => ({ title: `Product ${i}`, handle: `p${i}` })) };
        assert.equal(parseShopifyProducts(many, 'https://a.com', 3).products.length, 3);
    });

    it('returns nothing for a non-Shopify payload', () => {
        assert.deepEqual(parseShopifyProducts({ error: 'nope' }, 'https://a.com', 5).products, []);
        assert.deepEqual(parseShopifyProducts(null, 'https://a.com', 5).products, []);
    });
});
