import type { AdMediaType, AdRecord } from '../types.js';
import { collapseWhitespace, truncate } from '../util/text.js';

/** Reads the first present, non-empty string from a list of candidate keys. */
export function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim()) return collapseWhitespace(value);
        if (Array.isArray(value)) {
            const first = value.find((v) => typeof v === 'string' && v.trim())
                ?? value.map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>).text : null))
                    .find((v) => typeof v === 'string' && v.trim());
            if (typeof first === 'string') return collapseWhitespace(first);
        }
        if (value && typeof value === 'object') {
            const text = (value as Record<string, unknown>).text;
            if (typeof text === 'string' && text.trim()) return collapseWhitespace(text);
        }
    }
    return undefined;
}

export function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value.replace(/[,\s]/g, ''));
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
}

export function pickStringArray(source: Record<string, unknown>, keys: string[]): string[] {
    for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) {
            const strings = value.filter((v): v is string => typeof v === 'string');
            if (strings.length > 0) return strings;
        }
        if (typeof value === 'string' && value.trim()) return [value.trim()];
    }
    return [];
}

/** Meta returns bounded ranges as { lower_bound, upper_bound } strings. */
export function parseBoundedRange(value: unknown): { min?: number; max?: number } {
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    const min = pickNumber(record, ['lower_bound', 'lowerBound', 'min']);
    const max = pickNumber(record, ['upper_bound', 'upperBound', 'max']);
    const out: { min?: number; max?: number } = {};
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    return out;
}

