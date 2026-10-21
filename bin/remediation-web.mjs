#!/usr/bin/env node
// remediation-web — the remediation register as its own page, with STATUS as the first column.
//
// WHY IT IS SPLIT OUT. bin/taxonomy-web.mjs renders the same rows inside the failure-taxonomy
// page, and its remRows template emits rank, title, action, note, closes, raises, effort and risk —
// and never `status`. On that page a DONE claim, and any contradiction of it, would be invisible
// to every reader.
//
// A register whose status nobody can read is a list of intentions. That is the whole argument for
// this page, and it is why STATUS leads rather than trails.
//
// UNASSESSED IS A STATE. An item with no status renders as UNASSESSED, never as blank and never as
// done. The house rule is that absence of evidence is its own state and is always displayed as such;
// a remediation register is exactly where a silent blank would be read as "nothing to worry about".
//
// THE DOCSITE PAGE IS MARKDOWN, AND EDITABLE. The manifest entry is kind:md: this
// writes docsite/content/<source> from the registry via lib/remediation-md.mjs, the docsite shell
// renders it in the site theme, and the editor's save parses it back into the registry
// (editVia: "remediations" in admin/routes/docsite.mjs). The registry stays the only truth.
// renderRemediation() below is the self-styled standalone export (--html), kept for file:// use.
//
// usage:  node bin/remediation-web.mjs [--out <path>]      # the docsite source (md) by default
//         node bin/remediation-web.mjs --html <path>        # standalone self-styled HTML
// env, read at CALL time: CW_TAXONOMY_JSON, CW_REMEDIATION_OUT, CW_NOW

import { esc } from '../lib/html-escape.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { statusOf, tally, toMarkdown } from '../lib/remediation-md.mjs';
import { loadManifest, findDoc, rootOf } from '../lib/docsite-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = () => process.env.CW_TAXONOMY_JSON || join(REPO, 'monitor', 'failure-taxonomy.json');
const manifestPath = () => process.env.CW_DOCSITE_MANIFEST || join(REPO, 'docsite', 'manifest.json');
export const outPath = () => {
  if (process.env.CW_REMEDIATION_OUT) return process.env.CW_REMEDIATION_OUT;
  const place = (root, doc) => (doc.kind === 'md' ? join(root, doc.source) : join(root, 'imported', `${doc.urlPath}.html`));
  if (process.env.CW_DOCSITE_MANIFEST) {
    const doc = JSON.parse(readFileSync(manifestPath(), 'utf8')).docs.find((d) => d.slug === 'taxonomy-remediation');
    if (!doc || !doc.urlPath) throw new Error(`${manifestPath()} has no taxonomy-remediation entry with a urlPath — the register has no address to be stored under`);
    return place(join(REPO, 'docsite'), doc);
  }
  const doc = findDoc(loadManifest(), 'taxonomy-remediation');
  if (!doc || !doc.urlPath) {
    throw new Error('neither docsite manifest has a taxonomy-remediation entry with a urlPath — the register is a private draft '
      + 'with no address in a public checkout; pass --out <file> to render it anyway');
  }
  return place(rootOf(doc), doc);
};
// Determinism: same inputs ⇒ byte-identical output. A page that embeds an unpinned clock differs on
// every run and a drift guard over it can only ever report noise.
const now = () => process.env.CW_NOW || '';

export { statusOf, tally };

const theme = () => `
${houseCss({ fonts: 'inline', weights: { sans: [400, 600, 700], mono: [400, 600] } })}
  :root{--zebra:color-mix(in srgb,var(--panel2) 45%,var(--bg))}
  body{font-size:.9375rem;line-height:1.55;-webkit-text-size-adjust:100%}
  .wrap{max-width:73.75rem;margin:0 auto;padding:2.5rem 1.375rem 5.625rem}
  h1{font-size:1.875rem;margin:0 0 .375rem;letter-spacing:-.01em}
  h2{font-size:1.1875rem;margin:2.75rem 0 .625rem}
  .sub{color:var(--mut);margin:0 0 1.625rem;max-width:78ch}
  .counts{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.875rem;padding:0;list-style:none}
  .counts li{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:.25rem .75rem;font:600 .75rem/1.4 var(--sans)}
  .n{font-variant-numeric:tabular-nums}
  .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:.5rem}
  table{min-width:56.25rem;font-size:.875rem}
  th{position:sticky;top:0;font-size:.6875rem}
  td{padding:.6875rem .75rem;vertical-align:top}
  tr:nth-child(even) td{background:var(--zebra)}
  .rank{font-variant-numeric:tabular-nums;color:var(--mut);width:3ch}
  .st{font:700 .6875rem/1.3 var(--sans);letter-spacing:.06em;white-space:nowrap}
  .st-done{color:var(--live)} .st-partial{color:var(--part)} .st-open{color:var(--crit)}
  .st-wrong{color:var(--high)} .st-superseded{color:var(--plan)} .st-unassessed{color:var(--mut)}
  .sdetail{display:block;margin-top:.3125rem;color:var(--mut);font-size:.78rem;max-width:46ch}
  .act{margin:.375rem 0 0;color:var(--mut);font-size:.8125rem}
  .rnote{margin:.4375rem 0 0;color:var(--mut);font-size:.78rem}
  .risk{color:var(--mut);font-size:.78rem;max-width:38ch}
  .chip{display:inline-block;border:1px solid var(--line);border-radius:.25rem;padding:1px .375rem;margin:0 .1875rem .1875rem 0;font:600 .6875rem/1.5 var(--mono);color:var(--mut)}
  .muted{color:var(--mut)}
  footer{margin-top:2.75rem;color:var(--mut);font-size:.78rem;border-top:1px solid var(--line);padding-top:.875rem}
  @media print{body{background:#fff}.scroll{border:0}th{position:static}}
`;

