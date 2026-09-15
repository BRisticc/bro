import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonicalLandingUrl, mapLandingPages } from '../src/analyze/landing-pages.js';
import { findProvenWinners } from '../src/analyze/creative-signals.js';
import { teardownLandingPages } from '../src/profile/landing-teardown.js';
import { analyseCopy } from '../src/analyze/copy-analyzer.js';
import { scoreExposure } from '../src/ads/exposure.js';
import type { AdRecord, RankedAd } from '../src/types.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const DAY = 86_400_000;

function ad(id: string, body: string, landingUrl: string, days: number, reach?: number): RankedAd {
    const base: AdRecord = {
        id, provider: 't', publisherPlatforms: ['facebook'], countries: ['US'], languages: ['en'],
        bodyText: body, mediaType: 'video', landingUrl, daysRunning: days, isActive: true,
        startDate: new Date(NOW - days * DAY).toISOString(),
        ...(reach !== undefined ? { euTotalReach: reach } : {}),
    };
    return { ...base, exposure: scoreExposure(base), analysis: analyseCopy(base) };
}

describe('canonical landing URLs', () => {
    it('strips tracking parameters that differ per ad', () => {
        assert.equal(
            canonicalLandingUrl('https://www.brand.com/lp/offer?utm_source=fb&fbclid=xyz&ad_id=9'),
            'https://brand.com/lp/offer',
        );
    });

    it('keeps parameters that genuinely change the page', () => {
        assert.equal(
            canonicalLandingUrl('https://brand.com/lp/offer?variant=b&utm_medium=cpc'),
            'https://brand.com/lp/offer?variant=b',
        );
    });

    it('treats a trailing slash as the same page', () => {
        assert.equal(canonicalLandingUrl('https://brand.com/lp/offer/'), canonicalLandingUrl('https://brand.com/lp/offer'));
    });

    it('rejects anything that is not an http URL', () => {
        assert.equal(canonicalLandingUrl('mailto:a@b.com'), null);
        assert.equal(canonicalLandingUrl('nonsense'), null);
    });
});

describe('landing page map', () => {
    const ads = [
        ad('1', 'Tired of low energy? Clinically proven formula.', 'https://brand.com/blogs/news/why-men-lose-energy?utm_source=fb', 120, 900_000),
        ad('2', 'Tired of low energy? Trusted by 40,000 men.', 'https://brand.com/blogs/news/why-men-lose-energy?fbclid=1', 90, 500_000),
        ad('3', '25% off today only. Shop now.', 'https://brand.com/products/daily-test', 10),
        ad('4', 'Take the quiz to find your dose.', 'https://brand.com/quiz', 45),
        ad('5', 'Another take on the same story.', 'https://brand.com/blogs/news/the-real-reason-you-are-tired', 30),
    ];
    const map = mapLandingPages(ads, 'brand.com');

    it('collapses the same page reached with different tracking', () => {
        const article = map.pages.find((p) => p.path === '/blogs/news/why-men-lose-energy');
        assert.ok(article, map.pages.map((p) => p.path).join(', '));
        assert.equal(article.adCount, 2);
        assert.equal(article.variants.length, 2, 'both raw URLs are kept for reference');
    });

    it('orders destinations by the exposure invested behind them', () => {
        assert.equal(map.pages[0]?.path, '/blogs/news/why-men-lose-energy');
        assert.ok((map.pages[0]?.totalExposure ?? 0) > (map.pages[1]?.totalExposure ?? 0));
    });

    it('classifies each destination as a funnel type', () => {
        const byPath = new Map(map.pages.map((p) => [p.path, p.funnel]));
        assert.equal(byPath.get('/products/daily-test'), 'product-page');
        assert.equal(byPath.get('/quiz'), 'quiz');
        assert.equal(byPath.get('/blogs/news/why-men-lose-energy'), 'advertorial');
    });

    it('records which angles drive traffic to each page', () => {
        const article = map.pages.find((p) => p.path === '/blogs/news/why-men-lose-energy');
        assert.ok(article?.angles.some((a) => a.angle === 'problem-agitation'));
    });

    it('spots sibling pages under one directory as a split test', () => {
        const test = map.splitTests.find((t) => t.directory === '/blogs/news');
        assert.ok(test, `split tests: ${map.splitTests.map((t) => t.directory).join(', ')}`);
        assert.equal(test.pages.length, 2);
    });

    it('counts ads whose destination the provider did not report', () => {
        const withMissing = mapLandingPages([...ads, ad('6', 'no link', '', 5)], 'brand.com');
        assert.equal(withMissing.unknownDestinationAds, 1);
    });

    it('reports how concentrated the spend is', () => {
        assert.equal(map.topPageShare, 40);
    });

    it('handles a brand with no ads', () => {
        const empty = mapLandingPages([], 'brand.com');
        assert.deepEqual(empty.pages, []);
        assert.equal(empty.topPageShare, 0);
    });
});

