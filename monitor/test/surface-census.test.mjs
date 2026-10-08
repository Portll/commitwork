// monitor/test/surface-census.test.mjs — the source-surface axis.
//
// censusRepo is pure: every state below is driven by handcrafted walk/git/scanners/capability
// inputs, so the assertions are about the JOIN, not about any tool. The one impure assertion is
// the enumerator mirror: this lens's SKIP/MAX_DEPTH must equal coverage-manifest's, or the two
// axes silently census different trees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { censusRepo, walkSurface, gitSurface, SKIP, MAX_DEPTH, LANGUAGES } from '../surface-census.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the enumerator mirrors coverage-manifest exactly — two axes, one tree', () => {
  const src = readFileSync(join(HERE, '..', 'coverage-manifest.mjs'), 'utf8');
  const m = src.match(/const SKIP = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'coverage-manifest.mjs must still declare SKIP as a Set literal');
  const theirs = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual([...SKIP].sort(), theirs);
  const d = src.match(/const MAX_DEPTH = (\d+)/);
  assert.equal(MAX_DEPTH, Number(d[1]));
});

const cap = (o) => Object.fromEntries(Object.entries(o).map(([k, w]) => [k, { witness: w }]));

test('a declared void is void-declared with its reason — the headline grey', () => {
  // rust graduated out of this state when sast-codeql-rust landed (2026-08-26); haskell and dart
  // remain the declared voids.
  const rows = censusRepo({ haskell: { files: 3, bytes: 100 } }, null, null, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'void-declared');
  assert.match(rows[0].note, /no security lane reads Haskell source/);
  assert.equal(rows[0].enumeration, 'walk-only', 'a non-git tree has one enumerator, stated as such');
});

test('rust is no longer a declared void — its lone CodeQL lane greys or covers it like any language', () => {
  const rows = censusRepo({ rust: { files: 3, bytes: 100 } }, null, null, {});
  assert.equal(rows[0].state, 'grey-unscanned', 'capable lane exists (sast-codeql-rust); nothing ran in this fixture');
});

test('kotlin is its own row, never folded into java', () => {
  const rows = censusRepo({ kotlin: { files: 2, bytes: 10 }, java: { files: 1, bytes: 5 } }, null, null, {});
  assert.deepEqual(rows.map((r) => r.language).sort(), ['java', 'kotlin']);
});

test('a counting lane that ran with a covered ratio is covered — and a lone witness is disclosed', () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'covered', ratio: 1 } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.equal(rows[0].state, 'covered');
  assert.equal(rows[0].witnessCount, 1);
  assert.equal(rows[0].singleWitness, true, 'a single-lane green is labelled uncorroborated, not hidden');
});

test('a read-ratio below floor is grey-unread — findings are real, their absence is not', () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'partial', ratio: 0.6 } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.equal(rows[0].state, 'grey-unread');
  assert.match(rows[0].note, /below floor/);
});

test("a lane whose SARIF claims no-language while the walk sees files is a witness dispute", () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'no-language' } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.equal(rows[0].state, 'grey-unread');
  assert.match(rows[0].note, /witnesses dispute/);
});

test('a MEASURED shape-only lane cannot cover — presence attested, coverage not', () => {
  const rows = censusRepo(
    { elixir: { files: 2, bytes: 20 } }, null,
    { sastElixir: { ran: true } },
    cap({ sastElixir: 'shape-only' }));
  assert.equal(rows[0].state, 'grey-shape-only');
});

test('an UNMEASURED capability (no-fixture) stays voiced — unmeasured is not incapable', () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true } },
    cap({ sastCodeqlJava: 'no-fixture' }));
  assert.equal(rows[0].state, 'covered');
  assert.equal(rows[0].witnessCount, 1);
  assert.equal(rows[0].witnessMeasured, 0, 'the strict count says nothing was PROVEN to count');
});

