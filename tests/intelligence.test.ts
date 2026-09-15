import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectTechStack } from '../src/profile/tech-stack.js';
import { extractCommerceSignals, priceTier, summariseCommerce } from '../src/profile/commerce-signals.js';
import { analyseCreativeSignals, classifyFunnel } from '../src/analyze/creative-signals.js';
import { computeBenchmarks, computeDeviations, creativeCompetitors } from '../src/report/benchmarks.js';
import { load } from '../src/profile/extractors.js';
import type { AdRecord, BrandReport } from '../src/types.js';

describe('marketing stack detection', () => {
    const html = `<html><head>
      <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
      <script src="https://analytics.tiktok.com/i18n/pixel/events.js"></script>
      <script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>
      <script src="https://cdn.rechargepayments.com/rc.js"></script>
      <script src="https://d3hw6dc1ow8pp2.cloudfront.net/okendo.io/widget.js"></script>
      <script src="https://js.klarna.com/web-sdk/v1/klarna.js"></script>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
      </head><body></body></html>`;

    const stack = detectTechStack(html);

    it('names the tools it found', () => {
        for (const tool of ['Meta Pixel', 'TikTok Pixel', 'Klaviyo', 'Recharge', 'Okendo', 'Klarna']) {
            assert.ok(stack.all.includes(tool), `expected ${tool} in ${stack.all.join(', ')}`);
        }
    });

    it('derives the signals that matter across brands', () => {
        assert.equal(stack.paidMediaTracking, true);
        assert.deepEqual(stack.paidChannels.sort(), ['Meta Pixel', 'TikTok Pixel']);
        assert.equal(stack.lifecycleMarketing, true);
        assert.equal(stack.subscriptionCommerce, true);
        assert.equal(stack.reviewProgramme, true);
        assert.equal(stack.bnpl, true);
    });

    it('scores a full stack above a bare one', () => {
        const bare = detectTechStack('<html><body>nothing here</body></html>');
        assert.equal(bare.paidMediaTracking, false);
        assert.equal(bare.sophisticationScore, 0);
        assert.ok(stack.sophisticationScore > 60, `full stack scored ${stack.sophisticationScore}`);
    });

    it('groups tools by category', () => {
        assert.deepEqual(stack.byCategory.subscription, ['Recharge']);
        assert.ok((stack.byCategory.adPixel ?? []).length >= 2);
    });
});

describe('commerce signals', () => {
    const html = `<html><body>
      <p>Free shipping on orders over $50. 90-day money-back guarantee. Save 30% off your first order.</p>
      <p>Rated 4.8 out of 5 from 12,480 reviews. Subscribe and save, cancel anytime.</p>
      <p>As seen in Forbes and Men's Health. NSF Certified and Third-Party Tested. Founded in 2018.</p>
    </body></html>`;
    const products = [
        { name: 'A', price: 29, currency: 'USD' },
        { name: 'B', price: 49 },
        { name: 'C', price: 89 },
    ];
    const signals = extractCommerceSignals(load(html), '', products);

    it('reads the price shape from products', () => {
        assert.equal(signals.priceMin, 29);
        assert.equal(signals.priceMax, 89);
        assert.equal(signals.priceMedian, 49);
        assert.equal(signals.currency, 'USD');
        assert.equal(signals.productCount, 3);
    });

    it('reads the offer architecture from copy', () => {
        assert.equal(signals.freeShippingThreshold, 50);
        assert.equal(signals.guaranteeDays, 90);
        assert.equal(signals.maxDiscountPercent, 30);
        assert.equal(signals.subscriptionOffered, true);
    });

    it('reads social proof, press and certifications', () => {
        assert.equal(signals.reviewCount, 12480);
        assert.equal(signals.reviewRating, 4.8);
        assert.ok(signals.pressMentions.includes('Forbes'));
        assert.ok(signals.certifications.includes('NSF Certified'));
        assert.equal(signals.foundedYear, 2018);
    });

    it('handles a page with nothing on it', () => {
        const empty = extractCommerceSignals(load('<html><body>hello</body></html>'), '', []);
        assert.equal(empty.productCount, 0);
        assert.equal(empty.priceMedian, undefined);
        assert.equal(empty.subscriptionOffered, false);
        assert.match(summariseCommerce(empty), /no commercial signals/);
    });

    it('places a brand in a price tier against its niche', () => {
        assert.equal(priceTier(90, 50), 'premium');
        assert.equal(priceTier(60, 50), 'above-market');
        assert.equal(priceTier(50, 50), 'at-market');
        assert.equal(priceTier(30, 50), 'value');
        assert.equal(priceTier(undefined, 50), null);
    });
});

