import { gotScraping } from 'crawlee';
import { log } from 'apify';
import { truncate } from '../util/text.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export interface LlmOptions {
    apiKey: string;
    model: string;
    timeoutSecs: number;
}

interface MessagesResponse {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
}

/**
 * Minimal Messages API call. Returns null on any failure — LLM enrichment is
 * strictly additive, so a bad key or a rate limit must never fail the run.
 */
export async function askJson<T>(prompt: string, opts: LlmOptions, maxTokens = 1024): Promise<T | null> {
    try {
        const response = await gotScraping({
            url: API_URL,
            method: 'POST',
            timeout: { request: opts.timeoutSecs * 1000 },
            throwHttpErrors: false,
            headers: {
                'content-type': 'application/json',
                'x-api-key': opts.apiKey,
                'anthropic-version': API_VERSION,
            },
            body: JSON.stringify({
                model: opts.model,
                max_tokens: maxTokens,
                messages: [{ role: 'user', content: prompt }],
            }),
            responseType: 'text',
        });

        const payload = JSON.parse(String(response.body)) as MessagesResponse;
        if (payload.error) {
            log.warning(`LLM enrichment skipped: ${payload.error.message ?? 'API error'}`);
            return null;
        }
        const text = payload.content?.find((c) => c.type === 'text')?.text;
        if (!text) return null;

        // Models sometimes wrap JSON in prose or a fenced block.
        const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
        const candidate = fenced?.[1] ?? text;
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start === -1 || end <= start) return null;
        return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch (err) {
        log.warning(`LLM enrichment failed: ${(err as Error).message}`);
        return null;
    }
}

export interface ClassificationRefinement {
    niche?: string;
    subNiche?: string;
    audience?: string;
    note?: string;
}

/**
 * Asks the model to sanity-check the rule-based classification.
 *
 * The rule-based answer is always kept as the baseline; this only overrides a
 * field when the model returns a non-empty replacement, and the disagreement
 * is recorded in `llmNote` so the change is visible rather than silent.
 */
export async function refineClassification(
    brandName: string,
    corpusSample: string,
    ruleBased: { niche: string; subNiche: string; audience: string | null },
    knownNiches: string[],
    opts: LlmOptions,
): Promise<ClassificationRefinement | null> {
    const prompt = [
        'You are classifying an e-commerce brand into a marketing niche taxonomy.',
        '',
        `Brand: ${brandName}`,
        `Website copy (truncated): """${truncate(corpusSample, 6000)}"""`,
        '',
        `A keyword classifier proposed: niche="${ruleBased.niche}", subNiche="${ruleBased.subNiche}", audience="${ruleBased.audience ?? 'unknown'}".`,
        '',
        `Allowed niches: ${knownNiches.join(', ')}.`,
        '',
        'Reply with JSON only, no prose:',
        '{"niche": "...", "subNiche": "...", "audience": "...", "note": "one sentence on why, or why you agree"}',
        'Use a niche from the allowed list. Keep subNiche short (1-3 words). Use "" for audience if the copy does not target a specific group.',
    ].join('\n');

    return askJson<ClassificationRefinement>(prompt, opts, 512);
}

export interface AngleSummary {
    summary?: string;
    angles?: string[];
    positioning?: string;
}

/** Plain-language summary of what a brand's top ads are actually doing. */
export async function summariseAngles(
    brandName: string,
    niche: string,
    hooks: string[],
    detectedAngles: string[],
    opts: LlmOptions,
): Promise<AngleSummary | null> {
    if (hooks.length === 0) return null;
    const prompt = [
        `You are a direct-response strategist reviewing ${brandName}'s highest-exposure Meta ads.`,
        `Niche: ${niche}.`,
        '',
        'Ad hooks (opening lines of the top ads by exposure):',
        ...hooks.slice(0, 15).map((h, i) => `${i + 1}. ${truncate(h, 200)}`),
        '',
        `A rule-based analyser detected these angles: ${detectedAngles.join(', ') || 'none'}.`,
        '',
        'Reply with JSON only, no prose:',
        '{"summary": "2-3 sentences on the angle strategy these ads share",',
        ' "angles": ["short angle name", "..."],',
        ' "positioning": "one sentence: who this brand is for and what it promises"}',
    ].join('\n');

    return askJson<AngleSummary>(prompt, opts, 800);
}
