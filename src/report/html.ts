import type { BrandReport, NicheBenchmark, RunReport } from '../types.js';
import { summariseCommerce } from '../profile/commerce-signals.js';
import { escapeHtml, truncate } from '../util/text.js';
import { angleDescription } from './report-builder.js';

const STYLE = `
:root { color-scheme: light dark; --bg:#fbfaf8; --fg:#1b1a18; --muted:#6b6862; --line:#e3e0da;
  --card:#ffffff; --accent:#a8552c; --chip:#f0ede7; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16151a; --fg:#eceaf2; --muted:#a09dab; --line:#2d2b34; --card:#1e1d24; --accent:#e0855a; --chip:#282630; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
.wrap { max-width: 1080px; margin:0 auto; padding: 32px 20px 72px; }
h1 { font-size: 1.9rem; margin:0 0 4px; letter-spacing:-.02em; }
h2 { font-size: 1.25rem; margin: 40px 0 12px; letter-spacing:-.01em; }
h3 { font-size: 1.05rem; margin: 0 0 6px; }
.sub { color: var(--muted); margin: 0 0 24px; }
.stats { display:flex; flex-wrap:wrap; gap:10px; margin: 0 0 8px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:110px; }
.stat b { display:block; font-size:1.35rem; line-height:1.2; }
.stat span { color:var(--muted); font-size:.8rem; }
.warn { background:var(--chip); border-left:3px solid var(--accent); border-radius:6px; padding:12px 14px; margin:12px 0; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; margin:14px 0; }
.meta { color:var(--muted); font-size:.87rem; margin:2px 0; }
table { width:100%; border-collapse:collapse; font-size:.9rem; }
.scroll { overflow-x:auto; }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
td.num, th.num { text-align:right; white-space:nowrap; }
.chip { display:inline-block; background:var(--chip); border-radius:999px; padding:2px 10px; font-size:.78rem; margin:2px 4px 2px 0; }
.bar { height:6px; background:var(--chip); border-radius:3px; overflow:hidden; min-width:60px; }
.bar > i { display:block; height:100%; background:var(--accent); }
.hook { border-left:3px solid var(--line); padding:6px 0 6px 12px; margin:10px 0; }
.hook em { font-style:normal; font-weight:600; }
.score { display:inline-block; background:var(--accent); color:#fff; border-radius:6px;
  padding:1px 7px; font-size:.8rem; font-weight:600; }
a { color:var(--accent); }
footer { color:var(--muted); font-size:.82rem; margin-top:48px; border-top:1px solid var(--line); padding-top:16px; }
`;

function bar(sharePct: number): string {
    return `<div class="bar"><i style="width:${Math.max(2, Math.min(100, sharePct)).toFixed(1)}%"></i></div>`;
}

