// lib/dfd-story-render.mjs: the story view's page. Its script is tested through its modules; here,
// that the page is self-contained, that its policy admits exactly its own bytes, and that the
// script it carries mounts against the embedded document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { renderStoryHtml, storyClientJs, storyCss } from '../dfd-story-render.mjs';
import { STORY } from './fixtures/dfd-story-model.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const between = (html, open, close) => { const a = html.indexOf(open) + open.length; return html.slice(a, html.indexOf(close, a)); };

test('the page embeds the document, names its parts and gives the core its counts', () => {
  // arrange
  const model = STORY();
  // act
  const { html, stats } = renderStoryHtml(model);
  // assert
  assert.deepEqual(stats, { drawn: 10, hidden: 0, lines: 11, weaknesses: 4, places: 5, stages: 7, changes: 3 });
  assert.deepEqual(JSON.parse(between(html, '<script type="application/json" id="dfd-data">', '</script>')), model);
  assert.match(html, /<title>toy — story<\/title>/);
  assert.match(html, /<noscript><p class="banner"><strong>This view is drawn by its script\.<\/strong> The document holds 5 finding\(s\) on 10 elements\./);
  assert.match(html, /Story view · dfd@1 · 10 boxes drawn · engineer views/);
  for (const id of ['st-prev', 'st-play', 'st-next', 'chips', 'cap', 'pic', 'key', 'card']) assert.ok(html.includes(` id="${id}"`), id);
  assert.ok(!/ style="/.test(html), 'no inline style: the policy would block it');
});

test('the policy admits exactly the page\'s own style and scripts, by hash, and a served font only when asked', () => {
  // arrange
  const model = STORY();
  // act
  const { html, csp } = renderStoryHtml(model);
  const served = renderStoryHtml(model, { fonts: 'served' });
  const meta = between(html, 'http-equiv="Content-Security-Policy" content="', '"');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // assert
  assert.equal(csp, `${meta}; frame-ancestors 'self'`);
  assert.match(meta, /^default-src 'none'; style-src 'sha256-[^']+'; script-src 'sha256-[^']+' 'sha256-[^']+'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'$/);
  assert.ok(meta.includes(`'sha256-${sha(between(html, '<style>', '</style>'))}'`));
  assert.equal(scripts.length, 2);
  for (const s of scripts) assert.ok(meta.includes(`'sha256-${sha(s)}'`));
  assert.equal(scripts[1], storyClientJs());
  assert.ok(between(html, '<style>', '</style>').endsWith(storyCss()));
  assert.match(served.csp, /font-src 'self'/);
});

test('a large document says how much it left out, and an untitled one still has a title', () => {
  // arrange
  const model = STORY();
  delete model.title;
  for (let i = 0; i < 70; i += 1) model.nodes.push({ id: `x${i}`, kind: 'process', label: `x${i}` });
  // act
  const { html, stats } = renderStoryHtml(model);
  // assert
  assert.equal(stats.hidden, 73);
  assert.match(html, /<title>data flow diagram — story<\/title>/);
  assert.match(html, /7 boxes drawn, 73 left out · /);
});

test('the script the page carries runs as one classic script and mounts on the embedded document', () => {
  // arrange
  const model = STORY();
  const els = new Map();
  const make = () => ({ innerHTML: '', textContent: '', disabled: false, addEventListener() {} });
  const document = { getElementById(id) { if (id === 'dfd-data') return { textContent: JSON.stringify(model) }; if (!els.has(id)) els.set(id, make()); return els.get(id); } };
  // act
  vm.runInNewContext(storyClientJs(), { document, setTimeout, clearTimeout });
  // assert
  assert.match(els.get('pic').innerHTML, /^<svg class="dfd story fit st-look"/);
  assert.match(els.get('cap').innerHTML, /^<h2>Platform layout<\/h2>/);
});
