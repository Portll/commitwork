// Renders a verdict record into the evidence string shown to the LLM rater (bin/rate-llm.mjs evidenceFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFor } from '../rate-llm.mjs';

test('renders absent gate, when, and commit fields as none recorded', () => {
  const r = evidenceFor({}, undefined);
  assert.deepEqual(r, "GATE: (none recorded)\nWHEN: (none recorded)\nCOMMIT: (none recorded)\n\nDid the gate make the right call?");
});

test('renders present gate, when, and commit fields verbatim', () => {
  const r = evidenceFor({ gate: 'gate-tests', at: '2024-01-01', headSha: 'abc123' }, undefined);
  assert.deepEqual(r, "GATE: gate-tests\nWHEN: 2024-01-01\nCOMMIT: abc123\nThe stored floor it compared against: undefined failing / undefined passing.\nWhat it measured in the working tree: undefined failing / undefined passing.\n\nDid the gate make the right call?");
});

test('renders null gate, when, and commit fields as none recorded', () => {
  const r = evidenceFor({ gate: null, at: null, headSha: null }, undefined);
  assert.deepEqual(r, "GATE: (none recorded)\nWHEN: (none recorded)\nCOMMIT: (none recorded)\n\nDid the gate make the right call?");
});

test('renders empty string gate, when, and commit fields as none recorded', () => {
  const r = evidenceFor({ gate: '', at: '', headSha: '' }, undefined);
  assert.deepEqual(r, "GATE: (none recorded)\nWHEN: (none recorded)\nCOMMIT: (none recorded)\n\nDid the gate make the right call?");
});

test('includes baseline and measured counts for gate-tests with headFail and committed', () => {
  const r = evidenceFor({
    gate: 'gate-tests',
    at: '2024-01-01',
    headSha: 'abc',
    baseline: { fail: 2, pass: 10 },
    fail: 3,
    pass: 10,
    headFail: 1,
    committed: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    names: ['x', 'y', 'z', 'w', 'v', 'u', 't']
  }, undefined);
  assert.deepEqual(r, "GATE: gate-tests\nWHEN: 2024-01-01\nCOMMIT: abc\nThe stored floor it compared against: 2 failing / 10 passing.\nWhat it measured in the working tree: 3 failing / 10 passing.\nWhat it measured at a pristine checkout of the commit: 1 failing.\nTests it recorded as failing in COMMITTED code: a; b; c; d; e; f\nTests it recorded as failing: x; y; z; w; v; u\n\nDid the gate make the right call?");
});

test('omits headFail line when headFail is not a number', () => {
  const r = evidenceFor({
    gate: 'gate-tests',
    at: '2024-01-01',
    headSha: 'abc',
    baseline: { fail: 1, pass: 5 },
    fail: 2,
    pass: 5,
    headFail: 'not-a-number',
    committed: ['only-one'],
    names: ['n1', 'n2']
  }, undefined);
  assert.deepEqual(r, "GATE: gate-tests\nWHEN: 2024-01-01\nCOMMIT: abc\nThe stored floor it compared against: 1 failing / 5 passing.\nWhat it measured in the working tree: 2 failing / 5 passing.\nTests it recorded as failing in COMMITTED code: only-one\nTests it recorded as failing: n1; n2\n\nDid the gate make the right call?");
});

test('includes metrics branch when gate is not gate-tests', () => {
  const r = evidenceFor({
    gate: 'gate-lint',
    at: '2024-01-01',
    headSha: 'def',
    baseline: { errors: 3 },
    metrics: { errors: 1 }
  }, undefined);
  assert.deepEqual(r, "GATE: gate-lint\nWHEN: 2024-01-01\nCOMMIT: def\nStored floor: {\"errors\":3}\nMeasured: {\"errors\":1}\n\nDid the gate make the right call?");
});

test('includes independent re-measurement block when provided', () => {
  const r = evidenceFor(
    { gate: 'gate-tests', at: '2024-01-01', headSha: 'ghi', baseline: { fail: 0, pass: 5 }, fail: 0, pass: 5 },
    're-measured: 0 failing / 5 passing'
  );
  assert.deepEqual(r, "GATE: gate-tests\nWHEN: 2024-01-01\nCOMMIT: ghi\nThe stored floor it compared against: 0 failing / 5 passing.\nWhat it measured in the working tree: 0 failing / 5 passing.\n\nINDEPENDENT RE-MEASUREMENT, taken later at that same commit, run twice with agreement required:\n  re-measured: 0 failing / 5 passing\n\nDid the gate make the right call?");
});

test('omits committed and names lines when arrays are empty', () => {
  const r = evidenceFor({
    gate: 'gate-tests',
    at: '2024-01-01',
    headSha: 'jkl',
    baseline: { fail: 1, pass: 2 },
    fail: 1,
    pass: 2,
    headFail: 0,
    committed: [],
    names: []
  }, undefined);
  assert.deepEqual(r, "GATE: gate-tests\nWHEN: 2024-01-01\nCOMMIT: jkl\nThe stored floor it compared against: 1 failing / 2 passing.\nWhat it measured in the working tree: 1 failing / 2 passing.\nWhat it measured at a pristine checkout of the commit: 0 failing.\n\nDid the gate make the right call?");
});

test('slices committed and names to first six entries when longer', () => {
  const committed = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const names = Array.from({ length: 10 }, (_, i) => `n${i}`);
  const r = evidenceFor({
    gate: 'gate-tests',
    at: '2024-01-01',
    headSha: 'mno',
    baseline: { fail: 5, pass: 5 },
    fail: 5,
    pass: 5,
    headFail: 2,
    committed,
    names
  }, undefined);
  assert.deepEqual(r, "GATE: gate-tests\nWHEN: 2024-01-01\nCOMMIT: mno\nThe stored floor it compared against: 5 failing / 5 passing.\nWhat it measured in the working tree: 5 failing / 5 passing.\nWhat it measured at a pristine checkout of the commit: 2 failing.\nTests it recorded as failing in COMMITTED code: c0; c1; c2; c3; c4; c5\nTests it recorded as failing: n0; n1; n2; n3; n4; n5\n\nDid the gate make the right call?");
});
