import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyText, detectAudience } from '../src/classify/classifier.js';
import { BUILT_IN_TAXONOMY, mergeTaxonomy } from '../src/classify/taxonomy.js';
import { normalise } from '../src/util/text.js';

const opts = { taxonomy: BUILT_IN_TAXONOMY, minConfidence: 25 };

describe('classifier', () => {
    it("puts a men's testosterone brand in Supplements / Men's health", () => {
        const result = classifyText(
            'Our testosterone booster is built for men over 40. Tongkat ali and fadogia agrestis support '
            + 'male vitality, libido and low T. A daily testosterone supplement for men.',
            opts,
        );
        assert.equal(result.niche, 'Supplements');
        assert.equal(result.subNiche, "Men's health");
        assert.equal(result.audience, 'men');
        assert.ok(result.confidence > 50, `confidence was ${result.confidence}`);
        assert.equal(result.unclassified, false);
    });

    it('separates anti-aging skincare from acne skincare', () => {
        const antiAging = classifyText(
            'A retinol night serum that softens fine lines and wrinkles. Peptide serum for firming and anti-aging.',
            opts,
        );
        assert.equal(antiAging.niche, 'Skincare');
        assert.equal(antiAging.subNiche, 'Anti-aging');

        const acne = classifyText(
            'Salicylic acid cleanser for acne-prone skin. Clears breakouts, blackheads and blemishes without drying.',
            opts,
        );
        assert.equal(acne.niche, 'Skincare');
        assert.equal(acne.subNiche, 'Acne & blemish');
    });

    it('classifies a hair loss brand into Haircare / Hair growth & loss', () => {
        const result = classifyText(
            'Clinically proven minoxidil and finasteride for hair loss. Stop thinning hair and a receding hairline.',
            opts,
        );
        assert.equal(result.niche, 'Haircare');
        assert.equal(result.subNiche, 'Hair growth & loss');
    });

    it('rolls a brand spread across sub-niches up to the dominant niche', () => {
        const result = classifyText(
            'Creatine monohydrate and whey protein for muscle gain. Our pre-workout has citrulline and beta-alanine. '
            + 'We also sell electrolyte sticks and a post-workout recovery blend. BCAA and EAA capsules too.',
            opts,
        );
        assert.equal(result.niche, 'Supplements');
        assert.equal(result.subNiche, 'Sports & performance');
    });

    it('classifies a recruitment agency, not just DTC brands', () => {
        const result = classifyText(
            'We are a specialist recruitment and staffing agency. Executive search and permanent placement '
            + 'for engineering teams. Our recruiters build a talent pool and shortlist candidates, cutting your '
            + 'time to hire. Partner with us to scale your team.',
            opts,
        );
        assert.equal(result.niche, 'Professional & B2B services');
        assert.equal(result.subNiche, 'Recruitment & staffing');
        assert.equal(result.unclassified, false);
        assert.ok(result.confidence > 60, `confidence was ${result.confidence}`);
    });

    it('separates a marketing agency from a recruitment agency', () => {
        const result = classifyText(
            'A performance marketing agency. We handle media buying and paid social for DTC brands, '
            + 'reporting on ROAS and ad spend every week on a monthly retainer.',
            opts,
        );
        assert.equal(result.niche, 'Professional & B2B services');
        assert.equal(result.subNiche, 'Marketing & creative agency');
    });

    it('keeps a SaaS product out of the B2B services branch', () => {
        const result = classifyText(
            'Our SaaS platform gives your team a dashboard, an API and workflow automation. '
            + 'Integrations included. Per month per user, cancel anytime.',
            opts,
        );
        assert.equal(result.subNiche, 'Software & SaaS');
    });

    it('does not pull a supplement brand into B2B services', () => {
        const result = classifyText(
            'Our creatine and whey protein are trusted by our clients. Case study: one athlete gained muscle.',
            opts,
        );
        assert.equal(result.niche, 'Supplements');
    });

    it('records auditable evidence for its call', () => {
        const result = classifyText('Our probiotic supports gut health and the microbiome. 50 billion CFU.', opts);
        const terms = result.evidence.map((e) => e.term);
        assert.ok(terms.includes('probiotic'), `evidence was ${terms.join(', ')}`);
        assert.ok(result.evidence.every((e) => e.hits > 0 && e.weight > 0));
    });

    it('offers runner-up niches for a borderline brand', () => {
        const result = classifyText(
            'Collagen peptides for skin, hair and nails. Supports collagen production and reduces fine lines.',
            opts,
        );
        assert.ok(result.alternatives.length > 0);
        assert.ok(result.alternatives.every((a) => a.niche && a.subNiche));
    });

    it('marks copy with no taxonomy signal as unclassified', () => {
        const result = classifyText('Welcome to our website. We are open Monday to Friday.', opts);
        assert.equal(result.unclassified, true);
        assert.equal(result.niche, 'Unclassified');
        assert.equal(result.confidence, 0);
    });

    it('respects a raised confidence threshold', () => {
        const text = 'A magnesium supplement.';
        assert.equal(classifyText(text, { ...opts, minConfidence: 0 }).unclassified, false);
        assert.equal(classifyText(text, { ...opts, minConfidence: 99 }).unclassified, true);
    });

    it('ranks breadth of evidence above repetition of one term', () => {
        const stuffed = classifyText(Array(40).fill('retinol').join(' '), opts);
        const broad = classifyText('A retinol serum for fine lines, wrinkles and firming. Peptide serum included.', opts);
        assert.equal(stuffed.niche, 'Skincare');
        assert.equal(broad.niche, 'Skincare');
        assert.ok(
            broad.confidence > stuffed.confidence,
            `broad evidence (${broad.confidence}) should beat 40x repetition (${stuffed.confidence})`,
        );
        assert.ok(stuffed.confidence < 75, `repetition alone should stay short of certainty, got ${stuffed.confidence}`);
    });
});

