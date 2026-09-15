import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseInput } from '../src/input.js';

interface SchemaProperty {
    title?: string;
    type?: string;
    description?: string;
    editor?: string;
    enum?: string[];
    enumTitles?: string[];
    default?: unknown;
    items?: { enum?: string[]; enumTitles?: string[] };
    minimum?: number;
    maximum?: number;
}

interface InputSchema {
    title: string;
    type: string;
    schemaVersion: number;
    properties: Record<string, SchemaProperty>;
    required?: string[];
}

// Read from disk rather than importing: the file must be valid as shipped,
// not as TypeScript happens to resolve it.
const schema = JSON.parse(readFileSync('.actor/input_schema.json', 'utf8')) as InputSchema;
const actorJson = JSON.parse(readFileSync('.actor/actor.json', 'utf8')) as Record<string, unknown>;

describe('input schema shape', () => {
    it('declares the fields the Apify build requires', () => {
        assert.equal(schema.schemaVersion, 1);
        assert.equal(schema.type, 'object');
        assert.ok(schema.title);
    });

    // The Apify build rejects the whole actor if any one property is missing
    // title, type or description. This check is why that cannot ship again.
    it('gives every property a title, type and description', () => {
        const incomplete = Object.entries(schema.properties)
            .filter(([, prop]) => !prop.title || !prop.type || !prop.description)
            .map(([name, prop]) => `${name} (missing: ${['title', 'type', 'description'].filter((k) => !prop[k as 'title']).join(', ')})`);
        assert.deepEqual(incomplete, [], `incomplete schema properties: ${incomplete.join('; ')}`);
    });

    it('keeps enum and enumTitles the same length wherever both are given', () => {
        for (const [name, prop] of Object.entries(schema.properties)) {
            if (prop.enum && prop.enumTitles) {
                assert.equal(prop.enum.length, prop.enumTitles.length, `${name}: enum/enumTitles length mismatch`);
            }
            if (prop.items?.enum && prop.items.enumTitles) {
                assert.equal(prop.items.enum.length, prop.items.enumTitles.length, `${name}: items enum/enumTitles mismatch`);
            }
        }
    });

    it('only marks properties that exist as required', () => {
        for (const name of schema.required ?? []) {
            assert.ok(schema.properties[name], `required field "${name}" is not declared in properties`);
        }
    });

    it('points actor.json at this schema', () => {
        assert.equal(actorJson.input, './input_schema.json');
        assert.equal(actorJson.dockerfile, './Dockerfile');
    });
});

describe('schema and parser agree', () => {
    const base = { startUrls: ['https://a.com'] };

    // Drift between the UI enum and what parseInput accepts is silent and
    // nasty: the user picks a value the actor then quietly discards.
    const enumFields: Array<[string, (v: string) => unknown]> = [
        ['discoveryMode', (v) => parseInput({ ...base, discoveryMode: v }).discoveryMode],
        ['profileDepth', (v) => parseInput({ ...base, profileDepth: v }).profileDepth],
        ['adsProvider', (v) => parseInput({ ...base, adsProvider: v }).adsProvider],
        ['adSearchStrategy', (v) => parseInput({ ...base, adSearchStrategy: v }).adSearchStrategy],
        ['adActiveStatus', (v) => parseInput({ ...base, adActiveStatus: v }).adActiveStatus],
        ['rankBy', (v) => parseInput({ ...base, rankBy: v }).rankBy],
    ];

    for (const [field, parse] of enumFields) {
        it(`accepts every "${field}" value the schema offers`, () => {
            const values = schema.properties[field]?.enum;
            assert.ok(values && values.length > 0, `${field} has no enum in the schema`);
            for (const value of values) {
                assert.equal(parse(value), value, `${field}: schema offers "${value}" but the parser dropped it`);
            }
        });
    }

    it('accepts every outputFormats value the schema offers', () => {
        const values = schema.properties.outputFormats?.items?.enum;
        assert.ok(values && values.length > 0);
        for (const value of values) {
            assert.deepEqual(parseInput({ ...base, outputFormats: [value] }).outputFormats, [value]);
        }
    });

    const defaults: Array<[string, unknown]> = [
        ['discoveryMode', 'auto'],
        ['maxBrands', 25],
        ['profileDepth', 'standard'],
        ['maxProductsPerBrand', 8],
        ['minClassificationConfidence', 25],
        ['adsProvider', 'auto'],
        ['adsApifyActorId', 'apify/facebook-ads-scraper'],
        ['adSearchStrategy', 'brand+products'],
        ['adsPerBrand', 20],
        ['adActiveStatus', 'ALL'],
        ['rankBy', 'composite'],
        ['useLlm', false],
        ['llmModel', 'claude-sonnet-5'],
        ['maxConcurrency', 5],
        ['requestTimeoutSecs', 30],
        ['maxRequestRetries', 3],
    ];

    it('documents the same defaults the parser applies', () => {
        const parsed = parseInput(base) as unknown as Record<string, unknown>;
        for (const [field, expected] of defaults) {
            assert.equal(schema.properties[field]?.default, expected, `${field}: schema default disagrees with the documented default`);
            assert.equal(parsed[field], expected, `${field}: parser default disagrees with the schema`);
        }
    });

    it('clamps to the bounds the schema advertises', () => {
        for (const [field, prop] of Object.entries(schema.properties)) {
            if (prop.type !== 'integer' || prop.minimum === undefined || prop.maximum === undefined) continue;
            const low = parseInput({ ...base, [field]: prop.minimum - 1000 }) as unknown as Record<string, number>;
            const high = parseInput({ ...base, [field]: prop.maximum + 1000 }) as unknown as Record<string, number>;
            assert.equal(low[field], prop.minimum, `${field} should clamp up to its documented minimum`);
            assert.equal(high[field], prop.maximum, `${field} should clamp down to its documented maximum`);
        }
    });
});

