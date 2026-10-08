import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLatticeHtml, layoutLattice, clip } from '../lib/lattice-html.mjs';

const objects = {
  GEN: ['observation:x'],
  S1: ['actor:a', 'observation:x'],
  S2: ['actor:b', 'observation:x'],
  LONE: ['actor:c', 'observation:y'],
  EQ1: ['actor:d'],
  EQ2: ['actor:d'],
};
const input = {
  objects,
  subs: [['S1', 'GEN'], ['S2', 'GEN']],
  groups: [['EQ1', 'EQ2']],
  contested: [{ from: 'LONE', relation: 'mechanism-of', to: 'GEN', basis: 'raters said <no> & "never"' }],
  names: new Map([['GEN', 'General class'], ['S1', 'Special one'], ['S2', 'Special two'], ['LONE', 'Lonely'], ['EQ1', 'Twin'], ['EQ2', 'Twin']]),
  registryVersion: '16',
  backed: [['S1', 'GEN']],
  now: null,
};

test('the artefact is byte-identical across renders', () => {
  assert.equal(renderLatticeHtml(input), renderLatticeHtml(input));
});

test('the artefact loads nothing from the network', () => {
  const html = renderLatticeHtml(input);
  assert.doesNotMatch(html, /(src|href)="https?:\/\//);
  assert.doesNotMatch(html, /@import|<link /);
});

test('text from the registry is escaped, not injected', () => {
  const html = renderLatticeHtml(input);
  assert.match(html, /raters said &lt;no&gt; &amp; &quot;never&quot;/);
  assert.doesNotMatch(html, /raters said <no>/);
});

test('a generation time appears only when CW_NOW-style input supplies one', () => {
  assert.doesNotMatch(renderLatticeHtml(input), /generated/);
  assert.match(renderLatticeHtml({ ...input, now: '2026-09-15T00:00:00Z' }), /generated 2026-09-15T00:00:00Z/);
});

test('contested edges are drawn dashed without an arrow, order edges carry one', () => {
  const html = renderLatticeHtml(input);
  assert.match(html, /<polyline class="edge contested" points="[^"]*"\/>/);
  assert.equal((html.match(/marker-end="url\(#arrow\)"/g) || []).length, 2);
});

test('classes with no drawn relation are listed, and an equivalence group is one entry', () => {
  const L = layoutLattice(input);
  assert.deepEqual(L.unrelated, ['EQ1 = EQ2']);
});

test('an implied edge through an intermediate class is not drawn', () => {
  const L = layoutLattice({
    ...input,
    objects: { A: ['x:1'], B: ['x:1', 'y:1'], C: ['x:1', 'y:1', 'z:1'] },
    subs: [['B', 'A'], ['C', 'B'], ['C', 'A']],
    groups: [],
    contested: [],
  });
  assert.deepEqual(L.orderEdges.map((e) => e.join('>')).sort(), ['B>A', 'C>B']);
});

test('many children stay on a canvas no wider than the cap', () => {
  const many = Object.fromEntries([['G', ['k:1']], ...Array.from({ length: 40 }, (_, i) => [`C${i}`, ['k:1', `v:${i}`]])]);
  const L = layoutLattice({ objects: many, subs: Object.keys(many).filter((k) => k !== 'G').map((k) => [k, 'G']), groups: [], contested: [] });
  assert.ok(L.width <= 1200 + 144, `canvas ${L.width}px`);
});

test('every placed child sits below and right of its parent, so no bracket can cross a box', () => {
  const L = layoutLattice({
    objects: { A: ['x:1'], B: ['x:1', 'y:1'], C: ['x:1', 'y:1', 'z:1'], D: ['x:1', 'w:1'] },
    subs: [['B', 'A'], ['C', 'B'], ['C', 'A'], ['D', 'A']],
    groups: [],
    contested: [],
  });
  for (const r of L.placed.filter((row) => row.parent)) {
    const parent = L.placed.filter((row) => row.cluster === r.cluster && row.node === r.parent && row.index < r.index).at(-1);
    assert.ok(parent, `${r.node} has its parent ${r.parent} above it in the same cluster`);
    assert.ok(r.y > parent.y && r.x > parent.x, `${r.node} is below and right of ${r.parent}`);
  }
});

test('a class with two parents appears under each, marked also under the other', () => {
  const html = renderLatticeHtml({
    ...input,
    objects: { P1: ['a:1'], P2: ['b:1'], KID: ['a:1', 'b:1'] },
    subs: [['KID', 'P1'], ['KID', 'P2']],
    groups: [],
    contested: [],
    backed: [],
  });
  assert.match(html, /KID · also under P2/);
  assert.match(html, /KID · also under P1/);
});

test('a relation backed through one member of a merged group is reported as backed', () => {
  const html = renderLatticeHtml({
    ...input,
    objects: { G: ['k:1'], A: ['k:1', 'v:1'], B: ['k:1', 'v:1'] },
    subs: [['A', 'G'], ['B', 'G']],
    groups: [['A', 'B']],
    contested: [],
    backed: [['A', 'G']],
  });
  assert.match(html, /<td>A[^<]* \/ B[^<]*<\/td><td>G[^<]*<\/td><td>rca mechanism-of<\/td>/);
  assert.doesNotMatch(html, /encoding only/);
});

test('a contested child names itself contested in its title, not beside the box', () => {
  const html = renderLatticeHtml(input);
  assert.match(html, />LONE · contested</);
  assert.doesNotMatch(html, /class="edge-label"/);
});

test('clip cuts at a word boundary and marks the cut', () => {
  assert.equal(clip('Stale by the time it is used', 22), 'Stale by the time it…');
  assert.equal(clip('Short', 22), 'Short');
});
