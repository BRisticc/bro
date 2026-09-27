import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    ALIAS_HEADERS, buildReviewQueue, fromCsv, mergeAliases, parseAliasCsv,
    renderAliasCsv, renderReviewCsv, resolutionStats, toCsv,
} from '../src/resolve/alias-store.js';
import type { AliasEntry, Resolution } from '../src/resolve/entity-resolver.js';

function resolution(over: Partial<Resolution>): Resolution {
    return { confidence: 0, status: 'unresolved', evidence: [], conflicts: [], ...over };
}

describe('CSV round trip', () => {
    it('survives commas, quotes and newlines', () => {
        const rows = [{ a: 'plain', b: 'has, comma', c: 'say "hi"', d: 'line\nbreak' }];
        const parsed = fromCsv(toCsv(['a', 'b', 'c', 'd'], rows));
        assert.equal(parsed[0]?.b, 'has, comma');
        assert.equal(parsed[0]?.c, 'say "hi"');
        assert.equal(parsed[0]?.d, 'line break', 'newlines are flattened so a row stays a row');
    });

    it('normalises header names and skips blank rows', () => {
        const parsed = fromCsv('Legal Entity,Brand\r\n115 Ventures LLC,Trysparta\r\n,\r\n');
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0]?.legal_entity, '115 Ventures LLC');
    });

    it('returns nothing for an empty file', () => {
        assert.deepEqual(fromCsv(''), []);
        assert.deepEqual(fromCsv('only,headers\n'), []);
    });
});

describe('review queue', () => {
    const resolutions = [
        resolution({ status: 'resolved', confidence: 93, brand: 'Trysparta', legalEntity: '115 Ventures, LLC' }),
        resolution({ status: 'confirmed', confidence: 100, brand: 'Acme', legalEntity: 'Acme Inc.' }),
        resolution({
            status: 'needs-review', confidence: 41, legalEntity: 'Alpha Holdings, LLC', brand: 'Bravo',
            website: 'https://x.com', linkedinSlug: 'alpha-holdings',
            reviewReason: 'The site names more than one company',
            evidence: [{ claim: 'Alpha Holdings, LLC', source: 'footer-copyright', weight: 30, quote: '© 2026 Alpha Holdings, LLC' }],
        }),
        resolution({ status: 'unresolved', confidence: 0, reviewReason: 'No legal entity found' }),
    ];

    const rows = buildReviewQueue(resolutions);

    it('queues only what the machine refused to decide', () => {
        assert.equal(rows.length, 2);
        assert.ok(!rows.some((r) => r.status === 'resolved' || r.status === 'confirmed'));
    });

    it('carries the question and the quoted evidence to the reviewer', () => {
        const row = rows[0];
        assert.match(row?.question ?? '', /more than one company/);
        assert.match(row?.evidence ?? '', /© 2026 Alpha Holdings, LLC/);
        assert.equal(row?.proposed_legal_entity, 'Alpha Holdings, LLC');
    });

    it('leaves the confirmation columns blank for a human to fill', () => {
        assert.ok(rows.every((r) => r.confirmed_brand === '' && r.confirmed_legal_entity === ''));
    });

    it('renders a CSV a spreadsheet can open', () => {
        const csv = renderReviewCsv(rows);
        assert.ok(csv.startsWith('linkedin_slug,website,'));
        assert.equal(fromCsv(csv).length, 2);
    });
});

describe('a filled review sheet becomes aliases', () => {
    it('accepts the sheet the reviewer was given back', () => {
        const csv = [
            'linkedin_slug,website,proposed_legal_entity,proposed_brand,confidence,status,question,evidence,confirmed_legal_entity,confirmed_brand',
            '115-ventures,https://trysparta.com,"115 Ventures, LLC",,41,needs-review,q,e,,Trysparta',
            'alpha-holdings,https://x.com,"Alpha Holdings, LLC",Bravo,41,needs-review,q,e,,',
        ].join('\n');

        const aliases = parseAliasCsv(csv);
        assert.equal(aliases.length, 1, 'an untouched row is not a confirmation');
        assert.equal(aliases[0]?.brand, 'Trysparta');
        assert.equal(aliases[0]?.legalEntity, '115 Ventures, LLC');
        assert.equal(aliases[0]?.linkedinSlug, '115-ventures');
    });

    it('round-trips its own alias file', () => {
        const entries: AliasEntry[] = [{
            legalEntity: '115 Ventures, LLC', brand: 'Trysparta',
            website: 'https://trysparta.com', linkedinSlug: '115-ventures',
            confirmedBy: 'ops@example.com', confirmedAt: '2026-09-27T00:00:00.000Z',
        }];
        const parsed = parseAliasCsv(renderAliasCsv(entries));
        assert.deepEqual(parsed, entries);
        assert.equal(renderAliasCsv(entries).split('\n')[0], ALIAS_HEADERS.join(','));
    });
});

describe('merging confirmations into the stored table', () => {
    const stored: AliasEntry[] = [{
        legalEntity: '115 Ventures, LLC', brand: 'Trysparta', linkedinSlug: '115-ventures',
    }];

    it('adds a company it has not seen', () => {
        const result = mergeAliases(stored, [{ legalEntity: 'Acme Inc.', brand: 'Acme', linkedinSlug: 'acme' }]);
        assert.equal(result.merged.length, 2);
        assert.equal(result.added.length, 1);
        assert.deepEqual(result.conflicts, []);
    });

    it('fills gaps without overwriting what is already stored', () => {
        const result = mergeAliases(stored, [{
            legalEntity: '115 Ventures LLC', brand: 'Trysparta',
            linkedinSlug: '115-ventures', website: 'https://trysparta.com', confirmedBy: 'ops',
        }]);
        assert.equal(result.merged.length, 1);
        assert.equal(result.merged[0]?.website, 'https://trysparta.com');
        assert.equal(result.merged[0]?.legalEntity, '115 Ventures, LLC', 'the stored spelling is kept');
    });

    it('surfaces a contradiction instead of applying it', () => {
        const result = mergeAliases(stored, [{
            legalEntity: '115 Ventures, LLC', brand: 'SomethingElse', linkedinSlug: '115-ventures',
        }]);
        assert.equal(result.conflicts.length, 1);
        assert.equal(result.conflicts[0]?.field, 'brand');
        assert.equal(result.merged[0]?.brand, 'Trysparta', 'the stored alias is untouched');
    });

    it('treats a differently-spelled but equal name as the same mapping', () => {
        const result = mergeAliases(stored, [{ legalEntity: '115 Ventures LLC', brand: 'trysparta', linkedinSlug: '115-ventures' }]);
        assert.deepEqual(result.conflicts, []);
    });
});

describe('run statistics', () => {
    it('reports the real automatic rate rather than anyone guessing it', () => {
        const stats = resolutionStats([
            resolution({ status: 'confirmed' }), resolution({ status: 'resolved' }),
            resolution({ status: 'resolved' }), resolution({ status: 'needs-review' }),
        ]);
        assert.equal(stats.total, 4);
        assert.equal(stats.automaticRate, 75);
        assert.equal(stats.humanDecisions, 1);
    });

    it('does not divide by zero on an empty run', () => {
        assert.equal(resolutionStats([]).automaticRate, 0);
    });
});
