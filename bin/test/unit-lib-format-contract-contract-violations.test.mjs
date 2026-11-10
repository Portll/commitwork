// Detects manifest checks whose declared format lacks a committed reader branch (bin/lib/format-contract.mjs contractViolations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractViolations } from '../lib/format-contract.mjs';

const src = `export const PARSED_FORMATS = new Set(['a','b'])
export const PASSTHROUGH_FORMATS = new Set(['c'])
if (format === 'a') { parseA() }
`;

test('returns a single unverifiable record when the reader source lacks the format declarations', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ id: 'x', report: { format: 'a' } }] } }], 'no declarations here'), [{ manifest: "-", check: "-", format: "-", why: "could not find PARSED_FORMATS / PASSTHROUGH_FORMATS in the reader \u2014 the contract is unverifiable, which is not the same as satisfied" }]);
});

test('returns an empty array when every declared format is known and parsed formats have reader branches', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ id: 'x', report: { format: 'a' } }, { id: 'y', report: { format: 'c' } }] } }], src), []);
});

test('reports a violation when a declared format is absent from both parsed and passthrough sets', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ id: 'x', report: { format: 'zzz' } }] } }], src), [{ manifest: "m1", check: "x", format: "zzz", why: "declares format 'zzz' \u2014 no committed reader; it will fall through to the generic pass-through and score GREEN whatever the report holds" }]);
});

test('reports a violation when a parsed format has no matching branch in the reader source', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ id: 'x', report: { format: 'b' } }] } }], src), [{ manifest: "m1", check: "x", format: "b", why: "is in PARSED_FORMATS but the committed reader has no `format === 'b'` branch \u2014 the set entry is a declaration, not a parser" }]);
});

test('skips checks that have no report object', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ id: 'x' }] } }], src), []);
});

test('skips checks whose report object has no format property', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ id: 'x', report: {} }] } }], src), []);
});

test('uses a placeholder for the check id when it is missing', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: { checks: [{ report: { format: 'zzz' } }] } }], src), [{ manifest: "m1", check: "?", format: "zzz", why: "declares format 'zzz' \u2014 no committed reader; it will fall through to the generic pass-through and score GREEN whatever the report holds" }]);
});

test('handles manifests with a null json value without throwing', () => {
  assert.deepEqual(contractViolations([{ path: 'm1', json: null }], src), []);
});
