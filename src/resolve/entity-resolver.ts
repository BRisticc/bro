import {
    dedupeSignals, namesMatch, normaliseCompanyName, parseLinkedinCompanyUrl,
    type IdentitySignal,
} from './identity-signals.js';
import { truncate, uniq } from '../util/text.js';

/**
 * Deciding which trading brand a legal entity is.
 *
 * No authoritative source maps "115 Ventures, LLC" to "Trysparta", so this
 * does not look one up. It collects what each source claims, then lets
 * corroboration decide: a claim from one place is a guess, the same claim from
 * two independent places is a fact. The join that does the real work is
 * cheap — take the name on the LinkedIn page and find the website whose legal
 * pages name that same entity. The mapping is not in a directory, it is in the
 * overlap.
 *
 * The design rule everything else follows from: for a prospecting pipeline, a
 * silent wrong match is far more expensive than an abstention. One brand's ads
 * attributed to another poisons every downstream number and nothing surfaces
 * the error. So this optimises precision and refuses rather than guesses, and
 * every refusal names what a human would have to check.
 */

/** A mapping a human has confirmed. Permanent, and trusted absolutely. */
export interface AliasEntry {
    legalEntity: string;
    brand: string;
    website?: string;
    linkedinSlug?: string;
    /** Who confirmed it, and when — an alias table is only as good as its provenance. */
    confirmedBy?: string;
    confirmedAt?: string;
}

export type ResolutionStatus = 'confirmed' | 'resolved' | 'needs-review' | 'unresolved';

export interface ResolutionEvidence {
    claim: string;
    source: string;
    weight: number;
    quote?: string;
    url?: string;
}

export interface Resolution {
    /** The name the market knows, which is what the rest of the pipeline uses. */
    brand?: string;
    /** The registered company behind it. */
    legalEntity?: string;
    website?: string;
    linkedinSlug?: string;
    confidence: number;
    status: ResolutionStatus;
    evidence: ResolutionEvidence[];
    /** Rival legal entities with real support. Present means: do not guess. */
    conflicts: Array<{ entity: string; weight: number; sources: string[] }>;
    /** What a human needs to check, when the machine will not decide. */
    reviewReason?: string;
}

export interface ResolutionInput {
    /** The LinkedIn company URL you started from. */
    linkedinUrl?: string;
    /** The company name as LinkedIn states it, e.g. "115 Ventures". */
    linkedinName?: string;
    /** A trading name you already believe in. */
    brandName?: string;
    websiteUrl?: string;
    /** Identity claims harvested from the website's own pages. */
    signals: IdentitySignal[];
    aliases?: AliasEntry[];
}

/** Below this, the pipeline must not act on the match by itself. */
export const MIN_AUTO_CONFIDENCE = 70;

/**
 * Independent corroboration, not repetition.
 *
 * Four copies of the same footer across four pages is one source saying one
 * thing four times. A footer plus a Terms of Service plus a trademark notice
 * is three. Only the second deserves confidence, so weight is summed per
 * distinct source and repeats within a source are discounted hard.
 */
function scoreClaims(
    signals: IdentitySignal[],
    role: IdentitySignal['role'],
): Array<{ value: string; weight: number; sources: string[]; signals: IdentitySignal[] }> {
    interface Group { value: string; bySource: Map<string, number>; signals: IdentitySignal[] }
    const groups = new Map<string, Group>();

    for (const signal of signals) {
        if (signal.role !== role) continue;
        const key = normaliseCompanyName(signal.value);
        if (!key) continue;
        const fresh: Group = { value: signal.value, bySource: new Map(), signals: [] };
        const group = groups.get(key) ?? fresh;
        // Keep the longest spelling: "115 Ventures, LLC" over "115 Ventures".
        if (signal.value.length > group.value.length) group.value = signal.value;
        group.bySource.set(signal.source, Math.max(group.bySource.get(signal.source) ?? 0, signal.weight));
        group.signals.push(signal);
        groups.set(key, group);
    }

    return [...groups.values()]
        .map((group) => {
            const weights = [...group.bySource.values()].sort((a, b) => b - a);
            // First source at full value, each further one at a declining share.
            const weight = weights.reduce((sum, w, i) => sum + w / (i + 1), 0);
            return {
                value: group.value,
                weight: Math.round(weight * 10) / 10,
                sources: [...group.bySource.keys()],
                signals: group.signals,
            };
        })
        .sort((a, b) => b.weight - a.weight);
}

