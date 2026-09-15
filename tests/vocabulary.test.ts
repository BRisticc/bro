import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    buildBrandVocabulary, buildNicheVocabulary, distinctiveTerms, ngrams, summariseVocabulary,
} from '../src/analyze/vocabulary.js';
import { analyseCopy } from '../src/analyze/copy-analyzer.js';
import { scoreExposure } from '../src/ads/exposure.js';
import type { AdRecord, RankedAd } from '../src/types.js';

function rankedAd(id: string, bodyText: string, exposure = 50, title?: string): RankedAd {
    const base: AdRecord = {
        id, provider: 't', publisherPlatforms: [], countries: [], languages: [],
        bodyText, mediaType: 'unknown', euTotalReach: exposure * 1000, daysRunning: exposure,
        ...(title ? { title } : {}),
    };
    return { ...base, exposure: scoreExposure(base), analysis: analyseCopy(base) };
}

const opts = { brandName: 'Iron Peak', productNames: ['Daily Test'] };

describe('n-gram extraction', () => {
    it('never runs a phrase across a sentence boundary', () => {
        const grams = ngrams('Trusted by 40,000 men. Shop now.');
        assert.ok(!grams.some((g) => g.includes('men shop')), `boundary crossed: ${grams.join(' | ')}`);
        assert.ok(grams.includes('shop now'));
    });

    it('keeps a thousands separator inside one token', () => {
        const grams = ngrams('Trusted by 40,000 men');
        assert.ok(grams.includes('40000 men'), grams.join(' | '));
        assert.ok(!grams.some((g) => g === '40' || g.endsWith(' 40')));
    });

    it('builds phrases up to four words', () => {
        const grams = ngrams('clinically dosed tongkat ali');
        assert.ok(grams.includes('clinically'));
        assert.ok(grams.includes('clinically dosed'));
        assert.ok(grams.includes('clinically dosed tongkat ali'));
    });

    it('never starts or ends a phrase on a function word', () => {
        for (const gram of ngrams('the energy of the morning is gone')) {
            const words = gram.split(' ');
            assert.ok(!['the', 'of', 'is'].includes(words[0] ?? ''), `"${gram}" starts on a stopword`);
            assert.ok(!['the', 'of', 'is'].includes(words[words.length - 1] ?? ''), `"${gram}" ends on a stopword`);
        }
    });

    it('keeps marketing adverbs so CTAs survive as phrases', () => {
        assert.ok(ngrams('shop now and save today').includes('shop now'));
    });

    it('drops bare numbers but keeps them inside a phrase', () => {
        const grams = ngrams('results in 30 days');
        assert.ok(!grams.includes('30'));
        assert.ok(grams.includes('30 days'));
    });
});

describe('recurring language', () => {
    // The whole point: "male vitality" is in 4 of 5 ads; "kitchen sink" is
    // hammered 6 times but only inside one ad.
    const ads = [
        rankedAd('1', 'Male vitality starts with the right dose. Clinically dosed tongkat ali.'),
        rankedAd('2', 'Male vitality is not a myth. Clinically dosed and third-party tested.'),
        rankedAd('3', 'Get your male vitality back. Clinically dosed formula.'),
        rankedAd('4', 'Male vitality for men over 40.'),
        rankedAd('5', 'kitchen sink kitchen sink kitchen sink kitchen sink kitchen sink kitchen sink'),
    ];
    const vocabulary = buildBrandVocabulary(ads, opts);
    const terms = vocabulary.signature.map((t) => t.term);

    it('ranks a phrase used across ads above one hammered inside a single ad', () => {
        const vitality = vocabulary.signature.find((t) => t.term === 'male vitality');
        const sink = vocabulary.signature.find((t) => t.term === 'kitchen sink');
        assert.ok(vitality, `expected "male vitality" in ${terms.join(', ')}`);
        assert.equal(vitality.adCount, 4);
        assert.equal(vitality.adShare, 80);
        assert.equal(sink, undefined, 'a term confined to one ad is not recurring language');
    });

    it('counts ads, not occurrences, however loud one ad is', () => {
        const vitality = vocabulary.signature.find((t) => t.term === 'male vitality');
        assert.ok(vitality && vitality.adCount <= vitality.totalCount);
    });

    it('excludes the brand and product names', () => {
        assert.ok(!terms.some((t) => t.includes('iron') || t.includes('peak') || t.includes('daily test')));
    });

    it('prefers the full phrase over its fragments', () => {
        assert.ok(terms.includes('clinically dosed'));
        assert.ok(!terms.includes('dosed'), `"dosed" should fold into "clinically dosed": ${terms.join(', ')}`);
    });

    it('records the exposure of the ads a term appears in', () => {
        assert.ok(vocabulary.signature.every((t) => t.avgExposure >= 0));
    });

    it('returns nothing for a brand with no ads', () => {
        const empty = buildBrandVocabulary([], opts);
        assert.deepEqual(empty.signature, []);
        assert.match(summariseVocabulary(empty), /no recurring language/);
    });

    it('separates hook vocabulary from closing vocabulary', () => {
        const cta = [
            rankedAd('a', 'Tired of low energy? Our formula helps. Shop now and save.'),
            rankedAd('b', 'Tired of low energy? It works fast. Shop now and save.'),
            rankedAd('c', 'Tired of low energy? Real results. Shop now and save.'),
        ];
        const v = buildBrandVocabulary(cta, opts);
        assert.ok(v.hookTerms.some((t) => t.term.includes('tired')), 'the opener should be hook vocabulary');
        assert.ok(v.ctaTerms.some((t) => t.term.includes('shop now')), 'the closer should be CTA vocabulary');
    });

    it('groups the words a brand reaches for per angle', () => {
        const mixed = [
            rankedAd('p1', 'Tired of bloating? Sick of feeling heavy after every meal?'),
            rankedAd('p2', 'Tired of bloating? Sick of the discomfort every day?'),
            rankedAd('s1', 'Trusted by 40,000 customers. Rated 4.8 out of 5 across 12,000 reviews.'),
            rankedAd('s2', 'Trusted by 40,000 customers. Join thousands who switched.'),
        ];
        const v = buildBrandVocabulary(mixed, opts);
        const problem = v.byAngle.find((g) => g.angle === 'problem-agitation');
        assert.ok(problem, `angles found: ${v.byAngle.map((g) => g.angle).join(', ')}`);
        assert.ok(problem.terms.some((t) => t.includes('tired') || t.includes('sick')));
    });
});

