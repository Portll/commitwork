#!/usr/bin/env node
// chunk-diff/generate.mjs — reads 2-6 Markdown files, writes one self-contained N-way comparison
// HTML artifact (file://-safe: no <script src>, no fetch, no CDN, all content inlined). Mirrors
// map/generate.mjs's shape (env-driven root, esc()-based embedding, atomic write).
//
// usage:
//   node chunk-diff/generate.mjs <doc1.md> <doc2.md> [doc3.md] [doc4.md] [doc5.md] [doc6.md] [--base <n>] [--by-section] [--out <path>]
//
// Documents may be any two-to-six .md files — different versions of one file, or files each
// holding a distinct agent's/model's output; the generator is source-agnostic, per design.
//
// env (read at CALL time, never at module load):
//   CW_DIFF_MAX_WORDS   per-chunk word-diff cap (default 20000) — see lib/diff-ops.mjs
//   CW_DIFF_MAX_BYTES   per-file size ceiling (default 5MB); larger files REFUSE the run entirely,
//                       never a partial read — a silent truncation would show an incomplete
//                       comparison as though it were whole.
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { splitBlocks, splitSections } from './lib/chunk-split.mjs';
import { alignColumns, MIN_COLUMNS, MAX_COLUMNS } from './lib/align.mjs';
import { STATE, fingerprint } from './lib/chunk-identity.mjs';
import { boundedWordDiff } from './lib/diff-ops.mjs';
import { renderMarkdown, stripComments, esc } from '../lib/render-markdown.mjs';
import { gateChunk } from './lib/secret-gate.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { followerScript } from '../lib/theme-follower.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const maxFileBytes = () => {
  const raw = Number(process.env.CW_DIFF_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 1024 * 1024;
};

export function parseArgs(argv) {
  const docs = [];
  let out = null;
  let base = 0;
  let bySection = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { out = argv[++i]; continue; }
    if (argv[i] === '--base') { base = Number(argv[++i]); continue; }
    if (argv[i] === '--by-section') { bySection = true; continue; }
    docs.push(argv[i]);
  }
  return { docs, out, base, bySection };
}

/** Read one document, refusing (never partially reading) anything over the size ceiling. */
export function loadDoc(path) {
  const abs = resolve(path);
  const st = statSync(abs); // ENOENT propagates — a named path that does not exist is a refusal
  if (st.size > maxFileBytes()) {
    throw new Error(`${path}: ${st.size} bytes exceeds CW_DIFF_MAX_BYTES (${maxFileBytes()}) — refusing rather than partially reading`);
  }
  return stripComments(readFileSync(abs, 'utf8'));
}

function renderCellSrc(pair) {
  const oldSrc = pair.old ? (Array.isArray(pair.old) ? pair.old.map((o) => o.src).join('\n\n') : pair.old.src) : null;
  const newSrc = pair.new ? (Array.isArray(pair.new) ? pair.new.map((n) => n.src).join('\n\n') : pair.new.src) : null;
  return { oldSrc, newSrc, src: newSrc != null ? newSrc : oldSrc };
}

function renderCell(pair) {
  if (!pair) return null;
  const { oldSrc, newSrc, src } = renderCellSrc(pair);
  let diffHtml = null;
  let capped = false;
  if (pair.state === STATE.EDITED && oldSrc != null && newSrc != null) {
    const { ops, capped: c } = boundedWordDiff(oldSrc, newSrc);
    capped = c;
    if (ops) {
      diffHtml = ops.map((o) => {
        const cls = o.t === '=' ? 'd-eq' : o.t === '-' ? 'd-del' : 'd-ins';
        return `<span class="${cls}">${esc(o.s)}</span>`;
      }).join('');
    }
  }
  return {
    state: pair.state,
    src: src || '',
    html: renderMarkdown(src || ''),
    diffHtml,
    capped,
    movedHint: pair.movedHint || null,
    isBase: !!pair.isBase,
  };
}

/** Pure function of file contents -> comparison payload. Same inputs, byte-identical output.
 *  `baseIndex` selects which column is the alignment reference, independent of its position in
 *  `docPaths`/`sources` (display order) — moving the reference document to a different display
 *  slot does not change which document the others are judged against, only where it's drawn.
 *  `bySection` chunks on Markdown headings instead of blank-line paragraphs (see
 *  lib/chunk-split.mjs's splitSections) — coarser rows, one per heading section rather than one
 *  per paragraph; a document with no real heading lines collapses to a single chunk under this
 *  mode, stated in splitSections' own header comment rather than silently misaligning. */
