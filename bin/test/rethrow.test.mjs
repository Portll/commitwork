// rethrow — a broken file and broken code must not look the same. Holds the guard itself and (at
// the end) the list of places it is applied, so that list is a declaration rather than a habit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rethrowIfBug, rethrowIfBugParsing } from '../rethrow.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the three error classes that always mean the CODE is wrong are re-raised', () => {
  for (const E of [ReferenceError, TypeError, SyntaxError]) {
    assert.throws(() => rethrowIfBug(new E('x')), E, `${E.name} must be re-raised, never swallowed as an absence`);
  }
});

test('an expected I/O failure is returned, not thrown', () => {
  const e = Object.assign(new Error('no such file'), { code: 'ENOENT' });
  assert.equal(rethrowIfBug(e), e, 'the caller still handles ENOENT as the legitimate absence it is');
  const t = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
  assert.equal(rethrowIfBug(t), t);
});

// JSON.parse throws SyntaxError for BAD INPUT — the expected failure of a reader. Spelled as its
// own name so the opt-out is visible at the call site.
test('a parsing reader opts out of SyntaxError, and only that one class', () => {
  const syn = (() => { try { JSON.parse('{'); } catch (e) { return e; } })();
  assert.ok(syn instanceof SyntaxError);
  assert.equal(rethrowIfBugParsing(syn), syn, 'corrupt input is an expected failure of a parser');
  assert.throws(() => rethrowIfBugParsing(new ReferenceError('x')), ReferenceError,
    'opting out of SyntaxError must not opt out of the others');
  assert.throws(() => rethrowIfBugParsing(new TypeError('x')), TypeError);
});

// RangeError is genuinely ambiguous — a bad toFixed argument is a bug, an oversized allocation from
// a hostile file is not — and a guard that re-raises an EXPECTED failure is a new outage, not a fix.
test('RangeError is deliberately NOT re-raised', () => {
  const e = new RangeError('too big');
  assert.equal(rethrowIfBug(e), e);
});

// ── THE APPLIED LIST IS A DECLARATION ─────────────────────────────────────────────────────────
// The guard is NOT a policy for every catch; it belongs where a swallowed error BECOMES A NUMBER.
// Pinning the list means removing it from a file is a test failure, not a silent regression.
test('the guard is applied at every reader whose empty answer becomes a number', () => {
  const APPLIED = [
    'bin/adjudication-sampler.mjs',
    'bin/ratchet-corroborate.mjs',
    'bin/measured.mjs',
    'monitor/package-inventory.mjs',
  ];
  for (const rel of APPLIED) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(src, /rethrowIfBug/,
      `${rel} feeds a rate, population or denominator — a swallowed ReferenceError there becomes a NUMBER, `
      + 'so the guard must be present. If this file genuinely no longer computes one, remove it from APPLIED '
      + 'deliberately rather than letting the guard vanish.');
  }
});
