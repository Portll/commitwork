// monitor/test/deno-lane-contract.test.mjs — the contract between bin/deno-scan.mjs (one deno run
// per deno.json, merged into one artifact) and its readers: a per-directory subtotal must not read
// as the repo total, and ANSI escapes between the TS code and [ERROR] defeat the row parser —
// deno-scan strips them at the source. Fixtures are copied from real output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SCANNER_SPECS } from '../extractors.mjs';

const ESC = String.fromCharCode(27);   // never a literal control byte in source
const read = (id, files) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-deno-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return SCANNER_SPECS.find((s) => s[0] === id)[2](dir);
};

test('the LAST canonical total wins — a per-directory subtotal must not be read as the repo total', () => {
  // The shape deno-scan.mjs writes: subtotals rewritten so they cannot match, one total at the end.
  const log = [
    '[deno-scan] ===== . — 0 error(s) =====',
    'Check file:///x/mod.ts',
    '[deno-scan] ===== APP/typesense — 5 error(s) =====',
    `${ESC}[1mTS2304 ${ESC}[0m[ERROR]: Cannot find name 'client'.`,
    '[deno-scan] subtotal: 5 error(s).',
    'Found 5 errors.',
    '',
  ].join('\n');
  const c = read('denoTypes', { 'deno-check.log': log });
  assert.equal(c.total, 5, 'the canonical total, not the first subtotal');
  assert.equal(c.ran, true);
});

test('a raw per-directory `Found N errors.` would be read as the repo total — the reason for the rewrite', () => {
  // The negative control: this is what naive concatenation produces, and it is WRONG.
  const naive = ['Found 5 errors.', 'Check file:///y/mod.ts', 'Found 900 errors.', ''].join('\n');
  const c = read('denoTypes', { 'deno-check.log': naive });
  assert.equal(c.total, 5, 'first match wins — 905 errors would report as 5, which is why deno-scan rewrites subtotals');
});

test('ANSI escapes must not cost the drill-down rows', () => {
  const log = [
    `${ESC}[1mTS2304 ${ESC}[0m[ERROR]: Cannot find name 'client'.`,
    `${ESC}[1mTS2304 ${ESC}[0m[ERROR]: Cannot find name 'userQuery'.`,
    `${ESC}[1mTS2345 ${ESC}[0m[ERROR]: Argument of type 'A' is not assignable to parameter of type 'B'.`,
    'Found 3 errors.',
    '',
  ].join('\n');
  const withEsc = read('denoTypes', { 'deno-check.log': log });
  assert.equal(withEsc.total, 3, 'the total parses either way — which is what made this defect quiet');
  // UPDATED 2026-08-22, on this test's own instruction. It used to assert 0 rows here and said:
  // "deno-scan strips them at the source, which is why this asserts the BROKEN shape — if a future
  // extractor learns to strip ANSI itself, this fails and the strip can be dropped." The extractor
  // has now learned to, so the assertion flips.
  //
  // WHY BOTH STRIPS STAY. The source-side strip in bin/deno-scan.mjs only helps logs that lane
  // wrote. It does nothing for an artifact already on disk: reports/sweep-20260820171500-clientD
  // carries a coloured deno-check.log with 18,463 counted errors and, before this, ZERO rows —
  // recovered to 25 distinct TS codes by the extractor-side strip. Belt and braces is the right
  // answer when one of the two only covers the future.
  assert.equal((withEsc.findings || []).length, 2,
    'the extractor now strips ANSI itself, so a coloured log yields its rows without help from the producer');
  assert.deepEqual(withEsc.findings.map((r) => r.rule).sort(), ['TS2304', 'TS2345']);

  const stripped = read('denoTypes', { 'deno-check.log': log.replace(/\[[0-9;]*[A-Za-z]/g, '') });
  assert.equal(stripped.total, 3);
  assert.equal((stripped.findings || []).length, 2, 'two distinct TS codes, one row each — not one row per occurrence');
  assert.deepEqual(stripped.findings.map((r) => r.rule).sort(), ['TS2304', 'TS2345']);
  assert.equal(stripped.findings.find((r) => r.rule === 'TS2304').count, 2, 'occurrences are counted on the row');
});

test('lint diagnostics merged across configs keep repo-relative paths and produce one row each', () => {
  const doc = {
    version: 1,
    scannedConfigs: ['.', 'APP/site'],
    diagnostics: [
      { code: 'no-explicit-any', message: 'any is not allowed', filename: 'APP/site/utils/a.ts', range: { start: { line: 12, col: 4 } } },
      { code: 'ban-ts-comment', message: '`@ts-ignore` is not allowed without comment', filename: 'APP/site/utils/b.ts', range: { start: { line: 360, col: 0 } } },
    ],
  };
  const c = read('denoLint', { 'deno-lint.json': JSON.stringify(doc) });
  assert.equal(c.total, 2);
  assert.equal(c.low, 2, 'deno lint assigns no severity — every diagnostic is low, uniformly');
  assert.equal(c.findings.length, 2);
  const row = c.findings.find((r) => r.rule === 'ban-ts-comment');
  assert.equal(row.path, 'APP/site/utils/b.ts', 'repo-relative, so the same file is one finding whichever config found it');
  assert.equal(row.line, 360);
});

test('a clean type-check is ran-and-zero, and an empty artifact is NOT', () => {
  const clean = read('denoTypes', { 'deno-check.log': 'Check file:///x/mod.ts\nFound 0 errors.\n' });
  assert.equal(clean.ran, true);
  assert.equal(clean.total, 0, 'ran and type-clean is a real result');

  const empty = read('denoTypes', { 'deno-check.log': '' });
  assert.equal(empty.ran, true);
  assert.equal(empty.nosrc, true, 'an empty artifact is "no source matched", never a clean bill');
});

test('a missing artifact is null — absent, not clean', () => {
  assert.equal(read('denoLint', {}), null);
  assert.equal(read('denoTypes', {}), null);
});
