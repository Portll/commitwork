// bin/module-seams.mjs — the seam screener, and the controls that make its answers mean something.
//
// The tool exists to answer "can this file be split here" BEFORE the split. Its two answers are
// "cycles" (no) and "no cycles" (structurally viable), and both are only worth having if the tool
// can actually produce each one. So both directions are asserted against synthetic modules whose
// shape is known, and then against the real file that motivated it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leafLayer, scoreCuts, declarations, stripNonCode } from '../module-seams.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// THE FILE THE FINDINGS BELOW WERE MEASURED ON, FROZEN. It was monitor/extractors.mjs at 01fbcce
// (2026-09-04). It is a fixture rather than the live file because the live file is being SPLIT —
// along the grain this tool found — so every measurement here would re-aim itself on each slice
// and stop guarding anything. Kept as .txt, not .mjs, so it is not a second copy of live source
// to a grep, a linter, or the tracked-imports guard.
//
// It is 2,503 lines of heavily-commented real code, and that is the point: every inversion this
// tool has had came from prose or from a trailing export block, neither of which a synthetic
// fixture has. The synthetic controls above prove the tool CAN say yes and no; this proves what it
// says on the file that has broken it three times.
const FROZEN = () => readFileSync(join(ROOT, 'bin', 'test', 'fixtures', 'extractors-2026-09-04.mjs.txt'), 'utf8')
  .split('\r\n').join('\n');   // checkout may be CRLF; the line numbers below are the file's own

test('declarations finds every top-level form and nothing nested', () => {
  const src = [
    'const a = 1;',
    'function b() { const notTopLevel = 2; return notTopLevel; }',
    'export const c = () => 3;',
    'export async function d() {}',
    'class E {}',
  ].join('\n');
  assert.deepEqual(declarations(src).map((x) => x.name), ['a', 'b', 'c', 'd', 'E']);
});

test('a chain of helpers is ALL leaf, however deep', () => {
  // c -> b -> a. None of them depends on anything outside, so the whole chain can move.
  const src = 'const a = 1;\nconst b = () => a + 1;\nconst c = () => b() + 1;\n';
  const r = leafLayer(src);
  assert.equal(r.rest.length, 0, `expected no remainder, got ${r.rest.map((d) => d.name).join(', ')}`);
  assert.equal(r.leaf.length, 3);
});

test('POSITIVE CONTROL: a mutually recursive pair is NOT leaf', () => {
  // The screener is worthless if everything reads as leaf. This pair cannot move to a base module
  // without taking each other, and must show up in the remainder.
  const src = 'function ping(n) { return n ? pong(n - 1) : 0; }\nfunction pong(n) { return n ? ping(n - 1) : 1; }\n';
  const r = leafLayer(src);
  assert.deepEqual(r.rest.map((d) => d.name).sort(), ['ping', 'pong']);
});

test('scoreCuts reports NO cycles when the dependency runs one way', () => {
  // section 1 declares the helper; section 2 uses it. One direction only.
  const src = ['const helper = () => 1;', '// ── section two ──', 'const user = () => helper();'].join('\n');
  const { edges, cycles } = scoreCuts(src, [2]);
  assert.deepEqual(cycles, [], 'a one-way dependency is not a cycle');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, 2);
  assert.equal(edges[0].to, 1);
  assert.deepEqual(edges[0].names, ['helper']);
});

test('POSITIVE CONTROL: scoreCuts REPORTS a cycle when both sections need each other', () => {
  const src = [
    'const up = () => down();',       // section 1 needs `down`
    '// ── section two ──',
    'const down = () => up();',       // section 2 needs `up`
  ].join('\n');
  const { cycles } = scoreCuts(src, [2]);
  assert.deepEqual(cycles, ['1<->2'], 'the tool must be able to say no, or its yes means nothing');
});

test('THE FINDING IT WAS BUILT FROM: extractors.mjs has no seam at its banners', () => {
  // Measured 2026-09-04, and the number here has already been WRONG once. Before comments were
  // stripped it read five cyclic pairs; two of those were prose — a comment naming a function is
  // not a call to it. Three remain, and they are real code: 3->1 alone is 20 symbols.
  // If this ever comes back clean, the file was restructured — go and look, do not delete it.
  const { cycles, edges } = scoreCuts(FROZEN(), [906, 1500, 2157]);
  assert.deepEqual(cycles.sort(), ['1<->3', '1<->4', '3<->4'],
    `cycle set changed: ${cycles.join(', ') || 'none'}`);
  const heaviest = edges.find((e) => e.from === 3 && e.to === 1);
  assert.ok(heaviest && heaviest.count >= 15,
    `section 3's dependence on section 1 was 20 symbols; now ${heaviest ? heaviest.count : 'absent'}`);
});

test('stripNonCode blanks prose but keeps code, and preserves offsets', () => {
  const src = [
    'const real = 1;',
    '// a comment mentioning real and fake',
    'const s = "fake in a string";',
    'const t = `text ${real} more`;',
  ].join('\n');
  const out = stripNonCode(src);
  assert.equal(out.length, src.length, 'offsets must survive — declarations() slices by index');
  assert.equal(out.split('\n').length, src.split('\n').length, 'line numbers must survive');
  // the comment's and string's words are gone; the template EXPRESSION is kept
  assert.ok(!/comment|fake/.test(out), `prose survived: ${out}`);
  assert.match(out, /real/, 'the template ${} expression is code and must survive');
});

