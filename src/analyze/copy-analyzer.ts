import type { AdRecord, AngleHit, AwarenessStage, CopyAnalysis, OfferSignal } from '../types.js';
import { collapseWhitespace, readingEase, splitSentences, truncate, uniq, wordCount } from '../util/text.js';
import { ANGLE_LIBRARY, EMOTION_PATTERNS } from './angle-library.js';

/** Every piece of copy on an ad, joined in reading order. */
export function adCopy(ad: AdRecord): string {
    return [ad.title, ad.bodyText, ad.linkDescription, ad.ctaText]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join('\n');
}

function detectAngles(text: string): AngleHit[] {
    const hits: AngleHit[] = [];
    for (const angle of ANGLE_LIBRARY) {
        let raw = 0;
        const evidence: string[] = [];
        for (const { re, weight } of angle.patterns) {
            // Regexes are shared and stateful with /g — reset before each use.
            re.lastIndex = 0;
            const matches = text.match(re);
            if (!matches || matches.length === 0) continue;
            // Cap per-pattern contribution: repetition is not extra evidence.
            raw += weight * Math.min(3, matches.length);
            evidence.push(...matches.slice(0, 3).map((m) => collapseWhitespace(m)));
        }
        if (raw <= 0) continue;
        hits.push({
            angle: angle.key,
            label: angle.label,
            score: Math.round(Math.min(100, (1 - Math.exp(-raw / 5)) * 100)),
            evidence: uniq(evidence).slice(0, 6),
        });
    }
    hits.sort((a, b) => b.score - a.score);
    // Two matched words should not be reported as a detected angle.
    return hits.filter((h) => h.score >= 20).slice(0, 6);
}

const OFFER_RULES: Array<{ kind: OfferSignal['kind']; re: RegExp }> = [
    { kind: 'discount-percent', re: /\b(\d{1,2})\s?% ?(off|discount|savings)\b/gi },
    { kind: 'discount-amount', re: /\b(save\s)?[$£€]\s?\d+(\.\d{2})?\s?(off|discount)?\b/gi },
    { kind: 'bogo', re: /\b(buy one,? get one|bogo|2 for 1|b1g1)\b/gi },
    { kind: 'free-shipping', re: /\bfree (shipping|delivery|returns)\b/gi },
    { kind: 'free-trial', re: /\b(free (trial|sample)|try (it )?free)\b/gi },
    { kind: 'subscription', re: /\b(subscribe (and|&) save|subscription|auto.?ship|monthly delivery|cancel any ?time)\b/gi },
    { kind: 'bundle', re: /\b(bundle|starter (kit|pack)|value pack|\d+.?pack)\b/gi },
    { kind: 'guarantee', re: /\b(\d+.?day (money.?back|guarantee)|money.?back guarantee|risk.?free)\b/gi },
    { kind: 'gift', re: /\b(free (gift|bottle|gift with purchase)|gift with)\b/gi },
    { kind: 'limited-time', re: /\b(limited time|today only|ends (today|tonight|soon)|while supplies last|last chance)\b/gi },
];

