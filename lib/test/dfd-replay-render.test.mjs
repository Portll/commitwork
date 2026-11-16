// lib/dfd-replay-render.mjs: the replay page as one self-contained file, pinned by its policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderReplayHtml, replayClientJs, replayCss, embedJson, stamp } from '../dfd-replay-render.mjs';
import { validateDfd } from '../dfd.mjs';
import { MARK_ICON } from '../brand-tokens.mjs';
import { MODEL, UNDECLARED } from './fixtures/dfd-replay-model.mjs';

const hash = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const between = (html, open, close) => { const a = html.indexOf(open) + open.length; return html.slice(a, html.indexOf(close, a)); };

test('the synthetic fixture is a valid dfd@1 document, with and without declared pull requests', () => {
  // arrange
  const docs = [MODEL(), UNDECLARED()];
  // act
  const results = docs.map((d) => validateDfd(d));
  // assert
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
});

test('the page carries its style and script pinned by hash, and admits nothing else', () => {
  // arrange
  const model = MODEL();
  // act
  const { html, csp } = renderReplayHtml(model, { asOf: '2026-11-14 09:30' });
  const style = between(html, '<style>', '</style>');
  const script = between(html, '<script>', '</script>');
  const meta = between(html, '<meta http-equiv="Content-Security-Policy" content="', '">');
  // assert
  assert.equal(style, replayCss());
  assert.equal(script, replayClientJs());
  assert.equal(meta, `default-src 'none'; style-src 'sha256-${hash(style)}'; script-src 'sha256-${hash(script)}'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`);
  assert.equal(csp, `${meta}; frame-ancestors 'self'`);
  assert.ok(html.includes(MARK_ICON), 'the tab icon is inlined');
  assert.ok(MARK_ICON.match(/href="([^"]*)"/)[1].startsWith('data:image/svg+xml;base64,'), MARK_ICON);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son[a-z]+="/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(script, /^export /m);
  assert.match(script, /mountReplayView\(document, createReplayCore\);\n$/);
});

test('header in three sections with an as-of time; controls, playback, regions and key are all present', () => {
  // arrange
  const model = MODEL();
  // act
  const { html } = renderReplayHtml(model, { asOf: '2026-11-14 09:30', label: 'Replay', chip: 'H1 fixed' });
  // assert
  assert.match(html, /<header class="hd">\n<p class="hd-label">Replay<\/p>\n<p class="hd-chip"><span class="chip">H1 fixed<\/span><\/p>\n<h1 class="hd-title">Parcel intake service<\/h1>\n<p class="asof">Correct as of <time datetime="2026-11-14T09:30">2026-11-14 09:30<\/time><\/p>\n<\/header>/);
  for (const id of ['m-scope', 'm-asof', 'm-path', 'm-colour', 'q', 'f-layers', 'f-state', 'f-sev', 'f-ev', 'pb', 'pb-scrub', 'pb-speed', 'pb-follow', 'pb-tree', 'pb-out', 'tree', 'overview', 'canvas', 'detail', 'account', 'sel', 'hits']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const pb of ['first', 'prev', 'play', 'next', 'last']) assert.match(html, new RegExp(`data-pb="${pb}"`));
  assert.match(html, /<div id="tree" role="tree"/);
  assert.match(html, /<h2>Key<\/h2>\n<ul class="legend">/);
});

test('defaults: the document title, a chip of counts, the label, and the time now', () => {
  // arrange
  const model = MODEL();
  // act
  const { html, stats } = renderReplayHtml(model);
  const dated = renderReplayHtml(model, { asOf: new Date(2026, 0, 2, 3, 4), title: 'Other' });
  // assert
  assert.match(html, /<p class="hd-label">Data flow replay<\/p>/);
  assert.match(html, /<span class="chip">7 findings · 4 change sets<\/span>/);
  assert.match(html, /<time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d">/);
  assert.match(dated.html, /<time datetime="2026-01-02T03:04">2026-01-02 03:04<\/time>/);
  assert.match(dated.html, /<title>Other — replay<\/title>/);
  assert.deepEqual([stats.elements, stats.findings, stats.sets, stats.files, stats.steps.length], [15, 7, 4, 6, 5]);
  assert.equal(stats.bytes, Buffer.byteLength(html, 'utf8'));
  assert.equal(stamp(new Date(2026, 10, 14, 9, 5)), '2026-11-14 09:05');
});

test('a document without a title still has one; the noscript banner gives the counts', () => {
  // arrange
  const model = MODEL();
  delete model.title;
  // act
  const { html } = renderReplayHtml(model, { asOf: 'x' });
  // assert
  assert.match(html, /<title>data flow diagram — replay<\/title>/);
  assert.match(html, /<noscript><p class="banner"><strong>Drawing needs script.<\/strong> Document: 15 elements, 17 flows, 7 issues, 4 change sets, 6 files.<\/p><\/noscript>/);
});

test('document strings are escaped in markup and cannot end the data block', () => {
  // arrange
  const model = MODEL();
  model.title = '</script><script>alert(1)</script>';
  model.nodes[2].note = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c </script>`;
  // act
  const { html } = renderReplayHtml(model, { asOf: 'x', label: '<b>', chip: '"q"' });
  const data = between(html, '<script type="application/json" id="dfd-data">', '</script>');
  // assert
  assert.match(html, /<title>&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; — replay<\/title>/);
  assert.match(html, /<p class="hd-label">&lt;b&gt;<\/p>/);
  assert.match(html, /<span class="chip">&quot;q&quot;<\/span>/);
  assert.doesNotMatch(data, /<|\u2028|\u2029/);
  assert.deepEqual(JSON.parse(data), model);
  assert.equal(embedJson({ a: '<' }), '{"a":"\\u003c"}');
});