export function daysBetween(startIso?: string, endIso?: string): number | undefined {
    if (!startIso) return undefined;
    const start = Date.parse(startIso);
    if (Number.isNaN(start)) return undefined;
    const end = endIso ? Date.parse(endIso) : Date.now();
    if (Number.isNaN(end)) return undefined;
    return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function guessMediaType(source: Record<string, unknown>): AdMediaType {
    const explicit = pickString(source, ['mediaType', 'media_type', 'displayFormat', 'display_format', 'creativeType']);
    if (explicit) {
        const value = explicit.toLowerCase();
        if (value.includes('video')) return 'video';
        if (value.includes('carousel') || value.includes('multi')) return 'carousel';
        if (value.includes('dco') || value.includes('dynamic')) return 'dco';
        if (value.includes('image') || value.includes('photo')) return 'image';
    }
    const serialised = JSON.stringify(source).slice(0, 20000).toLowerCase();
    if (serialised.includes('video_hd_url') || serialised.includes('"video"')) return 'video';
    if (serialised.includes('carousel')) return 'carousel';
    if (serialised.includes('original_image_url') || serialised.includes('"image"')) return 'image';
    return 'unknown';
}

/**
 * Maps an arbitrary ad record from any provider onto AdRecord.
 *
 * Written defensively on purpose: third-party Ad Library actors change their
 * output shape between releases, so this matches on families of field names
 * rather than one exact schema.
 */
export function normaliseAdRecord(
    raw: Record<string, unknown>,
    provider: string,
    matchedQuery: string,
): AdRecord | null {
    const id = pickString(raw, ['id', 'adArchiveID', 'ad_archive_id', 'adId', 'archiveId', 'adArchiveId'])
        ?? pickNumber(raw, ['id', 'adArchiveID', 'ad_archive_id'])?.toString();

    const bodyText = pickString(raw, [
        'ad_creative_bodies', 'adCreativeBodies', 'body', 'bodyText', 'primaryText',
        'ad_creative_body', 'text', 'snapshot_body', 'caption',
    ]) ?? '';

    const title = pickString(raw, [
        'ad_creative_link_titles', 'adCreativeLinkTitles', 'title', 'headline', 'linkTitle',
    ]);

    // An ad with neither an id nor any copy is unusable downstream.
    if (!id && !bodyText && !title) return null;

    const startDate = pickString(raw, [
        'ad_delivery_start_time', 'adDeliveryStartTime', 'startDate', 'start_date',
        'startDateFormatted', 'ad_creation_time',
    ]);
    const endDate = pickString(raw, [
        'ad_delivery_stop_time', 'adDeliveryStopTime', 'endDate', 'end_date', 'endDateFormatted',
    ]);

    const impressions = parseBoundedRange(raw.impressions);
    const spend = parseBoundedRange(raw.spend);

    const record: AdRecord = {
        id: id ?? `${provider}:${Buffer.from(`${bodyText}${title ?? ''}`).toString('base64url').slice(0, 24)}`,
        provider,
        publisherPlatforms: pickStringArray(raw, ['publisher_platforms', 'publisherPlatforms', 'platforms']),
        countries: pickStringArray(raw, ['ad_reached_countries', 'reachedCountries', 'countries', 'country']),
        languages: pickStringArray(raw, ['languages', 'language']),
        bodyText: truncate(bodyText, 8000),
        mediaType: guessMediaType(raw),
        matchedQuery,
        raw,
    };

    const pageName = pickString(raw, ['page_name', 'pageName', 'advertiser', 'advertiserName', 'pageInfo']);
    if (pageName) record.pageName = pageName;
    const pageId = pickString(raw, ['page_id', 'pageId']) ?? pickNumber(raw, ['page_id', 'pageId'])?.toString();
    if (pageId) record.pageId = pageId;
    const snapshotUrl = pickString(raw, ['ad_snapshot_url', 'adSnapshotUrl', 'snapshotUrl', 'url', 'adLibraryUrl']);
    if (snapshotUrl) record.snapshotUrl = snapshotUrl;
    if (startDate) record.startDate = startDate;
    if (endDate) record.endDate = endDate;
    if (title) record.title = truncate(title, 500);

    const linkDescription = pickString(raw, [
        'ad_creative_link_descriptions', 'adCreativeLinkDescriptions', 'linkDescription', 'description',
    ]);
    if (linkDescription) record.linkDescription = truncate(linkDescription, 1000);

    const ctaText = pickString(raw, [
        'ad_creative_link_captions', 'adCreativeLinkCaptions', 'ctaText', 'cta_text', 'callToAction',
    ]);
    if (ctaText) record.ctaText = truncate(ctaText, 200);

    const ctaType = pickString(raw, ['cta_type', 'ctaType', 'call_to_action_type']);
    if (ctaType) record.ctaType = ctaType;

    const landingUrl = pickString(raw, ['link_url', 'linkUrl', 'landingUrl', 'destinationUrl', 'caption_url']);
    if (landingUrl) record.landingUrl = landingUrl;

    const isActive = raw.is_active ?? raw.isActive ?? raw.active;
    if (typeof isActive === 'boolean') {
        record.isActive = isActive;
    } else if (endDate) {
        // A delivery stop time in the past means the ad is off; a future one
        // (Meta sometimes returns a scheduled end) means it is still running.
        const stop = Date.parse(endDate);
        if (!Number.isNaN(stop)) record.isActive = stop > Date.now();
    } else if (startDate) {
        record.isActive = true;
    }

    const days = daysBetween(startDate, endDate);
    if (days !== undefined) record.daysRunning = days;

    if (impressions.min !== undefined) record.impressionsMin = impressions.min;
    if (impressions.max !== undefined) record.impressionsMax = impressions.max;
    if (spend.min !== undefined) record.spendMin = spend.min;
    if (spend.max !== undefined) record.spendMax = spend.max;

    const flatImpressions = pickNumber(raw, ['impressionsCount', 'totalImpressions']);
    if (flatImpressions !== undefined && record.impressionsMin === undefined) record.impressionsMin = flatImpressions;

    const currency = pickString(raw, ['currency']);
    if (currency) record.currency = currency;

    const euReach = pickNumber(raw, ['eu_total_reach', 'euTotalReach', 'totalReach', 'reach']);
    if (euReach !== undefined) record.euTotalReach = euReach;

    const variantCount = pickNumber(raw, [
        'collation_count', 'collationCount', 'variantCount', 'creativeCount', 'totalActiveTime',
    ]);
    if (variantCount !== undefined && variantCount > 0) record.variantCount = variantCount;

    return record;
}

/**
 * Merges ad lists from several search terms, keeping one record per ad id and
 * remembering every query that surfaced it.
 */
export function dedupeAds(ads: AdRecord[]): AdRecord[] {
    const byId = new Map<string, AdRecord>();
    for (const ad of ads) {
        const existing = byId.get(ad.id);
        if (!existing) {
            byId.set(ad.id, ad);
            continue;
        }
        if (ad.matchedQuery && existing.matchedQuery && !existing.matchedQuery.includes(ad.matchedQuery)) {
            existing.matchedQuery = `${existing.matchedQuery}; ${ad.matchedQuery}`;
        }
        // Keep whichever copy of the record carries more exposure data.
        if (existing.euTotalReach === undefined && ad.euTotalReach !== undefined) existing.euTotalReach = ad.euTotalReach;
        if (existing.impressionsMin === undefined && ad.impressionsMin !== undefined) {
            existing.impressionsMin = ad.impressionsMin;
            existing.impressionsMax = ad.impressionsMax;
        }
    }
    return [...byId.values()];
}
