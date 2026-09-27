import type { CheerioAPI } from 'cheerio';
import { collapseWhitespace, truncate, uniq } from '../util/text.js';
import { extractJsonLd, extractTextCorpus, load } from '../profile/extractors.js';

/**
 * Extracting the legal entity behind a trading brand.
 *
 * The premise that this mapping "does not exist" is wrong in a useful way: it
 * exists, in several places, put there by the company itself because it is
 * legally obliged to. A footer says "© 2026 115 Ventures, LLC". Terms of
 * Service say "these terms are between you and 115 Ventures, LLC". A
 * trademark notice says "Trysparta® is a registered trademark of 115
 * Ventures, LLC" — which is the mapping, stated outright.
 *
 * What does not exist is a single authoritative source. So the job is not
 * lookup, it is evidence gathering: collect every claim, record where each
 * came from, and let corroboration decide. One source is a guess; two
 * independent sources agreeing is a fact.
 */

export type SignalSource =
    | 'trademark-notice' | 'terms-of-service' | 'privacy-policy' | 'footer-copyright'
    | 'jsonld-legal-name' | 'jsonld-parent' | 'og-site-name' | 'page-title' | 'contact-page';

export interface IdentitySignal {
    /** The name this signal asserts. */
    value: string;
    /** What kind of name it is. */
    role: 'legal-entity' | 'brand';
    source: SignalSource;
    /** How much this source is worth on its own, 0-50. */
    weight: number;
    /** The sentence it came from, so a human can check it in one glance. */
    quote?: string;
    /** The page it was found on. */
    url?: string;
}

/**
 * Company-form suffixes across the jurisdictions a DTC brand is likely to sit
 * in. The suffix is what makes a string a legal entity rather than a brand.
 */
const ENTITY_SUFFIX = String.raw`(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.|Company|Ltd\.?|Limited|LLP|L\.P\.|LP|PLC|GmbH|mbH|AG|UG|B\.V\.|N\.V\.|S\.A\.|S\.A\.S\.|SAS|SARL|S\.à r\.l\.|S\.r\.l\.|S\.p\.A\.|S\.L\.|Pty\.? Ltd\.?|Pte\.? Ltd\.?|AB|ApS|A\/S|AS|Oy|Oyj|d\.o\.o\.|Sp\. z o\.o\.|s\.r\.o\.|Kft\.?|SRL)`;

// Both halves are captured: the name and the company form. Capturing only
// the name loses the ", LLC" that makes it a legal entity at all, and
// recovering it by slicing the match produced "115 Ventures , LLC".
const ENTITY_NAME = String.raw`([A-Z0-9][\w&.,'’\-\/ ]{1,60}?[\w.’])[,\s]+(${ENTITY_SUFFIX})`;

function entityRegex(prefix: string, flags = 'g'): RegExp {
    return new RegExp(`${prefix}${ENTITY_NAME}`, flags);
}

/** Joins a captured name and company form into one canonical entity string. */
function cleanEntity(name: string, suffix?: string): string {
    const base = collapseWhitespace(name)
        .replace(/^(?:the|by|and|of|to|is|are|a|an)\s+/i, '')
        .replace(/[,\s]+$/, '');
    if (!suffix) return truncate(base, 90);
    return truncate(`${base}, ${collapseWhitespace(suffix)}`, 90);
}

/** Strips the company form and punctuation, for comparing two names. */
export function normaliseCompanyName(name: string): string {
    return collapseWhitespace(
        name
            .toLowerCase()
            .replace(new RegExp(`[,\\s]+${ENTITY_SUFFIX}\\s*$`, 'i'), '')
            .replace(/[®™©]/g, '')
            .replace(/[^a-z0-9]+/g, ' '),
    );
}

/** True when two names refer to the same thing once form and case are gone. */
export function namesMatch(a: string, b: string): boolean {
    const na = normaliseCompanyName(a);
    const nb = normaliseCompanyName(b);
    if (!na || !nb) return false;
    return na === nb || na.replace(/\s/g, '') === nb.replace(/\s/g, '');
}

/**
 * The single best signal there is: a trademark notice names the brand AND the
 * entity that owns it, in one sentence, written by the company's own lawyers.
 */
function trademarkSignals(text: string, url?: string): IdentitySignal[] {
    const out: IdentitySignal[] = [];
    const re = new RegExp(
        String.raw`([A-Z][\w'’\-]{2,40})\s*[®™]?\s*(?:is|are)?\s*(?:a\s+)?(?:registered\s+)?trademarks?\s+(?:of|owned by)\s+${ENTITY_NAME}`,
        'gi',
    );
    let match: RegExpExecArray | null = re.exec(text);
    while (match !== null) {
        const brand = match[1];
        const entity = match[2];
        if (brand && entity) {
            const quote = truncate(collapseWhitespace(match[0]), 220);
            out.push({ value: cleanEntity(entity, match[3]), role: 'legal-entity', source: 'trademark-notice', weight: 50, quote, ...(url ? { url } : {}) });
            out.push({ value: collapseWhitespace(brand), role: 'brand', source: 'trademark-notice', weight: 50, quote, ...(url ? { url } : {}) });
        }
        match = re.exec(text);
    }
    return out;
}

const CONTRACT_PREFIXES = [
    String.raw`(?:between|with)\s+you\s+and\s+`,
    String.raw`(?:operated|owned|provided|run)\s+by\s+`,
    String.raw`(?:these\s+terms[^.]{0,40}?\s+with\s+)`,
    String.raw`(?:a\s+(?:service|brand|product)\s+of\s+)`,
    String.raw`(?:is\s+a\s+(?:trading|registered)\s+name\s+of\s+)`,
];

