import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectDiscoveryMode, discoverBrands, selfCandidate } from '../src/discovery/brand-discovery.js';
import { load } from '../src/profile/extractors.js';

const LISTICLE = `<!doctype html><html><head><title>Best men's supplement brands</title></head><body>
<nav><a href="https://facebook.com/blogpage">Facebook</a><a href="/about">About us</a></nav>
<article class="post-content">
  <h2><a href="https://ironpeak.com">Iron Peak</a></h2>
  <p>Iron Peak makes a testosterone booster. <a href="https://ironpeak.com/products/test">See the product</a>.</p>
  <h2><a href="https://vitalroot.co.uk/">Vital Root</a></h2>
  <p>Read more at <a href="https://vitalroot.co.uk/shop">their shop</a>.</p>
  <h2><a href="https://northlabs.com">North Labs</a></h2>
  <p>Also sold on <a href="https://amazon.com/dp/B01">Amazon</a>.</p>
  <p>Study: <a href="https://pubmed.ncbi.nlm.nih.gov/12345">PubMed</a></p>
  <p><a href="https://ironpeak.com/privacy">Privacy policy</a></p>
</article>
<footer><a href="https://instagram.com/blog">Instagram</a><a href="https://shopify.com">Powered by Shopify</a></footer>
</body></html>`;

const BRAND_SITE = `<!doctype html><html><head>
<title>Iron Peak — Testosterone support for men</title>
<meta property="og:site_name" content="Iron Peak">
</head><body><h1>Built for men over 40</h1>
<a href="https://instagram.com/ironpeak">IG</a></body></html>`;

const baseOpts = { includeDomains: [], excludeDomains: [], maxBrands: 25 };

describe('brand discovery', () => {
    it('finds the brands and ignores social, retailers, research and boilerplate', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/best-brands', baseOpts);
        const domains = found.map((b) => b.domain).sort();
        assert.deepEqual(domains, ['ironpeak.com', 'northlabs.com', 'vitalroot.co.uk']);
    });

    it('names brands from the heading that links to them', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/best-brands', baseOpts);
        const ironPeak = found.find((b) => b.domain === 'ironpeak.com');
        assert.equal(ironPeak?.name, 'Iron Peak');
        assert.equal(found.find((b) => b.domain === 'vitalroot.co.uk')?.name, 'Vital Root');
    });

    it('prefers the shallowest URL on each brand domain', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/x', baseOpts);
        assert.equal(found.find((b) => b.domain === 'ironpeak.com')?.url, 'https://ironpeak.com/');
    });

    it('counts repeat links as mentions', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/x', baseOpts);
        assert.ok((found.find((b) => b.domain === 'ironpeak.com')?.mentions ?? 0) >= 2);
    });

    it('drops same-site links so the publisher is never a candidate', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/x', baseOpts);
        assert.ok(!found.some((b) => b.domain === 'example.com'));
    });

    it('honours includeDomains as an allowlist', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/x', { ...baseOpts, includeDomains: ['northlabs.com'] });
        assert.deepEqual(found.map((b) => b.domain), ['northlabs.com']);
    });

    it('honours excludeDomains', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/x', { ...baseOpts, excludeDomains: ['ironpeak.com'] });
        assert.ok(!found.some((b) => b.domain === 'ironpeak.com'));
    });

    it('caps results at maxBrands', () => {
        const $ = load(LISTICLE);
        assert.equal(discoverBrands($, 'https://blog.example.com/x', { ...baseOpts, maxBrands: 2 }).length, 2);
    });

    it('scopes extraction to brandLinkSelector when given', () => {
        const $ = load(LISTICLE);
        const found = discoverBrands($, 'https://blog.example.com/x', { ...baseOpts, selector: 'footer' });
        assert.deepEqual(found, []);
    });
});

describe('discovery mode detection', () => {
    it('reads a listicle as an outbound-links page', () => {
        assert.equal(detectDiscoveryMode(load(LISTICLE), 'https://blog.example.com/x', baseOpts), 'outbound-links');
    });

    it('reads a brand homepage as single-brand', () => {
        assert.equal(detectDiscoveryMode(load(BRAND_SITE), 'https://ironpeak.com/', baseOpts), 'single-brand');
    });
});

describe('selfCandidate', () => {
    it('uses og:site_name for the brand name', () => {
        const candidate = selfCandidate(load(BRAND_SITE), 'https://ironpeak.com/');
        assert.equal(candidate?.name, 'Iron Peak');
        assert.equal(candidate?.domain, 'ironpeak.com');
        assert.equal(candidate?.discoveryScore, 100);
    });

    it('falls back to the title stem when og:site_name is absent', () => {
        const html = '<html><head><title>Vital Root | Clean supplements</title></head><body></body></html>';
        assert.equal(selfCandidate(load(html), 'https://vitalroot.com/')?.name, 'Vital Root');
    });
});
