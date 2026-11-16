// lib/dfd-replay-render.mjs — the replay view: a dfd@1 document as one self-contained HTML page
// that steps through its change sets over the process-flow drawing of the document, beside the
// repository file tree the document names.
//
// The page embeds the document as JSON data and hands it to a script (lib/dfd-replay-core.mjs, the
// rules, then lib/dfd-replay-client.js, the drawing). It makes no request and carries a
// Content-Security-Policy that admits exactly its own bytes: one style element and one script, each
// by hash; no inline style attribute anywhere. Without script nothing is drawn, so the page says
// so and gives the counts.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './html-escape.mjs';
import { createReplayCore } from './dfd-replay-core.mjs';
import { houseTokens } from './house-css.mjs';
import { MARK_ICON } from './brand-tokens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const inlined = (file) => readFileSync(join(HERE, file), 'utf8').replace(/^export /gm, '');
export const replayClientJs = () => `${inlined('dfd-replay-core.mjs')}\n${inlined('dfd-replay-client.js')}\nmountReplayView(document, createReplayCore);\n`;
export const replayCss = () => `${houseTokens()}\n${readFileSync(join(HERE, 'dfd-replay.css'), 'utf8')}`;
// the same rule as lib/dfd-paths-render.mjs embedJson: `<` and the two line separators escaped
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
export const embedJson = (model) => JSON.stringify(model).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

const two = (n) => String(n).padStart(2, '0');
/** A date as "YYYY-MM-DD HH:MM" in local time. */
export const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

const LEGEND = `<ul class="legend">
<li>Square: external entity · circle: process · open-ended box: data store · rounded box: closed group · dashed box: elements outside scope</li>
<li>Diamond on a flow: check station, teal chip naming its patch · dashed diamond: check not yet landed · red dashed diamond: check missing</li>
<li>Red fill: open · red ring: dismissed, unproven · green ring: fixed, untested · green fill: fixed, tested or held on two tested axes</li>
<li>Red line: path from weakness to outcome · thick green line: route closed by a landed patch · grey dashed line: typed rejection not yet landed</li>
<li>Black trunk: untrusted sources · dashed enclosure: trust boundary · dotted ring: element touched by step · number: reading order</li>
<li>Text on each flow: data item, with count when merged · severity badge beside station</li>
</ul>`;

/**
 * -> { html, csp, stats }. opts: { label, chip, asOf (Date or string), title }. `stats` is the
 * core's own count: { elements, drawable, flows, findings, patches, sets, files, steps, bytes }.
 */
export function renderReplayHtml(model, opts = {}) {
  const title = opts.title || model.title || 'data flow diagram';
  const css = replayCss();
  const client = replayClientJs();
  const core = createReplayCore(model);
  const stats = core.stats();
  const asOf = opts.asOf instanceof Date ? stamp(opts.asOf) : String(opts.asOf || stamp(new Date()));
  const chip = opts.chip || `${stats.findings} findings · ${stats.sets} change sets`;
  const policy = (extra) => ["default-src 'none'", `style-src 'sha256-${sha256b64(css)}'`, `script-src 'sha256-${sha256b64(client)}'`, "img-src data:", "font-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", ...extra].join('; ');
  const sel = (id, label, options) => `<label class="mode" for="${id}">${label}<select id="${id}">${options}</select></label>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy([])}">${MARK_ICON}
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — replay</title>
<style>${css}</style></head>
<body><main>
<header class="hd">
<p class="hd-label">${esc(opts.label || 'Data flow replay')}</p>
<p class="hd-chip"><span class="chip">${esc(chip)}</span></p>
<h1 class="hd-title">${esc(title)}</h1>
<p class="asof">Correct as of <time datetime="${esc(asOf.replace(' ', 'T'))}">${esc(asOf)}</time></p>
</header>
<noscript><p class="banner"><strong>Drawing needs script.</strong> Document: ${stats.elements} elements, ${stats.flows} flows, ${stats.findings} issues, ${stats.sets} change sets, ${stats.files} files.</p></noscript>
<div class="ctl" role="group" aria-label="View controls">
${sel('m-scope', 'Scope', '<option value="paths">Issue paths</option><option value="step">Step neighbourhood</option><option value="all">Whole document</option>')}
${sel('m-asof', 'State as of', '')}
${sel('m-path', 'Path', '')}
${sel('m-colour', 'Colour by', '<option value="state">State</option><option value="coverage">Line coverage</option><option value="none">No colour</option>')}
<label class="mode" for="q">Search<input type="search" id="q" autocomplete="off" spellcheck="false" placeholder="id, file, function, rule, CWE"></label>
<div id="facets"><fieldset id="f-layers"></fieldset><fieldset id="f-state"></fieldset><fieldset id="f-sev"></fieldset><fieldset id="f-ev"></fieldset></div>
</div>
<div class="pb" id="pb" role="group" aria-label="Playback by change set">
<button type="button" data-pb="first" aria-label="First step">⏮</button>
<button type="button" data-pb="prev" aria-label="Previous step">◀</button>
<button type="button" data-pb="play" id="pb-play" aria-pressed="false">Play</button>
<button type="button" data-pb="next" aria-label="Next step">▶</button>
<button type="button" data-pb="last" aria-label="Last step">⏭</button>
<input type="range" id="pb-scrub" min="0" max="0" step="1" value="0" aria-label="Change sets landed">
<label for="pb-speed">Speed</label><select id="pb-speed"><option value="3000">3 s per step</option><option value="1500" selected>1.5 s per step</option><option value="700">0.7 s per step</option></select>
<label><input type="checkbox" id="pb-follow" checked> Touched groups opened</label>
<label><input type="checkbox" id="pb-tree" checked> Touched files expanded</label>
<output id="pb-out" aria-live="polite"></output>
</div>
<div class="regions">
<aside id="treepane" aria-label="Repository files"><h2>Repository files</h2><div id="tree" role="tree" aria-label="Repository file tree"></div></aside>
<section id="center" aria-label="Flow canvas"><h2>Overview</h2><div id="overview"></div><div id="canvas"></div></section>
<aside id="detail" aria-label="Detail"><h2>Account and selection</h2><div id="hits" hidden></div><div id="account" aria-live="polite"></div><div id="sel"></div></aside>
</div>
<section id="checks" aria-label="Checks and tests"></section>
<h2>Key</h2>
${LEGEND}
<script type="application/json" id="dfd-data">${embedJson(model)}</script>
<script>${client}</script>
</main></body></html>
`;
  return { html, csp: policy(["frame-ancestors 'self'"]), stats: { ...stats, bytes: Buffer.byteLength(html, 'utf8') } };
}
