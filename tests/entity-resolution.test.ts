import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    extractIdentitySignals, namesMatch, normaliseCompanyName, parseLinkedinCompanyUrl,
} from '../src/resolve/identity-signals.js';
import {
    MIN_AUTO_CONFIDENCE, resolveEntity, resolutionSummary, toAliasEntry,
} from '../src/resolve/entity-resolver.js';

// The case the whole module exists for: LinkedIn says "115 Ventures", the
// market knows the brand as "Trysparta", and nothing maps one to the other.
const TRYSPARTA_HOME = `<!doctype html><html><head>
<title>Trysparta — Daily performance</title>
<meta property="og:site_name" content="Trysparta">
</head><body>
<footer><p>© 2026 115 Ventures, LLC. All rights reserved.</p>
<p>Trysparta® is a registered trademark of 115 Ventures, LLC.</p></footer>
</body></html>`;

const TRYSPARTA_TERMS = `<html><head><title>Terms of Service</title></head><body>
<h1>Terms of Service</h1>
<p>These Terms of Service are an agreement between you and 115 Ventures, LLC
("Company", "we", "us"), the operator of trysparta.com.</p>
<p>By accessing the site you agree to be bound by these terms.</p>
</body></html>`;

function signalsFor(pages: Array<[string, string, 'home' | 'terms' | 'privacy']>) {
    return pages.flatMap(([url, html, kind]) => extractIdentitySignals({ url, html, kind }));
}

describe('LinkedIn company URLs', () => {
    it('reads the slug and a name from it, without fetching anything', () => {
        const parsed = parseLinkedinCompanyUrl('https://www.linkedin.com/company/115-ventures/');
        assert.equal(parsed?.slug, '115-ventures');
        assert.equal(parsed?.guessedName, '115 Ventures');
    });

    it('drops the disambiguating numeric suffix LinkedIn appends', () => {
        assert.equal(parseLinkedinCompanyUrl('https://linkedin.com/company/acme-labs-2')?.guessedName, 'Acme Labs');
    });

    it('rejects anything that is not a LinkedIn company URL', () => {
        assert.equal(parseLinkedinCompanyUrl('https://linkedin.com/in/someone'), null);
        assert.equal(parseLinkedinCompanyUrl('https://example.com/company/x'), null);
        assert.equal(parseLinkedinCompanyUrl('not a url'), null);
    });
});

describe('name normalisation', () => {
    it('ignores company form and punctuation when comparing', () => {
        assert.equal(normaliseCompanyName('115 Ventures, LLC'), '115 ventures');
        assert.ok(namesMatch('115 Ventures, LLC', '115 Ventures'));
        assert.ok(namesMatch('Acme Labs Inc.', 'acme labs'));
    });

    it('does not collapse genuinely different companies', () => {
        assert.ok(!namesMatch('115 Ventures', '116 Ventures'));
        assert.ok(!namesMatch('Acme Labs', 'Acme Holdings'));
    });
});

describe('identity signals on a page', () => {
    const signals = extractIdentitySignals({ url: 'https://trysparta.com/', html: TRYSPARTA_HOME, kind: 'home' });

    it('reads the legal entity out of the footer copyright', () => {
        const footer = signals.find((s) => s.source === 'footer-copyright');
        assert.equal(footer?.value, '115 Ventures, LLC');
        assert.equal(footer?.role, 'legal-entity');
    });

    it('reads both sides of a trademark notice — the mapping, stated outright', () => {
        const tm = signals.filter((s) => s.source === 'trademark-notice');
        assert.ok(tm.some((s) => s.role === 'legal-entity' && s.value === '115 Ventures, LLC'));
        assert.ok(tm.some((s) => s.role === 'brand' && s.value === 'Trysparta'));
    });

    it('keeps the sentence each claim came from', () => {
        assert.ok(signals.every((s) => s.source === 'og-site-name' || s.source === 'page-title' || s.quote));
    });

    it('reads the contracting party out of Terms of Service', () => {
        const terms = extractIdentitySignals({ url: 'https://trysparta.com/terms', html: TRYSPARTA_TERMS, kind: 'terms' });
        const party = terms.find((s) => s.source === 'terms-of-service');
        assert.ok(party?.value.startsWith('115 Ventures'), party?.value);
    });
});