function contractSignals(text: string, source: SignalSource, weight: number, url?: string): IdentitySignal[] {
    const out: IdentitySignal[] = [];
    for (const prefix of CONTRACT_PREFIXES) {
        const re = entityRegex(prefix, 'gi');
        let match: RegExpExecArray | null = re.exec(text);
        while (match !== null) {
            if (match[1]) {
                out.push({
                    value: cleanEntity(match[1], match[2]),
                    role: 'legal-entity',
                    source,
                    weight,
                    quote: truncate(collapseWhitespace(match[0]), 220),
                    ...(url ? { url } : {}),
                });
            }
            match = re.exec(text);
        }
    }
    return out;
}

function copyrightSignals(text: string, url?: string): IdentitySignal[] {
    const out: IdentitySignal[] = [];
    const re = entityRegex(String.raw`(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*`, 'gi');
    let match: RegExpExecArray | null = re.exec(text);
    while (match !== null) {
        if (match[1]) {
            out.push({
                value: cleanEntity(match[1], match[2]),
                role: 'legal-entity',
                source: 'footer-copyright',
                weight: 30,
                quote: truncate(collapseWhitespace(match[0]), 220),
                ...(url ? { url } : {}),
            });
        }
        match = re.exec(text);
    }
    return out;
}

function structuredSignals($: CheerioAPI, url?: string): IdentitySignal[] {
    const out: IdentitySignal[] = [];
    const push = (value: unknown, role: IdentitySignal['role'], source: SignalSource, weight: number): void => {
        if (typeof value !== 'string') return;
        const clean = collapseWhitespace(value);
        if (clean.length < 2 || clean.length > 90) return;
        out.push({ value: truncate(clean, 90), role, source, weight, ...(url ? { url } : {}) });
    };

    for (const node of extractJsonLd($)) {
        push(node.legalName, 'legal-entity', 'jsonld-legal-name', 40);
        push(node.name, 'brand', 'jsonld-legal-name', 20);
        push(node.alternateName, 'brand', 'jsonld-legal-name', 15);
        const parent = node.parentOrganization;
        if (parent && typeof parent === 'object') {
            push((parent as Record<string, unknown>).name, 'legal-entity', 'jsonld-parent', 35);
        }
    }

    push($('meta[property="og:site_name"]').first().attr('content'), 'brand', 'og-site-name', 25);
    const title = $('title').first().text().split(/[|\-–—]/)[0];
    push(title, 'brand', 'page-title', 10);

    return out;
}

export interface SignalPage {
    url: string;
    html: string;
    /** What kind of page this is, which sets how much its claims are worth. */
    kind: 'home' | 'terms' | 'privacy' | 'contact' | 'about' | 'other';
}

const KIND_WEIGHT: Record<SignalPage['kind'], { source: SignalSource; weight: number }> = {
    terms: { source: 'terms-of-service', weight: 45 },
    privacy: { source: 'privacy-policy', weight: 40 },
    contact: { source: 'contact-page', weight: 25 },
    about: { source: 'contact-page', weight: 20 },
    home: { source: 'footer-copyright', weight: 30 },
    other: { source: 'footer-copyright', weight: 20 },
};

/** Every identity claim one page makes about itself. */
export function extractIdentitySignals(page: SignalPage): IdentitySignal[] {
    const $ = load(page.html);
    const text = extractTextCorpus(load(page.html), 60000);
    const { source, weight } = KIND_WEIGHT[page.kind];

    return [
        ...trademarkSignals(text, page.url),
        ...contractSignals(text, source, weight, page.url),
        ...copyrightSignals(text, page.url),
        ...structuredSignals($, page.url),
    ];
}

/** Paths that carry legal identity, in the order they are worth fetching. */
export const IDENTITY_PATHS: Array<{ path: string; kind: SignalPage['kind'] }> = [
    { path: '/policies/terms-of-service', kind: 'terms' },
    { path: '/pages/terms-of-service', kind: 'terms' },
    { path: '/terms', kind: 'terms' },
    { path: '/terms-of-service', kind: 'terms' },
    { path: '/policies/privacy-policy', kind: 'privacy' },
    { path: '/privacy', kind: 'privacy' },
    { path: '/privacy-policy', kind: 'privacy' },
    { path: '/pages/contact', kind: 'contact' },
    { path: '/contact', kind: 'contact' },
    { path: '/pages/about', kind: 'about' },
    { path: '/about', kind: 'about' },
];

/**
 * Parses a LinkedIn company URL into its slug.
 *
 * Only the URL is read. LinkedIn's terms forbid scraping its pages, and its
 * anti-automation is effective regardless, so the slug is treated as an
 * identifier to carry through the pipeline — never as a page to fetch.
 */
export function parseLinkedinCompanyUrl(raw: string): { slug: string; guessedName: string } | null {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;

    const match = /\/company\/([^/?#]+)/i.exec(parsed.pathname);
    const slug = match?.[1];
    if (!slug) return null;

    const decoded = decodeURIComponent(slug).toLowerCase();
    // Slugs are lower-cased and hyphenated, and often carry a disambiguating
    // numeric suffix ("115-ventures-2") that is not part of the name.
    const guessedName = decoded
        .replace(/-\d+$/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    return { slug: decoded, guessedName: collapseWhitespace(guessedName) };
}

export function dedupeSignals(signals: IdentitySignal[]): IdentitySignal[] {
    const seen = new Map<string, IdentitySignal>();
    for (const signal of signals) {
        const key = `${signal.role}:${normaliseCompanyName(signal.value)}:${signal.source}`;
        const existing = seen.get(key);
        if (!existing || signal.weight > existing.weight) seen.set(key, signal);
    }
    return [...seen.values()];
}

export function signalSummary(signals: IdentitySignal[]): string {
    return uniq(signals.map((s) => `${s.value} (${s.source})`)).join(' · ');
}
