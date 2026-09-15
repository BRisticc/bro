import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { profileBrand } from '../src/profile/brand-profiler.js';
import { classifyBrand } from '../src/classify/classifier.js';
import { BUILT_IN_TAXONOMY } from '../src/classify/taxonomy.js';
import { buildBrandReport, buildRunReport } from '../src/report/report-builder.js';
import { renderHtml, } from '../src/report/html.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { analyseCopy } from '../src/analyze/copy-analyzer.js';
import { scoreExposure } from '../src/ads/exposure.js';
import { NoOpAdsProvider } from '../src/ads/provider.js';
import { researchBrandAds } from '../src/ads/ad-research.js';
import type { AdRecord, BrandCandidate, RankedAd } from '../src/types.js';

const HOMEPAGE = `<!doctype html><html><head>
<title>Iron Peak — Testosterone support for men</title>
<meta property="og:site_name" content="Iron Peak">
<meta name="description" content="A clinically dosed testosterone booster for men over 40.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Iron Peak Labs",
 "description":"Men's performance supplements: testosterone support, libido and male vitality."}
</script>
<script>window.Shopify = {shop:"ironpeak.myshopify.com"};</script>
</head><body>
<h1>Built for men over 40</h1>
<a href="/about">Our story</a>
<a href="/products/daily-test">Daily Test</a>
<p>Tongkat ali and fadogia for male vitality.</p>
</body></html>`;

const ABOUT = `<!doctype html><html><head><title>About Iron Peak</title></head><body>
<p>We formulate a testosterone booster with clinically dosed tongkat ali. Low T is common in men over 40.
Our prostate support blend rounds out the men's multivitamin range.</p></body></html>`;

const PRODUCTS_JSON = JSON.stringify({
    products: [
        { title: 'Daily Test', handle: 'daily-test', variants: [{ price: '49.00' }], body_html: '<p>Testosterone booster with tongkat ali.</p>', tags: ['testosterone', 'mens'] },
        { title: 'Sleep Stack', handle: 'sleep-stack', variants: [{ price: '39.00' }], body_html: '<p>Magnesium glycinate for deep sleep.</p>' },
    ],
});

let server: http.Server;
let origin: string;

before(async () => {
    server = http.createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HOMEPAGE); return; }
        if (path === '/about') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(ABOUT); return; }
        if (path === '/products.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(PRODUCTS_JSON); return; }
        if (path === '/boom') { res.writeHead(503); res.end('nope'); return; }
        res.writeHead(404); res.end('not found');
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
});

function candidate(url: string): BrandCandidate {
    return {
        url, domain: '127.0.0.1', name: 'Iron Peak (from listicle)',
        sourceUrl: 'https://blog.example.com/best', anchorTexts: ['Iron Peak'], mentions: 2, discoveryScore: 90,
    };
}

const fetchOpts = { timeoutSecs: 10, retries: 0 };

describe('profiling a live brand site end to end', () => {
    it('prefers the site\'s own structured name over the listicle anchor text', async () => {
        const profile = await profileBrand(candidate(`${origin}/`), { ...fetchOpts, depth: 'standard', maxProducts: 8 });
        assert.equal(profile.brandName, 'Iron Peak Labs');
        assert.equal(profile.tagline, 'Built for men over 40');
        assert.equal(profile.platform, 'shopify');
        assert.deepEqual(profile.fetchErrors, []);
    });

    it('pulls products and prices from the Shopify endpoint', async () => {
        const profile = await profileBrand(candidate(`${origin}/`), { ...fetchOpts, depth: 'standard', maxProducts: 8 });
        const names = profile.products.map((p) => p.name);
        assert.ok(names.includes('Daily Test'));
        assert.ok(names.includes('Sleep Stack'));
        assert.equal(profile.priceRange?.min, 39);
        assert.equal(profile.priceRange?.max, 49);
        assert.ok(profile.pagesFetched.some((u) => u.includes('/products.json')));
    });

    it('fetches deeper pages only at deeper profiling depths', async () => {
        const fast = await profileBrand(candidate(`${origin}/`), { ...fetchOpts, depth: 'fast', maxProducts: 8 });
        assert.equal(fast.pagesFetched.length, 1);
        assert.equal(fast.products.length > 0, true, 'homepage links still yield products');

        const deep = await profileBrand(candidate(`${origin}/`), { ...fetchOpts, depth: 'deep', maxProducts: 8 });
        assert.ok(deep.pagesFetched.some((u) => u.endsWith('/about')));
        assert.ok(deep.corpus.includes('prostate'), 'about-page copy joins the classification corpus');
    });

    it('records a failure instead of throwing when the site is down', async () => {
        const profile = await profileBrand(candidate(`${origin}/boom`), { ...fetchOpts, depth: 'standard', maxProducts: 8 });
        assert.equal(profile.products.length, 0);
        assert.equal(profile.fetchErrors.length, 1);
        assert.match(profile.fetchErrors[0] ?? '', /503/);
    });

    it('classifies the profiled brand into the right niche and audience', async () => {
        const profile = await profileBrand(candidate(`${origin}/`), { ...fetchOpts, depth: 'deep', maxProducts: 8 });
        const classification = classifyBrand(profile, { taxonomy: BUILT_IN_TAXONOMY, minConfidence: 25 });
        assert.equal(classification.niche, 'Supplements');
        assert.equal(classification.subNiche, "Men's health");
        assert.equal(classification.audience, 'men');
        assert.equal(classification.unclassified, false);
    });
});

