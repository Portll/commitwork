// lib/dfd-paths-render.mjs — the paths view: a dfd@1 document as one self-contained HTML page that
// draws source-to-impact paths, what each patch closes, and what nobody has evaluated.
//
// Where lib/dfd-render.mjs lays the whole graph out and draws it once, this page hands the document
// to a script (lib/dfd-paths-core.mjs, the rules and layout, then lib/dfd-paths-client.js, the
// drawing and wiring) that draws it at three levels, steps through the patches
// (Timeline, with playback), applies any subset of them (Combinations) and reads a SARIF document
// into the steps nobody has evaluated. The notation, the palette and the legend are the renderer's
// own, unchanged; the paths view's marks are listed after the legend as additions.
//
// The page makes no request and carries a Content-Security-Policy that admits exactly its own
// bytes: one style element, and two scripts (the theme follower and the client), each by hash. The
// document is embedded as a JSON data block, which is never executed.
//
// Coverage (nodes[].coverage, flows[].coverage, patches[].evidence.control) is a further layer the
// client draws when the document carries any: its tiles, its toggle and its table of gaps are in the
// page hidden, and the client shows them. The Proof column of the patches table is always there.
//
// Without script nothing is drawn, so the page says so and names the view that needs none. The
// counts in `stats` are lib/dfd.mjs threatPaths's, computed here, so a caller can report them
// without running the page.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './html-escape.mjs';
import { MARK_ICON } from './brand-tokens.mjs';
import { FOLLOWER_JS } from './theme-follower.mjs';
import { threatPaths } from './dfd.mjs';
import { pageCss, LEGEND, MARKERS, sourceBanner } from './dfd-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

/**
 * The page's script: the rules module and the drawing module with their `export` keywords dropped
 * (an inline script is not a module), then the one call that mounts the view on the page.
 */
const inlined = (file) => readFileSync(join(HERE, file), 'utf8').replace(/^export /gm, '');
export const clientJs = () => `${inlined('dfd-paths-core.mjs')}\n${inlined('dfd-paths-client.js')}\nmountPathsView(document, createCore);\n`;
export const pathsCss = () => readFileSync(join(HERE, 'dfd-paths.css'), 'utf8');

/** A document as the text of a JSON data block: `<` and the two line separators cannot end the block or break a parser. */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
export const embedJson = (model) => JSON.stringify(model).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

const OK_MARKER = '<marker id="dfd-a-okc" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="10" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="mk-okc" d="M0,0 L10,4 L0,8 z"/></marker>';
const sample = (inner) => `<svg class="dfd" viewBox="0 0 58 24" width="58" height="24" aria-hidden="true">${inner}</svg>`;
const line = (halo, cls = 'fwd sync', marker = 'ink') => sample(`${halo ? `<path class="halo ${halo}" d="M4,12 L54,12"/>` : ''}<g class="e ${cls}"><path class="ln" d="M4,12 L54,12" marker-end="url(#dfd-a-${marker})"/></g>`);
export const ADDITIONS = `<ul class="legend">
<li>${line('live')} on an open path (!)</li>
<li>${line('live crit')} critical impact, not closed</li>
<li>${line('closed', 'fwd sync cut')} every path through it is closed, proven by test or at runtime</li>
<li>${line('closed weak', 'fwd sync cut')} closed on static, inspected or asserted evidence only</li>
<li>${line('grey')} on a path nobody has evaluated (?)</li>
<li>${sample('<g class="pip fixed"><circle cx="29" cy="12" r="6"/><text x="29" y="15" text-anchor="middle">✓</text></g>')} fixed by a patch</li>
<li>${sample('<g class="pip safe weak"><circle cx="29" cy="12" r="6"/><text x="29" y="15" text-anchor="middle">⊘</text></g>')} measured non-exploitable, no patch (dashed: no runtime proof)</li>
<li>${sample('<g class="guard absent"><path d="M29,5 l7,7 l-7,7 l-7,-7 z"/></g>')} check missing on this flow</li>
<li>${sample('<g class="guard present"><path d="M29,5 l7,7 l-7,7 l-7,-7 z"/></g>')} check added by a patch (dashed outline: not tested)</li>
<li>${line(null, 'fwd sync rej', 'okc')} reject flow a patch adds</li>
<li>${sample('<g class="cv"><rect class="cv-track" x="6" y="11" width="46" height="3"/><rect class="cv-fill" x="6" y="11" width="42" height="3"/><line class="cv-floor" x1="42.8" y1="9.5" x2="42.8" y2="15.5"/></g>')} line coverage of an element, at or above the floor (the tick)</li>
<li>${sample('<g class="cv"><rect class="cv-track" x="6" y="11" width="46" height="3"/><rect class="cv-fill low" x="6" y="11" width="18" height="3"/><line class="cv-floor" x1="42.8" y1="9.5" x2="42.8" y2="15.5"/></g>')} line coverage below the floor</li>
<li>${sample('<g class="cv"><rect class="cv-none" x="6" y="11" width="46" height="3"/></g>')} coverage not measured (never drawn as 0%)</li>
<li>${sample('<g class="e fwd sync"><path class="ln" d="M4,12 L54,12" marker-end="url(#dfd-a-ink)"/></g><g class="fx ex"><rect x="15" y="9" width="6" height="6"/></g>')} flow a test exercised</li>
<li>${sample('<g class="e fwd sync"><path class="ln" d="M4,12 L54,12" marker-end="url(#dfd-a-ink)"/></g><g class="fx nx"><rect x="15" y="9" width="6" height="6"/><line x1="15" y1="15" x2="21" y2="9"/></g>')} flow measured, never exercised (no mark: not measured)</li>
<li>${sample('<g class="guard present"><circle class="ring" cx="29" cy="12" r="9.5"/><path d="M29,6 l6,6 l-6,6 l-6,-6 z"/></g>')} a run-time control holds: a test or a run-time assertion fails without the patch and passes with it</li>
</ul>`;

