import type { AliasEntry, Resolution } from './entity-resolver.js';
import { namesMatch } from './identity-signals.js';
import { collapseWhitespace, truncate, uniq } from '../util/text.js';

/**
 * The loop that makes a human-in-the-loop resolver cheap.
 *
 * Every company that cannot be resolved automatically costs one human
 * decision — once, not once per run. This module carries that decision out as
 * a review queue and back in as an alias, so the manual tail shrinks with
 * every run instead of being re-paid.
 *
 * CSV is the transport on purpose: the person deciding is looking at a
 * spreadsheet, not a JSON editor, and the round trip has to survive being
 * opened in Excel and sent back.
 */

// ------------------------------------------------------------------ CSV

function csvEscape(value: string): string {
    const clean = value.replace(/\r?\n/g, ' ');
    return /[",]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

export function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
    }
    return `${lines.join('\n')}\n`;
}

/** Tolerant CSV reader: handles quotes, embedded commas and CRLF. */
export function fromCsv(text: string): Array<Record<string, string>> {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
            } else field += char;
            continue;
        }
        if (char === '"') { quoted = true; continue; }
        if (char === ',') { row.push(field); field = ''; continue; }
        if (char === '\n') {
            row.push(field.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            field = '';
            continue;
        }
        field += char;
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
    }

    const header = rows.shift();
    if (!header) return [];
    const keys = header.map((h) => collapseWhitespace(h).toLowerCase().replace(/\s+/g, '_'));

    return rows
        .filter((r) => r.some((cell) => cell.trim() !== ''))
        .map((r) => {
            const record: Record<string, string> = {};
            keys.forEach((key, index) => { record[key] = (r[index] ?? '').trim(); });
            return record;
        });
}

// ------------------------------------------------------------ review queue

export interface ReviewRow extends Record<string, string> {
    linkedin_slug: string;
    website: string;
    proposed_legal_entity: string;
    proposed_brand: string;
    confidence: string;
    status: string;
    /** The specific question, so the reviewer does not have to re-derive it. */
    question: string;
    /** The quoted sentences the proposal rests on. */
    evidence: string;
    /** Left blank for the reviewer. Filling either one confirms the row. */
    confirmed_legal_entity: string;
    confirmed_brand: string;
}

export const REVIEW_HEADERS = [
    'linkedin_slug', 'website', 'proposed_legal_entity', 'proposed_brand',
    'confidence', 'status', 'question', 'evidence',
    'confirmed_legal_entity', 'confirmed_brand',
];

/** Only what a machine refused to decide reaches a human. */
export function buildReviewQueue(resolutions: Resolution[]): ReviewRow[] {
    return resolutions
        .filter((r) => r.status === 'needs-review' || r.status === 'unresolved')
        .map((r) => ({
            linkedin_slug: r.linkedinSlug ?? '',
            website: r.website ?? '',
            proposed_legal_entity: r.legalEntity ?? '',
            proposed_brand: r.brand ?? '',
            confidence: String(r.confidence),
            status: r.status,
            question: r.reviewReason ?? '',
            evidence: truncate(
                uniq(r.evidence.map((e) => (e.quote ? `${e.source}: "${e.quote}"` : `${e.source}: ${e.claim}`))).join(' | '),
                600,
            ),
            confirmed_legal_entity: '',
            confirmed_brand: '',
        }));
}

export function renderReviewCsv(rows: ReviewRow[]): string {
    return toCsv(REVIEW_HEADERS, rows);
}

// ------------------------------------------------------------- alias table

export const ALIAS_HEADERS = ['legal_entity', 'brand', 'website', 'linkedin_slug', 'confirmed_by', 'confirmed_at'];

export function renderAliasCsv(entries: AliasEntry[]): string {
    return toCsv(ALIAS_HEADERS, entries.map((a) => ({
        legal_entity: a.legalEntity,
        brand: a.brand,
        website: a.website ?? '',
        linkedin_slug: a.linkedinSlug ?? '',
        confirmed_by: a.confirmedBy ?? '',
        confirmed_at: a.confirmedAt ?? '',
    })));
}