export function renderRemediation(registry, { stamp = '' } = {}) {
  const rem = (registry.remediations || []).slice().sort((a, b) => a.rank - b.rank);
  const attr = registry.attributionPlan || [];
  const t = tally(rem);

  const counts = Object.entries(t)
    .filter(([, n]) => n > 0)
    .map(([w, n]) => `<li class="st-${w.toLowerCase()}">${esc(w)} <span class="n">${n}</span></li>`)
    .join('');

  const rows = rem.map((r) => {
    const s = statusOf(r);
    return `<tr>
      <td class="rank">${esc(String(r.rank))}</td>
      <td><span class="st st-${s.kind}">${esc(s.word)}</span>${s.detail ? `<span class="sdetail">${esc(s.detail)}</span>` : ''}</td>
      <td><b>${esc(r.title)}</b><p class="act">${esc(r.action)}</p>${r.note ? `<p class="rnote">${esc(r.note)}</p>` : ''}</td>
      <td>${(r.closes || []).map((id) => `<span class="chip">${esc(id)}</span>`).join('') || '<span class="muted">none</span>'}</td>
      <td>${esc(r.effort)} <span class="muted">/ gain ${esc(String(r.gain))}</span></td>
      <td class="risk">${r.risk ? esc(r.risk) : '<span class="muted">no risk stated</span>'}</td>
    </tr>`;
  }).join('\n');

  // Status on these rows too. Written without it for an hour after this page was built to fix
  // exactly that — a field carried in the data and rendered nowhere. The surfaces carry statuses now.
  const attrRows = attr.map((a) => {
    const s = statusOf(a);
    return `<tr>
      <td><b>${esc(a.area)}</b><br><span class="st st-${s.kind}">${esc(s.word)}</span>${s.detail ? `<span class="sdetail">${esc(s.detail)}</span>` : ''}</td>
      <td>${esc(a.defect)}<p class="rnote"><b>mechanism</b> — ${esc(a.mechanism)}</p></td>
      <td>${esc(a.change)}</td>
      <td>${(a.closes || []).map((id) => `<span class="chip">${esc(id)}</span>`).join('')}<br><span class="muted">${esc(a.effort)}</span></td>
    </tr>`;
  }).join('\n');

  const unassessed = t.UNASSESSED;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Remediation register — commitwork</title>
<style>${theme()}</style></head><body><div class="wrap">
<h1>Remediation register</h1>
<p class="sub">The ${rem.length} ranked actions and ${attr.length} attribution surfaces from the failure
taxonomy, with the status of each. Status leads because it did not used to be published at all: the
field existed in the registry and the taxonomy page never rendered it, so an item could carry
<code>DONE</code> while the defect it named was still firing in production, and no reader could see
either the claim or the contradiction.</p>
<ul class="counts">${counts}</ul>
${unassessed ? `<p class="sub"><b>${unassessed} of ${rem.length}</b> carry no status. That is displayed as
UNASSESSED rather than left blank — an unchecked item is not a finished one, and a register that
renders the difference as whitespace is the failure this page exists to stop.</p>` : ''}
<h2>Ranked actions</h2>
<div class="scroll"><table>
<thead><tr><th>#</th><th>Status</th><th>Action</th><th>Closes</th><th>Effort</th><th>Risk</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<h2>Attribution surfaces</h2>
<p class="sub">Each row names the mechanism that makes the defect possible, not the incident that
revealed it.</p>
<div class="scroll"><table>
<thead><tr><th>Surface</th><th>Defect</th><th>Change</th><th>Closes</th></tr></thead>
<tbody>
${attrRows}
</tbody></table></div>
<footer>Generated by <code>bin/remediation-web.mjs</code> from <code>monitor/failure-taxonomy.json</code>
— never hand-edit; regenerate.${stamp ? ` Generated ${esc(stamp)}.` : ''}</footer>
</div></body></html>
`;
}

if (isMainModule(import.meta.url)) {
  const flag = (k) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null; };
  const htmlOut = flag('--html');
  const out = htmlOut || flag('--out') || outPath();
  const registry = JSON.parse(readFileSync(registryPath(), 'utf8'));
  const body = htmlOut || out.endsWith('.html') ? renderRemediation(registry, { stamp: now() }) : toMarkdown(registry);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  const t = tally(registry.remediations || []);
  const line = Object.entries(t).filter(([, n]) => n > 0).map(([w, n]) => `${w} ${n}`).join(', ');
  process.stdout.write(`remediation-web: ${out} — ${(registry.remediations || []).length} actions (${line})\n`);
}
