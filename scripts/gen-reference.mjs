/**
 * Regenerates docs/reference.md from the code so the documented taxonomy and
 * angle library can never drift from what the actor actually uses.
 *
 *   npm run docs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { BUILT_IN_TAXONOMY, AUDIENCE_TERMS, termWeight } from '../dist/classify/taxonomy.js';
import { ANGLE_LIBRARY } from '../dist/analyze/angle-library.js';

const lines = [];
lines.push('# Reference: taxonomy and angle library');
lines.push('');
lines.push('_Generated from the source by `npm run docs`. Do not edit by hand._');
lines.push('');

const nicheCount = Object.keys(BUILT_IN_TAXONOMY).length;
const subCount = Object.values(BUILT_IN_TAXONOMY).reduce((n, subs) => n + Object.keys(subs).length, 0);
lines.push(`## Niche taxonomy — ${nicheCount} niches, ${subCount} sub-niches`);
lines.push('');
lines.push('Terms are weighted by how diagnostic they are. Override or extend any of this with the `customTaxonomy` input.');
lines.push('');

for (const [niche, subNiches] of Object.entries(BUILT_IN_TAXONOMY)) {
    lines.push(`### ${niche}`);
    lines.push('');
    lines.push('| Sub-niche | Strongest terms | Implied audience |');
    lines.push('| --- | --- | --- |');
    for (const [subNiche, def] of Object.entries(subNiches)) {
        const top = def.terms
            .map(termWeight)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 6)
            .map((t) => `\`${t.text}\``)
            .join(', ');
        lines.push(`| ${subNiche} | ${top} | ${def.audience?.join(', ') ?? '—'} |`);
    }
    lines.push('');
}

lines.push(`## Audience signals — ${Object.keys(AUDIENCE_TERMS).length} audiences`);
lines.push('');
lines.push('| Audience | Terms |');
lines.push('| --- | --- |');
for (const [audience, terms] of Object.entries(AUDIENCE_TERMS)) {
    lines.push(`| ${audience} | ${terms.map(termWeight).map((t) => `\`${t.text}\``).join(', ')} |`);
}
lines.push('');

lines.push(`## Angle library — ${ANGLE_LIBRARY.length} angles`);
lines.push('');
lines.push('| Key | Label | What it does |');
lines.push('| --- | --- | --- |');
for (const angle of ANGLE_LIBRARY) {
    lines.push(`| \`${angle.key}\` | ${angle.label} | ${angle.description.replace(/\|/g, '\\|')} |`);
}
lines.push('');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/reference.md', `${lines.join('\n')}\n`);
console.log(`Wrote docs/reference.md — ${nicheCount} niches, ${subCount} sub-niches, ${ANGLE_LIBRARY.length} angles.`);
