// Computes a record-integrity verdict from unparseable and step counts (bin/lib/turn-gate-core.mjs recordIntegrity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordIntegrity } from '../lib/turn-gate-core.mjs';

test('returns unknown when both unparseable and steps are non-finite', () => {
  const r = recordIntegrity({ unparseable: 'abc', steps: 'xyz' });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "unknown", reason: "the reader did not report parse counts", evidence: { unparseable: null, steps: null }, policy: {} });
});

test('returns unknown when unparseable is non-finite but steps is finite', () => {
  const r = recordIntegrity({ unparseable: 'abc', steps: 5 });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "unknown", reason: "the reader did not report parse counts", evidence: { unparseable: null, steps: null }, policy: {} });
});

test('returns unknown when steps is non-finite but unparseable is finite', () => {
  const r = recordIntegrity({ unparseable: 0, steps: 'xyz' });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "unknown", reason: "the reader did not report parse counts", evidence: { unparseable: null, steps: null }, policy: {} });
});

test('returns unknown when steps is zero', () => {
  const r = recordIntegrity({ unparseable: 0, steps: 0 });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "unknown", reason: "no records read \u2014 an absent or empty transcript is not a clean session", evidence: { unparseable: 0, steps: 0 }, policy: {} });
});

test('returns unknown when steps is one', () => {
  const r = recordIntegrity({ unparseable: 0, steps: 1 });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "pass", reason: "1 records read, none unparseable", evidence: { unparseable: 0, steps: 1 }, policy: {} });
});

test('returns unknown when unparseable is one', () => {
  const r = recordIntegrity({ unparseable: 1, steps: 10 });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "unknown", reason: "1 unparseable line(s): the denominator is unknown, so every rate over it is a guess", evidence: { unparseable: 1, steps: 10 }, policy: {} });
});

test('returns pass when unparseable is zero and steps is positive', () => {
  const r = recordIntegrity({ unparseable: 0, steps: 10 });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "pass", reason: "10 records read, none unparseable", evidence: { unparseable: 0, steps: 10 }, policy: {} });
});

test('returns unknown when unparseable is zero and steps is two', () => {
  const r = recordIntegrity({ unparseable: 0, steps: 2 });
  assert.deepEqual(r, { rule: "record-integrity", verdict: "pass", reason: "2 records read, none unparseable", evidence: { unparseable: 0, steps: 2 }, policy: {} });
});
