// Validates refutation arguments and returns a normalized refutation record (monitor/lane-confidence.mjs refuteBand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuteBand } from '../lane-confidence.mjs';

test('throws when detector is missing', () => {
  assert.throws(
    () => refuteBand({ detector: null, band: 'measured', reason: 'r' }),
    { name: 'Error', message: 'a refutation must name the detector whose band it contests' }
  );
});

test('throws when band is not a known band', () => {
  assert.throws(
    () => refuteBand({ detector: 'd', band: 'bogus', reason: 'r' }),
    { name: 'Error', message: "'bogus' is not one of the 7 bands" }
  );
});

test('throws when reason is empty string', () => {
  assert.throws(
    () => refuteBand({ detector: 'd', band: 'measured', reason: '' }),
    { name: 'Error', message: 'a refutation without a reason is a disagreement, not a refutation' }
  );
});

test('throws when reason is whitespace only', () => {
  assert.throws(
    () => refuteBand({ detector: 'd', band: 'measured', reason: '   ' }),
    { name: 'Error', message: 'a refutation without a reason is a disagreement, not a refutation' }
  );
});

test('returns record with by and at defaulted to null', () => {
  const r = refuteBand({ detector: 'd', band: 'measured', reason: 'r' });
  assert.deepEqual(r, { detector: "d", band: "measured", by: null, reason: "r", at: null });
});

test('returns record with by and at preserved', () => {
  const r = refuteBand({ detector: 'd', band: 'measured', reason: 'r', by: 'alice', at: '2024-01-01' });
  assert.deepEqual(r, { detector: "d", band: "measured", by: "alice", reason: "r", at: "2024-01-01" });
});

test('coerces non-string reason to string', () => {
  const r = refuteBand({ detector: 'd', band: 'measured', reason: 42 });
  assert.deepEqual(r, { detector: "d", band: "measured", by: null, reason: "42", at: null });
});

test('throws when reason is null', () => {
  assert.throws(
    () => refuteBand({ detector: 'd', band: 'measured', reason: null }),
    { name: 'Error', message: 'a refutation without a reason is a disagreement, not a refutation' }
  );
});
