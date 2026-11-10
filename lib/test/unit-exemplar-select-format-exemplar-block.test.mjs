// Formats a block of recent exemplar lines or returns null (lib/exemplar-select.mjs formatExemplarBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExemplarBlock } from '../exemplar-select.mjs';

test('returns null when exemplars is null', () => {
  assert.equal(formatExemplarBlock(null), null);
});

test('returns null when exemplars is an empty array', () => {
  assert.equal(formatExemplarBlock([]), null);
});

test('returns null when exemplars is undefined', () => {
  assert.equal(formatExemplarBlock(undefined), null);
});

test('returns formatted block for a single exemplar with rule and reason', () => {
  const exemplars = [{ verdict: 'pass', rule: 'no-var', reason: 'ok' }];
  assert.equal(formatExemplarBlock(exemplars), "Recent adjudications for this same check (for calibration, not binding precedent):\n- [pass] no-var \u2014 prior disposition: ok");
});

test('returns formatted block for a single exemplar with identity and reason', () => {
  const exemplars = [{ verdict: 'fail', identity: 'check-1', reason: 'bad' }];
  assert.equal(formatExemplarBlock(exemplars), "Recent adjudications for this same check (for calibration, not binding precedent):\n- [fail] check-1 \u2014 prior disposition: bad");
});

test('returns formatted block for multiple exemplars', () => {
  const exemplars = [
    { verdict: 'pass', rule: 'r1', reason: 'a' },
    { verdict: 'fail', rule: 'r2', reason: 'b' },
  ];
  assert.equal(formatExemplarBlock(exemplars), "Recent adjudications for this same check (for calibration, not binding precedent):\n- [pass] r1 \u2014 prior disposition: a\n- [fail] r2 \u2014 prior disposition: b");
});

test('returns formatted block when exemplar has no rule or identity', () => {
  const exemplars = [{ verdict: 'warn', reason: 'note' }];
  assert.equal(formatExemplarBlock(exemplars), "Recent adjudications for this same check (for calibration, not binding precedent):\n- [warn] undefined \u2014 prior disposition: note");
});

test('returns formatted block for a long list of exemplars', () => {
  const exemplars = Array.from({ length: 5 }, (_, i) => ({
    verdict: 'pass',
    rule: `rule-${i}`,
    reason: `reason-${i}`,
  }));
  assert.equal(formatExemplarBlock(exemplars), "Recent adjudications for this same check (for calibration, not binding precedent):\n- [pass] rule-0 \u2014 prior disposition: reason-0\n- [pass] rule-1 \u2014 prior disposition: reason-1\n- [pass] rule-2 \u2014 prior disposition: reason-2\n- [pass] rule-3 \u2014 prior disposition: reason-3\n- [pass] rule-4 \u2014 prior disposition: reason-4");
});
