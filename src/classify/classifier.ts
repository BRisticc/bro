import type { BrandProfile, Classification, TaxonomyMatch } from '../types.js';
import { normalise, countTerm } from '../util/text.js';
import { AUDIENCE_TERMS, type Taxonomy, termWeight } from './taxonomy.js';

/**
 * Diminishing returns, then a hard ceiling.
 *
 * The 9th mention of "collagen" says little the 3rd did not, and a product
 * grid that repeats one word forty times is not forty times the evidence. The
 * cap means breadth of matched terms beats depth of any single one, which is
 * what actually distinguishes a retinol brand from a page that happens to
 * list retinol a lot.
 */
const MAX_TERM_CONTRIBUTION = 3;

function dampen(hits: number): number {
    if (hits <= 0) return 0;
    return Math.min(MAX_TERM_CONTRIBUTION, 1 + Math.log2(hits));
}

/**
 * Maps a raw weighted score onto 0-100. The curve is deliberately gentle so
 * that a brand matching two strong terms lands around 45-60 rather than 99 —
 * the number is a confidence, not a match count.
 */
function toConfidence(rawScore: number): number {
    if (rawScore <= 0) return 0;
    return Math.round(100 * (1 - Math.exp(-rawScore / 14)));
}

interface ScoredSubNiche extends TaxonomyMatch {
    rawScore: number;
}

function scoreSubNiche(
    text: string,
    niche: string,
    subNiche: string,
    terms: ReturnType<typeof termWeight>[],
): ScoredSubNiche {
    let rawScore = 0;
    const evidence: TaxonomyMatch['evidence'] = [];
    for (const { text: term, weight } of terms) {
        const hits = countTerm(text, term);
        if (hits === 0) continue;
        const contribution = dampen(hits) * weight;
        rawScore += contribution;
        evidence.push({ term, hits, weight });
    }
    evidence.sort((a, b) => b.hits * b.weight - a.hits * a.weight);
    return {
        niche,
        subNiche,
        audience: null,
        confidence: toConfidence(rawScore),
        evidence: evidence.slice(0, 12),
        rawScore,
    };
}

export function detectAudience(text: string, subNicheHints: string[] = []): string | null {
    let best: { audience: string; score: number } | null = null;
    for (const [audience, terms] of Object.entries(AUDIENCE_TERMS)) {
        let score = 0;
        for (const raw of terms) {
            const { text: term, weight } = termWeight(raw);
            const hits = countTerm(text, term);
            if (hits > 0) score += dampen(hits) * weight;
        }
        // A sub-niche that is inherently gendered ("Men's health") nudges its
        // own audience, so "for men" need not appear verbatim on the page.
        if (subNicheHints.includes(audience)) score += 6;
        if (score > 0 && (!best || score > best.score)) best = { audience, score };
    }
    if (!best || best.score < 4) return null;
    return best.audience;
}

export interface ClassifyOptions {
    taxonomy: Taxonomy;
    minConfidence: number;
}

/**
 * Scores the brand's text corpus against every sub-niche and returns the
 * winner plus runners-up. Pure and synchronous — no network, so it is cheap
 * to re-run and easy to test.
 */
export function classifyText(corpus: string, opts: ClassifyOptions): Classification {
    const text = normalise(corpus);
    const scored: ScoredSubNiche[] = [];

    for (const [niche, subNiches] of Object.entries(opts.taxonomy)) {
        for (const [subNiche, def] of Object.entries(subNiches)) {
            const terms = def.terms.map(termWeight);
            const result = scoreSubNiche(text, niche, subNiche, terms);
            if (result.rawScore > 0) scored.push(result);
        }
    }

    scored.sort((a, b) => b.rawScore - a.rawScore);
    const winner = scored[0];

    if (!winner) {
        return {
            niche: 'Unclassified',
            subNiche: 'Unclassified',
            audience: detectAudience(text),
            confidence: 0,
            evidence: [],
            alternatives: [],
            unclassified: true,
        };
    }

    // Roll the niche up across its sub-niches: a brand spread thinly over
    // three supplement sub-niches is still, clearly, a supplement brand.
    const nicheTotals = new Map<string, number>();
    for (const s of scored) nicheTotals.set(s.niche, (nicheTotals.get(s.niche) ?? 0) + s.rawScore);
    let dominantNiche = winner.niche;
    let dominantTotal = nicheTotals.get(winner.niche) ?? winner.rawScore;
    for (const [niche, total] of nicheTotals) {
        if (total > dominantTotal) {
            dominantNiche = niche;
            dominantTotal = total;
        }
    }

    // If the roll-up disagrees with the single best sub-niche, keep the best
    // sub-niche *within* the dominant niche.
    const bestInDominant = scored.find((s) => s.niche === dominantNiche) ?? winner;

    const subNicheDef = opts.taxonomy[bestInDominant.niche]?.[bestInDominant.subNiche];
    const audience = detectAudience(text, subNicheDef?.audience ?? []);
    const confidence = toConfidence(bestInDominant.rawScore + dominantTotal * 0.25);

    const alternatives = scored
        .filter((s) => s !== bestInDominant)
        .slice(0, 3)
        .map((s) => ({ niche: s.niche, subNiche: s.subNiche, confidence: s.confidence }));

    return {
        niche: bestInDominant.niche,
        subNiche: bestInDominant.subNiche,
        audience,
        confidence,
        evidence: bestInDominant.evidence,
        alternatives,
        unclassified: confidence < opts.minConfidence,
    };
}

/** Builds the classification corpus from everything we know about a brand. */
export function buildCorpus(profile: BrandProfile): string {
    const parts = [
        profile.brandName,
        profile.siteTitle ?? '',
        profile.tagline ?? '',
        profile.description ?? '',
        profile.anchorTexts.join(' '),
        profile.products.map((p) => `${p.name} ${p.description ?? ''}`).join(' '),
        profile.corpus,
    ];
    return parts.filter(Boolean).join(' \n ');
}

export function classifyBrand(profile: BrandProfile, opts: ClassifyOptions): Classification {
    return classifyText(buildCorpus(profile), opts);
}