test('PROSE IS NOT A DEPENDENCY — a comment naming a function is not a call to it', () => {
  // This assertion used to say the OPPOSITE, and pinned the defect: comment mentions were counted,
  // which in a file that documents itself as heavily as this repository's turned prose into a
  // dependency graph. On monitor/extractors.mjs that manufactured two cyclic section pairs out of
  // four, and the conclusion drawn from it — "no seam, do not split" — was wrong in the expensive
  // direction. Stripping comments is what makes a reported cycle mean something.
  const src = ['const thing = 1;', '// ── two ──', '// this comment mentions thing and nothing else'].join('\n');
  const { edges } = scoreCuts(src, [2]);
  assert.deepEqual(edges, [], 'a comment mention must NOT register as a dependency');
});

test('a string containing a symbol name is not a dependency either', () => {
  const src = ['const thing = 1;', '// ── two ──', "const label = 'thing';"].join('\n');
  const { edges } = scoreCuts(src, [2]);
  assert.deepEqual(edges, [], 'a quoted name is data, not a reference');
});

test('but a REAL call still registers — the stripper must not hide code', () => {
  // The control for the two above: if stripping were too aggressive it would under-report, which is
  // the direction that green-lights a split that then fails.
  const src = ['const thing = () => 1;', '// ── two ──', 'const user = () => thing();'].join('\n');
  const { edges } = scoreCuts(src, [2]);
  assert.equal(edges.length, 1, 'a genuine call must survive stripping');
  assert.deepEqual(edges[0].names, ['thing']);
});

test('a trailing export block does not become a reference from the last declaration', () => {
  // The defect this guards produced a phantom cycle in monitor/extractors.mjs: `_a11yCounts` is
  // declared last, the file ends with `export { SCANNER_SPECS, _a11yCounts, … }`, and the last
  // body ran to EOF and swallowed that list — so the pair read as mutually dependent when the real
  // edge runs one way. It inverted the tool's answer from "splittable" to "no seam".
  const src = [
    'const first = 1;',
    'const last = () => 2;',
    'export {',
    '  first, last,',
    '};',
  ].join('\n');
  const decls = declarations(src);
  const lastDecl = decls.find((d) => d.name === 'last');
  assert.ok(!lastDecl.body.includes('export {'), `last body swallowed the export block: ${lastDecl.body}`);
  assert.ok(!lastDecl.body.includes('first'), 'the export list made `first` look like a reference');
});

test('extractors.mjs was FULLY ACYCLIC — 84 of 84 declarations layered cleanly', () => {
  // The headline correction of 2026-09-04. Two tool defects — counting prose, and the trailing
  // export block above — made this file look untouchable. It was not: nothing in it was cyclic,
  // which is what authorised the split now under way.
  const r = leafLayer(FROZEN());
  assert.equal(r.rest.length, 0,
    `expected no cyclic remainder; got: ${r.rest.map((d) => d.name).join(', ')}`);
  assert.equal(r.leaf.length, 84, `leaf layer was 84 declarations, got ${r.leaf.length}`);
});

test('AND THE LIVE FILE STILL IS, whatever size the split has left it', () => {
  // The fixture above records what was true; this asserts what must STAY true. A slice that
  // introduces a cycle — a part module importing back into the barrel, say — fails here rather
  // than at the next reader. Deliberately no count: the number falls with every slice, and a
  // count would have to be re-pinned each time until nobody believed it.
  const r = leafLayer(readFileSync(join(ROOT, 'monitor', 'extractors.mjs'), 'utf8'));
  assert.equal(r.rest.length, 0,
    `extractors.mjs went cyclic: ${r.rest.map((d) => d.name).join(', ')}`);
  assert.ok(r.leaf.length > 0, 'no declarations found — the parser lost the file');
});

test('an INTERIOR export block bounds the body before it and does not unbound the ones after', () => {
  // The trailing-block fix above took the FIRST `export {` in the file, which was right only while
  // the only one was the last line. Splitting the lane register out of extractors.mjs put a
  // re-export at line 2157, the scan stopped there, and the trailing block went back to being
  // swallowed — the same phantom `SCANNER_SPECS <-> _a11yCounts` cycle, in a tool documented as
  // fixed. A guard whose reach depends on where the thing it guards happens to sit is not a guard.
  const src = [
    'const early = 1;',
    "export { early } from './somewhere.mjs';",
    'const late = () => 2;',
    'export {',
    '  early, late,',
    '};',
  ].join('\n');
  const decls = declarations(src);
  const lateDecl = decls.find((d) => d.name === 'late');
  assert.ok(!lateDecl.body.includes('export {'),
    `an interior export block left the trailing one to be swallowed: ${lateDecl.body}`);
  assert.ok(!lateDecl.body.includes('early'), 'the trailing export list made `early` look like a reference');
});
