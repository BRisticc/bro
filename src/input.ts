import type { ProxyConfigurationOptions } from 'apify';
import type { Taxonomy } from './classify/taxonomy.js';
import type { ProfileDepth } from './profile/brand-profiler.js';
import type { RankBy } from './ads/exposure.js';

export type DiscoveryMode = 'auto' | 'outbound-links' | 'single-brand';
export type AdsProviderName = 'auto' | 'meta-graph' | 'apify-actor' | 'none';
export type AdSearchStrategy = 'brand' | 'brand+products' | 'products';
export type OutputFormat = 'json' | 'markdown' | 'html';

export interface ActorInput {
    startUrls: Array<{ url: string } | string>;
    discoveryMode: DiscoveryMode;
    brandLinkSelector?: string;
    maxBrands: number;
    includeDomains: string[];
    excludeDomains: string[];
    profileDepth: ProfileDepth;
    maxProductsPerBrand: number;
    minClassificationConfidence: number;
    customTaxonomy?: Taxonomy;
    adsProvider: AdsProviderName;
    metaAccessToken?: string;
    adsApifyActorId: string;
    adsApifyActorInput?: Record<string, unknown>;
    adCountries: string[];
    adSearchStrategy: AdSearchStrategy;
    adsPerBrand: number;
    adActiveStatus: 'ALL' | 'ACTIVE' | 'INACTIVE';
    minExposureScore: number;
    provenWinnerMinDays: number;
    analyseLandingPages: boolean;
    maxLandingPagesPerBrand: number;
    rankBy: RankBy;
    useLlm: boolean;
    llmApiKey?: string;
    llmModel: string;
    outputFormats: OutputFormat[];
    maxConcurrency: number;
    requestTimeoutSecs: number;
    maxRequestRetries: number;
    proxyConfiguration?: ProxyConfigurationOptions;
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
    if (Array.isArray(value) && value.length > 0) return value as T[];
    return fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export class InputError extends Error {}

/** Normalises raw actor input into a fully-populated, validated shape. */
export function parseInput(raw: Record<string, unknown> | null): ActorInput {
    const input = raw ?? {};

    const startUrls = asArray<{ url: string } | string>(input.startUrls, []);
    if (startUrls.length === 0) {
        throw new InputError('startUrls is required: give at least one page to mine for brands.');
    }

    const outputFormats = asArray<string>(input.outputFormats, ['json', 'markdown', 'html'])
        .filter((f): f is OutputFormat => ['json', 'markdown', 'html'].includes(f));

    const parsed: ActorInput = {
        startUrls,
        discoveryMode: asEnum(input.discoveryMode, ['auto', 'outbound-links', 'single-brand'] as const, 'auto'),
        maxBrands: asInt(input.maxBrands, 25, 1, 500),
        includeDomains: asArray<string>(input.includeDomains, []),
        excludeDomains: asArray<string>(input.excludeDomains, []),
        profileDepth: asEnum(input.profileDepth, ['fast', 'standard', 'deep'] as const, 'standard'),
        maxProductsPerBrand: asInt(input.maxProductsPerBrand, 8, 0, 50),
        minClassificationConfidence: asInt(input.minClassificationConfidence, 25, 0, 100),
        adsProvider: asEnum(input.adsProvider, ['auto', 'meta-graph', 'apify-actor', 'none'] as const, 'auto'),
        adsApifyActorId: asString(input.adsApifyActorId) ?? 'apify/facebook-ads-scraper',
        adCountries: asArray<string>(input.adCountries, ['US']).map((c) => String(c).trim().toUpperCase()).filter(Boolean),
        adSearchStrategy: asEnum(input.adSearchStrategy, ['brand', 'brand+products', 'products'] as const, 'brand+products'),
        adsPerBrand: asInt(input.adsPerBrand, 20, 1, 200),
        minExposureScore: asInt(input.minExposureScore, 0, 0, 100),
        provenWinnerMinDays: asInt(input.provenWinnerMinDays, 60, 1, 365),
        analyseLandingPages: input.analyseLandingPages === true,
        maxLandingPagesPerBrand: asInt(input.maxLandingPagesPerBrand, 5, 1, 25),
        adActiveStatus: asEnum(input.adActiveStatus, ['ALL', 'ACTIVE', 'INACTIVE'] as const, 'ALL'),
        rankBy: asEnum(input.rankBy, ['composite', 'impressions', 'reach', 'longevity', 'spend'] as const, 'composite'),
        useLlm: input.useLlm === true,
        llmModel: asString(input.llmModel) ?? 'claude-sonnet-5',
        outputFormats: outputFormats.length > 0 ? outputFormats : ['json', 'markdown', 'html'],
        maxConcurrency: asInt(input.maxConcurrency, 5, 1, 50),
        requestTimeoutSecs: asInt(input.requestTimeoutSecs, 30, 5, 300),
        maxRequestRetries: asInt(input.maxRequestRetries, 3, 0, 10),
    };

    const selector = asString(input.brandLinkSelector);
    if (selector) parsed.brandLinkSelector = selector;

    const metaToken = asString(input.metaAccessToken);
    if (metaToken) parsed.metaAccessToken = metaToken;

    const llmKey = asString(input.llmApiKey) ?? asString(process.env.ANTHROPIC_API_KEY);
    if (llmKey) parsed.llmApiKey = llmKey;

    if (input.customTaxonomy && typeof input.customTaxonomy === 'object') {
        parsed.customTaxonomy = input.customTaxonomy as Taxonomy;
    }
    if (input.adsApifyActorInput && typeof input.adsApifyActorInput === 'object') {
        parsed.adsApifyActorInput = input.adsApifyActorInput as Record<string, unknown>;
    }
    if (input.proxyConfiguration && typeof input.proxyConfiguration === 'object') {
        parsed.proxyConfiguration = input.proxyConfiguration as ProxyConfigurationOptions;
    }

    if (parsed.useLlm && !parsed.llmApiKey) {
        throw new InputError('useLlm is on but no llmApiKey was provided (and ANTHROPIC_API_KEY is unset).');
    }

    return parsed;
}

export function startUrlStrings(input: ActorInput): string[] {
    return input.startUrls
        .map((entry) => (typeof entry === 'string' ? entry : entry?.url))
        .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url));
}

/**
 * Picks the ad provider when the user left it on "auto".
 *
 * Order matters: the Apify actor path covers commercial ads worldwide, which
 * is what most users actually want, so it wins over the official API unless
 * the user asked for the API explicitly.
 */
export function resolveAdsProvider(input: ActorInput, hasApifyToken: boolean): Exclude<AdsProviderName, 'auto'> {
    if (input.adsProvider !== 'auto') return input.adsProvider;
    if (hasApifyToken) return 'apify-actor';
    if (input.metaAccessToken) return 'meta-graph';
    return 'none';
}
