// monitor/test/extractors-stub-counts.test.mjs — the stubs lane's counts must come FROM its rows.
//
// THE DEFECT (measured 2026-08-19): _stubCounts returned `high: arr.length`, a bucket hardcoded
// beside a per-row `sev` computed independently from the same input. Fleet-wide, scanners.stubs
// read {high: 4322, low: 0} while every one of those 4,322 rows carried sev 'low' — a complete
// inversion, live, for as long as the lane has existed.
//
// It was survivable only because TOTALS_EXCLUDE keeps the hygiene lane out of the severity
// headline. Unexcluded, 4,322 TODO markers would have landed in the fleet's HIGH count — which is
// also why "just delete TOTALS_EXCLUDE" was withdrawn as an instruction (DECISIONS D4 correction).
//
// The fix derives the buckets from the rows, so counts and rows cannot disagree by construction.
// This test asserts the DERIVATION, not the current numbers: a test pinning `low: 3` would pass
// against a fresh hardcode of `low`, which is the same defect wearing the other severity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SCANNER_SPECS } from '../extractors.mjs';

const stubSpec = SCANNER_SPECS.find((s) => s[0] === 'stubs');
const readStubs = (findings) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-stubs-'));
  writeFileSync(join(dir, 'stub.json'), JSON.stringify({ findings }));
  return stubSpec[2](dir);
};

test('every severity bucket equals the number of rows carrying that severity', () => {
  const c = readStubs([
    { marker: 'TODO', path: 'a.js', line: 1, severity: 'low', detail: 'x' },
    { marker: 'TODO', path: 'b.js', line: 2, severity: 'low', detail: 'y' },
    { marker: 'FIXME', path: 'c.js', line: 3, severity: 'medium', detail: 'z' },
  ]);
  assert.equal(c.total, 3);
  assert.equal(c.low, 2, 'two low rows, two counted low');
  assert.equal(c.med, 1);
  assert.equal(c.high, 0, 'and NOTHING is high — this read 3 before the fix');
  assert.equal(c.crit, 0);
});

test('the buckets sum to total — no row is counted twice or dropped', () => {
  const c = readStubs([
    { marker: 'TODO', path: 'a.js', line: 1, severity: 'low' },
    { marker: 'TODO', path: 'b.js', line: 2, severity: 'high' },
    { marker: 'TODO', path: 'c.js', line: 3, severity: 'critical' },
  ]);
  assert.equal(c.crit + c.high + c.med + c.low, c.total, 'conservation between the buckets and the count');
});

test('an all-low lane reports zero high — the live shape, asserted', () => {
  const c = readStubs(Array.from({ length: 25 }, (_, i) => ({ marker: 'TODO', path: `f${i}.js`, line: i + 1, severity: 'low' })));
  assert.equal(c.low, 25);
  assert.equal(c.high, 0);
});

test('an empty lane that RAN is not the same as a lane that did not', () => {
  const c = readStubs([]);
  assert.equal(c.ran, true, 'it ran');
  assert.equal(c.total, 0, 'and found nothing — which is not the same as never looking');
});