export function parseAliasCsv(text: string): AliasEntry[] {
    const out: AliasEntry[] = [];
    for (const row of fromCsv(text)) {
        // Accepts both the alias file's own columns and a filled-in review
        // queue, so a reviewer can send back the sheet they were given.
        const legalEntity = row.legal_entity || row.confirmed_legal_entity || row.proposed_legal_entity;
        const brand = row.confirmed_brand || row.brand || row.proposed_brand;
        if (!legalEntity || !brand) continue;

        // On a review sheet, an untouched row is not a confirmation.
        const isReviewSheet = 'confirmed_brand' in row || 'confirmed_legal_entity' in row;
        if (isReviewSheet && !row.confirmed_brand && !row.confirmed_legal_entity) continue;

        const entry: AliasEntry = { legalEntity, brand };
        if (row.website) entry.website = row.website;
        if (row.linkedin_slug) entry.linkedinSlug = row.linkedin_slug.toLowerCase();
        if (row.confirmed_by) entry.confirmedBy = row.confirmed_by;
        if (row.confirmed_at) entry.confirmedAt = row.confirmed_at;
        out.push(entry);
    }
    return out;
}

export interface MergeResult {
    merged: AliasEntry[];
    added: AliasEntry[];
    /** Incoming rows that contradict a stored alias. Never silently applied. */
    conflicts: Array<{ existing: AliasEntry; incoming: AliasEntry; field: string }>;
}

function aliasKey(entry: AliasEntry): string {
    if (entry.linkedinSlug) return `li:${entry.linkedinSlug}`;
    if (entry.website) {
        try {
            return `web:${new URL(entry.website).hostname.replace(/^www\./, '')}`;
        } catch { /* fall through to the name key */ }
    }
    return `name:${entry.legalEntity.toLowerCase()}`;
}

/**
 * Merges confirmations into the stored table.
 *
 * A row that disagrees with a stored alias is surfaced rather than applied: an
 * alias table is trusted absolutely by the resolver, so a bad row silently
 * overwriting a good one would be the worst failure in the system.
 */
export function mergeAliases(existing: AliasEntry[], incoming: AliasEntry[]): MergeResult {
    const byKey = new Map(existing.map((e) => [aliasKey(e), e]));
    const added: AliasEntry[] = [];
    const conflicts: MergeResult['conflicts'] = [];

    for (const entry of incoming) {
        const key = aliasKey(entry);
        const current = byKey.get(key);
        if (!current) {
            byKey.set(key, entry);
            added.push(entry);
            continue;
        }
        if (!namesMatch(current.brand, entry.brand)) {
            conflicts.push({ existing: current, incoming: entry, field: 'brand' });
            continue;
        }
        if (!namesMatch(current.legalEntity, entry.legalEntity)) {
            conflicts.push({ existing: current, incoming: entry, field: 'legalEntity' });
            continue;
        }
        // Same mapping, possibly richer: fill gaps without overwriting.
        byKey.set(key, {
            ...current,
            website: current.website ?? entry.website,
            linkedinSlug: current.linkedinSlug ?? entry.linkedinSlug,
            confirmedBy: current.confirmedBy ?? entry.confirmedBy,
            confirmedAt: current.confirmedAt ?? entry.confirmedAt,
        });
    }

    return { merged: [...byKey.values()], added, conflicts };
}

export interface ResolutionStats {
    total: number;
    confirmed: number;
    resolved: number;
    needsReview: number;
    unresolved: number;
    /** Share decided without a human, as a percentage. */
    automaticRate: number;
    /** How many rows a human actually has to look at. */
    humanDecisions: number;
}

/**
 * Reports the real automatic-resolution rate for this run, rather than
 * anybody guessing at it. The number that matters when deciding whether the
 * manual tail is tolerable is the one your own data produces.
 */
export function resolutionStats(resolutions: Resolution[]): ResolutionStats {
    const count = (status: Resolution['status']): number => resolutions.filter((r) => r.status === status).length;
    const total = resolutions.length;
    const confirmed = count('confirmed');
    const resolved = count('resolved');
    const needsReview = count('needs-review');
    const unresolved = count('unresolved');

    return {
        total,
        confirmed,
        resolved,
        needsReview,
        unresolved,
        automaticRate: total === 0 ? 0 : Math.round(((confirmed + resolved) / total) * 1000) / 10,
        humanDecisions: needsReview + unresolved,
    };
}