export function buildComparison(docPaths, sources, { baseIndex = 0, bySection = false } = {}) {
  if (sources.length < MIN_COLUMNS || sources.length > MAX_COLUMNS) {
    throw new Error(`buildComparison: expected ${MIN_COLUMNS}-${MAX_COLUMNS} documents, got ${sources.length}`);
  }
  if (!Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= sources.length) {
    throw new Error(`buildComparison: baseIndex ${baseIndex} out of range for ${sources.length} documents`);
  }
  const split = bySection ? splitSections : splitBlocks;
  const columns = sources.map((text, i) => ({
    label: basename(docPaths[i]),
    sourceDigest: fingerprint(text),
    chunks: split(text).map((c) => {
      const gated = gateChunk(c.src);
      return { src: gated.src };
    }),
  }));

  const { rows, extraRows } = alignColumns(columns, baseIndex);

  return {
    columns: columns.map((c) => ({ label: c.label, sourceDigest: c.sourceDigest, chunkCount: c.chunks.length })),
    rows: rows.map((row) => ({ perColumn: row.perColumn.map(renderCell) })),
    extraRows: extraRows.map((e) => ({ colIdx: e.colIdx, cell: renderCell(e.pair) })),
  };
}

// Embed JSON safely inside a <script> — same escaping as map/generate.mjs's dataLiteral.
function dataLiteralOf(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const css = () => `
${houseCss({ fonts: 'inline', weights: { sans: [400, 600, 700], mono: [400] } })}
:root{
  --del-bg:color-mix(in srgb,var(--crit) 16%,transparent);--del-ink:var(--crit);
  --ins-bg:color-mix(in srgb,var(--live) 16%,transparent);--ins-ink:var(--live);
  --st-MATCHED:var(--plan);--st-WHITESPACE_ONLY:var(--mut);--st-EDITED:var(--part);--st-AMBIGUOUS:var(--high);
  --st-UNRESOLVED:var(--crit);--st-ADDED:var(--live);--st-DELETED:var(--crit);
}
body{font-size:.8125rem;line-height:1.5}
header{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:.75rem;padding:.625rem 1rem;background:var(--panel);color:var(--head);border-bottom:1px solid var(--line2)}
header h1{font-size:.875rem;margin:0;font-weight:700}
header .meta{font-size:.6875rem;color:var(--mut);margin-left:auto}
header button{cursor:pointer;border:1px solid var(--line2);background:var(--panel2);color:var(--ink);border-radius:3px;padding:.3125rem .625rem;font:600 .71875rem var(--sans)}
header button:hover{border-color:var(--acc)}
.notice{padding:.375rem 1rem;font-size:.6875rem;color:var(--mut);background:var(--panel);border-bottom:1px solid var(--line2)}
.hidden-strip{padding:.375rem 1rem;font-size:.6875rem;background:color-mix(in srgb,var(--part) 12%,var(--panel));color:var(--part);border-bottom:1px solid var(--line2);display:none}
.hidden-strip.show{display:block}
.hidden-strip button{margin-left:.5rem;cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--ink);border-radius:.3125rem;padding:.125rem .4375rem;font-size:.6875rem}
.grid{display:grid}
.col{border-right:1px solid var(--line2);min-width:0;display:flex;flex-direction:column;background:var(--bg)}
.col:last-child{border-right:none}
.col.active{background:color-mix(in srgb,var(--acc) 5%,var(--bg))}
.col-head{position:sticky;top:2.5625rem;z-index:10;background:var(--panel);border-bottom:1px solid var(--line2);padding:.5rem .625rem;display:flex;align-items:center;gap:.375rem}
.col-head .lbl{font-weight:700;font-size:.75rem;color:var(--head);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.col-head .dig{font-family:var(--mono);font-size:.625rem;color:var(--mut)}
.col-head .hide{cursor:pointer;border:1px solid var(--line);background:var(--panel2);border-radius:.3125rem;padding:.125rem .375rem;font-size:.625rem;color:var(--crit)}
.row{display:flex;border-bottom:1px solid var(--line)}
.row.highlight{background:color-mix(in srgb,var(--part) 14%,var(--bg))}
.gutter{flex:0 0 1rem;cursor:pointer;background:var(--st,transparent);opacity:.6;border-right:1px solid var(--line2)}
.gutter:hover{opacity:1}
.cell{position:relative;flex:1;min-width:0;padding:.4375rem .625rem;overflow-wrap:break-word;color:var(--ink)}
.cell.empty{color:var(--mut);font-style:italic;font-size:.6875rem}
.cell p{margin:.4em 0}
.cell .st-tag{display:inline-block;font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--bg);border-radius:.25rem;padding:.0625rem .3125rem;margin-bottom:.25rem}
.cell .moved{font-size:.625rem;color:var(--mut);margin-left:.375rem}
.cell .master-star{position:absolute;top:.375rem;right:.375rem;font-size:.8125rem;color:var(--part)}
.d-del{background:var(--del-bg);color:var(--del-ink);text-decoration:line-through}
.d-ins{background:var(--ins-bg);color:var(--ins-ink)}
.menu{display:none;position:absolute;top:.25rem;right:.25rem;background:var(--panel);border:1px solid var(--line2);border-radius:.375rem;padding:.1875rem;gap:2px;z-index:5}
.cell:hover .menu{display:flex}
.menu button{cursor:pointer;border:none;background:transparent;color:var(--ink);font-size:.625rem;padding:.1875rem .375rem;border-radius:.25rem;white-space:nowrap}
.menu button:hover{background:var(--panel2);color:var(--head)}
.extras{padding:.625rem 1rem;border-top:1px solid var(--line2);background:var(--panel)}
.extras h2{font-size:.6875rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:0 0 .5rem}
.extra-row{display:flex;gap:.5rem;margin-bottom:.375rem;font-size:.71875rem;color:var(--ink)}
.extra-row .tag{flex:0 0 auto;font-weight:700;color:var(--live)}
@media(max-width:900px){.grid{display:block}.col{border-right:none;border-bottom:1px solid var(--line2)}}
`;

const APP_JS = String.raw`
(function(){
'use strict';
const DATA = window.__DATA__;
const N = DATA.columns.length;
const state = { active: 0, hidden: new Set(), master: new Map(), overrides: new Map(), highlighted: null };
const cellKey = (r,c) => r+':'+c;

function overrideSrc(rowIdx, colIdx){
  const k = cellKey(rowIdx, colIdx);
  return state.overrides.has(k) ? state.overrides.get(k) : null;
}
function cellFor(rowIdx, colIdx){
  const orig = DATA.rows[rowIdx].perColumn[colIdx];
  const ov = overrideSrc(rowIdx, colIdx);
  if (ov == null) return orig;
  return Object.assign({}, orig, { src: ov, html: mdEscape(ov), overridden: true });
}
// The generated artifact ships pre-rendered HTML for original content only; a client-side edit
// (copy-to-all / apply-to-active) is shown as escaped plain text, not re-rendered Markdown -- this
// keeps the one Markdown parser server-side (generate.mjs) rather than duplicating it in the
// browser, at the cost of overridden cells losing rich formatting until the next regeneration.
function mdEscape(s){
  const d = document.createElement('div'); d.textContent = s; return '<p>'+d.innerHTML+'</p>';
}

function setActive(colIdx){ state.active = colIdx; render(); }
function highlightRow(rowIdx, colIdx){ state.highlighted = rowIdx; state.active = colIdx; render(); }
function hideCol(colIdx){ state.hidden.add(colIdx); render(); }
function restoreCol(colIdx){ state.hidden.delete(colIdx); render(); }
function makeMaster(rowIdx, colIdx){ state.master.set(rowIdx, colIdx); render(); }
function copyToAll(rowIdx, colIdx){
  const src = cellFor(rowIdx, colIdx).src;
  for (let c=0;c<N;c++){ if (c===colIdx || state.hidden.has(c)) continue; state.overrides.set(cellKey(rowIdx,c), src); }
  state.master.set(rowIdx, colIdx);
  render();
}
function revertCell(rowIdx, colIdx){ state.overrides.delete(cellKey(rowIdx, colIdx)); render(); }
function applyToActive(rowIdx, colIdx){
  if (state.active === colIdx) return;
  state.overrides.set(cellKey(rowIdx, state.active), cellFor(rowIdx, colIdx).src);
  render();
}
function exportMerged(){
  const lines = [];
  for (let r=0;r<DATA.rows.length;r++){
    const winner = state.master.has(r) ? state.master.get(r) : 0;
    const cell = cellFor(r, winner) || cellFor(r, DATA.rows[r].perColumn.findIndex(Boolean));
    if (cell && cell.src) lines.push(cell.src);
  }
  const text = lines.join('\n\n');
  const blob = new Blob([text], {type:'text/markdown'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'merged.md';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function stTag(state_){
  return '<span class="st-tag" style="background:var(--st-'+state_+')">'+state_.replace('_',' ')+'</span>';
}

function cellHtml(rowIdx, colIdx){
  const raw = DATA.rows[rowIdx].perColumn[colIdx];
  if (!raw) return '<div class="cell empty">— no corresponding chunk —</div>';
  const c = cellFor(rowIdx, colIdx);
  const isMaster = state.master.get(rowIdx) === colIdx;
  const body = c.diffHtml || c.html;
  const capNote = c.capped ? '<div class="moved">(word diff skipped — chunk exceeds size cap)</div>' : '';
  const movedNote = c.movedHint ? '<span class="moved">'+c.movedHint+'</span>' : '';
  return '<div class="cell" data-row="'+rowIdx+'" data-col="'+colIdx+'">'
    + (isMaster ? '<span class="master-star" title="master for this row">\u2605</span>' : '')
    + stTag(c.state) + movedNote
    + '<div>'+body+'</div>' + capNote
    + '<div class="menu">'
    +   '<button data-act="master">make master</button>'
    +   '<button data-act="copyall">copy to all</button>'
    +   '<button data-act="revert">revert</button>'
    +   '<button data-act="apply">apply to active</button>'
    + '</div></div>';
}

function render(){
  const visible = []; for (let c=0;c<N;c++) if (!state.hidden.has(c)) visible.push(c);
  const grid = document.getElementById('grid');
  grid.style.gridTemplateColumns = 'repeat('+visible.length+', 1fr)';
  grid.innerHTML = visible.map((colIdx) => {
    const col = DATA.columns[colIdx];
    let rowsHtml = '';
    for (let r=0;r<DATA.rows.length;r++){
      const cell = DATA.rows[r].perColumn[colIdx];
      const stVar = cell ? 'var(--st-'+cell.state+')' : 'transparent';
      const hl = state.highlighted === r ? ' highlight' : '';
      rowsHtml += '<div class="row'+hl+'">'
        + '<div class="gutter" style="--st:'+stVar+'" data-row="'+r+'" data-col="'+colIdx+'"></div>'
        + cellHtml(r, colIdx)
        + '</div>';
    }
    return '<div class="col'+(state.active===colIdx?' active':'')+'" data-col="'+colIdx+'">'
      + '<div class="col-head"><span class="lbl">'+escHtml(col.label)+'</span>'
      + '<span class="dig">'+col.sourceDigest.slice(0,8)+'</span>'
      + '<button class="hide" data-hide="'+colIdx+'">hide</button></div>'
      + rowsHtml + '</div>';
  }).join('');

  const hiddenIdx = [...state.hidden];
  const strip = document.getElementById('hidden-strip');
  if (hiddenIdx.length){
    strip.classList.add('show');
    strip.innerHTML = 'Hidden: ' + hiddenIdx.map((c)=>escHtml(DATA.columns[c].label)
      +' <button data-restore="'+c+'">restore</button>').join('  ');
  } else { strip.classList.remove('show'); strip.innerHTML=''; }
}
function escHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

document.addEventListener('click', (ev) => {
  const hide = ev.target.closest('[data-hide]');
  if (hide) return hideCol(+hide.getAttribute('data-hide'));
  const restore = ev.target.closest('[data-restore]');
  if (restore) return restoreCol(+restore.getAttribute('data-restore'));
  const gutter = ev.target.closest('.gutter');
  if (gutter) return highlightRow(+gutter.getAttribute('data-row'), +gutter.getAttribute('data-col'));
  const act = ev.target.closest('[data-act]');
  if (act) {
    const cell = act.closest('.cell');
    const r = +cell.getAttribute('data-row'), c = +cell.getAttribute('data-col');
    const kind = act.getAttribute('data-act');
    if (kind==='master') makeMaster(r,c);
    else if (kind==='copyall') copyToAll(r,c);
    else if (kind==='revert') revertCell(r,c);
    else if (kind==='apply') applyToActive(r,c);
    return;
  }
  const col = ev.target.closest('.col');
  if (col) setActive(+col.getAttribute('data-col'));
});
document.getElementById('export').addEventListener('click', exportMerged);

render();
})();
`;

function buildHtml(comparison, docPaths) {
  const dataLiteral = dataLiteralOf(comparison);
  const generatedNotice = 'Snapshot comparison of ' + comparison.columns.length
    + ' document(s). This file does not auto-refresh — regenerate to check for changes.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>chunk-diff — ${esc(comparison.columns.map((c) => c.label).join(' vs '))}</title>
${followerScript()}
<style>${css()}</style></head>
<body>
<header>
  <h1>chunk-diff</h1>
  <button id="export">Copy / download merged Markdown</button>
  <span class="meta">${esc(comparison.columns.length)} columns · generated offline, no network</span>
</header>
<div class="notice">${esc(generatedNotice)}</div>
<div class="hidden-strip" id="hidden-strip"></div>
<div class="grid" id="grid"></div>
${comparison.extraRows.length ? `<div class="extras"><h2>Unmatched chunks (no counterpart in the base document)</h2>${
  comparison.extraRows.map((e) => `<div class="extra-row"><span class="tag">${esc(comparison.columns[e.colIdx].label)}</span><div>${e.cell.html}</div></div>`).join('')
}</div>` : ''}
<script>window.__DATA__ = ${dataLiteral};</script>
<script>${APP_JS}</script>
</body></html>`;
}

/** Refuses to write anything that would need the network — the file://-safety gate on the OUTPUT
 *  itself, not a comment on the source (the "second witness" pattern this repo's CLAUDE.md names
 *  explicitly for exactly this kind of invariant).
 *
 *  Checks APP_JS — the only hand-authored executable code in the artifact — for fetch/XHR/
 *  WebSocket/sendBeacon, never the whole document. The other <script> block is `window.__DATA__ =
 *  <JSON>`: chunk content is diffed technical prose, which routinely contains the literal text
 *  "fetch(" or "WebSocket" inside a code span (rendered by render-markdown.mjs into inert
 *  `<code>fetch(...)</code>` HTML) or, once JSON.stringify'd into the data literal, inside a
 *  quoted string value — never as bare executable syntax, so it cannot actually run regardless of
 *  what substrings it contains. Scanning that blob for these substrings would refuse to generate a
 *  comparison of any two documents that merely *discuss* those APIs, which is exactly the kind of
 *  content this tool exists to compare. `<script src=` is still checked against the whole
 *  document: escaped content can never produce a live unescaped tag, so that check catches only a
 *  real markup-level regression, not diffed prose. */
export function assertFileSafe(html, appJs = APP_JS) {
  if (/<script[^>]*\ssrc=/i.test(html)) {
    throw new Error('chunk-diff generator: output would violate file://-safety (matched <script src=)');
  }
  const forbidden = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bnavigator\.sendBeacon\b/];
  for (const re of forbidden) {
    if (re.test(appJs)) throw new Error(`chunk-diff generator: output would violate file://-safety (matched ${re} in APP_JS)`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const { docs, out, base, bySection } = parseArgs(argv);
  if (docs.length < MIN_COLUMNS || docs.length > MAX_COLUMNS) {
    process.stderr.write(`usage: chunk-diff/generate.mjs <doc1.md> <doc2.md> [doc3.md] [doc4.md] [doc5.md] [doc6.md] [--base <n>] [--by-section] [--out <path>]\n`
      + `  (${MIN_COLUMNS}-${MAX_COLUMNS} documents required, got ${docs.length})\n`);
    return 2;
  }
  if (!Number.isInteger(base) || base < 0 || base >= docs.length) {
    process.stderr.write(`chunk-diff: --base must be a document index from 0 to ${docs.length - 1}\n`);
    return 2;
  }
  const sources = docs.map(loadDoc);
  const comparison = buildComparison(docs, sources, { baseIndex: base, bySection });
  const html = buildHtml(comparison, docs);
  assertFileSafe(html);
  const outPath = resolve(out || `${basename(docs[0], '.md')}.chunk-diff.html`);
  writeAtomic(outPath, html);
  process.stdout.write(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, ${comparison.columns.length} columns)\n`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
