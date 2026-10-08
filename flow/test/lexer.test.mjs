// W1's own failure modes, and the incidents that produced them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, cook, rawQuotedRuns } from '../lexer.mjs';

const values = (src) => classify(src).spans.filter((s) => s.kind === 'string' && s.value !== null).map((s) => s.value);
const kinds = (src) => classify(src).spans.map((s) => s.kind);

test('NEGATIVE CONTROL — the lexer reports something, and reports nothing when there is nothing', () => {
  // Every assertion below is consistent with a lexer that returns [] for all input. This one is not.
  assert.deepEqual(values("const p = 'reports/x.json';"), ['reports/x.json']);
  assert.deepEqual(values('const n = 1 + 2;'), []);
});

test('a glob string does not open a block comment', () => {
  // THE INCIDENT (CLAUDE.md): a whole-file /*...*/ regex read the pair inside '*<slash>node_modules<slash>*'
  // as a comment opener and swallowed 1,375 lines of admin/serve.mjs, then reported it clean.
  const src = "const args = ['-not', '-path', '*/node_modules/*'];\nconst p = 'reports/after.json';\n";
  assert.ok(values(src).includes('reports/after.json'),
    'a literal AFTER a glob string must still be seen — a false negative, the flattering direction');
});

test('prose about a path is a comment, not a read', () => {
  const src = "// see 'reports/ghost.json' for why\nconst p = 'reports/real.json';\n";
  assert.deepEqual(values(src), ['reports/real.json']);
});

test('a fixture written by a test is not a read by that test', () => {
  const src = "write(d, 'sink.mjs', `import { A } from './builder.js';`);\n";
  const spans = classify(src).spans;
  assert.ok(spans.some((s) => s.kind === 'template'), 'the template must be classified as a template');
  assert.ok(!values(src).includes('./builder.js'), 'a specifier inside a template is not an import');
});

test('a regex literal containing quotes does not desync the scanner', () => {
  // The hand-rolled tokenizer that preceded the repaired guard died here: /class="…"/ opened a
  // string state that never closed, and unrelated text landed in specifier position.
  const src = 'const re = /class="[^"]*"/g;\nconst p = \'reports/after-regex.json\';\n';
  assert.ok(kinds(src).includes('regex'), 'the regex must be classified as a regex');
  assert.deepEqual(values(src), ['reports/after-regex.json']);
});

test('division is not a regex', () => {
  const src = "const half = total / 2;\nconst p = 'reports/x.json';\n";
  assert.ok(!kinds(src).includes('regex'));
  assert.deepEqual(values(src), ['reports/x.json']);
});

test('template interpolation returns to code, and nested strings inside it are found', () => {
  const src = 'const p = `${join(dir, \'inner.json\')}/tail`;\n';
  const spans = classify(src).spans;
  assert.ok(spans.some((s) => s.kind === 'string' && s.value === 'inner.json'),
    'a string inside ${} is code, and its literal must be seen');
  assert.ok(spans.filter((s) => s.kind === 'template').length >= 2, 'both template chunks are spans');
});

test('an interpolated template is not offered as a complete value', () => {
  const src = 'const p = `reports/${area}/rollup.json`;\n';
  const t = classify(src).spans.filter((s) => s.kind === 'template');
  assert.ok(t.every((s) => s.interpolated === true || s.value !== 'reports/'),
    'a chunk of an interpolated template is not a whole path');
});

test('spans never overlap and never invert', () => {
  const src = "const a = 'x'; /* c */ const r = /a[/]b/; const t = `p${1}q`; // end 'z'\n";
  const spans = [...classify(src).spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(spans[i].start >= spans[i - 1].end, `span ${i} overlaps its predecessor`);
    assert.ok(spans[i].innerEnd >= spans[i].innerStart, `span ${i} is inverted`);
  }
});

test('a hashbang is consumed and does not eat the file', () => {
  const src = "#!/usr/bin/env node\nconst p = 'reports/x.json';\n";
  assert.deepEqual(values(src), ['reports/x.json']);
});

test('BAIL IS ITS OWN STATE — an unterminated string is not an empty result', () => {
  const r = classify("const a = 'oops\nconst b = 2;\n");
  assert.equal(r.ok, false, 'a lexer that cannot account for the file must say so');
  assert.match(r.reason, /unterminated/);
});

test('cook refuses to guess an escape it does not know', () => {
  assert.equal(cook('a\\nb'), 'a\nb');
  assert.equal(cook('a\\u0041b'), 'aAb');
  assert.equal(cook('a\\qb'), null, 'an unknown escape makes the VALUE unknown, not wrong');
});

test('W3 has a DIFFERENT failure mode from the mask lexer', () => {
  // It over-reports on purpose — that is what makes it usable as a false-negative witness. What it
  // must not do is share the mask's blind spot.
  const src = "const re = /class=\"[^\"]*\"/g;\nconst p = 'reports/after-regex.json';\n";
  assert.ok(rawQuotedRuns(src).some((r) => r.value === 'reports/after-regex.json'));
  // And its own documented weakness, stated so it is not mistaken for coverage.
  const apostrophe = "// don't\nconst p = 'reports/x.json';\n";
  assert.ok(rawQuotedRuns(apostrophe).some((r) => r.value === 'reports/x.json'),
    'a stray apostrophe on an EARLIER line must not shift the pairing on a later one');
});