/**
 * -> { html, csp, stats }. `csp` is the header form; the page carries the same policy in a meta
 * element. `stats` counts the document's paths by state with every patch not marked applied:false
 * in force: { elements, flows, patches, paths, open, unevaluated, closed, truncated }.
 */
export function renderPathsHtml(model, { fonts = 'none' } = {}) {
  const title = model.title || 'data flow diagram';
  const css = `${pageCss(fonts)}\n${pathsCss()}`;
  const client = clientJs();
  const tp = threatPaths(model, { maxPaths: 2000 });
  const count = (st) => tp.paths.filter((p) => p.state === st).length;
  const stats = { elements: model.nodes.length, flows: model.flows.length, patches: (model.patches || []).length,
    paths: tp.paths.length, open: count('open'), unevaluated: count('unevaluated'), closed: count('closed'), truncated: tp.truncated };
  const policy = (extra) => ["default-src 'none'", `style-src 'sha256-${sha256b64(css)}'`, `script-src 'sha256-${sha256b64(FOLLOWER_JS)}' 'sha256-${sha256b64(client)}'`,
    'img-src data:', `font-src ${fonts === 'served' ? "'self'" : 'data:'}`, "base-uri 'none'", "form-action 'none'", ...extra].join('; ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy([])}">${MARK_ICON}
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — paths</title>
<script>${FOLLOWER_JS}</script>
<style>${css}</style></head>
<body><main>
<h1>${esc(title)}</h1>
<p class="sub">Paths view, Gane–Sarson notation · dfd@${esc(model.v)} · ${stats.elements} elements, ${stats.flows} flows, ${stats.patches} patches · trust runs left to right; every path ends in the impact column</p>
${sourceBanner(model)}
<noscript><p class="banner"><strong>This view is drawn by its script.</strong> With every patch in force the document has ${stats.paths} source-to-impact path(s): ${stats.open} open, ${stats.unevaluated} not evaluated, ${stats.closed} closed${stats.truncated ? ' (the list was cut, so these are floors)' : ''}. The classic view of the same document needs no script.</p></noscript>
<svg class="dfd defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${MARKERS}${OK_MARKER}</defs></svg>
<div class="tiles" id="tiles"></div>
<div class="tiles" id="cov-tiles" hidden></div>
<div class="bar">
<span id="lvl-l">Level</span>
<span class="seg" role="group" aria-labelledby="lvl-l" id="lvl"><button type="button" data-level="0">L0 context</button><button type="button" data-level="1">L1 boundaries</button><button type="button" data-level="2">L2 elements</button></span>
<span id="flt-l">Show paths</span>
<span class="seg" role="group" aria-labelledby="flt-l" id="flt"><button type="button" data-flt="all">all</button><button type="button" data-flt="live">open</button><button type="button" data-flt="grey">not evaluated</button><button type="button" data-flt="closed">closed</button></span>
</div>
<div class="bar opts" id="opts" role="group" aria-labelledby="opts-l">
<span id="opts-l">Draw</span>
<label><input type="checkbox" id="o-halos" data-opt="halos" checked> path state under lines</label>
<label><input type="checkbox" id="o-pips" data-opt="pips" checked> verdict marks</label>
<label><input type="checkbox" id="o-guards" data-opt="guards" checked> guards</label>
<label><input type="checkbox" id="o-chips" data-opt="chips" checked> finding chips</label>
<label><input type="checkbox" id="o-labels" data-opt="labels" checked> flow labels</label>
<label class="cov-only" hidden><input type="checkbox" id="o-cov" data-opt="cov" checked> coverage marks</label>
<label><input type="checkbox" id="o-tiles" data-opt="tiles" checked> summary tiles</label>
<label class="cov-only" hidden><input type="checkbox" id="o-gaps" data-opt="gaps" checked> coverage gaps table</label>
</div>
<div class="tabs" role="tablist" aria-label="How patches are applied">
<button type="button" role="tab" id="tab-time" aria-controls="pane-time" data-mode="time">Timeline</button>
<button type="button" role="tab" id="tab-combo" aria-controls="pane-combo" data-mode="combo">Combinations</button>
</div>
<div class="pane" id="pane-time" role="tabpanel" aria-labelledby="tab-time">
<div class="bar">
<button type="button" class="btn" id="play">▶ play</button>
<label for="speed">step every</label>
<select id="speed"><option value="2400">2.4 s</option><option value="1200" selected>1.2 s</option><option value="600">0.6 s</option></select>
<button type="button" class="btn" id="prev" aria-label="Step back">◀</button>
<input type="range" id="scrub" min="0" max="${stats.patches}" step="1" value="${stats.patches}" aria-label="Position on the timeline">
<button type="button" class="btn" id="next" aria-label="Step forward">▶</button>
<span id="scrub-out" class="m"></span>
<button type="button" class="btn" id="k0">before any patch</button>
<button type="button" class="btn" id="kall">every patch</button>
</div>
<p class="sub"><label><input type="checkbox" id="by-set" checked> step and play by change set (a pull request, the commits patches share, or the patch file they came from), not patch by patch</label>. The scrubber still moves one patch at a time. Steps follow the order of the document's patches; this page has no git, so it does not order by commit.</p>
</div>
<div class="pane" id="pane-combo" role="tabpanel" aria-labelledby="tab-combo" hidden>
<div class="bar"><button type="button" class="btn" id="c-all">tick all</button><button type="button" class="btn" id="c-none">tick none</button><span id="combo-out" class="sub"></span></div>
<div class="combo" id="combo"></div>
<p class="sub">Tick any set of patches to see what that set closes. Beside each patch: what ticking or unticking it alone would change from here.</p>
</div>
<div class="focusbar" id="focusbar"></div>
<div class="dfd-wrap" id="wrap"></div>
<div class="cols">
<div><h2>Paths to impact</h2>
<p class="sub">One row per source-to-impact path, worst first. A path is closed when any step on it is fixed or measured non-exploitable. Select a row to trace it.</p>
<table><thead><tr><th>State</th><th>Impact</th><th>Path</th><th>What decides it</th></tr></thead><tbody id="paths"></tbody></table></div>
<div><h2>Patches</h2>
<p class="sub">Each patch is a change to the graph: the flow it guards, the paths it closes, the reject it adds. Select a row to trace its effect; on the timeline that also applies every patch up to it.</p>
<table><thead><tr><th>#</th><th>Patch</th><th>Commit</th><th>Guard on</th><th>Closes</th><th>Evidence</th><th>Proof</th></tr></thead><tbody id="patches"></tbody></table></div>
</div>
<div id="gaps-sec" hidden>
<h2>Coverage gaps</h2>
<p class="sub">Where the evidence is thin, worst impact first. A covered line is not a tested guard: a bar says the line ran under a test, and only a control proves a cut: something that fails without the patch and passes with it. A test or a run-time assertion is a run-time control; a compile-time assertion alone is not, because it says nothing about run time. Two kinds that both hold are belt and braces. Select a row to trace it.</p>
<table><thead><tr><th>Impact</th><th>Gap</th><th>Where</th><th>Detail</th></tr></thead><tbody id="gaps"></tbody></table>
</div>
<h2>Fill what nobody has evaluated from SARIF</h2>
<p class="sub">A result is matched by <code>ruleId</code> (the finding) and <code>locations[].logicalLocations[].name</code> (the element's reference). <code>kind: fail</code> turns the step open, <code>pass</code> turns it measured non-exploitable with the tool as witness, <code>open</code> and <code>review</code> leave it unevaluated. Results stay in this page and are not written to the document.</p>
<textarea id="sarif" spellcheck="false" aria-label="SARIF document" placeholder="Paste a SARIF 2.1.0 document"></textarea>
<div class="bar"><button type="button" class="btn" id="sarif-go">apply SARIF</button><button type="button" class="btn" id="sarif-clear">remove SARIF results</button><span id="sarif-msg" class="sub"></span></div>
<h2>Legend</h2>
${LEGEND}
<p class="sub">Additions of the paths view. State sits under or beside a line; the line itself keeps the meanings above. The coverage marks appear when the document carries coverage; a covered line is not a tested guard.</p>
${ADDITIONS}
<script type="application/json" id="dfd-data">${embedJson(model)}</script>
<script>${client}</script>
</main></body></html>
`;
  return { html, csp: policy(["frame-ancestors 'self'"]), stats };
}
