// lib/dfd-record-render.mjs: the record page as one self-contained file, pinned by its policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderRecordHtml, recordClientJs, recordCss } from '../dfd-record-render.mjs';
import { houseTokens } from '../house-css.mjs';
import { MARK_ICON } from '../brand-tokens.mjs';
import { RECORD, SINKS } from './fixtures/dfd-record-model.mjs';

const hash = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const between = (html, open, close) => { const a = html.indexOf(open) + open.length; return html.slice(a, html.indexOf(close, a)); };

test('the page carries its style and script pinned by hash, and admits nothing else', () => {
  // Arrange
  const model = RECORD();
  // Act
  const { html, csp } = renderRecordHtml(model, { asOf: '2026-11-23 10:15' });
  const style = between(html, '<style>', '</style>');
  const script = between(html, '<script>', '</script>');
  const meta = between(html, '<meta http-equiv="Content-Security-Policy" content="', '">');
  // Assert
  assert.equal(style, recordCss());
  assert.ok(style.startsWith(houseTokens()), 'palette and font stacks come from the house tokens');
  assert.equal(script, recordClientJs());
  assert.equal(meta, `default-src 'none'; style-src 'sha256-${hash(style)}'; script-src 'sha256-${hash(script)}'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`);
  assert.equal(csp, `${meta}; frame-ancestors 'self'`);
  assert.ok(html.includes(MARK_ICON));
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son[a-z]+="/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(script, /^export /m);
  assert.doesNotMatch(script, /\bimport\b/);
  assert.match(script, /mountRecordView\(document, createRecordCore\);\n$/);
});

test('header, controls, playback, three regions, tables and key are all present, with the layout check stated', () => {
  // Arrange
  const model = RECORD();
  // Act
  const { html } = renderRecordHtml(model, { asOf: '2026-11-23 10:15', label: 'Record', chip: 'K1 landed' });
  // Assert
  assert.match(html, /<title>Parcel intake service — record<\/title>/);
  assert.match(html, /<p class="hd-label">Record<\/p>\n<p class="hd-chip"><span class="chip">K1 landed<\/span><\/p>\n<h1 class="hd-title">Parcel intake service<\/h1>/);
  assert.match(html, /<time datetime="2026-11-23T10:15">2026-11-23 10:15<\/time>/);
  for (const id of ['m-lanes', 'm-order', 'm-dim', 'pb', 'pb-play', 'pb-scrub', 'pb-out', 'rail', 'grid', 'account', 'sel', 'tabs', 'table', 'legend', 'dfd-data']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<div id="tabs" role="tablist" aria-label="Tables"><\/div><div id="table" role="tabpanel"><\/div>/);
  assert.match(html, /Layout check: 0 broken coordinates, 0 flows through a chip, 0 overlapping runs\./);
});

test('the default chip and label count findings and change sets; the noscript banner gives every count', () => {
  // Arrange
  const model = RECORD();
  delete model.title;
  // Act
  const { html, stats } = renderRecordHtml(model, { asOf: new Date(2026, 10, 23, 8, 5) });
  // Assert
  assert.match(html, /<title>data flow diagram — record<\/title>/);
  assert.match(html, /<p class="hd-label">Data flow record<\/p>/);
  assert.match(html, /<span class="chip">7 findings · 3 change sets<\/span>/);
  assert.match(html, /<time datetime="2026-11-23T08:05">/);
  assert.match(html, /<noscript><p class="banner"><strong>Drawing needs script.<\/strong> Document: 16 elements, 18 flows, 7 findings, 4 patches, 3 change sets, 2 routes.<\/p><\/noscript>/);
  assert.deepEqual([stats.elements, stats.sets, stats.lanes, stats.outcomeRule], [16, 3, { group: 5, layer: 5 }, 'declared']);
  assert.deepEqual(stats.audit, { group: { nan: 0, through: 0, overlap: 0, hits: [] }, layer: { nan: 0, through: 0, overlap: 0, hits: [] } });
  assert.equal(stats.bytes, Buffer.byteLength(html, 'utf8'));
  assert.equal(renderRecordHtml(SINKS(), { asOf: 'x' }).stats.outcomeRule, 'sinks');
});

test('document strings are escaped in markup and cannot end the data block', () => {
  // Arrange
  const model = RECORD();
  model.title = '</script><script>alert(1)</script>';
  model.nodes[2].note = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c </script>`;
  // Act
  const { html } = renderRecordHtml(model, { asOf: 'x', label: '<b>', chip: '"q"' });
  const data = between(html, '<script type="application/json" id="dfd-data">', '</script>');
  // Assert
  assert.match(html, /<title>&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; — record<\/title>/);
  assert.match(html, /<p class="hd-label">&lt;b&gt;<\/p>/);
  assert.match(html, /<span class="chip">&quot;q&quot;<\/span>/);
  assert.doesNotMatch(data, /<|\u2028|\u2029/);
  assert.deepEqual(JSON.parse(data), model);
});
