#!/usr/bin/env node
// remediation-web — the remediation register as its own page, with STATUS as the first column.
//
// WHY IT IS SPLIT OUT. bin/taxonomy-web.mjs renders the same 18 rows inside the failure-taxonomy
// page, and its remRows template emits rank, title, action, note, closes, raises, effort and risk —
// and never `status`. So the field has existed in monitor/failure-taxonomy.json and been invisible
// to every reader of the published page. Measured 2026-08-29: item 4 carried
// "DONE 2026-08-13" (citing three commits) while the defect it names ran in production until
// 2026-08-27, and no reader could have seen either the claim or the contradiction.
//
// A register whose status nobody can read is a list of intentions. That is the whole argument for
// this page, and it is why STATUS leads rather than trails.
//
// UNASSESSED IS A STATE. An item with no status renders as UNASSESSED, never as blank and never as
// done. The house rule is that absence of evidence is its own state and is always displayed as such;
// a remediation register is exactly where a silent blank would be read as "nothing to worry about".
//
// Self-styled deliberately, like bin/taxonomy-render.mjs: no dependency on lib/docsite-page.mjs, so
// the page renders identically from a file:// path and this generator does not couple to the
// docsite shell. Data inlined, no CDN (house rule).
//
// usage:  node bin/remediation-web.mjs [--out <path>]
// env, read at CALL time: CW_TAXONOMY_JSON, CW_REMEDIATION_OUT, CW_NOW

import { esc } from '../lib/html-escape.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { loadManifest, findDoc, rootOf } from '../lib/docsite-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = () => process.env.CW_TAXONOMY_JSON || join(REPO, 'monitor', 'failure-taxonomy.json');
const manifestPath = () => process.env.CW_DOCSITE_MANIFEST || join(REPO, 'docsite', 'manifest.json');
// The page is ADDRESSED by the manifest's urlPath and must be STORED under it. An imported doc is
// copied to pages/<basename of source>; a urlPath rotation that leaves the file where it was
// renames the URL and nothing else (bin/test/docsite-manifest.test.mjs). The output name is
// therefore read from the manifest rather than fixed here.
// The register is a draft document, so its entry lives in the PRIVATE docsite manifest and the page
// is written into that root's imported/ (lib/docsite-roots.mjs). loadManifest() reads both manifests;
// a public checkout has no such entry and refuses with the reason unless --out names a file.
// CW_DOCSITE_MANIFEST still names one manifest file outright, with docsite/imported/ beside it.
const outPath = () => {
  if (process.env.CW_REMEDIATION_OUT) return process.env.CW_REMEDIATION_OUT;
  if (process.env.CW_DOCSITE_MANIFEST) {
    const doc = JSON.parse(readFileSync(manifestPath(), 'utf8')).docs.find((d) => d.slug === 'taxonomy-remediation');
    if (!doc || !doc.urlPath) throw new Error(`${manifestPath()} has no taxonomy-remediation entry with a urlPath — the register has no address to be stored under`);
    return join(REPO, 'docsite', 'imported', `${doc.urlPath}.html`);
  }
  const doc = findDoc(loadManifest(), 'taxonomy-remediation');
  if (!doc || !doc.urlPath) {
    throw new Error('neither docsite manifest has a taxonomy-remediation entry with a urlPath — the register is a private draft '
      + 'with no address in a public checkout; pass --out <file> to render it anyway');
  }
  return join(rootOf(doc), 'imported', `${doc.urlPath}.html`);
};
// Determinism: same inputs ⇒ byte-identical output. A page that embeds an unpinned clock differs on
// every run and a drift guard over it can only ever report noise.
const now = () => process.env.CW_NOW || '';


/**
 * The status word an item leads with, and the class that colours it.
 *
 * Parsed from the FRONT of the free-text status field, which is the shape already in use
 * ("DONE 2026-08-13 (sha) — narrative"). Anything unrecognised is UNASSESSED rather than guessed at:
 * inferring "probably done" from prose is how a register starts lying.
 */
export function statusOf(item) {
  const raw = String(item?.status || '').trim();
  if (!raw) return { word: 'UNASSESSED', kind: 'unassessed', detail: '' };
  const m = raw.match(/^(DONE|PARTIAL|OPEN|SUPERSEDED|WRONG)\b/i);
  if (!m) return { word: 'UNASSESSED', kind: 'unassessed', detail: raw };
  const word = m[1].toUpperCase();
  return { word, kind: word.toLowerCase(), detail: raw.slice(m[1].length).replace(/^[\s—-]+/, '') };
}

/** Counts by status word, including the unassessed — a total that hides its own gaps is not a total. */
export function tally(items) {
  const t = { DONE: 0, PARTIAL: 0, OPEN: 0, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 0 };
  for (const i of items) t[statusOf(i).word] += 1;
  return t;
}

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
  const i = process.argv.indexOf('--out');
  const out = i > -1 && process.argv[i + 1] ? process.argv[i + 1] : outPath();
  const registry = JSON.parse(readFileSync(registryPath(), 'utf8'));
  const html = renderRemediation(registry, { stamp: now() });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  const t = tally(registry.remediations || []);
  const line = Object.entries(t).filter(([, n]) => n > 0).map(([w, n]) => `${w} ${n}`).join(', ');
  process.stdout.write(`remediation-web: ${out} — ${(registry.remediations || []).length} actions (${line})\n`);
}