function brandCard(brand: BrandReport): string {
    const parts: string[] = [];
    parts.push('<div class="card">');
    parts.push(`<h3>${escapeHtml(brand.brandName)}</h3>`);
    parts.push(`<p class="meta"><a href="${escapeHtml(brand.websiteUrl)}" rel="nofollow noopener">${escapeHtml(brand.domain)}</a> · ${escapeHtml(brand.platform)}</p>`);
    parts.push(`<p class="meta"><span class="chip">${escapeHtml(brand.niche)}</span><span class="chip">${escapeHtml(brand.subNiche)}</span>${brand.audience ? `<span class="chip">${escapeHtml(brand.audience)}</span>` : ''}<span class="chip">confidence ${brand.classificationConfidence}</span>${brand.unclassified ? '<span class="chip">unclassified</span>' : ''}</p>`);

    if (brand.tagline) parts.push(`<p class="meta">“${escapeHtml(brand.tagline)}”</p>`);
    if (brand.classificationEvidence.length > 0) {
        parts.push(`<p class="meta">Signals: ${brand.classificationEvidence.slice(0, 8).map((e) => `<code>${escapeHtml(e.term)}</code>×${e.hits}`).join(', ')}</p>`);
    }
    if (brand.llmNote) parts.push(`<p class="meta">LLM: ${escapeHtml(brand.llmNote)}</p>`);

    if (brand.techStack) {
        const t = brand.techStack;
        parts.push(`<p class="meta">Stack <b>${t.sophisticationScore}/100</b>: ${t.all.map((x) => `<span class="chip">${escapeHtml(x)}</span>`).join('') || '<span class="chip">nothing detected</span>'}</p>`);
        const flags = [
            t.paidMediaTracking ? `paid: ${t.paidChannels.join(', ')}` : 'no ad pixel',
            t.lifecycleMarketing ? 'lifecycle' : null,
            t.subscriptionCommerce ? 'subscription' : null,
            t.reviewProgramme ? 'reviews' : null,
            t.bnpl ? 'BNPL' : null,
        ].filter((f): f is string => Boolean(f));
        parts.push(`<p class="meta">${flags.map((f) => `<span class="chip">${escapeHtml(f)}</span>`).join('')}</p>`);
    }
    if (brand.commerce) {
        parts.push(`<p class="meta">Commercials: ${escapeHtml(summariseCommerce(brand.commerce))}</p>`);
    }
    if (brand.creative && brand.creative.adCount > 0) {
        const c = brand.creative;
        parts.push(`<p class="meta">Ad account: <b>${escapeHtml(c.posture)}</b> — ${escapeHtml(c.postureReason)}</p>`);
        parts.push(`<p class="meta">${c.launchesPerMonth}/month · ${c.activeAds}/${c.adCount} active · median run ${c.medianRunDays ?? '?'}d · longest ${c.longestRunDays ?? '?'}d</p>`);
        if (c.funnelMix.length > 0) {
            parts.push(`<p class="meta">Funnels: ${c.funnelMix.map((f) => `<span class="chip">${escapeHtml(f.funnel)} ${f.share}%</span>`).join('')}</p>`);
        }
    }
    if (brand.deviations.length > 0) {
        parts.push('<p class="meta"><b>Breaks from its niche</b></p><ul class="meta">');
        for (const d of brand.deviations) {
            parts.push(`<li><b>${escapeHtml(d.signal)}</b> (${escapeHtml(d.direction)}): ${escapeHtml(d.brandValue)} vs ${escapeHtml(d.nicheValue)} — ${escapeHtml(d.note)}</li>`);
        }
        parts.push('</ul>');
    }
    const winners = brand.provenWinners;
    if (winners) {
        parts.push(`<p class="meta"><b>Scaling:</b> ${escapeHtml(winners.pattern)}</p>`);
    }
    const landing = brand.landingPages;
    if (landing && landing.pages.length > 0) {
        const teardowns = new Map((brand.landingTeardowns ?? []).map((t) => [t.url, t]));
        parts.push(`<p class="meta"><b>Pages they run</b> — ${landing.pages.length} destinations, top page takes ${landing.topPageShare}% of ads</p>`);
        parts.push('<div class="scroll"><table><thead><tr><th>Page</th><th>Funnel</th><th class="num">Ads</th><th class="num">Exposure</th><th>Angles</th><th>Match</th></tr></thead><tbody>');
        for (const page of landing.pages.slice(0, 10)) {
            const teardown = teardowns.get(page.url);
            const match = teardown?.messageMatch !== undefined
                ? `<span class="chip">${teardown.messageMatch}%</span>`
                : '—';
            parts.push(`<tr><td><a href="${escapeHtml(page.url)}" rel="nofollow noopener">${escapeHtml(page.path)}</a></td>`
                + `<td>${escapeHtml(page.funnel)}</td><td class="num">${page.adCount}</td>`
                + `<td class="num">${page.totalExposure}</td>`
                + `<td class="meta">${escapeHtml(page.angles.map((a) => a.label).join(', ')) || '—'}</td><td>${match}</td></tr>`);
        }
        parts.push('</tbody></table></div>');
        for (const test of landing.splitTests) {
            parts.push(`<p class="meta">Split test under <code>${escapeHtml(test.directory)}</code>: ${test.pages.map((p) => `<span class="chip">${escapeHtml(p)}</span>`).join('')}</p>`);
        }
        for (const teardown of brand.landingTeardowns ?? []) {
            if (!teardown.ok) continue;
            parts.push(`<p class="meta"><b>${escapeHtml(teardown.h1 ?? teardown.url)}</b> — ${escapeHtml(teardown.shape)} · ${teardown.wordCount} words · ${teardown.ctaCount} CTAs`
                + `${teardown.messageMatchNote ? ` — ${escapeHtml(teardown.messageMatchNote)}` : ''}</p>`);
        }
    }

    const vocab = brand.vocabulary;
    if (vocab && vocab.signature.length > 0) {
        parts.push('<p class="meta"><b>Language they repeat</b> (share of this brand\'s ads)</p>');
        parts.push(`<p class="meta">${vocab.signature.slice(0, 18).map((t) => `<span class="chip">${escapeHtml(t.term)} ${t.adShare}%</span>`).join('')}</p>`);
        if (vocab.distinctive.length > 0) {
            parts.push(`<p class="meta">Their words, not the category's: ${vocab.distinctive.map((t) => `<span class="chip">${escapeHtml(t.term)} ${t.lift}×</span>`).join('')}</p>`);
        }
        if (vocab.hookTerms.length > 0) {
            parts.push(`<p class="meta">Hook vocabulary: ${vocab.hookTerms.slice(0, 10).map((t) => `<span class="chip">${escapeHtml(t.term)}</span>`).join('')}</p>`);
        }
        if (vocab.ctaTerms.length > 0) {
            parts.push(`<p class="meta">Closing vocabulary: ${vocab.ctaTerms.slice(0, 10).map((t) => `<span class="chip">${escapeHtml(t.term)}</span>`).join('')}</p>`);
        }
        for (const group of vocab.byAngle.slice(0, 6)) {
            parts.push(`<p class="meta"><b>${escapeHtml(group.label)}</b> (${group.adCount} ads): ${group.terms.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</p>`);
        }
    }

    if (brand.creativeCompetitors.length > 0) {
        parts.push(`<p class="meta">Same feed slot: ${brand.creativeCompetitors.map((c) => `<span class="chip">${escapeHtml(c.brand)} ${c.similarity}%</span>`).join('')}</p>`);
    }

    if (brand.adCount === 0) {
        parts.push(`<p class="meta">No ads returned. Queries tried: ${brand.adQueries.map((q) => `<span class="chip">${escapeHtml(q)}</span>`).join('') || '—'}</p>`);
        for (const note of brand.notes.slice(0, 2)) parts.push(`<p class="meta">${escapeHtml(note)}</p>`);
        parts.push('</div>');
        return parts.join('\n');
    }

    parts.push(`<p class="meta">${brand.adCount} ads · avg exposure ${brand.exposureScore} · primary angle <b>${escapeHtml(brand.topAngle ?? 'n/a')}</b></p>`);

    parts.push('<div class="scroll"><table><thead><tr><th>Angle</th><th class="num">Ads</th><th>Share</th><th class="num">Avg exposure</th><th>What it does</th></tr></thead><tbody>');
    for (const angle of brand.angleBreakdown.slice(0, 8)) {
        parts.push(`<tr><td>${escapeHtml(angle.label)}</td><td class="num">${angle.adCount}</td><td>${bar(angle.share)}<span class="meta">${angle.share}%</span></td><td class="num">${angle.avgExposure}</td><td class="meta">${escapeHtml(angleDescription(angle.angle))}</td></tr>`);
    }
    parts.push('</tbody></table></div>');

    parts.push(`<p class="meta">Awareness: ${brand.awarenessBreakdown.map((a) => `<span class="chip">${escapeHtml(a.stage)} ${a.share}%</span>`).join('')}</p>`);
    parts.push(`<p class="meta">Formats: ${brand.formatBreakdown.map((f) => `<span class="chip">${escapeHtml(f.format)} ${f.share}%</span>`).join('')}</p>`);
    if (brand.commonOffers.length > 0) {
        parts.push(`<p class="meta">Offers: ${brand.commonOffers.map((o) => `<span class="chip">${escapeHtml(o.detail)} ×${o.count}</span>`).join('')}</p>`);
    }

    for (const ad of brand.ads.slice(0, 6)) {
        const link = ad.snapshotUrl ? ` <a href="${escapeHtml(ad.snapshotUrl)}" rel="nofollow noopener">view ad</a>` : '';
        parts.push('<div class="hook">');
        parts.push(`<p><span class="score">${ad.exposure.score}</span> <em>${escapeHtml(truncate(ad.analysis.hook, 200))}</em>${link}</p>`);
        parts.push(`<p class="meta">${ad.analysis.angles.map((a) => `<span class="chip">${escapeHtml(a.label)}</span>`).join('') || '<span class="chip">no angle detected</span>'}</p>`);
        parts.push(`<p class="meta">${escapeHtml(ad.analysis.awarenessStage)} · ${escapeHtml(ad.analysis.format)} · ${escapeHtml(ad.analysis.hookType)} · ${ad.analysis.wordCount} words · ${escapeHtml(ad.exposure.basis)}</p>`);
        parts.push('</div>');
    }

    parts.push('</div>');
    return parts.join('\n');
}

