import type { BrandReport, RunReport } from '../types.js';
import { truncate } from '../util/text.js';
import { angleDescription } from './report-builder.js';

function pct(value: number): string {
    return `${value.toFixed(1)}%`;
}

function mdEscape(input: string): string {
    return input.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function brandSection(brand: BrandReport): string {
    const lines: string[] = [];
    lines.push(`### ${brand.brandName}`);
    lines.push('');
    lines.push(`- **Site:** ${brand.websiteUrl}`);
    lines.push(`- **Niche:** ${brand.niche} → ${brand.subNiche}${brand.audience ? ` (audience: ${brand.audience})` : ''}`);
    lines.push(`- **Classification confidence:** ${brand.classificationConfidence}/100${brand.unclassified ? ' _(below threshold — treat as unclassified)_' : ''}`);
    if (brand.classificationEvidence.length > 0) {
        lines.push(`- **Signals:** ${brand.classificationEvidence.slice(0, 8).map((e) => `\`${e.term}\`×${e.hits}`).join(', ')}`);
    }
    if (brand.classificationAlternatives.length > 0) {
        lines.push(`- **Runner-up niches:** ${brand.classificationAlternatives.map((a) => `${a.niche}/${a.subNiche} (${a.confidence})`).join(', ')}`);
    }
    if (brand.llmNote) lines.push(`- **LLM note:** ${brand.llmNote}`);
    if (brand.tagline) lines.push(`- **Tagline:** ${brand.tagline}`);
    if (brand.priceRange) {
        lines.push(`- **Price range:** ${brand.priceRange.min}–${brand.priceRange.max} ${brand.priceRange.currency}`);
    }
    lines.push(`- **Platform:** ${brand.platform}`);
    if (brand.products.length > 0) {
        lines.push(`- **Products sampled:** ${brand.products.slice(0, 8).map((p) => p.name).join(' · ')}`);
    }
    lines.push('');

    if (brand.adCount === 0) {
        lines.push(`_No ads returned (queries: ${brand.adQueries.map((q) => `"${q}"`).join(', ') || 'none'})._`);
        for (const note of brand.notes.slice(0, 3)) lines.push(`> ${note}`);
        lines.push('');
        return lines.join('\n');
    }

    lines.push(`**Ads analysed:** ${brand.adCount} · **Avg exposure score:** ${brand.exposureScore} · **Primary angle:** ${brand.topAngle ?? 'n/a'}`);
    lines.push('');
    lines.push('| Angle | Ads | Share | Avg exposure | What it does |');
    lines.push('| --- | ---: | ---: | ---: | --- |');
    for (const angle of brand.angleBreakdown.slice(0, 8)) {
        lines.push(`| ${angle.label} | ${angle.adCount} | ${pct(angle.share)} | ${angle.avgExposure} | ${mdEscape(angleDescription(angle.angle))} |`);
    }
    lines.push('');

    lines.push(`**Awareness mix:** ${brand.awarenessBreakdown.map((a) => `${a.stage} ${pct(a.share)}`).join(' · ')}`);
    lines.push('');
    lines.push(`**Formats:** ${brand.formatBreakdown.map((f) => `${f.format} ${pct(f.share)}`).join(' · ')}`);
    lines.push('');

    if (brand.commonOffers.length > 0) {
        lines.push(`**Offers used:** ${brand.commonOffers.map((o) => `${o.detail} (${o.kind}, ×${o.count})`).join(' · ')}`);
        lines.push('');
    }

    lines.push('**Highest-exposure ads**');
    lines.push('');
    for (const ad of brand.ads.slice(0, 8)) {
        const link = ad.snapshotUrl ? ` ([ad](${ad.snapshotUrl}))` : '';
        lines.push(`- **${ad.exposure.score}** — _${truncate(ad.analysis.hook, 160)}_${link}`);
        lines.push(`  - angle: ${ad.analysis.angles.map((a) => a.label).join(', ') || 'none detected'}`);
        lines.push(`  - awareness: ${ad.analysis.awarenessStage} · format: ${ad.analysis.format} · hook type: ${ad.analysis.hookType} · ${ad.analysis.wordCount} words`);
        if (ad.analysis.emotionalTriggers.length > 0) {
            lines.push(`  - emotion: ${ad.analysis.emotionalTriggers.join(', ')}`);
        }
        if (ad.analysis.proofPoints.length > 0) {
            lines.push(`  - proof: ${ad.analysis.proofPoints.slice(0, 5).join(', ')}`);
        }
        lines.push(`  - exposure basis: ${ad.exposure.basis}`);
    }
    lines.push('');
    return lines.join('\n');
}

export function renderMarkdown(report: RunReport): string {
    const lines: string[] = [];

    lines.push('# Brand niche & ad angle report');
    lines.push('');
    lines.push(`Generated ${report.generatedAt}`);
    lines.push('');
    lines.push(`**Sources:** ${report.sourceUrls.join(', ')}`);
    lines.push('');
    lines.push(`**Discovered:** ${report.brandsDiscovered} brands · **Profiled:** ${report.brandsProfiled} · **With ads:** ${report.brandsWithAds} · **Ads analysed:** ${report.adsAnalysed} · **Ad source:** ${report.adsProvider}`);
    lines.push('');

    if (report.warnings.length > 0) {
        lines.push('## Read this first');
        lines.push('');
        for (const warning of report.warnings) lines.push(`- ${warning}`);
        lines.push('');
    }

    lines.push('## Niche map');
    lines.push('');
    lines.push('| Niche | Brands | Sub-niches |');
    lines.push('| --- | ---: | --- |');
    for (const niche of report.niches) {
        const subs = niche.subNiches.map((s) => `${s.subNiche} (${s.brandCount})`).join(', ');
        lines.push(`| ${niche.niche} | ${niche.brandCount} | ${mdEscape(subs)} |`);
    }
    lines.push('');

    for (const niche of report.niches) {
        if (niche.topAngles.length === 0) continue;
        lines.push(`**${niche.niche} — angles in play:** ${niche.topAngles.map((a) => `${a.label} ${pct(a.share)}`).join(' · ')}`);
        lines.push('');
    }

    if (report.angleLeaderboard.length > 0) {
        lines.push('## Angle leaderboard (all brands)');
        lines.push('');
        lines.push('| Angle | Ads | Brands using it | Avg exposure | What it does |');
        lines.push('| --- | ---: | ---: | ---: | --- |');
        for (const angle of report.angleLeaderboard.slice(0, 20)) {
            lines.push(`| ${angle.label} | ${angle.adCount} | ${angle.brandCount} | ${angle.avgExposure} | ${mdEscape(angleDescription(angle.angle))} |`);
        }
        lines.push('');
    }

    if (report.topAdsOverall.length > 0) {
        lines.push('## Highest-exposure ads across every brand');
        lines.push('');
        lines.push('| Exposure | Brand | Angle | Hook |');
        lines.push('| ---: | --- | --- | --- |');
        for (const ad of report.topAdsOverall) {
            const hook = ad.snapshotUrl ? `[${mdEscape(ad.hook)}](${ad.snapshotUrl})` : mdEscape(ad.hook);
            lines.push(`| ${ad.exposure} | ${mdEscape(ad.brand)} | ${ad.angle ?? '—'} | ${hook} |`);
        }
        lines.push('');
    }

    lines.push('## Brands');
    lines.push('');
    for (const brand of report.brands) {
        lines.push(brandSection(brand));
    }

    return lines.join('\n');
}