describe('proven winners', () => {
    const ads = [
        ad('old1', 'Tired of low energy? Clinically proven formula.', 'https://brand.com/blogs/a', 150, 900_000),
        ad('old2', 'Tired of low energy? Clinically proven and tested.', 'https://brand.com/blogs/b', 120, 700_000),
        ad('new1', '25% off today. Shop now.', 'https://brand.com/products/x', 5),
        ad('new2', 'New drop out now.', 'https://brand.com/products/y', 3),
    ];

    it('keeps only ads that survived the threshold', () => {
        const winners = findProvenWinners(ads, 60, 'brand.com');
        assert.deepEqual(winners.adIds, ['old1', 'old2']);
        assert.equal(winners.adCount, 2);
        assert.match(winners.criteria, /at least 60 days/);
    });

    it('names the angle every winner shares', () => {
        const winners = findProvenWinners(ads, 60, 'brand.com');
        assert.ok(winners.sharedAngles.some((a) => a.angle === 'problem-agitation'));
        assert.match(winners.pattern, /every one runs/, winners.pattern);
    });

    it('says plainly when nothing has proven itself yet', () => {
        const winners = findProvenWinners(ads.slice(2), 60, 'brand.com');
        assert.equal(winners.adCount, 0);
        assert.match(winners.pattern, /still a test/);
    });

    it('says so when there is nothing to judge', () => {
        assert.match(findProvenWinners([], 60).pattern, /no ads to judge/);
    });

    it('respects a different threshold', () => {
        assert.equal(findProvenWinners(ads, 130, 'brand.com').adCount, 1);
    });
});

// ---------------------------------------------------------------- live teardown

const ADVERTORIAL = `<!doctype html><html><head><title>Why men lose energy after 40</title></head><body>
<h1>Why men lose energy after 40</h1>
<h2>The real reason nobody tells you</h2>
${'<p>Tired of low energy? Most men are, and it is not their fault. Clinically proven research shows the cause.</p>'.repeat(30)}
<h2>What actually helps</h2>
<p>90-day money-back guarantee. Rated 4.8 out of 5 from 12,000 reviews.</p>
<a href="/products/x">Shop now</a><a href="/products/x">Buy now</a>
</body></html>`;

const PDP = `<!doctype html><html><head><title>Daily Test</title></head><body>
<h1>Daily Test</h1><p>$49.00</p><button>Add to cart</button>
<p>In stock. Free shipping.</p></body></html>`;

let server: http.Server;
let origin: string;

before(async () => {
    server = http.createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/advertorial') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(ADVERTORIAL); return; }
        if (path === '/pdp') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PDP); return; }
        res.writeHead(404); res.end('gone');
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
});

describe('landing page teardown', () => {
    const opts = { timeoutSecs: 10, retries: 0, concurrency: 2, maxPages: 5 };

    it('reads an advertorial and reports its shape and structure', async () => {
        const ads = [ad('1', 'Tired of low energy? Clinically proven formula.', `${origin}/advertorial`, 100, 500_000)];
        const [teardown] = await teardownLandingPages(mapLandingPages(ads).pages, opts);
        assert.ok(teardown?.ok, teardown?.error);
        assert.equal(teardown.shape, 'article');
        assert.equal(teardown.h1, 'Why men lose energy after 40');
        assert.ok(teardown.wordCount > 100);
        assert.ok(teardown.ctaCount >= 2);
        assert.ok(teardown.headings.includes('What actually helps'));
        assert.equal(teardown.guaranteeDays, 90);
        assert.equal(teardown.reviewRating, 4.8);
    });

    it('scores message match when the page continues the ad\'s angle', async () => {
        const ads = [ad('1', 'Tired of low energy? Clinically proven formula.', `${origin}/advertorial`, 100, 500_000)];
        const [teardown] = await teardownLandingPages(mapLandingPages(ads).pages, opts);
        assert.ok((teardown?.messageMatch ?? 0) > 0, `match was ${teardown?.messageMatch}`);
        assert.ok(teardown?.messageMatchNote);
    });

    it('flags a page that drops the angle its ads promise', async () => {
        const ads = [ad('1', 'Tired of low energy? Sick of the afternoon crash? Fed up?', `${origin}/pdp`, 100, 500_000)];
        const [teardown] = await teardownLandingPages(mapLandingPages(ads).pages, opts);
        assert.ok(teardown?.ok);
        assert.equal(teardown.shape, 'product-page');
        assert.ok((teardown.messageMatch ?? 100) < 60, `match was ${teardown.messageMatch}`);
        assert.match(teardown.messageMatchNote ?? '', /page/);
    });

    it('records a failure instead of throwing', async () => {
        const ads = [ad('1', 'copy', `${origin}/missing`, 10)];
        const [teardown] = await teardownLandingPages(mapLandingPages(ads).pages, opts);
        assert.equal(teardown?.ok, false);
        assert.equal(teardown?.statusCode, 404);
        assert.match(teardown?.error ?? '', /404/);
    });

    it('caps how many pages it opens', async () => {
        const ads = [
            ad('1', 'a', `${origin}/advertorial`, 10),
            ad('2', 'b', `${origin}/pdp`, 10),
        ];
        const result = await teardownLandingPages(mapLandingPages(ads).pages, { ...opts, maxPages: 1 });
        assert.equal(result.length, 1);
    });
});