function benchmarkCard(b: NicheBenchmark): string {
    const parts: string[] = [];
    parts.push(`<h2>Category benchmark — ${escapeHtml(b.niche)}</h2><div class="card">`);
    parts.push(`<p class="meta">${b.brandCount} brands · ${b.adCount} ads · median ${b.medianAdsPerBrand} ads per brand</p>`);

    const norms: Array<[string, string | undefined]> = [
        ['Median price', b.medianPrice !== undefined ? String(b.medianPrice) : undefined],
        ['Guarantee', b.medianGuaranteeDays !== undefined ? `${b.medianGuaranteeDays}d` : undefined],
        ['Headline discount', b.medianDiscountPercent !== undefined ? `${b.medianDiscountPercent}%` : undefined],
        ['Reviews', b.medianReviewCount !== undefined ? b.medianReviewCount.toLocaleString('en-US') : undefined],
        ['Stack maturity', b.medianSophistication !== undefined ? `${b.medianSophistication}/100` : undefined],
        ['Launches/month', b.medianLaunchesPerMonth !== undefined ? String(b.medianLaunchesPerMonth) : undefined],
        ['Subscription', `${b.subscriptionShare}%`],
        ['Paid tracked', `${b.paidMediaShare}%`],
        ['Review tool', `${b.reviewProgrammeShare}%`],
    ];
    parts.push('<div class="stats">');
    for (const [label, value] of norms) {
        if (value !== undefined) parts.push(`<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`);
    }
    parts.push('</div>');

    const mix = (label: string, entries: Array<{ label: string; share: number }>): void => {
        if (entries.length === 0) return;
        parts.push(`<p class="meta">${escapeHtml(label)}: ${entries.slice(0, 6).map((e) => `<span class="chip">${escapeHtml(e.label)} ${e.share}%</span>`).join('')}</p>`);
    };
    mix('Angles', b.angleMix);
    mix('Formats', b.formatMix);
    mix('Awareness', b.awarenessMix);
    mix('Funnels', b.funnelMix);
    mix('Postures', b.postureMix);
    if (b.commonTools.length > 0) {
        parts.push(`<p class="meta">Category stack: ${b.commonTools.map((t) => `<span class="chip">${escapeHtml(t.tool)} ${t.brandShare}%</span>`).join('')}</p>`);
    }

    if (b.vocabulary.length > 0) {
        parts.push('<p class="meta"><b>Shared category language</b> — terms and how many brands use them</p>');
        parts.push(`<p class="meta">${b.vocabulary.slice(0, 20).map((v) => `<span class="chip">${escapeHtml(v.term)} ${v.brandCount}/${Math.max(1, b.brandCount)}</span>`).join('')}</p>`);
    }

    if (b.angleWhitespace.length > 0) {
        parts.push('<p class="meta"><b>Creative whitespace</b> — angles this category barely runs</p>');
        parts.push('<div class="scroll"><table><thead><tr><th>Angle</th><th class="num">Share</th><th>What it does</th></tr></thead><tbody>');
        for (const w of b.angleWhitespace) {
            parts.push(`<tr><td>${escapeHtml(w.label)}</td><td class="num">${w.share}%</td><td class="meta">${escapeHtml(w.description)}</td></tr>`);
        }
        parts.push('</tbody></table></div>');
    }

    parts.push('</div>');
    return parts.join('\n');
}