describe('audience detection', () => {
    it('reads an explicit gender target', () => {
        assert.equal(detectAudience(normalise('Made for women who run. Women\'s sizing.')), 'women');
    });

    it('falls back to the sub-niche hint when copy is implicit', () => {
        assert.equal(detectAudience(normalise('Supports healthy levels naturally.'), ['men']), 'men');
    });

    it('reads a B2B hiring audience', () => {
        assert.equal(
            detectAudience(normalise('Talk to a hiring manager about your next hire. Scale your team fast.')),
            'hiring managers',
        );
    });

    it('returns null when nothing targets a group', () => {
        assert.equal(detectAudience(normalise('A water filter for your kitchen tap.')), null);
    });
});

describe('taxonomy merging', () => {
    it('adds a new niche without dropping the built-ins', () => {
        const merged = mergeTaxonomy(BUILT_IN_TAXONOMY, {
            Gaming: { Peripherals: { terms: ['mechanical keyboard', 'gaming mouse'] } },
        });
        assert.ok(merged.Gaming?.Peripherals);
        assert.ok(merged.Supplements?.["Men's health"], 'built-in niches survive the merge');
    });

    it('overrides a built-in sub-niche in place', () => {
        const merged = mergeTaxonomy(BUILT_IN_TAXONOMY, {
            Skincare: { 'Anti-aging': { terms: [['my-custom-term', 9]] } },
        });
        assert.deepEqual(merged.Skincare?.['Anti-aging']?.terms, [['my-custom-term', 9]]);
        assert.ok(merged.Skincare?.['Acne & blemish'], 'sibling sub-niches are untouched');
    });

    it('does not mutate the built-in taxonomy', () => {
        const before = BUILT_IN_TAXONOMY.Skincare?.['Anti-aging']?.terms.length;
        mergeTaxonomy(BUILT_IN_TAXONOMY, { Skincare: { 'Anti-aging': { terms: ['x'] } } });
        assert.equal(BUILT_IN_TAXONOMY.Skincare?.['Anti-aging']?.terms.length, before);
    });

    it('ignores malformed override entries', () => {
        const merged = mergeTaxonomy(BUILT_IN_TAXONOMY, { Bad: { Sub: { terms: 'nope' } } } as never);
        assert.equal(merged.Bad?.Sub, undefined);
    });
});
