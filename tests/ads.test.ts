import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { rankAds, scoreExposure } from '../src/ads/exposure.js';
import { daysBetween, dedupeAds, normaliseAdRecord, parseBoundedRange, pickString } from '../src/ads/normalise.js';
import { attributeTerm } from '../src/ads/provider.js';
import { adLibraryUrl } from '../src/ads/apify-actor-provider.js';
import { buildQueries } from '../src/ads/ad-research.js';
import type { AdRecord, ClassifiedBrand } from '../src/types.js';

function ad(partial: Partial<AdRecord>): AdRecord {
    return {
        id: 'a1', provider: 'test', publisherPlatforms: [], countries: [], languages: [],
        bodyText: '', mediaType: 'unknown', ...partial,
    };
}

describe('normalising provider records', () => {
    it('maps a Meta Graph ads_archive record', () => {
        const record = normaliseAdRecord({
            id: '123',
            page_name: 'Iron Peak',
            page_id: '999',
            ad_creative_bodies: ['Tired of low energy?'],
            ad_creative_link_titles: ['Iron Peak Daily'],
            ad_delivery_start_time: '2026-01-01',
            ad_delivery_stop_time: '2026-03-02',
            ad_snapshot_url: 'https://facebook.com/ads/archive/render_ad/?id=123',
            publisher_platforms: ['facebook', 'instagram'],
            impressions: { lower_bound: '1000', upper_bound: '5000' },
            spend: { lower_bound: '100', upper_bound: '499' },
            eu_total_reach: 24000,
            currency: 'EUR',
        }, 'meta-graph', 'Iron Peak');

        assert.equal(record?.id, '123');
        assert.equal(record?.pageName, 'Iron Peak');
        assert.equal(record?.bodyText, 'Tired of low energy?');
        assert.equal(record?.title, 'Iron Peak Daily');
        assert.equal(record?.impressionsMin, 1000);
        assert.equal(record?.impressionsMax, 5000);
        assert.equal(record?.euTotalReach, 24000);
        assert.equal(record?.daysRunning, 60);
        assert.equal(record?.isActive, false);
        assert.deepEqual(record?.publisherPlatforms, ['facebook', 'instagram']);
    });

    it('maps a third-party scraper record with different field names', () => {
        const record = normaliseAdRecord({
            adArchiveID: 'A-77',
            pageName: 'Vital Root',
            body: { text: 'Clinically proven formula' },
            headline: 'Vital Root Greens',
            startDate: '2026-02-01',
            snapshotUrl: 'https://example.com/ad/77',
            collationCount: 12,
            isActive: true,
        }, 'apify-actor', 'Vital Root');

        assert.equal(record?.id, 'A-77');
        assert.equal(record?.bodyText, 'Clinically proven formula');
        assert.equal(record?.title, 'Vital Root Greens');
        assert.equal(record?.variantCount, 12);
        assert.equal(record?.isActive, true);
    });

    it('synthesises an id when the provider gives none', () => {
        const record = normaliseAdRecord({ body: 'Some copy here' }, 'p', 'q');
        assert.ok(record?.id.startsWith('p:'));
    });

    it('rejects a record with no id and no copy', () => {
        assert.equal(normaliseAdRecord({ page_name: 'X' }, 'p', 'q'), null);
    });

    it('reads a string from array, object and scalar shapes', () => {
        assert.equal(pickString({ a: ['first', 'second'] }, ['a']), 'first');
        assert.equal(pickString({ a: { text: 'inner' } }, ['a']), 'inner');
        assert.equal(pickString({ a: '  spaced  ' }, ['a']), 'spaced');
        assert.equal(pickString({ a: '' }, ['a', 'b']), undefined);
    });

    it('parses bounded ranges from strings', () => {
        assert.deepEqual(parseBoundedRange({ lower_bound: '10', upper_bound: '20' }), { min: 10, max: 20 });
        assert.deepEqual(parseBoundedRange(null), {});
    });

    it('computes days running and treats a missing stop date as still running', () => {
        assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
        assert.ok((daysBetween('2020-01-01') ?? 0) > 1000);
        assert.equal(daysBetween(undefined), undefined);
    });
});

describe('deduping ads across search terms', () => {
    it('keeps one record per id and merges the queries that found it', () => {
        const merged = dedupeAds([
            ad({ id: 'x', matchedQuery: 'Iron Peak' }),
            ad({ id: 'x', matchedQuery: 'Iron Peak Daily' }),
            ad({ id: 'y', matchedQuery: 'Iron Peak' }),
        ]);
        assert.equal(merged.length, 2);
        assert.equal(merged[0]?.matchedQuery, 'Iron Peak; Iron Peak Daily');
    });

    it('back-fills exposure data from the richer duplicate', () => {
        const merged = dedupeAds([
            ad({ id: 'x' }),
            ad({ id: 'x', euTotalReach: 5000, impressionsMin: 10, impressionsMax: 20 }),
        ]);
        assert.equal(merged[0]?.euTotalReach, 5000);
        assert.equal(merged[0]?.impressionsMin, 10);
    });
});