export function renderHtml(report: RunReport): string {
    const parts: string[] = [];
    parts.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    parts.push('<title>Brand niche &amp; ad angle report</title>');
    parts.push(`<style>${STYLE}</style></head><body><div class="wrap">`);

    parts.push('<h1>Brand niche &amp; ad angle report</h1>');
    parts.push(`<p class="sub">Generated ${escapeHtml(report.generatedAt)} · ad source: ${escapeHtml(report.adsProvider)}</p>`);

    parts.push('<div class="stats">');
    for (const [label, value] of [
        ['Brands discovered', report.brandsDiscovered],
        ['Profiled', report.brandsProfiled],
        ['With ads', report.brandsWithAds],
        ['Ads analysed', report.adsAnalysed],
        ['Niches', report.niches.length],
    ] as Array<[string, number]>) {
        parts.push(`<div class="stat"><b>${value}</b><span>${escapeHtml(label)}</span></div>`);
    }
    parts.push('</div>');

    parts.push(`<p class="meta">Sources: ${report.sourceUrls.map((u) => `<a href="${escapeHtml(u)}" rel="nofollow noopener">${escapeHtml(truncate(u, 80))}</a>`).join(' · ')}</p>`);

    for (const warning of report.warnings) {
        parts.push(`<div class="warn">${escapeHtml(warning)}</div>`);
    }

    parts.push('<h2>Niche map</h2><div class="scroll"><table><thead><tr><th>Niche</th><th class="num">Brands</th><th>Sub-niches</th><th>Angles in play</th></tr></thead><tbody>');
    for (const niche of report.niches) {
        const subs = niche.subNiches.map((s) => `<span class="chip">${escapeHtml(s.subNiche)} (${s.brandCount})</span>`).join('');
        const angles = niche.topAngles.slice(0, 5).map((a) => `<span class="chip">${escapeHtml(a.label)} ${a.share}%</span>`).join('');
        parts.push(`<tr><td><b>${escapeHtml(niche.niche)}</b></td><td class="num">${niche.brandCount}</td><td>${subs}</td><td>${angles || '—'}</td></tr>`);
    }
    parts.push('</tbody></table></div>');

    for (const benchmark of report.benchmarks) parts.push(benchmarkCard(benchmark));

    if (report.angleLeaderboard.length > 0) {
        parts.push('<h2>Angle leaderboard</h2><div class="scroll"><table><thead><tr><th>Angle</th><th class="num">Ads</th><th class="num">Brands</th><th class="num">Avg exposure</th><th>What it does</th></tr></thead><tbody>');
        for (const angle of report.angleLeaderboard.slice(0, 20)) {
            parts.push(`<tr><td>${escapeHtml(angle.label)}</td><td class="num">${angle.adCount}</td><td class="num">${angle.brandCount}</td><td class="num">${angle.avgExposure}</td><td class="meta">${escapeHtml(angleDescription(angle.angle))}</td></tr>`);
        }
        parts.push('</tbody></table></div>');
    }

    if (report.topAdsOverall.length > 0) {
        parts.push('<h2>Highest-exposure ads</h2><div class="scroll"><table><thead><tr><th class="num">Score</th><th>Brand</th><th>Angle</th><th>Hook</th></tr></thead><tbody>');
        for (const ad of report.topAdsOverall) {
            const hook = ad.snapshotUrl
                ? `<a href="${escapeHtml(ad.snapshotUrl)}" rel="nofollow noopener">${escapeHtml(ad.hook)}</a>`
                : escapeHtml(ad.hook);
            parts.push(`<tr><td class="num"><span class="score">${ad.exposure}</span></td><td>${escapeHtml(ad.brand)}</td><td>${escapeHtml(ad.angle ?? '—')}</td><td>${hook}</td></tr>`);
        }
        parts.push('</tbody></table></div>');
    }

    parts.push('<h2>Brands</h2>');
    for (const brand of report.brands) parts.push(brandCard(brand));

    parts.push('<footer>Exposure scores are comparable within this run only. Meta publishes true impression and spend figures for political/issue ads only; for commercial ads the score is built from EU reach, how long each ad has been running and how many creative variants share the copy. Each ad lists the signals actually used under &ldquo;exposure basis&rdquo;.</footer>');
    parts.push('</div></body></html>');
    return parts.join('\n');
}