describe('scripts/run-remote.mjs builds input this actor accepts', () => {
    // Imported by absolute path: the compiled test lives under dist-tests/,
    // so a relative specifier would not find the script.
    const load = async () => await import(
        pathToFileURL(resolve('scripts/run-remote.mjs')).href
    ) as {
        buildInput: (args: Record<string, unknown>) => Record<string, unknown>;
        describeHttpFailure: (method: string, path: string, status: number, body: string) => string;
    };

    it('produces input that survives parseInput unchanged', async () => {
        const { buildInput } = await load();
        const parsed = parseInput(buildInput({ url: 'https://ultimapeak.com', mode: 'single-brand', strategy: 'brand' }));
        assert.equal(parsed.discoveryMode, 'single-brand');
        assert.equal(parsed.adSearchStrategy, 'brand');
        assert.equal(parsed.profileDepth, 'deep');
        assert.deepEqual(parsed.adCountries, ['US']);
    });

    it('splits and upper-cases a comma-separated country list', async () => {
        const { buildInput } = await load();
        const parsed = parseInput(buildInput({ url: 'https://a.com', countries: 'us, gb ,de' }));
        assert.deepEqual(parsed.adCountries, ['US', 'GB', 'DE']);
    });

    it('rejects a missing or non-http url before any network call', async () => {
        const { buildInput } = await load();
        assert.throws(() => buildInput({}), /--url is required/);
        assert.throws(() => buildInput({ url: 'ultimapeak.com' }), /must be an http\(s\) URL/);
    });

    it('does not run main() on import', async () => {
        // Importing twice must stay silent; a side-effecting module would
        // have tried to reach the API the first time.
        await load();
        await load();
        assert.ok(true);
    });
});

describe('run-remote tells you which side of the wire failed', () => {
    const load = async () => await import(
        pathToFileURL(resolve('scripts/run-remote.mjs')).href
    ) as { describeHttpFailure: (m: string, p: string, s: number, b: string) => string };

    it('names a proxy allowlist block as a network problem, not a bad token', async () => {
        const { describeHttpFailure } = await load();
        const message = describeHttpFailure('GET', '/acts', 403,
            'Host not in allowlist: api.apify.com. Add this host to your network egress settings to allow access.');
        assert.match(message, /proxy or firewall/);
        assert.match(message, /token is not the problem/);
        assert.doesNotMatch(message, /Check APIFY_TOKEN is current/);
    });

    it('names an Apify auth rejection as a token problem', async () => {
        const { describeHttpFailure } = await load();
        const message = describeHttpFailure('GET', '/acts', 401,
            JSON.stringify({ error: { type: 'token-not-provided', message: 'Authentication token is not provided' } }));
        assert.match(message, /Apify says "Authentication token is not provided"/);
        assert.match(message, /Check APIFY_TOKEN is current/);
        assert.doesNotMatch(message, /proxy or firewall/);
    });

    it('passes an Apify permissions error through without a token hint', async () => {
        const { describeHttpFailure } = await load();
        const message = describeHttpFailure('GET', '/acts', 403,
            JSON.stringify({ error: { type: 'insufficient-permissions', message: 'Insufficient permissions' } }));
        assert.match(message, /Apify says "Insufficient permissions"/);
        assert.doesNotMatch(message, /Check APIFY_TOKEN is current/);
    });

    it('says so plainly when the body is empty', async () => {
        const { describeHttpFailure } = await load();
        assert.match(describeHttpFailure('GET', '/acts', 502, ''), /\(empty response body\)/);
    });
});
