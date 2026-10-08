// `deno check` colours its output, and the reset sequence lands BETWEEN the error code and the
// tag: the bytes are `TS2307 <ESC>[0m[ERROR]:`, never `TS2307 [ERROR]:`. The detail pattern matched
// the second shape, so every deno repo published a correct total from `Found N errors.` and ZERO
// rows beside it.
//
// It survived because it did not look like a bug. A count with no drill-down reads as an
// aggregation choice, and the schema even documents one ("one row per distinct TS code, not per
// occurrence") — so the absence looked deliberate. Measured across the fleet's 34 rollups it was
// 40,453 counted errors with nothing to explain any of them: the single largest detail gap there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCANNER_SPECS } from '../extractors.mjs';

const denoTypes = SCANNER_SPECS.find((s) => s[0] === 'denoTypes')[2];
const T = mkdtempSync(join(tmpdir(), 'cw-deno-'));
const ESC = String.fromCharCode(27);

const write = (name, body) => {
  const d = mkdtempSync(join(T, 'r-'));
  writeFileSync(join(d, name), body);
  return d;
};

// The real byte sequence, taken from reports/sweep-20260820171500-clientD/clientD/deno-check.log.
const coloured = (code, msg) => `${ESC}[0m${ESC}[1m${code} ${ESC}[0m[ERROR]: ${msg}`;

test('a coloured deno log yields detail rows — the bytes the tool actually emits', () => {
  const dir = write('deno-check.log', [
    coloured('TS2307', 'Import "preact/hooks" not a dependency'),
    coloured('TS2307', 'Import "preact" not a dependency'),
    coloured('TS2503', "Cannot find namespace 'preact'."),
    '',
    'Found 3 errors.',
  ].join('\n'));
  const c = denoTypes(dir);
  assert.equal(c.total, 3, 'the count was never the broken part');
  assert.equal((c.findings || []).length, 2, 'two DISTINCT codes, not three occurrences');
  const byCode = Object.fromEntries(c.findings.map((f) => [f.rule, f.count]));
  assert.deepEqual(byCode, { TS2307: 2, TS2503: 1 });
});

test('an UNcoloured log still parses — a non-tty run must not become the new blind spot', () => {
  const dir = write('deno-check.log', 'TS2345 [ERROR]: Argument of type X\n\nFound 1 error.');
  const c = denoTypes(dir);
  assert.equal((c.findings || []).length, 1);
  assert.equal(c.findings[0].rule, 'TS2345');
});

test('a message containing a literal [0m is not corrupted by the strip', () => {
  // The strip matches the ESC byte explicitly. Without it, `[0m` inside a genuine message would be
  // eaten too — silently damaging the text the fix exists to recover.
  const dir = write('deno-check.log', `${coloured('TS2322', 'Type \'"[0m"\' is not assignable')}\n\nFound 1 error.`);
  const c = denoTypes(dir);
  assert.equal(c.findings.length, 1);
  assert.match(c.findings[0].message, /\[0m/, 'the literal sequence inside the message survives');
});

test('a type-clean run is clean, not a void', () => {
  const dir = write('deno-check.log', 'Check file:///x/main.ts\n');
  const c = denoTypes(dir);
  assert.equal(c.ran, true);
  assert.equal(c.total, 0);
  assert.equal(c.nosrc, undefined, 'a log with no error line is a PASS, not an absent scan');
});

test('an empty log is a VOID — a run killed on its first syscall leaves the same file', () => {
  const c = denoTypes(write('deno-check.log', ''));
  assert.equal(c.nosrc, true);
  assert.equal(c.total, 0);
});

test('the aggregation holds AT SCALE — many occurrences collapse to few codes, and the count survives', () => {
  // THE CLAIM THIS CONVERTS INTO A CHECK. The commit that fixed the ANSI bug quoted a real
  // recovery: 18,463 counted errors in one clientD log yielding 25 distinct TS codes where there had
  // been 0 rows. That number was read off a live run and guarded by nothing — reports/ is
  // gitignored, so the artifact cannot become a fixture, and a number in a commit message is a
  // claim, not a check.
  //
  // So the SHAPE is reproduced at scale rather than the artifact copied: 25 distinct codes across
  // thousands of coloured occurrences, constructed here. If the parser regresses on volume, on the
  // many-occurrences-per-code path, or on ANSI at scale, this fails — which the synthetic
  // three-line fixtures above would not catch.
  const CODES = 25;
  const lines = [];
  let total = 0;
  for (let i = 0; i < CODES; i++) {
    const code = `TS${2300 + i}`;
    const occurrences = (i % 7) + 1;              // 1..7 — deliberately uneven, so counts differ per code
    for (let k = 0; k < occurrences; k++) { lines.push(coloured(code, `diagnostic ${i}/${k}`)); total++; }
  }
  lines.push('', `Found ${total} errors.`);
  const c = denoTypes(write('deno-check.log', lines.join('\n')));

  assert.equal(c.total, total, 'the count comes from `Found N errors.` and must survive the volume');
  assert.equal((c.findings || []).length, CODES, `${total} occurrences must collapse to ${CODES} rows, not ${total}`);
  // WHICH codes, not just how many — a length assertion is satisfied by any 25 rows, including 25
  // wrong ones.
  assert.deepEqual(c.findings.map((f) => f.rule).sort(),
    Array.from({ length: CODES }, (_, i) => `TS${2300 + i}`).sort());
  // And the per-code counts must be the real distribution, not all-ones.
  const byCode = Object.fromEntries(c.findings.map((f) => [f.rule, f.count]));
  assert.equal(byCode.TS2300, 1);
  assert.equal(byCode.TS2306, 7, 'the uneven distribution is preserved per row');
  assert.equal(Object.values(byCode).reduce((a, b) => a + b, 0), total,
    'the row counts must sum to the reported total — otherwise the aggregation is losing occurrences');
});

test('a count with NO parseable codes is still reported as a count — never silently zeroed', () => {
  // The failure this file is about, preserved as a state rather than a crash: if deno changes its
  // format again, the total must survive even when no row can be built from it.
  const dir = write('deno-check.log', 'something entirely unexpected\n\nFound 42 errors.');
  const c = denoTypes(dir);
  assert.equal(c.total, 42, 'the count stays real');
  assert.equal((c.findings || []).length, 0, 'and the missing detail is visible as an absence');
});
