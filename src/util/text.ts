/** Text helpers shared by the classifier and the copy analyser. */

export function collapseWhitespace(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

export function normalise(input: string): string {
    return collapseWhitespace(
        input
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[’‘`]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[^a-z0-9%$£€'".,!?/+\-\s]/g, ' '),
    );
}

export function tokenise(input: string): string[] {
    return normalise(input).split(/[^a-z0-9'+-]+/).filter((t) => t.length > 1);
}

/**
 * Counts whole-word occurrences of a term (single word or phrase) in
 * already-normalised text. Phrases match across a single space.
 */
export function countTerm(normalisedText: string, term: string): number {
    const needle = normalise(term);
    if (!needle) return 0;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
    return (normalisedText.match(re) ?? []).length;
}

export function splitSentences(input: string): string[] {
    return collapseWhitespace(input)
        .split(/(?<=[.!?…])\s+(?=[A-Z0-9"'“‘(])|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

export function truncate(input: string, max: number): string {
    const clean = collapseWhitespace(input);
    if (clean.length <= max) return clean;
    return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function countSyllables(word: string): number {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return w.length > 0 ? 1 : 0;
    const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    return (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length || 1;
}

/** Flesch reading ease, rounded. Higher is easier. Returns 0 for empty text. */
export function readingEase(input: string): number {
    const sentences = splitSentences(input);
    const words = collapseWhitespace(input).split(/\s+/).filter((w) => /[a-z]/i.test(w));
    if (sentences.length === 0 || words.length === 0) return 0;
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
    return Math.round(Math.max(0, Math.min(100, score)));
}

export function wordCount(input: string): number {
    return collapseWhitespace(input).split(/\s+/).filter(Boolean).length;
}

export function uniq<T>(items: T[]): T[] {
    return [...new Set(items)];
}

export function titleCase(input: string): string {
    return input.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/** Rough "is this a real product name" filter for text pulled off a page. */
export function looksLikeProductName(name: string): boolean {
    const clean = collapseWhitespace(name);
    if (clean.length < 3 || clean.length > 90) return false;
    if (!/[a-z]/i.test(clean)) return false;
    if (/^(home|shop|cart|menu|search|login|account|about|contact|blog|faq|sale|new|all)$/i.test(clean)) return false;
    if (/(add to cart|view all|learn more|read more|shop now|see all|sign up|subscribe)/i.test(clean)) return false;
    return true;
}

/** Percentage of `part` within `total`, rounded to one decimal. */
export function share(part: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((part / total) * 1000) / 10;
}

export function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