describe('funnel destination', () => {
    const cases: Array<[string, string]> = [
        ['https://brand.com/products/daily-test', 'product-page'],
        ['https://brand.com/collections/all', 'collection'],
        ['https://brand.com/blogs/news/why-your-sleep-is-broken', 'advertorial'],
        ['https://brand.com/quiz', 'quiz'],
        ['https://brand.com/pages/top-5-reasons-men-lose-energy', 'listicle'],
        ['https://brand.com/', 'homepage'],
        ['https://brand.com/lp/summer-offer', 'landing-page'],
        ['https://brand.com/book-a-call', 'lead-form'],
        ['https://apps.apple.com/app/id123', 'app-store'],
        ['https://someoneelse.com/thing', 'offsite'],
    ];

    for (const [url, expected] of cases) {
        it(`reads ${url} as ${expected}`, () => {
            assert.equal(classifyFunnel(url, 'brand.com'), expected);
        });
    }

    it('returns unknown for a missing or unparseable URL', () => {
        assert.equal(classifyFunnel(undefined, 'brand.com'), 'unknown');
        assert.equal(classifyFunnel('not a url', 'brand.com'), 'unknown');
    });

    it('treats a sub-domain of the brand as on-site', () => {
        assert.equal(classifyFunnel('https://shop.brand.com/products/x', 'brand.com'), 'product-page');
    });
});

describe('creative velocity and posture', () => {
    const NOW = Date.parse('2026-06-01T00:00:00Z');
    const day = 86_400_000;
    const ad = (daysAgo: number, runDays: number, extra: Partial<AdRecord> = {}): AdRecord => ({
        id: `a${daysAgo}-${runDays}`, provider: 't', publisherPlatforms: ['facebook'], countries: [], languages: [],
        bodyText: '', mediaType: 'video', startDate: new Date(NOW - daysAgo * day).toISOString(),
        daysRunning: runDays, isActive: true, ...extra,
    });

    it('calls a brand with fresh launches and a long runner "scaling"', () => {
        const ads = [ad(200, 200), ...Array.from({ length: 6 }, (_, i) => ad(i * 3, i * 3))];
        const signals = analyseCreativeSignals(ads, 'brand.com', NOW);
        assert.equal(signals.posture, 'scaling');
        assert.equal(signals.launchedLast30Days, 6);
        assert.equal(signals.longestRunDays, 200);
    });

    it('calls fresh launches with no proven winner "testing"', () => {
        const ads = Array.from({ length: 6 }, (_, i) => ad(i * 2, i * 2));
        assert.equal(analyseCreativeSignals(ads, 'brand.com', NOW).posture, 'testing');
    });

    it('calls a quiet account "stale" and says how quiet', () => {
        const signals = analyseCreativeSignals([ad(300, 20), ad(400, 30)], 'brand.com', NOW);
        assert.equal(signals.posture, 'stale');
        assert.equal(signals.daysSinceNewestAd, 300);
        assert.match(signals.postureReason, /gone quiet/);
    });

    it('calls a live long-runner with few launches "steady"', () => {
        assert.equal(analyseCreativeSignals([ad(10, 120)], 'brand.com', NOW).posture, 'steady');
    });

    it('reports "absent" with no ads at all', () => {
        const signals = analyseCreativeSignals([], 'brand.com', NOW);
        assert.equal(signals.posture, 'absent');
        assert.equal(signals.adCount, 0);
        assert.deepEqual(signals.funnelMix, []);
    });

    it('builds media, platform and funnel mixes that sum to 100', () => {
        const ads = [
            ad(5, 5, { mediaType: 'video', landingUrl: 'https://brand.com/products/x' }),
            ad(6, 6, { mediaType: 'image', landingUrl: 'https://brand.com/blogs/a/why-x' }),
        ];
        const signals = analyseCreativeSignals(ads, 'brand.com', NOW);
        assert.equal(signals.mediaMix.reduce((s, m) => s + m.share, 0), 100);
        assert.deepEqual(
            signals.funnelMix.map((f) => f.funnel).sort(),
            ['advertorial', 'product-page'],
        );
    });

    it('counts creative variants, defaulting to one per ad', () => {
        assert.equal(analyseCreativeSignals([ad(1, 1, { variantCount: 12 }), ad(2, 2)], 'brand.com', NOW).totalVariants, 13);
    });
});

