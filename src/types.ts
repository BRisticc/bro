import type { TechStack } from './profile/tech-stack.js';
import type { CommerceSignals } from './profile/commerce-signals.js';
import type { CreativeSignals } from './analyze/creative-signals.js';
import type { BrandVocabulary } from './analyze/vocabulary.js';
import type { BrandDeviation, NicheBenchmark } from './report/benchmarks.js';

export type { TechStack } from './profile/tech-stack.js';
export type { CommerceSignals } from './profile/commerce-signals.js';
export type { CreativeSignals, FunnelType, ScalingPosture } from './analyze/creative-signals.js';
export type { BrandVocabulary, TermStat, DistinctiveTerm, NicheVocabularyEntry } from './analyze/vocabulary.js';
export type { BrandDeviation, NicheBenchmark } from './report/benchmarks.js';

/**
 * Shared domain types for the whole pipeline.
 *
 * The pipeline is a straight line and each stage adds one field group:
 *   BrandCandidate -> BrandProfile -> ClassifiedBrand -> BrandReport
 */

/** A brand link harvested from the source page, before we know anything about it. */
export interface BrandCandidate {
    /** Absolute URL of the brand's own site. */
    url: string;
    /** Registrable domain, e.g. "hims.com". Used as the dedupe key. */
    domain: string;
    /** Best guess at the brand name, from anchor text or domain. */
    name: string;
    /** The source page this candidate was found on. */
    sourceUrl: string;
    /** Every distinct anchor text that pointed at this domain. */
    anchorTexts: string[];
    /** How many times the source page linked to this domain. */
    mentions: number;
    /** Heuristic 0-100 score that this link is a brand and not navigation/boilerplate. */
    discoveryScore: number;
}

export interface ProductRecord {
    name: string;
    url?: string;
    price?: number;
    currency?: string;
    description?: string;
}

export type EcommercePlatform = 'shopify' | 'woocommerce' | 'bigcommerce' | 'magento' | 'squarespace' | 'wix' | 'unknown';

/** A brand after we have visited its own site. */
export interface BrandProfile extends BrandCandidate {
    /** Name as the brand's own site states it (og:site_name / JSON-LD / <title>). */
    brandName: string;
    siteTitle?: string;
    description?: string;
    tagline?: string;
    products: ProductRecord[];
    platform: EcommercePlatform;
    socials: Record<string, string>;
    /** Lower-cased, whitespace-collapsed text used for classification. */
    corpus: string;
    pagesFetched: string[];
    priceRange?: { min: number; max: number; currency: string };
    /** Marketing/commerce tools detected in the page source. */
    techStack?: TechStack;
    /** Prices, offers, guarantees and social proof read off the site. */
    commerce?: CommerceSignals;
    fetchErrors: string[];
}

export interface TaxonomyMatch {
    niche: string;
    subNiche: string;
    audience: string | null;
    /** 0-100. */
    confidence: number;
    /** Terms that actually fired, with how often. Makes every call auditable. */
    evidence: Array<{ term: string; hits: number; weight: number }>;
}

export interface Classification extends TaxonomyMatch {
    /** Runner-up niches, so a human can sanity-check a borderline call. */
    alternatives: Array<{ niche: string; subNiche: string; confidence: number }>;
    /** True when confidence fell under the input threshold. */
    unclassified: boolean;
    /** Set when LLM enrichment ran and disagreed or added nuance. */
    llmNote?: string;
}

export interface ClassifiedBrand extends BrandProfile {
    classification: Classification;
}

export type AdMediaType = 'video' | 'image' | 'carousel' | 'dco' | 'unknown';

/** One ad creative from the Ad Library, normalised across providers. */
export interface AdRecord {
    id: string;
    provider: string;
    pageName?: string;
    pageId?: string;
    snapshotUrl?: string;
    /** ISO date string. */
    startDate?: string;
    endDate?: string;
    isActive?: boolean;
    daysRunning?: number;
    publisherPlatforms: string[];
    countries: string[];
    languages: string[];
    /** Primary text / body copy. The main input to angle analysis. */
    bodyText: string;
    title?: string;
    linkDescription?: string;
    ctaText?: string;
    ctaType?: string;
    landingUrl?: string;
    mediaType: AdMediaType;
    /** Meta only publishes these for political/issue ads. Undefined is normal. */
    impressionsMin?: number;
    impressionsMax?: number;
    spendMin?: number;
    spendMax?: number;
    currency?: string;
    /** EU transparency figure, present when the ad targeted the EU. */
    euTotalReach?: number;
    /** How many creative variants share this ad's copy. A scaling signal. */
    variantCount?: number;
    /** The search term that surfaced this ad. */
    matchedQuery?: string;
    raw?: unknown;
}