describe('exposure scoring', () => {
    it('scores a high-reach long-running ad above a short-lived one', () => {
        const big = scoreExposure(ad({ euTotalReach: 2_000_000, daysRunning: 150, isActive: true }));
        const small = scoreExposure(ad({ euTotalReach: 800, daysRunning: 2 }));
        assert.ok(big.score > small.score, `${big.score} should beat ${small.score}`);
    });

    it('records which signals were actually available', () => {
        const result = scoreExposure(ad({ daysRunning: 40 }));
        assert.deepEqual(result.signals, ['longevity']);
        assert.match(result.basis, /running 40 days/);
    });

    it('says so plainly when an ad publishes no exposure signal', () => {
        const result = scoreExposure(ad({}));
        assert.equal(result.score, 0);
        assert.deepEqual(result.signals, []);
        assert.match(result.basis, /no exposure signals/);
    });

    it('does not penalise a data-rich ad against a data-poor one', () => {
        const rich = scoreExposure(ad({ daysRunning: 180, euTotalReach: 3_000_000, impressionsMin: 5_000_000, variantCount: 30 }));
        const poor = scoreExposure(ad({ daysRunning: 180 }));
        assert.ok(rich.score >= poor.score, `rich ${rich.score} vs poor ${poor.score}`);
    });

    it('caps an ad with no published exposure figure below a measured one', () => {
        const inferred = scoreExposure(ad({ daysRunning: 5000, variantCount: 500, isActive: true }));
        const measured = scoreExposure(ad({ euTotalReach: 5_000_000, daysRunning: 5000, isActive: true }));
        assert.ok(inferred.score <= 85, `inferred-only score was ${inferred.score}`);
        assert.ok(measured.score > inferred.score, `${measured.score} should beat ${inferred.score}`);
        assert.ok(!inferred.signals.includes('eu-reach'));
    });

    it('falls back to longevity when rankBy asks for an absent signal', () => {
        const result = scoreExposure(ad({ daysRunning: 90 }), 'impressions');
        assert.ok(result.score > 0);
    });

    it('keeps every score inside 0-100', () => {
        const extreme = scoreExposure(ad({
            impressionsMin: 10_000_000_000, euTotalReach: 9_000_000_000, daysRunning: 5000,
            variantCount: 100_000, isActive: true,
        }));
        assert.ok(extreme.score <= 100 && extreme.score >= 0);
    });

    it('ranks a list highest-exposure first', () => {
        const ranked = rankAds([
            ad({ id: 'low', daysRunning: 3 }),
            ad({ id: 'high', daysRunning: 200, euTotalReach: 1_000_000 }),
            ad({ id: 'mid', daysRunning: 60 }),
        ], 'composite');
        assert.deepEqual(ranked.map((a) => a.id), ['high', 'mid', 'low']);
    });
});

describe('search term construction', () => {
    const brand = {
        brandName: 'Iron Peak',
        name: 'Iron Peak',
        products: [
            { name: 'Daily Test' },
            { name: 'Iron Peak Sleep Stack' },
            { name: 'Gift Card' },
            { name: 'ab' },
        ],
    } as unknown as ClassifiedBrand;

    it('searches the brand name only when asked', () => {
        assert.deepEqual(buildQueries(brand, 'brand', 5), ['Iron Peak']);
    });

    it('prefixes generic product names with the brand to avoid competitor noise', () => {
        const queries = buildQueries(brand, 'brand+products', 5);
        assert.ok(queries.includes('Iron Peak'));
        assert.ok(queries.includes('Iron Peak Daily Test'), queries.join(' | '));
    });

    it('leaves an already brand-prefixed product name alone', () => {
        assert.ok(buildQueries(brand, 'brand+products', 5).includes('Iron Peak Sleep Stack'));
    });

    it('drops gift cards and stub names', () => {
        const queries = buildQueries(brand, 'products', 5).join(' | ');
        assert.ok(!queries.includes('Gift Card'));
        assert.ok(!queries.includes('ab'));
    });

    it('omits the brand name under the products-only strategy', () => {
        assert.ok(!buildQueries(brand, 'products', 5).includes('Iron Peak'));
    });

    it('respects the product query cap', () => {
        assert.equal(buildQueries(brand, 'products', 1).length, 1);
    });
});

describe('provider helpers', () => {
    it('builds a valid Ad Library search URL', () => {
        const url = new URL(adLibraryUrl('Iron Peak', 'de', 'ACTIVE'));
        assert.equal(url.searchParams.get('q'), 'Iron Peak');
        assert.equal(url.searchParams.get('country'), 'DE');
        assert.equal(url.searchParams.get('active_status'), 'active');
    });

    it('attributes a batched ad to the most specific matching term', () => {
        const record = ad({ pageName: 'Iron Peak', bodyText: 'Try Iron Peak Sleep Stack tonight.' });
        assert.equal(attributeTerm(record, ['Iron Peak', 'Iron Peak Sleep Stack']), 'Iron Peak Sleep Stack');
    });

    it('falls back to the first term when nothing matches', () => {
        assert.equal(attributeTerm(ad({ bodyText: 'unrelated' }), ['A', 'B']), 'A');
    });
});
