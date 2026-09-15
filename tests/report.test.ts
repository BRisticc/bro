import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { analyseCopy } from '../src/analyze/copy-analyzer.js';
import { scoreExposure } from '../src/ads/exposure.js';
import { angleDescription, buildBrandReport, buildRunReport } from '../src/report/report-builder.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderHtml } from '../src/report/html.js';
import type { AdRecord, ClassifiedBrand, RankedAd } from '../src/types.js';

function rankedAd(id: string, bodyText: string, partial: Partial<AdRecord> = {}): RankedAd {
    const base: AdRecord = {
        id, provider: 'test', publisherPlatforms: [], countries: [], languages: [],
        bodyText, mediaType: 'unknown', ...partial,
    };
    return { ...base, exposure: scoreExposure(base), analysis: analyseCopy(base) };
}

function brand(name: string, niche: string, subNiche: string): ClassifiedBrand {
    return {
        url: `https://${name.toLowerCase()}.com`, domain: `${name.toLowerCase()}.com`, name,
        sourceUrl: 'https://src.example/list', anchorTexts: [], mentions: 1, discoveryScore: 80,
        brandName: name, products: [], platform: 'shopify', socials: {}, corpus: '',
        pagesFetched: [], fetchErrors: [],
        classification: {
            niche, subNiche, audience: 'men', confidence: 70, evidence: [], alternatives: [], unclassified: false,
        },
    };
}

const research = (ads: RankedAd[], queries = ['Iron Peak']) => ({ queries, ads, errors: [] });

describe('per-brand report', () => {
    const ads = [
        rankedAd('1', 'Tired of low energy? Clinically proven formula. 30% off today only.', { euTotalReach: 900_000, daysRunning: 120 }),
        rankedAd('2', 'Join 40,000 customers. 60-day money-back guarantee.', { daysRunning: 20 }),
        rankedAd('3', 'Tired of low energy? Sick of the afternoon crash?', { daysRunning: 10 }),
    ];
    const report = buildBrandReport(brand('IronPeak', 'Supplements', "Men's health"), research(ads), 'test');

    it('carries the classification through to the dataset row', () => {
        assert.equal(report.niche, 'Supplements');
        assert.equal(report.subNiche, "Men's health");
        assert.equal(report.audience, 'men');
        assert.equal(report.classificationConfidence, 70);
    });

    it('counts every angle an ad exhibits, not just its primary one', () => {
        const problem = report.angleBreakdown.find((a) => a.angle === 'problem-agitation');
        assert.equal(problem?.adCount, 2);
        assert.equal(problem?.share, 66.7);
    });

    it('picks the primary angle by exposure-weighted volume, not raw frequency', () => {
        assert.equal(report.topAngle, 'problem-agitation');
    });

    it('summarises awareness and format mixes that sum to the ad count', () => {
        const total = report.awarenessBreakdown.reduce((s, a) => s + a.adCount, 0);
        assert.equal(total, 3);
        assert.equal(report.formatBreakdown.reduce((s, f) => s + f.adCount, 0), 3);
    });

    it('collects the offers actually used', () => {
        const kinds = report.commonOffers.map((o) => o.kind);
        assert.ok(kinds.includes('discount-percent'));
        assert.ok(kinds.includes('guarantee'));
    });

    it('lists hooks in exposure order', () => {
        assert.equal(report.topHooks[0]?.hook, 'Tired of low energy?');
        assert.ok((report.topHooks[0]?.exposure ?? 0) >= (report.topHooks[1]?.exposure ?? 0));
    });

    it('explains itself when a brand has no ads', () => {
        const empty = buildBrandReport(brand('Quiet', 'Skincare', 'Anti-aging'), research([], ['Quiet']), 'test');
        assert.equal(empty.adCount, 0);
        assert.equal(empty.topAngle, null);
        assert.equal(empty.exposureScore, 0);
        assert.ok(empty.notes.some((n) => n.includes('No ads found')));
    });

    it('does not add a "no ads" note when ad research was switched off', () => {
        const off = buildBrandReport(brand('Quiet', 'Skincare', 'Anti-aging'), research([], []), 'none');
        assert.ok(!off.notes.some((n) => n.includes('No ads found')));
    });

    it('surfaces site fetch errors as notes', () => {
        const broken = brand('Broken', 'Supplements', 'Immunity');
        broken.fetchErrors.push('homepage HTTP 503');
        const out = buildBrandReport(broken, research([]), 'test');
        assert.ok(out.notes.includes('homepage HTTP 503'));
    });
});

