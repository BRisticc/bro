import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    brandNameFromDomain, hasDeniedPath, isDeniedDomain, normaliseUrl, registrableDomain, sameSite,
} from '../src/util/domain.js';
import { countTerm, normalise, readingEase, share, splitSentences, truncate } from '../src/util/text.js';
import { mapWithConcurrency } from '../src/util/http.js';

describe('domain utils', () => {
    it('extracts the registrable domain through subdomains', () => {
        assert.equal(registrableDomain('https://shop.eu.hims.com/products/x'), 'hims.com');
        assert.equal(registrableDomain('https://www.ritual.com'), 'ritual.com');
    });

    it('keeps three labels for multi-part public suffixes', () => {
        assert.equal(registrableDomain('https://www.mybrand.co.uk/shop'), 'mybrand.co.uk');
        assert.equal(registrableDomain('https://store.brand.com.au'), 'brand.com.au');
    });

    it('strips tracking params and fragments but keeps real query state', () => {
        assert.equal(
            normaliseUrl('https://a.com/p?utm_source=ig&size=large&fbclid=xyz#top'),
            'https://a.com/p?size=large',
        );
    });

    it('rejects non-http protocols', () => {
        assert.equal(normaliseUrl('mailto:hi@a.com'), null);
        assert.equal(normaliseUrl('javascript:alert(1)'), null);
    });

    it('denies social, retail and infra hosts', () => {
        assert.equal(isDeniedDomain('instagram.com'), true);
        assert.equal(isDeniedDomain('amazon.com'), true);
        assert.equal(isDeniedDomain('somebrand.com'), false);
    });

    it('honours caller-supplied deny entries, case-insensitively and by suffix', () => {
        assert.equal(isDeniedDomain('partner.com', ['Partner.com']), true);
        assert.equal(isDeniedDomain('shop.partner.com', ['partner.com']), true, 'sub-domains of a denied domain are denied too');
        assert.equal(isDeniedDomain('notpartner.com', ['partner.com']), false, 'suffix match must respect the dot boundary');
        assert.equal(isDeniedDomain('partner.com', ['  ', '']), false, 'blank entries are ignored');
    });

    it('rejects boilerplate and asset paths', () => {
        assert.equal(hasDeniedPath('https://a.com/privacy-policy'), true);
        assert.equal(hasDeniedPath('https://a.com/logo.png'), true);
        assert.equal(hasDeniedPath('https://a.com/products/serum'), false);
    });

    it('detects same-site links', () => {
        assert.equal(sameSite('https://blog.a.com/x', 'https://a.com/y'), true);
        assert.equal(sameSite('https://a.com', 'https://b.com'), false);
    });

    it('humanises a domain into a brand name', () => {
        assert.equal(brandNameFromDomain('wellness-co.com'), 'Wellness Co');
    });
});

describe('text utils', () => {
    it('normalises accents, smart quotes and casing', () => {
        assert.equal(normalise('Crème  BRÛLÉE’s  “best”'), 'creme brulee\'s "best"');
    });

    it('counts whole words only', () => {
        const text = normalise('Testosterone support. A testosterone booster, not testosterones.');
        assert.equal(countTerm(text, 'testosterone'), 2);
        assert.equal(countTerm(text, 'testosterone booster'), 1);
    });

    it('matches phrases across variable whitespace', () => {
        assert.equal(countTerm(normalise('hair   loss is common'), 'hair loss'), 1);
    });

    it('returns zero for absent terms', () => {
        assert.equal(countTerm(normalise('skincare serum'), 'creatine'), 0);
    });

    it('splits sentences on terminal punctuation', () => {
        assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
    });

    it('scores simple copy as easier to read than dense copy', () => {
        const simple = readingEase('We help you sleep. It works fast. You wake up fresh.');
        const dense = readingEase('Comprehensive pharmacological intervention necessitates multidimensional physiological considerations.');
        assert.ok(simple > dense, `expected ${simple} > ${dense}`);
    });

    it('returns 0 reading ease for empty input', () => {
        assert.equal(readingEase('   '), 0);
    });

    it('truncates with an ellipsis only when needed', () => {
        assert.equal(truncate('short', 20), 'short');
        assert.equal(truncate('abcdefghij', 5), 'abcd…');
    });

    it('guards share() against a zero total', () => {
        assert.equal(share(3, 0), 0);
        assert.equal(share(1, 3), 33.3);
    });
});

describe('mapWithConcurrency', () => {
    it('preserves input order regardless of completion order', async () => {
        const result = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
            await new Promise((r) => { setTimeout(r, ms); });
            return ms;
        });
        assert.deepEqual(result, [30, 10, 20]);
    });

    it('never exceeds the concurrency limit', async () => {
        let active = 0;
        let peak = 0;
        await mapWithConcurrency([...Array(12).keys()], 3, async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((r) => { setTimeout(r, 5); });
            active -= 1;
            return null;
        });
        assert.ok(peak <= 3, `peak concurrency was ${peak}`);
    });

    it('handles an empty input list', async () => {
        assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
    });
});
