// lib/dfd-map-render.mjs: the map view's page. The script it carries is tested through its two
// modules; here, that the page is self-contained, that its policy admits exactly its own bytes,
// and that what it embeds is the document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { renderMapHtml, mapClientJs, mapCss } from '../dfd-map-render.mjs';
import { MODEL } from './fixtures/dfd-map-model.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const between = (html, open, close) => { const a = html.indexOf(open) + open.length; return html.slice(a, html.indexOf(close, a)); };

test('the page embeds the document as data, with the counts the core gives', () => {
  // arrange
  const model = MODEL();
  // act
  const { html, stats } = renderMapHtml(model);
  // assert
  assert.deepEqual([stats.elements, stats.leaves, stats.flows, stats.issues, stats.drawn, stats.budget], [7, 6, 13, 4, 6, 150]);
  assert.deepEqual(JSON.parse(between(html, '<script type="application/json" id="dfd-data">', '</script>')), model);
  assert.match(html, /<title>shop — map<\/title>/);
  assert.match(html, /Map view · dfd@1 · 7 code elements, 6 files, variables and programs, 13 flows, 4 issues/);
  assert.match(html, /<noscript><p class="banner"><strong>This view is drawn by its script\.<\/strong> The document holds 7 code elements/);
  for (const id of ['tiles', 'q', 'lens', 'close-all', 'hits', 'opts', 'status', 'wrap', 'panel', 'issues', 'copy-all', 'fix-all', 'copied', 'brief', 'brief-title', 'brief-text', 'brief-copy', 'brief-close', 'play-bar', 'pb-play', 'pb-scrub', 'pb-speed', 'pb-out']) assert.ok(html.includes(` id="${id}"`), id);
  assert.equal((html.match(/data-lens="/g) || []).length, 4);
  assert.equal((html.match(/data-opt="/g) || []).length, 5);
  assert.match(html, /<section id="story" class="story" aria-live="polite"><\/section>/);
  assert.match(html, /<input type="checkbox" data-opt="follow" checked> during playback, open every group the step touches/);
});

test('the policy admits exactly the page\'s own style and scripts, by hash, and nothing remote', () => {
  // arrange
  const model = MODEL();
  // act
  const { html, csp } = renderMapHtml(model, { fonts: 'none' });
  const served = renderMapHtml(model, { fonts: 'served' });
  // assert
  const style = between(html, '<style>', '</style>');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[1], mapClientJs());
  assert.ok(style.endsWith(mapCss()));
  assert.ok(csp.includes(`style-src 'sha256-${sha(style)}'`));
  for (const s of scripts) assert.ok(csp.includes(`'sha256-${sha(s)}'`));
  assert.ok(csp.startsWith("default-src 'none'") && csp.endsWith("frame-ancestors 'self'"));
  assert.ok(html.includes(`content="${csp.replace("; frame-ancestors 'self'", '')}"`));
  assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), false);
  assert.ok(served.csp.includes("font-src 'self'") && csp.includes('font-src data:'));
});

test('the inlined script is one classic script that defines and mounts the view', () => {
  // arrange
  const js = mapClientJs();
  // act
  const parsed = new vm.Script(js);
  // assert
  assert.ok(parsed);
  assert.equal(/^export /m.test(js), false);
  assert.equal(/^import /m.test(js), false);
  assert.ok(js.trimEnd().endsWith('mountMapView(document, createMapCore);'));
});

test('text from the document cannot end the data block or the title', () => {
  // arrange
  const model = { v: 1, kind: 'dfd', title: '</title><script>alert(1)</script>', nodes: [{ id: 'a', kind: 'process', label: '</script><script>alert(2)</script>' }], flows: [] };
  // act
  const { html } = renderMapHtml(model);
  // assert
  assert.equal(html.includes('<script>alert('), false);
  assert.equal((html.match(/<script/g) || []).length, 3);
  assert.match(html, /<h1>&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
});

test('a document with no title is a data flow diagram', () => {
  // arrange
  const model = { v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }], flows: [] };
  // act
  const { html } = renderMapHtml(model);
  // assert
  assert.match(html, /<title>data flow diagram — map<\/title>/);
});
