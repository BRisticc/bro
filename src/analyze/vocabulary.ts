import type { RankedAd } from '../types.js';
import { collapseWhitespace, normalise, share, splitSentences, uniq } from '../util/text.js';

/**
 * Recurring-language mining across a brand's ads.
 *
 * The central choice here is document frequency over raw count: a phrase used
 * once in eight of ten ads is the brand's actual vocabulary, while a phrase
 * repeated twenty times inside one long advertorial is one ad's quirk.
 * Counting occurrences would rank the second above the first and be wrong
 * about the thing the whole feature exists to answer.
 */

/**
 * Function words only. Marketing adverbs ("now", "free", "today") are kept on
 * purpose — "shop now" and "free shipping" are the phrases we are looking for.
 */
const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
    'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
    'i', 'you', 'your', 'yours', 'we', 'our', 'ours', 'us', 'they', 'them', 'their',
    'he', 'she', 'his', 'her', 'hers', 'him', 'my', 'me', 'mine',
    'do', 'does', 'did', 'done', 'have', 'has', 'had', 'having',
    'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
    'so', 'than', 'then', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
    'all', 'any', 'some', 'each', 'both', 'few', 'such', 'own', 'same',
    'into', 'onto', 'about', 'against', 'between', 'through', 'during', 'above', 'below',
    'up', 'down', 'out', 'off', 'again', 'further', 'once', 'because', 'while', 'until',
    'been', 'were', 'also', 'via', 'per', 'etc',
]);

export interface TermStat {
    term: string;
    /** How many distinct ads contain it. The "constantly used" measure. */
    adCount: number;
    /** That count as a percentage of the brand's ads. */
    adShare: number;
    /** Total occurrences, for reference only — never used for ranking. */
    totalCount: number;
    /** Mean exposure score of the ads carrying it: is it in the winners? */
    avgExposure: number;
    /** How many words the term is. */
    words: number;
}

export interface DistinctiveTerm extends TermStat {
    /** The brand's ad-share divided by the niche's. >1 means it over-indexes. */
    lift: number;
    nicheAdShare: number;
}

export interface BrandVocabulary {
    /** Terms the brand repeats across its ads, most consistent first. */
    signature: TermStat[];
    /** Terms it uses far more than its category. Filled in by the niche pass. */
    distinctive: DistinctiveTerm[];
    /** Language that opens ads — the hook vocabulary. */
    hookTerms: TermStat[];
    /** Language that closes ads — the call-to-action vocabulary. */
    ctaTerms: TermStat[];
    /** Which words travel with which angle in this brand's copy. */
    byAngle: Array<{ angle: string; label: string; adCount: number; terms: string[] }>;
}

interface Accumulator {
    totalCount: number;
    adIds: Set<string>;
    exposures: number[];
}

function isUsableToken(token: string): boolean {
    if (token.length < 2) return false;
    // Pure numbers are noise on their own; "30 days" survives as a bigram.
    if (/^\d+$/.test(token)) return false;
    return true;
}

/**
 * Builds 1-3 word n-grams from one piece of text.
 * Phrases may contain a stopword but never start or end with one, which is
 * what separates "free shipping on orders" from "shipping on".
 */
