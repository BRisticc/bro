import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { analyseCopy } from '../src/analyze/copy-analyzer.js';
import type { AdRecord } from '../src/types.js';

function ad(bodyText: string, extra: Partial<AdRecord> = {}): AdRecord {
    return {
        id: 'x', provider: 'test', publisherPlatforms: [], countries: [], languages: [],
        bodyText, mediaType: 'unknown', ...extra,
    };
}

const angles = (text: string, extra?: Partial<AdRecord>) =>
    analyseCopy(ad(text, extra)).angles.map((a) => a.angle);

describe('angle detection', () => {
    it('detects problem-agitation copy', () => {
        assert.ok(angles('Tired of waking up exhausted? Sick of the 3am wake-ups?').includes('problem-agitation'));
    });

    it('detects an authority/science angle', () => {
        assert.ok(angles('Clinically proven in a double-blind study. Formulated by a board-certified dermatologist.')
            .includes('authority-science'));
    });

    it('detects social proof with a crowd number', () => {
        assert.ok(angles('Join over 40,000 customers. Rated 4.8 out of 5 across 12,000 reviews.')
            .includes('social-proof'));
    });

    it('detects a risk-reversal guarantee', () => {
        assert.ok(angles('Try it with our 60-day money-back guarantee. Cancel anytime, no questions asked.')
            .includes('risk-reversal'));
    });

    it('detects us-vs-them positioning', () => {
        assert.ok(angles('Unlike other brands, we do not water down our formula. Big supplement does not want you to know this.')
            .includes('us-vs-them'));
    });

    it('detects identity call-outs', () => {
        assert.ok(angles('Attention: for men over 40 who want their energy back.').includes('identity'));
    });

    it('detects a customer-voice/UGC register', () => {
        assert.ok(angles("I've been using this for 3 weeks and honestly my skin is different. I was skeptical.")
            .includes('ugc-testimonial'));
    });

    it('returns no angles for copy with no persuasive signal', () => {
        assert.deepEqual(angles('Blue. Medium. Cotton.'), []);
    });

    it('ranks the dominant angle first', () => {
        const result = analyseCopy(ad(
            'Tired of bloating? Sick of feeling heavy after every meal? Fed up with the discomfort? '
            + 'You are struggling with something real. Ships free.',
        ));
        assert.equal(result.primaryAngle, 'problem-agitation');
    });

    it('stacks multiple angles on layered copy', () => {
        const found = angles(
            'Tired of hair loss? Clinically proven minoxidil, trusted by 50,000 customers. '
            + '30% off today only with a 90-day money-back guarantee.',
        );
        assert.ok(found.length >= 3, `expected several angles, got ${found.join(', ')}`);
    });

    it('is stable across repeated calls (shared /g regexes are reset)', () => {
        const text = 'Clinically proven and trusted by 10,000 customers.';
        assert.deepEqual(angles(text), angles(text));
    });
});

describe('awareness staging', () => {
    it('reads a bare discount ad as most-aware', () => {
        assert.equal(analyseCopy(ad('30% off today only. Use code SAVE30. Shop now.')).awarenessStage, 'most-aware');
    });

    it('reads symptom-led copy as problem-aware', () => {
        assert.equal(
            analyseCopy(ad('Struggling with brain fog and low energy every afternoon? Do you have these symptoms?')).awarenessStage,
            'problem-aware',
        );
    });

    it('reads mechanism-led copy as solution-aware', () => {
        assert.equal(
            analyseCopy(ad("Here's how it works: 400mg of magnesium glycinate, chosen for absorption.")).awarenessStage,
            'solution-aware',
        );
    });

    it('reads a story opener as unaware', () => {
        assert.equal(
            analyseCopy(ad('I never used to think about this. It started when I turned 38. Turns out most people do not know.')).awarenessStage,
            'unaware',
        );
    });

    it('defaults short signal-free copy to most-aware', () => {
        assert.equal(analyseCopy(ad('New drop. Out now.')).awarenessStage, 'most-aware');
    });
});

describe('offers, formats, hooks and proof', () => {
    it('extracts discount, shipping and guarantee offers', () => {
        const kinds = analyseCopy(ad('Save 25% off, free shipping, and a 90-day money-back guarantee.'))
            .offers.map((o) => o.kind);
        assert.ok(kinds.includes('discount-percent'));
        assert.ok(kinds.includes('free-shipping'));
        assert.ok(kinds.includes('guarantee'));
    });

    it('spots subscription and limited-time offers', () => {
        const kinds = analyseCopy(ad('Subscribe and save. Cancel anytime. Limited time only.')).offers.map((o) => o.kind);
        assert.ok(kinds.includes('subscription'));
        assert.ok(kinds.includes('limited-time'));
    });

    it('classifies a numbered list as a listicle', () => {
        assert.equal(analyseCopy(ad('3 reasons your sleep is broken:\n1. Late caffeine\n2. Light\n3. Stress')).format, 'listicle');
    });

    it('classifies a short discount ad as a direct offer', () => {
        assert.equal(analyseCopy(ad('20% off. Shop now.')).format, 'direct-offer');
    });

    it('labels hook types', () => {
        assert.equal(analyseCopy(ad('Are you still waking up tired?')).hookType, 'question');
        assert.equal(analyseCopy(ad('Attention men over 40: this matters.')).hookType, 'call-out');
        assert.equal(analyseCopy(ad('Warning: your shampoo may be the problem.')).hookType, 'warning');
    });

    it('takes the first sentence as the hook', () => {
        assert.equal(analyseCopy(ad('This is the hook. This is the body copy that follows.')).hook, 'This is the hook.');
    });

    it('pulls numeric proof points', () => {
        const proof = analyseCopy(ad('93% saw results in 30 days across 12 studies.')).proofPoints;
        assert.ok(proof.some((p) => p.includes('93%')));
        assert.ok(proof.some((p) => p.includes('30 days')));
    });

    it('extracts claim sentences', () => {
        const claims = analyseCopy(ad('It reduces bloating within a week. The bottle is blue.')).claims;
        assert.equal(claims.length, 1);
        assert.ok(claims[0]?.includes('reduces bloating'));
    });

    it('prefers the ad CTA field over a CTA found in the body', () => {
        assert.equal(analyseCopy(ad('Learn more about it.', { ctaText: 'Shop Now' })).cta, 'Shop Now');
        assert.equal(analyseCopy(ad('Learn more about it.')).cta, 'Learn more');
    });

    it('reads title, body and link description together', () => {
        const result = analyseCopy(ad('Body copy.', { title: 'Clinically proven formula', linkDescription: '60-day guarantee' }));
        const found = result.angles.map((a) => a.angle);
        assert.ok(found.includes('authority-science'));
        assert.ok(found.includes('risk-reversal'));
    });

    it('reports word count and reading ease', () => {
        const result = analyseCopy(ad('We help you sleep. It works fast.'));
        assert.equal(result.wordCount, 7);
        assert.ok(result.readingEase > 50);
    });

    it('handles empty copy without throwing', () => {
        const result = analyseCopy(ad(''));
        assert.deepEqual(result.angles, []);
        assert.equal(result.wordCount, 0);
        assert.equal(result.primaryAngle, null);
    });
});
