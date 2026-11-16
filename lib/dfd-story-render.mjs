// lib/dfd-story-render.mjs — the story view: a dfd@1 document as one self-contained HTML page for a
// reader who does not know the code. One fixed picture (what comes in, the parts that handle it,
// what can happen), lit one layer at a time: the picture, the lines data follows, the findings,
// each change set, what is left. lib/dfd-story-core.mjs holds the rules, lib/dfd-story-client.js
// the drawing; the change-set state is the map view's (lib/dfd-map-core.mjs).
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
import { embedJson } from './dfd-paths-render.mjs';
import { createMapCore } from './dfd-map-core.mjs';
import { createStoryCore } from './dfd-story-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const inlined = (file) => readFileSync(join(HERE, file), 'utf8').replace(/^export /gm, '');
export const storyClientJs = () => `${inlined('dfd-map-core.mjs')}\n${inlined('dfd-story-core.mjs')}\n${inlined('dfd-story-client.js')}\nmountStoryView(document, createStoryCore, createMapCore);\n`;
export const storyCss = () => readFileSync(join(HERE, 'dfd-story.css'), 'utf8');

/** -> { html, csp, stats }. `stats` is the core's: { drawn, hidden, lines, weaknesses, places, stages, changes }. */
export function renderStoryHtml(model, { fonts = 'none' } = {}) {
  const title = model.title || 'data flow diagram';
  const css = `${pageCss(fonts)}\n${storyCss()}`;
  const client = storyClientJs();
  const stats = createStoryCore(model, createMapCore).stats();
  const policy = (extra) => ["default-src 'none'", `style-src 'sha256-${sha256b64(css)}'`, `script-src 'sha256-${sha256b64(FOLLOWER_JS)}' 'sha256-${sha256b64(client)}'`,
    'img-src data:', `font-src ${fonts === 'served' ? "'self'" : 'data:'}`, "base-uri 'none'", "form-action 'none'", ...extra].join('; ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy([])}">${MARK_ICON}
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — story</title>
<script>${FOLLOWER_JS}</script>
<style>${css}</style></head>
<body><main>
<h1>${esc(title)}</h1>
<noscript><p class="banner"><strong>This view is drawn by its script.</strong> The document holds ${stats.places} finding(s) on ${stats.drawn + stats.hidden} elements.</p></noscript>
<div class="stbar" role="group" aria-label="Steps">
<button type="button" class="btn" id="st-prev" aria-label="Step back">◀</button>
<button type="button" class="btn fix" id="st-play">▶ play</button>
<button type="button" class="btn" id="st-next" aria-label="Step forward">▶</button>
<ol id="chips"></ol>
</div>
<div class="stlay"><div><div id="pic"></div><ul id="key"></ul></div><div class="side"><section id="cap" aria-live="polite"></section><aside id="card" aria-live="polite"></aside></div></div>
<details><summary class="sub">Provenance and unread inputs</summary>${sourceBanner(model)}
<p class="sub">Story view · dfd@${esc(model.v)} · ${stats.drawn} boxes drawn${stats.hidden ? `, ${stats.hidden} left out` : ''} · engineer views: <code>commitwork dfd --view map</code>, <code>--view paths</code></p></details>
<script type="application/json" id="dfd-data">${embedJson(model)}</script>
<script>${client}</script>
</main></body></html>
`;
  return { html, csp: policy(["frame-ancestors 'self'"]), stats };
}