describe('resolving a LinkedIn name to a trading brand', () => {
    const signals = signalsFor([
        ['https://trysparta.com/', TRYSPARTA_HOME, 'home'],
        ['https://trysparta.com/terms', TRYSPARTA_TERMS, 'terms'],
    ]);

    it('joins "115 Ventures" to Trysparta from the site\'s own pages', () => {
        const result = resolveEntity({
            linkedinUrl: 'https://www.linkedin.com/company/115-ventures/',
            websiteUrl: 'https://trysparta.com',
            signals,
        });
        assert.equal(result.status, 'resolved', result.reviewReason);
        assert.equal(result.legalEntity, '115 Ventures, LLC');
        assert.equal(result.brand, 'Trysparta');
        assert.ok(result.confidence >= MIN_AUTO_CONFIDENCE, `confidence ${result.confidence}`);
        assert.ok(result.evidence.some((e) => e.source === 'linkedin-website-join'));
    });

    it('carries the quote for every claim, so a human can check it in one glance', () => {
        const result = resolveEntity({ linkedinName: '115 Ventures', websiteUrl: 'https://trysparta.com', signals });
        const quoted = result.evidence.filter((e) => e.quote);
        assert.ok(quoted.length >= 2, JSON.stringify(result.evidence));
        assert.ok(quoted.some((e) => e.quote?.includes('registered trademark')));
    });

    it('refuses when LinkedIn names a company the site never mentions', () => {
        const result = resolveEntity({
            linkedinName: 'Northwind Holdings',
            websiteUrl: 'https://trysparta.com',
            signals,
        });
        assert.equal(result.status, 'needs-review');
        assert.match(result.reviewReason ?? '', /Nothing here ties the two together/);
        assert.ok(result.confidence <= 45,
            `strong site evidence must not carry a contradicted match, got ${result.confidence}`);
    });

    it('never reports "resolved" when the starting name is contradicted', () => {
        // The failure mode this module exists to prevent: one company's ads
        // attributed to another, with nothing surfacing the error.
        for (const name of ['Northwind Holdings', 'Acme Corp', '116 Ventures']) {
            const result = resolveEntity({ linkedinName: name, websiteUrl: 'https://trysparta.com', signals });
            assert.notEqual(result.status, 'resolved', `"${name}" was silently accepted`);
        }
    });

    it('refuses when only one source backs the entity', () => {
        const thin = extractIdentitySignals({
            url: 'https://thin.com/',
            html: '<html><body><footer>© 2026 Thin Holdings Ltd.</footer></body></html>',
            kind: 'home',
        });
        const result = resolveEntity({ websiteUrl: 'https://thin.com', signals: thin });
        assert.equal(result.status, 'needs-review');
        assert.match(result.reviewReason ?? '', /One source is a guess/);
    });

    it('refuses to pick between a parent and a subsidiary', () => {
        const conflicted = signalsFor([
            ['https://x.com/', `<html><body><footer>© 2026 Alpha Holdings, LLC</footer>
             <p>Bravo Brands, Inc. is a registered trademark of Bravo Brands, Inc.</p></body></html>`, 'home'],
            ['https://x.com/terms', `<html><body><p>These terms are between you and Bravo Brands, Inc.,
             a subsidiary of Alpha Holdings, LLC.</p></body></html>`, 'terms'],
        ]);
        const result = resolveEntity({ websiteUrl: 'https://x.com', signals: conflicted });
        assert.equal(result.status, 'needs-review');
        assert.ok(result.conflicts.length > 0);
        assert.match(result.reviewReason ?? '', /more than one company/);
    });

    it('says plainly when the site names no entity at all', () => {
        const result = resolveEntity({
            linkedinName: '115 Ventures',
            websiteUrl: 'https://blank.com',
            signals: extractIdentitySignals({ url: 'https://blank.com/', html: '<html><body>hi</body></html>', kind: 'home' }),
        });
        assert.equal(result.status, 'unresolved');
        assert.equal(result.confidence, 0);
        assert.match(result.reviewReason ?? '', /Terms of Service/);
    });
});

describe('the alias table closes the loop', () => {
    const alias = {
        legalEntity: '115 Ventures, LLC',
        brand: 'Trysparta',
        website: 'https://trysparta.com',
        linkedinSlug: '115-ventures',
        confirmedBy: 'ops@example.com',
    };

    it('a confirmed alias answers outright, with no weighing', () => {
        const result = resolveEntity({
            linkedinUrl: 'https://www.linkedin.com/company/115-ventures/',
            signals: [],
            aliases: [alias],
        });
        assert.equal(result.status, 'confirmed');
        assert.equal(result.confidence, 100);
        assert.equal(result.brand, 'Trysparta');
        assert.equal(result.evidence[0]?.source, 'confirmed-alias');
    });

    it('matches an alias by website or by legal name, not only by slug', () => {
        assert.equal(resolveEntity({ websiteUrl: 'https://www.trysparta.com/x', signals: [], aliases: [alias] }).status, 'confirmed');
        assert.equal(resolveEntity({ linkedinName: '115 Ventures', signals: [], aliases: [alias] }).status, 'confirmed');
    });

    it('does not match an alias for a different company', () => {
        assert.notEqual(resolveEntity({ linkedinName: 'Other Co', signals: [], aliases: [alias] }).status, 'confirmed');
    });

    it('turns an approved resolution into a permanent alias', () => {
        const signals = signalsFor([
            ['https://trysparta.com/', TRYSPARTA_HOME, 'home'],
            ['https://trysparta.com/terms', TRYSPARTA_TERMS, 'terms'],
        ]);
        const resolved = resolveEntity({ linkedinName: '115 Ventures', websiteUrl: 'https://trysparta.com', signals });
        const entry = toAliasEntry(resolved, 'ops@example.com');
        assert.equal(entry?.legalEntity, '115 Ventures, LLC');
        assert.equal(entry?.brand, 'Trysparta');
        assert.equal(entry?.confirmedBy, 'ops@example.com');
        assert.ok(entry?.confirmedAt);
    });

    it('will not mint an alias from an incomplete resolution', () => {
        assert.equal(toAliasEntry({ confidence: 0, status: 'unresolved', evidence: [], conflicts: [] }, 'x'), null);
    });

    it('summarises a resolution in one line for a review queue', () => {
        const summary = resolutionSummary(resolveEntity({
            linkedinUrl: 'https://linkedin.com/company/115-ventures',
            signals: [], aliases: [alias],
        }));
        assert.match(summary, /115 Ventures, LLC → Trysparta/);
        assert.match(summary, /confirmed \(100\)/);
    });
});
