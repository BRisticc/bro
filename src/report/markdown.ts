import type { BrandReport, NicheBenchmark, RunReport } from '../types.js';
import { summariseCommerce } from '../profile/commerce-signals.js';
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
    if (brand.techStack) {
        const t = brand.techStack;
        lines.push(`- **Stack (${t.sophisticationScore}/100):** ${t.all.join(', ') || 'nothing detected'}`);
        const flags = [
            t.paidMediaTracking ? `paid: ${t.paidChannels.join(', ')}` : 'no ad pixel',
            t.lifecycleMarketing ? 'lifecycle email/SMS' : null,
            t.subscriptionCommerce ? 'subscription' : null,
            t.reviewProgramme ? 'review programme' : null,
            t.bnpl ? 'BNPL' : null,
        ].filter(Boolean);
        lines.push(`- **Growth posture:** ${flags.join(' · ')}`);
    }
    if (brand.commerce) {
        lines.push(`- **Commercials:** ${summariseCommerce(brand.commerce)}`);
        if (brand.commerce.pressMentions.length > 0) lines.push(`- **Press:** ${brand.commerce.pressMentions.join(', ')}`);
        if (brand.commerce.certifications.length > 0) lines.push(`- **Certifications:** ${brand.commerce.certifications.join(', ')}`);
    }
    if (brand.creative && brand.creative.adCount > 0) {
        const c = brand.creative;
        lines.push(`- **Ad account:** ${c.posture} — ${c.postureReason}`);
        lines.push(`  - ${c.launchesPerMonth}/month · ${c.activeAds}/${c.adCount} active · median run ${c.medianRunDays ?? '?'}d · longest ${c.longestRunDays ?? '?'}d`);
        if (c.funnelMix.length > 0) {
            lines.push(`  - funnels: ${c.funnelMix.map((f) => `${f.funnel} ${pct(f.share)}`).join(' · ')}`);
        }
        if (c.mediaMix.length > 0) {
            lines.push(`  - media: ${c.mediaMix.map((m) => `${m.mediaType} ${pct(m.share)}`).join(' · ')}`);
        }
    }
    if (brand.deviations.length > 0) {
        lines.push('');
        lines.push('**How it breaks from its niche**');
        lines.push('');
        for (const d of brand.deviations) {
            lines.push(`- **${d.signal}** (${d.direction}): ${d.brandValue} vs ${d.nicheValue} — ${mdEscape(d.note)}`);
        }
    }
    const vocab = brand.vocabulary;
    if (vocab && vocab.signature.length > 0) {
        lines.push('');
        lines.push('**Language they repeat** _(% = share of this brand\'s ads containing the term)_');
        lines.push('');
        lines.push('| Term | In ads | Share | Avg exposure |');
        lines.push('| --- | ---: | ---: | ---: |');
        for (const t of vocab.signature.slice(0, 15)) {
            lines.push(`| \`${mdEscape(t.term)}\` | ${t.adCount} | ${pct(t.adShare)} | ${t.avgExposure} |`);
        }
        lines.push('');
        if (vocab.distinctive.length > 0) {
            lines.push(`**Their words, not the category's:** ${vocab.distinctive.map((t) => `\`${mdEscape(t.term)}\` (${t.lift}× category)`).join(' · ')}`);
            lines.push('');
        }
        if (vocab.hookTerms.length > 0) {
            lines.push(`**Hook vocabulary:** ${vocab.hookTerms.slice(0, 10).map((t) => `\`${mdEscape(t.term)}\``).join(' · ')}`);
        }
        if (vocab.ctaTerms.length > 0) {
            lines.push(`**Closing vocabulary:** ${vocab.ctaTerms.slice(0, 10).map((t) => `\`${mdEscape(t.term)}\``).join(' · ')}`);
        }
        if (vocab.byAngle.length > 0) {
            lines.push('');
            lines.push('**Words they reach for per angle**');
            lines.push('');
            for (const group of vocab.byAngle.slice(0, 6)) {
                lines.push(`- **${group.label}** (${group.adCount} ads): ${group.terms.map((t) => `\`${mdEscape(t)}\``).join(', ')}`);
            }
        }
        lines.push('');
    }

    if (brand.creativeCompetitors.length > 0) {
        lines.push('');
        lines.push(`**Competing for the same feed slot:** ${brand.creativeCompetitors.map((c) => `${c.brand} (${c.similarity}% similar)`).join(' · ')}`);
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

function benchmarkSection(b: NicheBenchmark): string {
    const lines: string[] = [];
    lines.push(`## Category benchmark — ${b.niche}`);
    lines.push('');
    lines.push(`${b.brandCount} brands · ${b.adCount} ads · median ${b.medianAdsPerBrand} ads per brand`);
    lines.push('');
    lines.push('| Norm | Value |');
    lines.push('| --- | --- |');
    const rows: Array<[string, string | undefined]> = [
        ['Median price', b.medianPrice !== undefined ? String(b.medianPrice) : undefined],
        ['Median guarantee', b.medianGuaranteeDays !== undefined ? `${b.medianGuaranteeDays} days` : undefined],
        ['Median headline discount', b.medianDiscountPercent !== undefined ? `${b.medianDiscountPercent}%` : undefined],
        ['Median review count', b.medianReviewCount !== undefined ? b.medianReviewCount.toLocaleString('en-US') : undefined],
        ['Median stack maturity', b.medianSophistication !== undefined ? `${b.medianSophistication}/100` : undefined],
        ['Median launches / month', b.medianLaunchesPerMonth !== undefined ? String(b.medianLaunchesPerMonth) : undefined],
        ['Brands offering subscription', `${b.subscriptionShare}%`],
        ['Brands tracking paid media', `${b.paidMediaShare}%`],
        ['Brands running a review tool', `${b.reviewProgrammeShare}%`],
        ['Brands offering BNPL', `${b.bnplShare}%`],
    ];
    for (const [label, value] of rows) {
        if (value !== undefined) lines.push(`| ${label} | ${value} |`);
    }
    lines.push('');

    const mixLine = (label: string, mix: Array<{ label: string; share: number }>): void => {
        if (mix.length > 0) lines.push(`**${label}:** ${mix.slice(0, 6).map((m) => `${m.label} ${pct(m.share)}`).join(' · ')}`);
    };
    mixLine('Angles in play', b.angleMix);
    mixLine('Formats', b.formatMix);
    mixLine('Awareness stages', b.awarenessMix);
    mixLine('Funnel destinations', b.funnelMix);
    mixLine('Scaling postures', b.postureMix);
    if (b.commonTools.length > 0) {
        lines.push(`**Category stack:** ${b.commonTools.map((t) => `${t.tool} ${pct(t.brandShare)}`).join(' · ')}`);
    }
    lines.push('');

    if (b.vocabulary.length > 0) {
        lines.push('**Shared category language** _(brands using each term)_');
        lines.push('');
        lines.push('| Term | Brands | Share of brands | Avg share of their ads |');
        lines.push('| --- | ---: | ---: | ---: |');
        for (const v of b.vocabulary.slice(0, 20)) {
            lines.push(`| \`${mdEscape(v.term)}\` | ${v.brandCount} | ${pct(v.brandShare)} | ${pct(v.avgAdShare)} |`);
        }
        lines.push('');
    }

    if (b.angleWhitespace.length > 0) {
        lines.push('**Creative whitespace — angles nobody here is running**');
        lines.push('');
        lines.push('| Angle | Share of category ads | What it does |');
        lines.push('| --- | ---: | --- |');
        for (const w of b.angleWhitespace) {
            lines.push(`| ${w.label} | ${pct(w.share)} | ${mdEscape(w.description)} |`);
        }
        lines.push('');
    }
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

    for (const benchmark of report.benchmarks) {
        lines.push(benchmarkSection(benchmark));
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