export interface ExposureScore {
    /** 0-100, comparable within a run only. */
    score: number;
    /** Which signals were actually available for this ad. */
    signals: string[];
    /** Human-readable justification, e.g. "EU reach 1.2M; running 94 days". */
    basis: string;
}

export interface RankedAd extends AdRecord {
    exposure: ExposureScore;
    analysis: CopyAnalysis;
}

export type AwarenessStage = 'unaware' | 'problem-aware' | 'solution-aware' | 'product-aware' | 'most-aware';

export interface AngleHit {
    angle: string;
    label: string;
    /** 0-100 confidence that this angle is present. */
    score: number;
    evidence: string[];
}

export interface CopyAnalysis {
    /** Ranked marketing angles detected in the copy. */
    angles: AngleHit[];
    primaryAngle: string | null;
    awarenessStage: AwarenessStage;
    /** The opening line, which is the hook in practice. */
    hook: string;
    hookType: string;
    /** UGC / testimonial / advertorial / listicle / direct-offer / story. */
    format: string;
    emotionalTriggers: string[];
    offers: OfferSignal[];
    claims: string[];
    cta: string | null;
    /** Numbers used as proof, e.g. "93%", "30 days", "10,000 reviews". */
    proofPoints: string[];
    wordCount: number;
    /** Flesch reading ease, rounded. Direct-response copy usually lands 60-80. */
    readingEase: number;
}

export interface OfferSignal {
    kind: 'discount-percent' | 'discount-amount' | 'bogo' | 'free-shipping' | 'free-trial' | 'subscription' | 'bundle' | 'guarantee' | 'gift' | 'limited-time';
    detail: string;
}

/** Everything we learned about one brand. One dataset item. */
export interface BrandReport {
    brandName: string;
    domain: string;
    websiteUrl: string;
    sourceUrl: string;
    niche: string;
    subNiche: string;
    audience: string | null;
    classificationConfidence: number;
    unclassified: boolean;
    classificationEvidence: Array<{ term: string; hits: number; weight: number }>;
    classificationAlternatives: Array<{ niche: string; subNiche: string; confidence: number }>;
    llmNote?: string;
    description?: string;
    tagline?: string;
    platform: EcommercePlatform;
    socials: Record<string, string>;
    products: ProductRecord[];
    priceRange?: { min: number; max: number; currency: string };
    adCount: number;
    adsProvider: string;
    adQueries: string[];
    exposureScore: number;
    topAngle: string | null;
    angleBreakdown: Array<{ angle: string; label: string; adCount: number; share: number; avgExposure: number }>;
    awarenessBreakdown: Array<{ stage: AwarenessStage; adCount: number; share: number }>;
    formatBreakdown: Array<{ format: string; adCount: number; share: number }>;
    topHooks: Array<{ hook: string; exposure: number; snapshotUrl?: string }>;
    commonOffers: Array<{ kind: string; detail: string; count: number }>;
    ads: RankedAd[];
    /** Marketing stack detected on the brand's own site. */
    techStack?: TechStack;
    /** Pricing, offer and social-proof shape. */
    commerce?: CommerceSignals;
    /** How the ad account is behaving: velocity, funnels, scaling posture. */
    creative?: CreativeSignals;
    /** The language this brand repeats across its ads. */
    vocabulary?: BrandVocabulary;
    /** Where this brand breaks from its niche. Filled in after benchmarking. */
    deviations: BrandDeviation[];
    /** Brands with the most similar creative fingerprint. */
    creativeCompetitors: Array<{ brand: string; similarity: number; sharedAngles: string[] }>;
    notes: string[];
    scrapedAt: string;
}

/** Cross-brand rollup saved to the key-value store. */
export interface RunReport {
    generatedAt: string;
    sourceUrls: string[];
    brandsDiscovered: number;
    brandsProfiled: number;
    brandsWithAds: number;
    adsAnalysed: number;
    adsProvider: string;
    niches: Array<{
        niche: string;
        brandCount: number;
        brands: string[];
        subNiches: Array<{ subNiche: string; brandCount: number; brands: string[] }>;
        topAngles: Array<{ angle: string; label: string; adCount: number; share: number }>;
    }>;
    angleLeaderboard: Array<{ angle: string; label: string; adCount: number; brandCount: number; avgExposure: number }>;
    topAdsOverall: Array<{ brand: string; hook: string; angle: string | null; exposure: number; snapshotUrl?: string }>;
    /** Per-niche norms, mixes and creative whitespace. */
    benchmarks: NicheBenchmark[];
    warnings: string[];
    brands: BrandReport[];
}