// ---------------------------------------------------------------- cross-brand

function brandReport(over: Partial<BrandReport>): BrandReport {
    return {
        brandName: 'X', domain: 'x.com', websiteUrl: 'https://x.com', sourceUrl: 's',
        niche: 'Supplements', subNiche: "Men's health", audience: 'men',
        classificationConfidence: 80, unclassified: false,
        classificationEvidence: [], classificationAlternatives: [],
        platform: 'shopify', socials: {}, products: [],
        adCount: 0, adsProvider: 't', adQueries: [], exposureScore: 0, topAngle: null,
        angleBreakdown: [], awarenessBreakdown: [], formatBreakdown: [],
        topHooks: [], commonOffers: [], ads: [],
        deviations: [], creativeCompetitors: [], notes: [], scrapedAt: '',
        ...over,
    };
}

describe('niche benchmarks', () => {
    const brands = [
        brandReport({
            brandName: 'Cheap', domain: 'cheap.com', adCount: 10,
            commerce: { productCount: 3, priceMedian: 20, subscriptionOffered: true, freeShippingUnconditional: false, guaranteeDays: 30, reviewCount: 1000, pressMentions: [], certifications: [] },
            techStack: { byCategory: {}, all: ['Meta Pixel', 'Klaviyo'], paidMediaTracking: true, paidChannels: ['Meta Pixel'], lifecycleMarketing: true, subscriptionCommerce: true, reviewProgramme: true, bnpl: false, sophisticationScore: 50 },
            angleBreakdown: [{ angle: 'offer-value', label: 'Offer / price-value', adCount: 8, share: 80, avgExposure: 40 }],
            formatBreakdown: [{ format: 'direct-offer', adCount: 10, share: 100 }],
            awarenessBreakdown: [{ stage: 'most-aware', adCount: 10, share: 100 }],
        }),
        brandReport({
            brandName: 'Mid', domain: 'mid.com', adCount: 10,
            commerce: { productCount: 5, priceMedian: 50, subscriptionOffered: true, freeShippingUnconditional: false, guaranteeDays: 30, reviewCount: 2000, pressMentions: [], certifications: [] },
            techStack: { byCategory: {}, all: ['Meta Pixel'], paidMediaTracking: true, paidChannels: ['Meta Pixel'], lifecycleMarketing: false, subscriptionCommerce: false, reviewProgramme: true, bnpl: false, sophisticationScore: 40 },
            angleBreakdown: [{ angle: 'offer-value', label: 'Offer / price-value', adCount: 7, share: 70, avgExposure: 40 }],
            formatBreakdown: [{ format: 'direct-offer', adCount: 10, share: 100 }],
            awarenessBreakdown: [{ stage: 'most-aware', adCount: 10, share: 100 }],
        }),
        brandReport({
            brandName: 'Lux', domain: 'lux.com', adCount: 2,
            commerce: { productCount: 2, priceMedian: 200, subscriptionOffered: false, freeShippingUnconditional: false, reviewCount: 50, pressMentions: [], certifications: [] },
            techStack: { byCategory: {}, all: [], paidMediaTracking: false, paidChannels: [], lifecycleMarketing: false, subscriptionCommerce: false, reviewProgramme: false, bnpl: false, sophisticationScore: 0 },
            angleBreakdown: [{ angle: 'aspiration', label: 'Aspiration / status', adCount: 2, share: 100, avgExposure: 10 }],
            formatBreakdown: [{ format: 'story', adCount: 2, share: 100 }],
            awarenessBreakdown: [{ stage: 'unaware', adCount: 2, share: 100 }],
        }),
    ];

    const [benchmark] = computeBenchmarks(brands);

    it('computes medians across the niche', () => {
        assert.equal(benchmark?.niche, 'Supplements');
        assert.equal(benchmark?.brandCount, 3);
        assert.equal(benchmark?.medianPrice, 50);
        assert.equal(benchmark?.medianAdsPerBrand, 10);
        assert.equal(benchmark?.medianSophistication, 40);
    });

    it('reports what share of the niche does each thing', () => {
        assert.equal(benchmark?.subscriptionShare, 66.7);
        assert.equal(benchmark?.paidMediaShare, 66.7);
    });

    it('ranks the angles the niche actually runs', () => {
        assert.equal(benchmark?.angleMix[0]?.key, 'offer-value');
    });

    it('lists angles nobody in the niche runs as whitespace', () => {
        const keys = benchmark?.angleWhitespace.map((w) => w.angle) ?? [];
        assert.ok(keys.includes('authority-science'), `whitespace was ${keys.join(', ')}`);
        assert.ok(!keys.includes('offer-value'), 'the dominant angle is not whitespace');
        assert.ok(benchmark?.angleWhitespace.every((w) => w.description.length > 0));
    });

    it('surfaces the tools the category has standardised on', () => {
        assert.equal(benchmark?.commonTools[0]?.tool, 'Meta Pixel');
        assert.equal(benchmark?.commonTools[0]?.brandShare, 66.7);
    });

    it('flags where a brand breaks from its niche', () => {
        const lux = brands[2];
        assert.ok(lux && benchmark);
        const deviations = computeDeviations(lux, benchmark);
        const signals = deviations.map((d) => d.signal);
        assert.ok(signals.includes('Price'), `expected a price deviation, got ${signals.join(', ')}`);
        assert.ok(signals.includes('Paid media'), 'no ad pixel while the niche tracks paid');
        assert.ok(signals.includes('Lead angle'), 'leads on a different angle from the category');
        assert.ok(deviations.every((d) => d.note.length > 0));
    });

    it('stays quiet about the norms a brand actually sits on', () => {
        const mid = brands[1];
        assert.ok(mid && benchmark);
        const signals = computeDeviations(mid, benchmark).map((d) => d.signal);
        // Mid is at the median price, guarantee and ad volume, and leads on the
        // category's own angle, so none of those may be reported.
        for (const quiet of ['Price', 'Guarantee', 'Ad volume', 'Lead angle', 'Paid media']) {
            assert.ok(!signals.includes(quiet), `${quiet} should not be flagged for a brand at the norm`);
        }
    });

    it('does not report every angle as whitespace when the niche has no ads', () => {
        const noAds = [
            brandReport({ brandName: 'A', domain: 'a.com', niche: 'Skincare', adCount: 0 }),
            brandReport({ brandName: 'B', domain: 'b.com', niche: 'Skincare', adCount: 0 }),
            brandReport({ brandName: 'C', domain: 'c.com', niche: 'Skincare', adCount: 0 }),
        ];
        const [bench] = computeBenchmarks(noAds);
        assert.ok(bench);
        assert.equal(bench.adCount, 0);
        assert.deepEqual(bench.angleWhitespace, [],
            'with no ads every angle sits at 0%, which is an empty dataset, not an opportunity');
        assert.equal(bench.medianLaunchesPerMonth, undefined);
    });

    it('refuses to invent norms from a one- or two-brand niche', () => {
        const lonely = [brandReport({ brandName: 'Solo', domain: 'solo.com', niche: 'Skincare', adCount: 40 })];
        const [solo] = computeBenchmarks(lonely);
        assert.ok(solo);
        assert.equal(solo.brandCount, 1);
        assert.deepEqual(computeDeviations(lonely[0]!, solo), [],
            'a median drawn from a single brand is that brand, so nothing can deviate from it');
    });

    it('finds the brands running the same creative pattern', () => {
        const cheap = brands[0];
        assert.ok(cheap);
        const rivals = creativeCompetitors(cheap, brands);
        assert.equal(rivals[0]?.brand, 'Mid', 'identical angle/format/awareness mix should rank first');
        assert.ok((rivals[0]?.similarity ?? 0) > (rivals[1]?.similarity ?? 0));
        assert.ok(rivals[0]?.sharedAngles.includes('Offer / price-value'));
    });

    it('never lists a brand as its own competitor', () => {
        const cheap = brands[0];
        assert.ok(cheap);
        assert.ok(!creativeCompetitors(cheap, brands).some((r) => r.brand === 'Cheap'));
    });
});
