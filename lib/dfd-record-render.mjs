// lib/dfd-record-render.mjs — the record view as one page: rules in dfd-record-core, drawing in dfd-record-client.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './html-escape.mjs';
import { createRecordCore } from './dfd-record-core.mjs';
import { houseTokens } from './house-css.mjs';
import { MARK_ICON } from './brand-tokens.mjs';
import { embedJson, stamp } from './dfd-replay-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const inlined = (file) => readFileSync(join(HERE, file), 'utf8').replace(/^export /gm, '');
export const recordClientJs = () => `${inlined('dfd-record-core.mjs')}\n${inlined('dfd-record-client.js')}\nmountRecordView(document, createRecordCore);\n`;
export const recordCss = () => `${houseTokens()}\n${readFileSync(join(HERE, 'dfd-record.css'), 'utf8')}`;

/** -> { html, csp, stats }. opts: { label, chip, asOf (Date or string), title }. */
export function renderRecordHtml(model, opts = {}) {
  const title = opts.title || model.title || 'data flow diagram';
  const css = recordCss();
  const client = recordClientJs();
  const core = createRecordCore(model);
  const stats = core.stats();
  const audit = { group: core.audit('group'), layer: core.audit('layer') };
  const asOf = opts.asOf instanceof Date ? stamp(opts.asOf) : String(opts.asOf || stamp(new Date()));
  const chip = opts.chip || `${stats.findings} findings · ${stats.sets} change sets`;
  const policy = (extra) => ["default-src 'none'", `style-src 'sha256-${sha256b64(css)}'`, `script-src 'sha256-${sha256b64(client)}'`, 'img-src data:', "font-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", ...extra].join('; ');
  const sel = (id, label) => `<label class="mode" for="${id}">${label}<select id="${id}"></select></label>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy([])}">${MARK_ICON}
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — record</title>
<style>${css}</style></head>
<body><main>
<header class="hd">
<p class="hd-label">${esc(opts.label || 'Data flow record')}</p>
<p class="hd-chip"><span class="chip">${esc(chip)}</span></p>
<h1 class="hd-title">${esc(title)}</h1>
<p class="asof">Correct as of <time datetime="${esc(asOf.replace(' ', 'T'))}">${esc(asOf)}</time></p>
</header>
<noscript><p class="banner"><strong>Drawing needs script.</strong> Document: ${stats.elements} elements, ${stats.flows} flows, ${stats.findings} findings, ${stats.patches} patches, ${stats.sets} change sets, ${stats.routes} routes.</p></noscript>
<div class="ctl" role="group" aria-label="View controls">
${sel('m-lanes', 'Lanes')}
${sel('m-order', 'Replay order')}
${sel('m-dim', 'Group patches by')}
</div>
<div class="pb" id="pb" role="group" aria-label="Replay by patch">
<button type="button" data-pb="first" aria-label="First step">⏮</button>
<button type="button" data-pb="prev" aria-label="Previous step">◀</button>
<button type="button" data-pb="play" id="pb-play" aria-pressed="false">Play</button>
<button type="button" data-pb="next" aria-label="Next step">▶</button>
<button type="button" data-pb="last" aria-label="Last step">⏭</button>
<input type="range" id="pb-scrub" min="0" max="0" step="1" value="0" aria-label="Patches landed">
<output id="pb-out" aria-live="polite"></output>
</div>
<div class="regions">
<aside id="railpane" aria-label="Patches"><h2>Patches</h2><div id="rail"></div></aside>
<section aria-label="Record grid"><div id="grid"></div></section>
<aside id="detail" aria-label="Account and selection"><div id="account" aria-live="polite"></div><div id="sel"></div></aside>
</div>
<section id="below" aria-label="Tables"><h2>Tables</h2><div id="tabs" role="tablist" aria-label="Tables"></div><div id="table" role="tabpanel"></div></section>
<section id="legend" aria-label="Key"></section>
<p class="sub">Layout check: ${audit.group.nan + audit.layer.nan} broken coordinates, ${audit.group.through + audit.layer.through} flows through a chip, ${audit.group.overlap + audit.layer.overlap} overlapping runs.</p>
<script type="application/json" id="dfd-data">${embedJson(model)}</script>
<script>${client}</script>
</main></body></html>
`;
  return { html, csp: policy(["frame-ancestors 'self'"]), stats: { ...stats, audit, bytes: Buffer.byteLength(html, 'utf8') } };
}
