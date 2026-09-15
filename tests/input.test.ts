import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { InputError, parseInput, resolveAdsProvider, startUrlStrings } from '../src/input.js';

describe('input parsing', () => {
    it('requires at least one start URL', () => {
        assert.throws(() => parseInput({}), InputError);
        assert.throws(() => parseInput({ startUrls: [] }), InputError);
    });

    it('applies documented defaults', () => {
        const input = parseInput({ startUrls: [{ url: 'https://a.com' }] });
        assert.equal(input.maxBrands, 25);
        assert.equal(input.discoveryMode, 'auto');
        assert.equal(input.profileDepth, 'standard');
        assert.equal(input.adSearchStrategy, 'brand+products');
        assert.equal(input.rankBy, 'composite');
        assert.equal(input.adsApifyActorId, 'apify/facebook-ads-scraper');
        assert.deepEqual(input.adCountries, ['US']);
        assert.equal(input.useLlm, false);
    });

    it('clamps numeric fields into range instead of failing', () => {
        const input = parseInput({ startUrls: ['https://a.com'], maxBrands: 9999, maxConcurrency: 0, adsPerBrand: -3 });
        assert.equal(input.maxBrands, 500);
        assert.equal(input.maxConcurrency, 1);
        assert.equal(input.adsPerBrand, 1);
    });

    it('falls back to the default for an unknown enum value', () => {
        assert.equal(parseInput({ startUrls: ['https://a.com'], rankBy: 'vibes' }).rankBy, 'composite');
    });

    it('upper-cases and trims country codes', () => {
        assert.deepEqual(parseInput({ startUrls: ['https://a.com'], adCountries: [' de ', 'fr'] }).adCountries, ['DE', 'FR']);
    });

    it('rejects useLlm without a key', () => {
        const previous = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try {
            assert.throws(() => parseInput({ startUrls: ['https://a.com'], useLlm: true }), InputError);
        } finally {
            if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
        }
    });

    it('accepts useLlm when the key comes from the environment', () => {
        const previous = process.env.ANTHROPIC_API_KEY;
        process.env.ANTHROPIC_API_KEY = 'sk-test';
        try {
            assert.equal(parseInput({ startUrls: ['https://a.com'], useLlm: true }).llmApiKey, 'sk-test');
        } finally {
            if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = previous;
        }
    });

    it('keeps only valid output formats', () => {
        assert.deepEqual(parseInput({ startUrls: ['https://a.com'], outputFormats: ['markdown', 'pdf'] }).outputFormats, ['markdown']);
    });

    it('restores the default when every requested format is invalid', () => {
        assert.deepEqual(parseInput({ startUrls: ['https://a.com'], outputFormats: ['pdf'] }).outputFormats, ['json', 'markdown', 'html']);
    });
});

describe('start URL extraction', () => {
    it('accepts both request objects and bare strings', () => {
        const input = parseInput({ startUrls: [{ url: 'https://a.com' }, 'https://b.com'] });
        assert.deepEqual(startUrlStrings(input), ['https://a.com', 'https://b.com']);
    });

    it('drops entries that are not http(s) URLs', () => {
        const input = parseInput({ startUrls: ['https://a.com', 'ftp://c.com', { url: '' }, 'not a url'] });
        assert.deepEqual(startUrlStrings(input), ['https://a.com']);
    });
});

describe('ad provider resolution', () => {
    const base = { startUrls: ['https://a.com'] };

    it('prefers the Apify actor when a token is available', () => {
        assert.equal(resolveAdsProvider(parseInput(base), true), 'apify-actor');
    });

    it('falls back to the Graph API when only a Meta token is set', () => {
        assert.equal(resolveAdsProvider(parseInput({ ...base, metaAccessToken: 'tok' }), false), 'meta-graph');
    });

    it('resolves to none when nothing is configured', () => {
        assert.equal(resolveAdsProvider(parseInput(base), false), 'none');
    });

    it('never overrides an explicit choice', () => {
        assert.equal(resolveAdsProvider(parseInput({ ...base, adsProvider: 'meta-graph' }), true), 'meta-graph');
        assert.equal(resolveAdsProvider(parseInput({ ...base, adsProvider: 'none' }), true), 'none');
    });
});