export function ngrams(text: string, maxWords = 4): string[] {
    const out: string[] = [];
    // Sentences are split BEFORE normalising: normalise lower-cases the text,
    // and the sentence splitter keys off a capital letter after the full stop.
    // Normalising first loses every boundary, and phrases then run across
    // them — "trusted by 40,000 men. Shop now." yields "40000 men shop".
    for (const raw of splitSentences(text)) {
        const sentence = normalise(raw);
        // "40,000" must stay one token: split on the comma and every ad that
        // says "trusted by 40,000 men" yields junk like "trusted by 40".
        const joined = sentence.replace(/(\d),(?=\d{3}\b)/g, '$1');
        const tokens = joined.split(/[^a-z0-9'+-]+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i += 1) {
            for (let n = 1; n <= maxWords && i + n <= tokens.length; n += 1) {
                const slice = tokens.slice(i, i + n);
                const first = slice[0];
                const last = slice[slice.length - 1];
                if (!first || !last) continue;
                if (STOPWORDS.has(first) || STOPWORDS.has(last)) continue;
                // A phrase may contain a number ("30 days") but ending on one
                // means the window was cut mid-figure ("trusted by 40000").
                if (/^\d+$/.test(last)) continue;
                if (!slice.some(isUsableToken)) continue;
                if (n === 1 && !isUsableToken(first)) continue;
                out.push(slice.join(' '));
            }
        }
    }
    return out;
}

/** Terms that are just the brand's or products' own names carry no insight. */
function buildNameFilter(brandName: string, productNames: string[]): Set<string> {
    const banned = new Set<string>();
    for (const name of [brandName, ...productNames]) {
        const normalised = normalise(name);
        if (!normalised) continue;
        banned.add(normalised);
        for (const token of normalised.split(/\s+/)) {
            if (token.length >= 3) banned.add(token);
        }
    }
    return banned;
}

function tally(
    texts: Array<{ adId: string; text: string; exposure: number }>,
    banned: Set<string>,
    maxWords = 4,
): Map<string, Accumulator> {
    const map = new Map<string, Accumulator>();
    for (const { adId, text, exposure } of texts) {
        for (const term of ngrams(text, maxWords)) {
            if (banned.has(term)) continue;
            if (term.split(' ').every((t) => banned.has(t))) continue;
            const entry = map.get(term) ?? { totalCount: 0, adIds: new Set<string>(), exposures: [] };
            entry.totalCount += 1;
            if (!entry.adIds.has(adId)) {
                entry.adIds.add(adId);
                entry.exposures.push(exposure);
            }
            map.set(term, entry);
        }
    }
    return map;
}

function toStats(map: Map<string, Accumulator>, adTotal: number, minAds: number): TermStat[] {
    const stats: TermStat[] = [];
    for (const [term, entry] of map) {
        if (entry.adIds.size < minAds) continue;
        const exposures = entry.exposures;
        stats.push({
            term,
            adCount: entry.adIds.size,
            adShare: share(entry.adIds.size, adTotal),
            totalCount: entry.totalCount,
            avgExposure: exposures.length > 0
                ? Math.round((exposures.reduce((a, b) => a + b, 0) / exposures.length) * 10) / 10
                : 0,
            words: term.split(' ').length,
        });
    }
    return stats;
}

/**
 * Drops a shorter term when a longer one containing it appears almost as
 * often: if "free shipping" is in six ads and "shipping" in six, the phrase
 * is the real unit and the bare word is an artefact of it.
 */
function preferLongerPhrases(stats: TermStat[]): TermStat[] {
    const redundant = new Set<string>();

    for (const longer of stats) {
        if (longer.words < 2) continue;
        for (const shorter of stats) {
            if (shorter.term === longer.term || shorter.words >= longer.words) continue;
            if (!isSubPhrase(shorter.term, longer.term)) continue;
            // Only fold it in if the short term barely occurs outside the phrase.
            if (shorter.adCount <= longer.adCount * 1.25) redundant.add(shorter.term);
        }
    }

    return stats.filter((s) => !redundant.has(s.term));
}

/** Word-boundary containment: "shipping" is in "free shipping", "ship" is not. */
function isSubPhrase(shorter: string, longer: string): boolean {
    const shortWords = shorter.split(' ');
    const longWords = longer.split(' ');
    for (let i = 0; i + shortWords.length <= longWords.length; i += 1) {
        if (shortWords.every((w, j) => w === longWords[i + j])) return true;
    }
    return false;
}

/**
 * True when two equal-length phrases are the same window shifted by one, e.g.
 * "clinically dosed tongkat" and "dosed tongkat ali". Reporting both is
 * reporting one phrase twice.
 */
function isShiftedWindow(a: string, b: string): boolean {
    const aw = a.split(' ');
    const bw = b.split(' ');
    if (aw.length !== bw.length || aw.length < 2) return false;
    const overlap = aw.length - 1;
    const aTail = aw.slice(-overlap).join(' ');
    const bHead = bw.slice(0, overlap).join(' ');
    const bTail = bw.slice(-overlap).join(' ');
    const aHead = aw.slice(0, overlap).join(' ');
    return aTail === bHead || bTail === aHead;
}

/** Ranks, then drops duplicates of a phrase already reported. */
function refine(stats: TermStat[], limit: number): TermStat[] {
    const ordered = rank(preferLongerPhrases(stats), stats.length);
    const kept: TermStat[] = [];
    for (const candidate of ordered) {
        const duplicate = kept.some((k) => (
            k.adCount === candidate.adCount && isShiftedWindow(k.term, candidate.term)
        ));
        if (!duplicate) kept.push(candidate);
        if (kept.length >= limit) break;
    }
    return kept;
}

function rank(stats: TermStat[], limit: number): TermStat[] {
    return [...stats]
        .sort((a, b) => (
            b.adShare - a.adShare
            || b.words - a.words
            || b.avgExposure - a.avgExposure
            || a.term.localeCompare(b.term)
        ))
        .slice(0, limit);
}

export interface VocabularyOptions {
    brandName: string;
    productNames: string[];
    /** A term must appear in at least this many ads to count as recurring. */
    minAds?: number;
    limit?: number;
}

export function buildBrandVocabulary(ads: RankedAd[], opts: VocabularyOptions): BrandVocabulary {
    const empty: BrandVocabulary = { signature: [], distinctive: [], hookTerms: [], ctaTerms: [], byAngle: [] };
    if (ads.length === 0) return empty;

    const banned = buildNameFilter(opts.brandName, opts.productNames);
    const limit = opts.limit ?? 40;
    // With very few ads, "in 2 of 3" is still a pattern; with many, demand more.
    const minAds = opts.minAds ?? Math.max(2, Math.ceil(ads.length * 0.15));

    const bodies = ads.map((ad) => ({
        adId: ad.id,
        text: [ad.title, ad.bodyText, ad.linkDescription].filter(Boolean).join('. '),
        exposure: ad.exposure.score,
    }));
    const signature = refine(toStats(tally(bodies, banned), ads.length, minAds), limit);

    const hooks = ads.map((ad) => ({ adId: ad.id, text: ad.analysis.hook, exposure: ad.exposure.score }));
    const hookTerms = refine(toStats(tally(hooks, banned), ads.length, Math.max(2, minAds - 1)), 12);

    const ctas = ads
        .map((ad) => {
            const sentences = splitSentences(ad.bodyText);
            const tail = sentences.slice(-2).join(' ');
            return { adId: ad.id, text: [tail, ad.ctaText, ad.linkDescription].filter(Boolean).join('. '), exposure: ad.exposure.score };
        })
        .filter((c) => c.text.trim().length > 0);
    const ctaTerms = refine(toStats(tally(ctas, banned), ads.length, Math.max(2, minAds - 1)), 12);

    // Vocabulary grouped by the angle of the ads it appears in, so you can see
    // the words the brand reaches for when it runs a given play.
    const angleGroups = new Map<string, { label: string; ads: typeof bodies }>();
    for (const ad of ads) {
        for (const hit of ad.analysis.angles) {
            const group = angleGroups.get(hit.angle) ?? { label: hit.label, ads: [] };
            group.ads.push({
                adId: ad.id,
                text: [ad.title, ad.bodyText].filter(Boolean).join('. '),
                exposure: ad.exposure.score,
            });
            angleGroups.set(hit.angle, group);
        }
    }

    const byAngle = [...angleGroups.entries()]
        .filter(([, group]) => group.ads.length >= 2)
        .map(([angle, group]) => ({
            angle,
            label: group.label,
            adCount: group.ads.length,
            terms: refine(toStats(tally(group.ads, banned), group.ads.length, 2), 6).map((t) => t.term),
        }))
        .filter((g) => g.terms.length > 0)
        .sort((a, b) => b.adCount - a.adCount);

    return { signature, distinctive: [], hookTerms, ctaTerms, byAngle };
}

export interface NicheVocabularyEntry {
    term: string;
    /** How many brands in the niche use it. */
    brandCount: number;
    brandShare: number;
    /** Ad-share averaged over the brands that use it. */
    avgAdShare: number;
    /** Per-brand ad-share, so a baseline can exclude the brand being measured. */
    sharesByBrand: Record<string, number>;
}

/**
 * The category's shared language: what everyone here says. Useful directly,
 * and as the baseline that makes a single brand's wording look distinctive.
 */
export function buildNicheVocabulary(
    brandVocabularies: Array<{ brand: string; vocabulary: BrandVocabulary }>,
    limit = 40,
): NicheVocabularyEntry[] {
    const brandTotal = brandVocabularies.length;
    if (brandTotal === 0) return [];

    const map = new Map<string, Record<string, number>>();
    for (const { brand, vocabulary } of brandVocabularies) {
        for (const stat of vocabulary.signature) {
            const entry = map.get(stat.term) ?? {};
            // Keep the strongest reading if a brand somehow appears twice.
            entry[brand] = Math.max(entry[brand] ?? 0, stat.adShare);
            map.set(stat.term, entry);
        }
    }

    // With three or more brands, a term only one of them uses is that brand's
    // own wording, not the category's — it belongs in `distinctive`, not here.
    const minBrands = brandTotal >= 3 ? 2 : 1;

    return [...map.entries()]
        .filter(([, sharesByBrand]) => Object.keys(sharesByBrand).length >= minBrands)
        .map(([term, sharesByBrand]) => {
            const shares = Object.values(sharesByBrand);
            return {
                term,
                brandCount: shares.length,
                brandShare: share(shares.length, brandTotal),
                avgAdShare: Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 10) / 10,
                sharesByBrand,
            };
        })
        .sort((a, b) => b.brandCount - a.brandCount || b.avgAdShare - a.avgAdShare || a.term.localeCompare(b.term))
        .slice(0, limit);
}

