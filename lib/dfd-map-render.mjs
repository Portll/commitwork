// lib/dfd-map-render.mjs — the map view: a dfd@1 document of any size as one self-contained HTML
// page that draws a few dozen boxes at a time.
//
// lib/dfd-render.mjs draws every element once, which stops being readable near 150 of them.
// This page embeds the document as data and hands it to a script (lib/dfd-map-core.mjs, the rules,
// then lib/dfd-map-client.js, the drawing): the reader opens groups in place, the drawing stays
// under a budget, files, variables and programs are folded into counts on what touches them, and a
// closed box shows what is inside it: issues by severity, line coverage, traced flows. The issue
// list and the search open whatever hides an element.
//
// The page makes no request and carries a Content-Security-Policy that admits exactly its own
// bytes. Without script nothing is drawn, so the page says so and gives the counts.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './html-escape.mjs';
import { MARK_ICON } from './brand-tokens.mjs';
import { FOLLOWER_JS } from './theme-follower.mjs';
import { pageCss, sourceBanner } from './dfd-render.mjs';
import { pathsCss, embedJson } from './dfd-paths-render.mjs';
import { createMapCore } from './dfd-map-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const inlined = (file) => readFileSync(join(HERE, file), 'utf8').replace(/^export /gm, '');
export const mapClientJs = () => `${inlined('dfd-map-core.mjs')}\n${inlined('dfd-map-client.js')}\nmountMapView(document, createMapCore);\n`;
export const mapCss = () => readFileSync(join(HERE, 'dfd-map.css'), 'utf8');

const LEGEND = `<ul class="maplegend">
<li>left to right: what comes in (untrusted input, variables, schedulers), the code, then what the code reads, writes and runs</li>
<li><b>+ name</b> a closed group, taller the more it holds; select to open it in place</li>
<li>box with no +: files, variables or programs folded into one box; tick the box above to draw them singly</li>
<li><b>− name</b> an open group; select its heading to close it</li>
<li>rounded box: one element (a module, a function)</li>
<li>dashed box: a file, variable or program, drawn only when unfolded</li>
<li>number in a pill: issues inside. Red: open, coloured by the worst severity. Grey: judged not a defect on fewer than two tested axes, so not closed. Green: fixed (not rescanned) or held on two or more</li>
<li>red dot: on a flow a scanner traced</li>
<li>bar: line coverage of what is inside; hatched: not measured, never drawn as 0%</li>
<li>playback: step 0 is the original position, every issue open. Each step lands one change set whole: a pull request with all its patches, or, where none is declared, the patches that share commits or a patch file; every group holding what it touched is opened and ringed, and the issues it ruled on change state at that step and not before</li>
<li>curve ×n: n flows between the two boxes, merged, thicker the more there are; red: a traced flow; bright: the selected box's</li>
</ul>`;

/**
 * -> { html, csp, stats }. `stats` is the core's own count of the document:
 * { elements, leaves, flows, issues, sev, drawn, open, budget, measured, unmeasured, coverage }.
 */