test('capable lanes that never ran are grey-unscanned; a repo with no rollup says that instead', () => {
  const ranless = censusRepo({ java: { files: 5, bytes: 0 } }, null, {}, {});
  assert.equal(ranless[0].state, 'grey-unscanned');
  assert.match(ranless[0].note, /none ran/);
  const norollup = censusRepo({ java: { files: 5, bytes: 0 } }, null, null, {});
  assert.equal(norollup[0].state, 'grey-unscanned');
  assert.match(norollup[0].note, /no rollup/);
});

test('enumerator disagreement degrades covered to grey — zero-vs-nonzero is the strong signal', () => {
  const rows = censusRepo(
    { python: { files: 3, bytes: 30 } }, { /* git sees NO python */ },
    { sastCodeqlPython: { ran: true, coverage: { state: 'covered', ratio: 1 } }, sastSemgrep: { ran: true } },
    cap({ sastCodeqlPython: 'counting', sastSemgrep: 'counting' }));
  assert.equal(rows[0].enumeration, 'disputed');
  assert.equal(rows[0].state, 'grey-unread');
  assert.match(rows[0].note, /enumerators dispute/);
});

test('walkSurface skips the declared dirs and counts files+bytes; gitSurface is null off-git', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-sc-'));
  mkdirSync(join(d, 'src'));
  mkdirSync(join(d, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(d, 'src', 'a.rs'), 'fn main() {}');
  writeFileSync(join(d, 'src', 'b.rs'), '// two');
  writeFileSync(join(d, 'node_modules', 'x', 'c.rs'), 'ignored');
  writeFileSync(join(d, 'README.md'), 'no language');
  const w = walkSurface(d);
  assert.equal(w.rust.files, 2, 'node_modules is never walked');
  assert.ok(w.rust.bytes > 0);
  assert.equal(gitSurface(d), null, 'a non-git tree yields no git witness, never a zero one');
});

test('every LANGUAGES lane id resolves to a rollup category — no invented check names', async () => {
  const { SCANNER_CHECKS } = await import('../scanner-checks.mjs');
  const ids = new Set(Object.values(SCANNER_CHECKS));
  for (const l of LANGUAGES) for (const id of l.lanes) {
    assert.ok(ids.has(id), `${l.id} names lane '${id}' which SCANNER_CHECKS does not map`);
  }
});

// ── the read-ratio as a number ─────────────────────────────────────────────────────────────────
// `note` carried the ratio inside an English sentence, so a support matrix wanting to show whether
// a lane LOOKED had to parse prose to get it. These pin the structured form and the one rendering
// rule that matters: an unmeasurable ratio is not zero.

test('the read-ratio is emitted as a NUMBER, not only inside the note prose', () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'partial', ratio: 0.64 } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.deepEqual(rows[0].readRatios, [{ check: 'sast-codeql-java', ratio: 0.64, coverageState: 'partial' }],
    'a renderer must be able to read the ratio without parsing a sentence');
});

test('a lane that READ ITS WHOLE LANGUAGE still reports its ratio — 100% and "no ratio here" differ', () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'covered', ratio: 1 } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.equal(rows[0].state, 'covered');
  assert.deepEqual(rows[0].readRatios, [{ check: 'sast-codeql-java', ratio: 1, coverageState: 'covered' }]);
});

test('a lane with NO measurable ratio emits none — absent is not zero', () => {
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'unmeasurable', ratio: null } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.equal(rows[0].readRatios, undefined,
    'a null ratio must not be published as a measurement — no key at all beats a fabricated 0');
});

test('an UNMEASURABLE ratio never renders as "0%" in the note', () => {
  // The defect this pins: `(ratio || 0)` turned null into the string "0%", so a lane that could not
  // be measured read as a lane that read nothing — absence wearing a measurement's clothes.
  const rows = censusRepo(
    { java: { files: 5, bytes: 50 } }, { java: 5 },
    { sastCodeqlJava: { ran: true, coverage: { state: 'partial', ratio: null } } },
    cap({ sastCodeqlJava: 'counting' }));
  assert.equal(rows[0].state, 'grey-unread');
  assert.doesNotMatch(rows[0].note, /\b0%/,
    'an unmeasurable ratio printed as 0% is a number nobody measured');
  assert.match(rows[0].note, /ratio unmeasured/);
});
