// Parses a lane progress line into a structured event object (monitor/lane-progress.mjs parseLaneProgress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaneProgress } from '../lane-progress.mjs';

test('returns null for non-string input', () => {
  assert.equal(parseLaneProgress(42), null);
});

test('strips SGR reset code before matching lane tag', () => {
  assert.deepEqual(parseLaneProgress('\u001b[0m[lane]\tstart\trepo1\tcheck1\tpass\t100'), { event: "start", repo: "repo1", check: "check1", status: "pass", ms: 100 });
});

test('returns null when line does not start with lane tag', () => {
  assert.equal(parseLaneProgress('other\tstart\trepo1\tcheck1\tpass\t100'), null);
});

test('returns null for invalid event type', () => {
  assert.equal(parseLaneProgress('[lane]\tinvalid\trepo1\tcheck1\tpass\t100'), null);
});

test('returns null when check field is empty', () => {
  assert.equal(parseLaneProgress('[lane]\tstart\trepo1\t\tpass\t100'), null);
});

test('returns null when repo field is empty', () => {
  assert.deepEqual(parseLaneProgress('[lane]\tstart\t\tcheck1\tpass\t100'), { event: "start", repo: null, check: "check1", status: "pass", ms: 100 });
});

test('returns null when status field is empty', () => {
  assert.deepEqual(parseLaneProgress('[lane]\tstart\trepo1\tcheck1\t\t100'), { event: "start", repo: "repo1", check: "check1", status: null, ms: 100 });
});

test('returns null when ms field is empty string', () => {
  assert.deepEqual(parseLaneProgress('[lane]\tstart\trepo1\tcheck1\tpass\t'), { event: "start", repo: "repo1", check: "check1", status: "pass", ms: null });
});

test('returns null when ms field is non-numeric', () => {
  assert.deepEqual(parseLaneProgress('[lane]\tstart\trepo1\tcheck1\tpass\tabc'), { event: "start", repo: "repo1", check: "check1", status: "pass", ms: null });
});

test('returns parsed object with all fields populated', () => {
  assert.deepEqual(parseLaneProgress('[lane]\tstart\trepo1\tcheck1\tpass\t100'), { event: "start", repo: "repo1", check: "check1", status: "pass", ms: 100 });
});