describe('category language and distinctiveness', () => {
    const shared = (id: string) => [
        rankedAd(`${id}-1', `, 'Clinically dosed testosterone support for men over 40.'),
        rankedAd(`${id}-2`, 'Clinically dosed and third-party tested for men over 40.'),
        rankedAd(`${id}-3`, 'Clinically dosed daily support for men over 40.'),
    ];

    const brandA = buildBrandVocabulary(shared('a'), { brandName: 'A', productNames: [] });
    const brandB = buildBrandVocabulary(shared('b'), { brandName: 'B', productNames: [] });
    const odd = buildBrandVocabulary([
        rankedAd('c-1', 'Cold plunge recovery protocol for winter mornings.'),
        rankedAd('c-2', 'Cold plunge recovery protocol, every single day.'),
        rankedAd('c-3', 'Cold plunge recovery protocol for tired legs.'),
    ], { brandName: 'C', productNames: [] });

    const niche = buildNicheVocabulary([
        { brand: 'a.com', vocabulary: brandA },
        { brand: 'b.com', vocabulary: brandB },
        { brand: 'c.com', vocabulary: odd },
    ]);

    it('ranks the language most brands share at the top', () => {
        assert.equal(niche[0]?.brandCount, 2, `top category term was ${niche[0]?.term}`);
        assert.ok(niche.some((n) => n.term.includes('clinically dosed')));
    });

    it('excludes one-brand wording from "shared" category language', () => {
        assert.ok(niche.every((n) => n.brandCount >= 2),
            `single-brand terms leaked in: ${niche.filter((n) => n.brandCount < 2).map((n) => n.term).join(', ')}`);
        assert.ok(!niche.some((n) => n.term.includes('cold plunge')));
    });

    it('reports what share of the niche uses each term', () => {
        const shared2 = niche.find((n) => n.brandCount === 2);
        assert.equal(shared2?.brandShare, 66.7);
    });

    it('flags the wording a brand uses far more than its category', () => {
        const distinct = distinctiveTerms(odd, niche, 8, "c.com");
        assert.ok(distinct.some((t) => t.term.includes('cold plunge')), `got ${distinct.map((t) => t.term).join(', ')}`);
        assert.ok(distinct.every((t) => t.lift > 1.3));
    });

    it('excludes the brand from its own baseline', () => {
        // "clinically dosed" is in every one of A's ads and half of B's.
        // Including A's own 100% drags the category average up to 75 and the
        // lift down to 1.3; the honest baseline for A is B's 50, giving 2.
        const nicheEntry = [{
            term: 'clinically dosed',
            brandCount: 2,
            brandShare: 100,
            avgAdShare: 75,
            sharesByBrand: { 'a.com': 100, 'b.com': 50 },
        }];
        const withSelf = distinctiveTerms(brandA, nicheEntry, 8);
        const leaveOneOut = distinctiveTerms(brandA, nicheEntry, 8, 'a.com');

        const self = withSelf.find((t) => t.term === 'clinically dosed');
        const loo = leaveOneOut.find((t) => t.term === 'clinically dosed');
        assert.ok(loo, 'leave-one-out should surface the term');
        assert.equal(loo.nicheAdShare, 50, 'baseline must be the other brand alone');
        assert.ok(
            loo.lift > (self?.lift ?? 0),
            `leave-one-out lift ${loo.lift} should beat self-inclusive ${self?.lift}`,
        );
    });

    it('does not call shared category language distinctive', () => {
        const distinct = distinctiveTerms(brandA, niche, 8, "a.com").map((t) => t.term);
        assert.ok(!distinct.includes('clinically dosed'), 'a term the whole category uses is not this brand\'s own');
    });

    it('handles an empty niche without dividing by zero', () => {
        assert.deepEqual(buildNicheVocabulary([]), []);
        assert.deepEqual(distinctiveTerms(brandA, [], 8, "a.com").filter((t) => !Number.isFinite(t.lift)), []);
    });
});