function detectOffers(text: string): OfferSignal[] {
    const offers: OfferSignal[] = [];
    const seen = new Set<string>();
    for (const { kind, re } of OFFER_RULES) {
        re.lastIndex = 0;
        const matches = text.match(re);
        if (!matches) continue;
        for (const match of matches.slice(0, 2)) {
            const detail = collapseWhitespace(match);
            const key = `${kind}:${detail.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            offers.push({ kind, detail });
        }
    }
    return offers;
}

const AWARENESS_RULES: Array<{ stage: AwarenessStage; re: RegExp; weight: number }> = [
    // Most aware: the reader already wants it; copy is pure transaction.
    { stage: 'most-aware', re: /\b(order now|shop now|get yours|buy now|use code|checkout|restock(ed)?|back in stock)\b/gi, weight: 3 },
    { stage: 'most-aware', re: /\b(\d{1,2}% off|free shipping|today only|last chance)\b/gi, weight: 2 },
    // Product aware: comparing options and looking for reassurance.
    { stage: 'product-aware', re: /\b(unlike (other|most)|compared to|vs\.?|why (we|ours)|reviews|rated|guarantee|money.?back)\b/gi, weight: 2.5 },
    { stage: 'product-aware', re: /\b(our (formula|product|serum|blend)|we (made|built|created))\b/gi, weight: 2 },
    // Solution aware: knows the category, not yet the brand.
    { stage: 'solution-aware', re: /\b(how it works|works by|clinically (proven|dosed)|mechanism|ingredient|\d+\s?mg|the (best|right) (way|type) to)\b/gi, weight: 2.5 },
    // Problem aware: feels the pain, does not know the fix.
    { stage: 'problem-aware', re: /\b(tired of|struggling with|sick of|if you'?re (still|always)|do you (have|suffer|struggle)|symptoms?)\b/gi, weight: 3 },
    { stage: 'problem-aware', re: /\b(bloating|brain fog|hair loss|acne|can'?t sleep|low energy|joint pain)\b/gi, weight: 2 },
    // Unaware: pure story or curiosity, product barely present.
    { stage: 'unaware', re: /\b(i (never|used to)|it started when|nobody (tells|talks)|turns out|the real reason|most people don'?t know)\b/gi, weight: 3 },
];

function detectAwareness(text: string, angles: AngleHit[]): AwarenessStage {
    const scores = new Map<AwarenessStage, number>();
    for (const { stage, re, weight } of AWARENESS_RULES) {
        re.lastIndex = 0;
        const matches = text.match(re);
        if (!matches) continue;
        scores.set(stage, (scores.get(stage) ?? 0) + weight * Math.min(3, matches.length));
    }

    // Angles carry awareness information of their own.
    const angleKeys = new Set(angles.map((a) => a.angle));
    if (angleKeys.has('offer-value') || angleKeys.has('urgency-scarcity')) {
        scores.set('most-aware', (scores.get('most-aware') ?? 0) + 2);
    }
    if (angleKeys.has('mechanism') || angleKeys.has('ingredient-hero')) {
        scores.set('solution-aware', (scores.get('solution-aware') ?? 0) + 2);
    }
    if (angleKeys.has('problem-agitation')) {
        scores.set('problem-aware', (scores.get('problem-aware') ?? 0) + 2);
    }
    if (angleKeys.has('curiosity') || angleKeys.has('founder-story')) {
        scores.set('unaware', (scores.get('unaware') ?? 0) + 1.5);
    }
    if (angleKeys.has('us-vs-them') || angleKeys.has('risk-reversal')) {
        scores.set('product-aware', (scores.get('product-aware') ?? 0) + 1.5);
    }

    let best: { stage: AwarenessStage; score: number } | null = null;
    for (const [stage, score] of scores) {
        if (!best || score > best.score) best = { stage, score };
    }
    // Short copy with no signal at all is almost always a most-aware retargeting ad.
    if (!best) return wordCount(text) < 25 ? 'most-aware' : 'solution-aware';
    return best.stage;
}

const HOOK_RULES: Array<{ type: string; re: RegExp }> = [
    { type: 'question', re: /\?\s*$/ },
    { type: 'call-out', re: /^(attention|calling all|hey |psa|to (all|every) )/i },
    { type: 'statistic', re: /\b\d{1,3}\s?%|\b\d[\d,]{2,}\b/ },
    { type: 'warning', re: /^(warning|stop|don'?t|never|beware|read this before)/i },
    { type: 'command', re: /^(try|get|meet|discover|start|switch|ditch|throw out|say goodbye)/i },
    { type: 'curiosity-gap', re: /^(the (real|one|weird|surprising)|this is (why|what|how)|nobody|turns out|here'?s (why|what|how))/i },
    { type: 'first-person-story', re: /^(i |my |we |after (years|months)|\d+ (years|months) ago)/i },
    { type: 'comparison', re: /^(unlike|most (people|brands|men|women)|everyone (thinks|says))/i },
    { type: 'relatable-pain', re: /^(if you|when you|ever (felt|had|woken))/i },
    { type: 'offer-led', re: /^(\d{1,2}% off|save|free |buy one|limited time|today only)/i },
];

function detectHookType(hook: string): string {
    for (const { type, re } of HOOK_RULES) {
        if (re.test(hook.trim())) return type;
    }
    return 'statement';
}

const FORMAT_RULES: Array<{ format: string; test: (text: string, words: number) => boolean }> = [
    { format: 'listicle', test: (t) => /(^|\n)\s*(\d[.)]|[-•*])\s+\S/m.test(t) || /\b\d+ (reasons|ways|things|signs|mistakes|tips)\b/i.test(t) },
    { format: 'advertorial', test: (t, w) => w >= 250 && /\b(i (tried|tested|switched)|my (experience|story)|read on|keep reading)\b/i.test(t) },
    { format: 'testimonial', test: (t) => /["“][^"”]{40,}["”]/.test(t) || /\b—\s?[A-Z][a-z]+( [A-Z]\.)?\b/.test(t) },
    { format: 'ugc-first-person', test: (t) => /\b(i'?ve been|i started|my (skin|hair|sleep|energy|life)|honestly|ngl|obsessed)\b/i.test(t) },
    { format: 'educational', test: (t) => /\b(here'?s how|how it works|the science|what to look for|step \d)\b/i.test(t) },
    { format: 'direct-offer', test: (t, w) => w <= 60 && /\b(\d{1,2}% off|shop now|order now|free shipping|use code)\b/i.test(t) },
    { format: 'story', test: (t, w) => w >= 120 && /\b(i |my |we )\b/i.test(t) },
];

function detectFormat(text: string, words: number): string {
    for (const { format, test } of FORMAT_RULES) {
        if (test(text, words)) return format;
    }
    return words <= 60 ? 'short-copy' : 'long-copy';
}

function detectEmotions(text: string): string[] {
    const found: Array<{ emotion: string; count: number }> = [];
    for (const { emotion, re } of EMOTION_PATTERNS) {
        re.lastIndex = 0;
        const matches = text.match(re);
        if (matches && matches.length > 0) found.push({ emotion, count: matches.length });
    }
    found.sort((a, b) => b.count - a.count);
    return found.slice(0, 5).map((f) => f.emotion);
}

// A trailing \b cannot follow "%", so units are closed with a negative
// lookahead instead — otherwise "93%" (the commonest proof point of all) is
// silently dropped.
const PROOF_RE = new RegExp(
    [
        String.raw`\b\d[\d,.]*\s?(?:%|mg|g|ml|billion|million|k|x)(?![a-z0-9])`,
        String.raw`\b\d[\d,.]*\s?(?:days?|weeks?|months?|years?|customers|reviews|studies|ingredients|hours?)\b`,
        String.raw`\b\d(?:\.\d)?\s?(?:\/|out of)\s?5\b`,
    ].join('|'),
    'gi',
);

function detectProofPoints(text: string): string[] {
    PROOF_RE.lastIndex = 0;
    const matches = text.match(PROOF_RE) ?? [];
    return uniq(matches.map((m) => collapseWhitespace(m))).slice(0, 10);
}

const CLAIM_VERBS = /\b(reduces?|boosts?|improves?|increases?|eliminates?|clears?|restores?|supports?|helps?|proven to|designed to|guaranteed to)\b/i;

function detectClaims(text: string): string[] {
    return splitSentences(text)
        .filter((s) => CLAIM_VERBS.test(s) && s.length <= 220)
        .slice(0, 6)
        .map((s) => truncate(s, 200));
}

const CTA_RE = /\b(shop now|buy now|order now|learn more|sign up|get started|try (it )?(free|now|today)|claim (your|yours)|download|book (a|your)|subscribe|get yours|start (your|now))\b/i;

function detectCta(text: string, ctaText?: string): string | null {
    if (ctaText && ctaText.trim()) return collapseWhitespace(ctaText);
    const match = CTA_RE.exec(text);
    return match ? collapseWhitespace(match[0]) : null;
}

/**
 * Full angle/positioning breakdown of one ad's copy.
 *
 * Deterministic and offline: the same copy always produces the same analysis,
 * which is what makes cross-brand aggregation meaningful.
 */
export function analyseCopy(ad: AdRecord): CopyAnalysis {
    const text = adCopy(ad);
    const words = wordCount(text);
    const angles = detectAngles(text);
    const sentences = splitSentences(text);
    const hook = truncate(sentences[0] ?? text, 220);

    return {
        angles,
        primaryAngle: angles[0]?.angle ?? null,
        awarenessStage: detectAwareness(text, angles),
        hook,
        hookType: detectHookType(hook),
        format: detectFormat(text, words),
        emotionalTriggers: detectEmotions(text),
        offers: detectOffers(text),
        claims: detectClaims(text),
        cta: detectCta(text, ad.ctaText),
        proofPoints: detectProofPoints(text),
        wordCount: words,
        readingEase: readingEase(text),
    };
}