/**
 * Terms this brand leans on far harder than its category does.
 *
 * The baseline is leave-one-out: the brand's own usage is excluded from the
 * category average. Including it means a brand can never look distinctive
 * against a number it is itself inflating — in a small niche the only brand
 * using a phrase would score a lift of exactly 1 and be filtered out, which
 * is the opposite of the truth.
 *
 * A term no other brand uses falls back to a small non-zero baseline, so a
 * genuinely unique phrase scores high but finite rather than infinite.
 */
export function distinctiveTerms(
    vocabulary: BrandVocabulary,
    nicheVocabulary: NicheVocabularyEntry[],
    limit = 8,
    brandKey?: string,
): DistinctiveTerm[] {
    const UNSEEN_BASELINE = 5;
    const baseline = new Map<string, number>();
    for (const entry of nicheVocabulary) {
        const others = Object.entries(entry.sharesByBrand)
            .filter(([brand]) => brand !== brandKey)
            .map(([, value]) => value);
        baseline.set(
            entry.term,
            others.length > 0 ? others.reduce((a, b) => a + b, 0) / others.length : 0,
        );
    }

    return vocabulary.signature
        .map((stat) => {
            const nicheAdShare = Math.round((baseline.get(stat.term) ?? 0) * 10) / 10;
            const lift = Math.round((stat.adShare / Math.max(UNSEEN_BASELINE, nicheAdShare)) * 100) / 100;
            return { ...stat, lift, nicheAdShare };
        })
        // A term has to actually be this brand's habit before its rarity in
        // the category means anything: a phrase in 20% of its ads is not a
        // signature just because nobody else happens to use it.
        .filter((t) => t.lift > 1.3 && t.adShare >= 40)
        .sort((a, b) => b.lift - a.lift || b.words - a.words || b.adShare - a.adShare)
        .slice(0, limit);
}

export function summariseVocabulary(vocabulary: BrandVocabulary, limit = 8): string {
    const terms = vocabulary.signature.slice(0, limit)
        .map((t) => `${t.term} (${t.adShare}%)`);
    return collapseWhitespace(uniq(terms).join(' · ')) || 'no recurring language found';
}