export function renderMapHtml(model, { fonts = 'none' } = {}) {
  const title = model.title || 'data flow diagram';
  const css = `${pageCss(fonts)}\n${pathsCss()}\n${mapCss()}`;
  const client = mapClientJs();
  const stats = createMapCore(model).stats();
  const policy = (extra) => ["default-src 'none'", `style-src 'sha256-${sha256b64(css)}'`, `script-src 'sha256-${sha256b64(FOLLOWER_JS)}' 'sha256-${sha256b64(client)}'`,
    'img-src data:', `font-src ${fonts === 'served' ? "'self'" : 'data:'}`, "base-uri 'none'", "form-action 'none'", ...extra].join('; ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy([])}">${MARK_ICON}
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — map</title>
<script>${FOLLOWER_JS}</script>
<style>${css}</style></head>
<body><main>
<h1>${esc(title)}</h1>
<p class="sub">Map view · dfd@${esc(model.v)} · ${stats.elements} code elements, ${stats.leaves} files, variables and programs, ${stats.flows} flows, ${stats.issues} issues · open a group to see inside it; at most ${stats.budget} boxes are drawn at once</p>
<details><summary class="sub">Where this document came from, and what it could not read</summary>${sourceBanner(model)}</details>
<noscript><p class="banner"><strong>This view is drawn by its script.</strong> The document holds ${stats.elements} code elements, ${stats.leaves} files, variables and programs, ${stats.flows} flows and ${stats.issues} issue(s). <code>commitwork dfd --view classic</code> with a filter draws a part of it without script.</p></noscript>
<svg class="dfd defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><marker id="map-a" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,4 L0,8 z"/></marker><marker id="map-a-t" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,4 L0,8 z"/></marker></defs></svg>
<div class="bar playbar" id="play-bar" hidden role="group" aria-label="Playback against pull requests">
<button type="button" class="btn" data-pb="first" aria-label="Before any pull request">⏮</button>
<button type="button" class="btn" data-pb="prev" aria-label="Step back one pull request">◀</button>
<button type="button" class="btn fix" data-pb="play" id="pb-play">▶ play</button>
<button type="button" class="btn" data-pb="next" aria-label="Step forward one pull request">▶</button>
<button type="button" class="btn" data-pb="last" aria-label="Every pull request">⏭</button>
<input type="range" id="pb-scrub" min="0" max="0" step="1" value="0" aria-label="Pull requests landed">
<label for="pb-speed">step every</label>
<select id="pb-speed"><option value="3000">3 s</option><option value="1500" selected>1.5 s</option><option value="700">0.7 s</option></select>
<span id="pb-out" aria-live="polite"></span>
</div>
<section id="story" class="story" aria-live="polite"></section>
<details class="adv"><summary>The numbers, and the map's controls</summary>
<div class="tiles" id="tiles"></div>
<div class="bar">
<label for="q">Find</label><input type="search" id="q" autocomplete="off" spellcheck="false" placeholder="file, function, variable, rule or issue id">
<span id="lens-l">Colour by</span>
<span class="seg" role="group" aria-labelledby="lens-l" id="lens"><button type="button" data-lens="issues">issues</button><button type="button" data-lens="coverage">coverage</button><button type="button" data-lens="traced">traced flows</button><button type="button" data-lens="none">nothing</button></span>
<button type="button" class="btn" id="close-all">close every group</button>
</div>
<ul id="hits" hidden></ul>
<div class="bar opts" id="opts" role="group" aria-labelledby="opts-l">
<span id="opts-l">Draw</span>
<label><input type="checkbox" data-opt="edges"> all flows inside open groups (otherwise: traced flows, and the selected box's)</label>
<label><input type="checkbox" data-opt="leaves"> files, variables and programs as boxes</label>
<label><input type="checkbox" data-opt="labels" checked> flow counts</label>
<label><input type="checkbox" data-opt="story" checked> the account in plain words</label>
<label><input type="checkbox" data-opt="follow" checked> during playback, open every group the step touches</label>
</div>
</details>
<p class="sub" id="status"></p>
<div class="maplay"><div class="dfd-wrap" id="wrap"></div><aside id="panel" aria-live="polite"></aside></div>
<h2>Issues</h2>
<p class="sub">Not closed first, then worst first. The standard for closing is a clean flow and two tested controls on different axes; hover a row for the reason given. Select a row to open the map at that element. <b>copy</b> puts everything the document holds about an issue on the clipboard. <b>remediate</b> writes the brief to give to whoever will fix it, a person or an agent session: this page runs nothing and sends nothing.</p>
<div class="bar"><button type="button" class="btn" id="copy-all">copy all issues</button><button type="button" class="btn fix" id="fix-all">remediation brief for all not closed</button><span class="sub" id="copied" role="status" aria-live="polite"></span></div>
<table><thead><tr><th>State</th><th>Severity</th><th>Id</th><th>Issue</th><th>CWE</th><th>Where</th><th title="tested axes / axes with a control">Axes</th><th></th></tr></thead><tbody id="issues"></tbody></table>
<section id="brief" hidden aria-labelledby="brief-title">
<h2 id="brief-title">Remediation brief</h2>
<p class="sub">A scanner's result is a claim, so the brief asks first for it to be checked against the source as it is now, then for a fix with a test that fails without it, or for the reason it is not a defect. Edit it here before copying if you need to.</p>
<textarea id="brief-text" spellcheck="false" aria-label="Brief text"></textarea>
<div class="bar"><button type="button" class="btn fix" id="brief-copy">copy brief</button><button type="button" class="btn" id="brief-close">close</button></div>
</section>
<h2>Legend</h2>
${LEGEND}
<script type="application/json" id="dfd-data">${embedJson(model)}</script>
<script>${client}</script>
</main></body></html>
`;
  return { html, csp: policy(["frame-ancestors 'self'"]), stats };
}