describe('the full journey, end to end', () => {
    it('goes site → profile → niche → ads → report without a live Ad Library', async () => {
        const profile = await profileBrand(candidate(`${origin}/`), { ...fetchOpts, depth: 'deep', maxProducts: 8 });
        const classified = {
            ...profile,
            classification: classifyBrand(profile, { taxonomy: BUILT_IN_TAXONOMY, minConfidence: 25 }),
        };

        // The no-op provider stands in for the Ad Library so the journey is
        // exercised without a network dependency or an API token.
        const research = await researchBrandAds(classified, {
            provider: new NoOpAdsProvider(),
            strategy: 'brand+products',
            countries: ['US'],
            activeStatus: 'ALL',
            adsPerBrand: 20,
            rankBy: 'composite',
            maxProductQueries: 3,
        });
        assert.ok(research.queries.includes('Iron Peak Labs'));
        assert.ok(research.queries.some((q) => q.includes('Daily Test')));
        assert.deepEqual(research.ads, []);

        // Substitute ads the Ad Library would have returned, then finish the run.
        const raw: AdRecord[] = [
            {
                id: 'ad-1', provider: 'fixture', publisherPlatforms: ['facebook'], countries: ['US'], languages: ['en'],
                bodyText: 'Tired of low energy at 40? Clinically dosed tongkat ali, trusted by 30,000 men. '
                    + '90-day money-back guarantee.',
                mediaType: 'video', euTotalReach: 1_400_000, daysRunning: 140, isActive: true,
                snapshotUrl: 'https://example.com/ad-1',
            },
            {
                id: 'ad-2', provider: 'fixture', publisherPlatforms: ['instagram'], countries: ['US'], languages: ['en'],
                bodyText: '25% off today only. Shop now.', mediaType: 'image', daysRunning: 4,
            },
        ];
        const ads: RankedAd[] = raw
            .map((ad) => ({ ...ad, exposure: scoreExposure(ad, 'composite'), analysis: analyseCopy(ad) }))
            .sort((a, b) => b.exposure.score - a.exposure.score);

        const brandReport = buildBrandReport(classified, { ...research, ads }, 'fixture');
        assert.equal(brandReport.niche, 'Supplements');
        assert.equal(brandReport.adCount, 2);
        assert.equal(brandReport.topHooks[0]?.hook, 'Tired of low energy at 40?', 'highest-exposure ad leads');
        assert.ok(brandReport.angleBreakdown.some((a) => a.angle === 'problem-agitation'));
        assert.ok(brandReport.angleBreakdown.some((a) => a.angle === 'social-proof'));
        assert.ok(brandReport.commonOffers.some((o) => o.kind === 'discount-percent'));

        const run = buildRunReport([brandReport], {
            sourceUrls: ['https://blog.example.com/best'], brandsDiscovered: 1, adsProvider: 'fixture', warnings: [],
        });
        assert.equal(run.niches[0]?.niche, 'Supplements');
        assert.equal(run.brandsWithAds, 1);
        assert.equal(run.topAdsOverall[0]?.brand, 'Iron Peak Labs');

        const md = renderMarkdown(run);
        const html = renderHtml(run);
        assert.ok(md.includes("Men's health"));
        assert.ok(html.includes('Iron Peak Labs'));
    });
});