function toConfidence(weight: number): number {
    if (weight <= 0) return 0;
    return Math.round(100 * (1 - Math.exp(-weight / 45)));
}

function evidenceFrom(signals: IdentitySignal[], limit = 6): ResolutionEvidence[] {
    return signals
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit)
        .map((s) => ({
            claim: s.value,
            source: s.source,
            weight: s.weight,
            ...(s.quote ? { quote: s.quote } : {}),
            ...(s.url ? { url: s.url } : {}),
        }));
}

function findAlias(input: ResolutionInput, linkedinSlug?: string): AliasEntry | undefined {
    for (const alias of input.aliases ?? []) {
        if (linkedinSlug && alias.linkedinSlug && alias.linkedinSlug.toLowerCase() === linkedinSlug) return alias;
        if (input.linkedinName && namesMatch(alias.legalEntity, input.linkedinName)) return alias;
        if (input.brandName && namesMatch(alias.brand, input.brandName)) return alias;
        if (input.websiteUrl && alias.website) {
            try {
                if (new URL(alias.website).hostname.replace(/^www\./, '')
                    === new URL(input.websiteUrl).hostname.replace(/^www\./, '')) return alias;
            } catch { /* a malformed alias website is not a match */ }
        }
    }
    return undefined;
}

export function resolveEntity(input: ResolutionInput): Resolution {
    const linkedin = input.linkedinUrl ? parseLinkedinCompanyUrl(input.linkedinUrl) : null;
    const linkedinSlug = linkedin?.slug;
    const claimedName = input.linkedinName ?? linkedin?.guessedName;

    // A human-confirmed alias is not evidence to be weighed; it is the answer.
    const alias = findAlias(input, linkedinSlug);
    if (alias) {
        const slug = linkedinSlug ?? alias.linkedinSlug;
        return {
            brand: alias.brand,
            legalEntity: alias.legalEntity,
            confidence: 100,
            status: 'confirmed',
            evidence: [{
                claim: `${alias.legalEntity} trades as ${alias.brand}`,
                source: 'confirmed-alias',
                weight: 100,
                ...(alias.confirmedBy ? { quote: `confirmed by ${alias.confirmedBy}` } : {}),
            }],
            conflicts: [],
            ...(alias.website ? { website: alias.website } : {}),
            ...(slug ? { linkedinSlug: slug } : {}),
        };
    }

    const signals = dedupeSignals(input.signals);
    const entities = scoreClaims(signals, 'legal-entity');
    const brands = scoreClaims(signals, 'brand');

    const evidence: ResolutionEvidence[] = [];
    let weight = 0;
    const best = entities[0];

    if (best) {
        weight += best.weight;
        evidence.push(...evidenceFrom(best.signals));
    }

    // The join that makes the whole thing work: the name on LinkedIn and the
    // entity named in the website's own legal pages are the same company.
    let joined = false;
    if (claimedName && best && namesMatch(best.value, claimedName)) {
        joined = true;
        weight += 35;
        evidence.unshift({
            claim: `LinkedIn's "${claimedName}" matches the entity named on ${input.websiteUrl ?? 'the site'}`,
            source: 'linkedin-website-join',
            weight: 35,
        });
    } else if (claimedName && entities.some((e) => namesMatch(e.value, claimedName))) {
        joined = true;
        weight += 20;
        evidence.unshift({
            claim: `LinkedIn's "${claimedName}" appears among the entities named on the site, but is not the strongest claim`,
            source: 'linkedin-website-join',
            weight: 20,
        });
    }

    const brandGuess = brands[0]?.value ?? input.brandName;
    if (brands[0]) evidence.push(...evidenceFrom(brands[0].signals, 2));

    // Rival entities backed by a substantial source of their own mean the site
    // names more than one company. A ratio test against the winner was wrong
    // here: a footer naming the parent scores lower than a Terms of Service
    // naming the operator, so the ratio hid exactly the parent/subsidiary
    // split it most needed to surface. Any rival with real backing counts.
    const conflicts = entities
        .slice(1)
        .filter((e) => e.weight >= 25)
        .map((e) => ({ entity: e.value, weight: e.weight, sources: e.sources }));

    // A LinkedIn name that matches none of the entities on the site is a
    // contradiction, not a missing bonus. The site's own evidence is strong
    // regardless — it just says nothing about whether this site belongs to the
    // company you started from. Treating that as "resolved" is the silent
    // wrong match this whole module exists to prevent.
    const contradicted = Boolean(claimedName) && entities.length > 0 && !joined;
    const confidence = contradicted
        ? Math.min(45, toConfidence(weight))
        : Math.min(100, toConfidence(weight));

    let status: ResolutionStatus;
    let reviewReason: string | undefined;

    if (contradicted && best) {
        status = 'needs-review';
        reviewReason = `The site is operated by ${best.value}, but you started from "${claimedName}". `
            + 'Nothing here ties the two together: either that LinkedIn page belongs to a different '
            + 'company, or the brand changed hands and the pages disagree.';
    } else if (!best) {
        status = 'unresolved';
        reviewReason = claimedName
            ? `No legal entity found on the site, so "${claimedName}" could not be tied to it. Check the Terms of Service and the footer by hand.`
            : 'No legal entity found on the site, and no LinkedIn name was supplied to match against.';
    } else if (conflicts.length > 0) {
        status = 'needs-review';
        reviewReason = `The site names more than one company with comparable support: ${
            [best.value, ...conflicts.map((c) => c.entity)].join(' vs ')
        }. This is usually a parent and its subsidiary — a human has to say which one trades as ${brandGuess ?? 'this brand'}.`;
    } else if (confidence < MIN_AUTO_CONFIDENCE) {
        status = 'needs-review';
        reviewReason = `Only ${best.sources.length} source${best.sources.length === 1 ? '' : 's'} `
            + `support ${best.value} (${best.sources.join(', ')}). One source is a guess.`;
    } else {
        status = 'resolved';
    }

    const resolution: Resolution = {
        confidence,
        status,
        evidence: evidence.slice(0, 8),
        conflicts,
    };
    if (brandGuess) resolution.brand = brandGuess;
    if (best) resolution.legalEntity = best.value;
    if (input.websiteUrl) resolution.website = input.websiteUrl;
    if (linkedinSlug) resolution.linkedinSlug = linkedinSlug;
    if (reviewReason) resolution.reviewReason = reviewReason;

    return resolution;
}

/**
 * Turns a resolution a human has just approved into a permanent alias, so the
 * cost of the hard tail is paid once per company rather than once per run.
 */
export function toAliasEntry(resolution: Resolution, confirmedBy: string): AliasEntry | null {
    if (!resolution.brand || !resolution.legalEntity) return null;
    return {
        legalEntity: resolution.legalEntity,
        brand: resolution.brand,
        confirmedBy,
        confirmedAt: new Date().toISOString(),
        ...(resolution.website ? { website: resolution.website } : {}),
        ...(resolution.linkedinSlug ? { linkedinSlug: resolution.linkedinSlug } : {}),
    };
}

/** One line a human can act on, for a review queue. */
export function resolutionSummary(resolution: Resolution): string {
    const head = resolution.legalEntity && resolution.brand
        ? `${resolution.legalEntity} → ${resolution.brand}`
        : resolution.legalEntity ?? resolution.brand ?? 'unidentified';
    return truncate(
        `${head} · ${resolution.status} (${resolution.confidence}) · ${
            uniq(resolution.evidence.map((e) => e.source)).join(', ') || 'no evidence'
        }`,
        240,
    );
}