describe('cross-brand run report', () => {
    const reports = [
        buildBrandReport(brand('IronPeak', 'Supplements', "Men's health"),
            research([rankedAd('1', 'Tired of low energy? Clinically proven.', { daysRunning: 100 })]), 'test'),
        buildBrandReport(brand('Vital', 'Supplements', 'Gut & digestive'),
            research([rankedAd('2', 'Tired of bloating? Trusted by 20,000 customers.', { daysRunning: 50 })]), 'test'),
        buildBrandReport(brand('Glow', 'Skincare', 'Anti-aging'), research([]), 'test'),
    ];
    const run = buildRunReport(reports, {
        sourceUrls: ['https://src.example/list'], brandsDiscovered: 5, adsProvider: 'test', warnings: ['heads up'],
    });

    it('groups brands by niche then sub-niche', () => {
        const supplements = run.niches.find((n) => n.niche === 'Supplements');
        assert.equal(supplements?.brandCount, 2);
        assert.deepEqual(supplements?.subNiches.map((s) => s.subNiche).sort(), ['Gut & digestive', "Men's health"]);
    });

    it('orders niches by brand count', () => {
        assert.equal(run.niches[0]?.niche, 'Supplements');
    });

    it('counts brands with and without ads separately', () => {
        assert.equal(run.brandsProfiled, 3);
        assert.equal(run.brandsWithAds, 2);
        assert.equal(run.adsAnalysed, 2);
        assert.equal(run.brandsDiscovered, 5);
    });

    it('builds an angle leaderboard spanning brands', () => {
        const problem = run.angleLeaderboard.find((a) => a.angle === 'problem-agitation');
        assert.equal(problem?.brandCount, 2);
        assert.equal(problem?.adCount, 2);
    });

    it('ranks the overall top ads by exposure', () => {
        assert.equal(run.topAdsOverall.length, 2);
        assert.ok((run.topAdsOverall[0]?.exposure ?? 0) >= (run.topAdsOverall[1]?.exposure ?? 0));
    });

    it('passes warnings through', () => {
        assert.deepEqual(run.warnings, ['heads up']);
    });

    it('handles a run with no brands at all', () => {
        const empty = buildRunReport([], { sourceUrls: [], brandsDiscovered: 0, adsProvider: 'none', warnings: [] });
        assert.deepEqual(empty.niches, []);
        assert.deepEqual(empty.angleLeaderboard, []);
        assert.equal(empty.adsAnalysed, 0);
    });
});

describe('renderers', () => {
    const run = buildRunReport(
        [buildBrandReport(brand('IronPeak', 'Supplements', "Men's health"),
            research([rankedAd('1', 'Tired of low energy? 30% off.', { daysRunning: 90, snapshotUrl: 'https://ex.com/a' })]), 'test')],
        { sourceUrls: ['https://src.example/list'], brandsDiscovered: 1, adsProvider: 'test', warnings: ['a warning'] },
    );

    it('renders markdown with the brand, niche and warning', () => {
        const md = renderMarkdown(run);
        assert.ok(md.includes('# Brand niche & ad angle report'));
        assert.ok(md.includes('IronPeak'));
        assert.ok(md.includes("Men's health"));
        assert.ok(md.includes('a warning'));
    });

    it('renders self-contained HTML with no external resources', () => {
        const html = renderHtml(run);
        assert.ok(html.startsWith('<!doctype html>'));
        assert.ok(html.includes('IronPeak'));
        assert.ok(!/<(script|link)\b/i.test(html), 'report HTML must not pull in external resources');
    });

    it('escapes HTML in brand-controlled text', () => {
        const nasty = brand('Nasty', 'Supplements', 'Immunity');
        nasty.brandName = '<img src=x onerror=alert(1)>';
        const evil = buildRunReport(
            [buildBrandReport(nasty, research([rankedAd('1', 'Hi', { daysRunning: 1 })]), 'test')],
            { sourceUrls: [], brandsDiscovered: 1, adsProvider: 'test', warnings: [] },
        );
        const html = renderHtml(evil);
        assert.ok(!html.includes('<img src=x'));
        assert.ok(html.includes('&lt;img src=x'));
    });

    it('exposes a description for every angle it reports', () => {
        assert.ok(angleDescription('problem-agitation').length > 0);
        assert.equal(angleDescription('not-an-angle'), '');
    });
});
