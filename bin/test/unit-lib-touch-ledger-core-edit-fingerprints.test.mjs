// Computes {h, n, t} fingerprints for a tool edit event (bin/lib/touch-ledger-core.mjs editFingerprints).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editFingerprints } from '../lib/touch-ledger-core.mjs';

test('returns empty object when tool_input is undefined', () => {
  const r = editFingerprints({ tool_name: 'Edit' });
  assert.deepEqual(r, {});
});

test('returns empty object when tool_input is null', () => {
  const r = editFingerprints({ tool_name: 'Edit', tool_input: null });
  assert.deepEqual(r, {});
});

test('returns empty object when tool_name is undefined', () => {
  const r = editFingerprints({ tool_input: { old_string: 'a' } });
  assert.deepEqual(r, { h: "ca978112ca1b", t: "edit" });
});

test('returns empty object when tool_name is null', () => {
  const r = editFingerprints({ tool_name: null, tool_input: { old_string: 'a' } });
  assert.deepEqual(r, { h: "ca978112ca1b", t: "edit" });
});

test('returns empty object when tool_name is empty string', () => {
  const r = editFingerprints({ tool_name: '', tool_input: { old_string: 'a' } });
  assert.deepEqual(r, { h: "ca978112ca1b", t: "edit" });
});

test('returns notebook type when tool_name matches notebook and no notebook_path', () => {
  const r = editFingerprints({ tool_name: 'NotebookEdit', tool_input: { old_string: 'a', new_string: 'b' } });
  assert.deepEqual(r, { h: "ca978112ca1b", n: "3e23e8160039", t: "notebook" });
});

test('returns notebook type when notebook_path is present and tool_name does not match', () => {
  const r = editFingerprints({ tool_name: 'Edit', tool_input: { notebook_path: '/nb.ipynb', old_string: 'a', new_string: 'b' } });
  assert.deepEqual(r, { h: "ca978112ca1b", n: "3e23e8160039", t: "notebook" });
});

test('returns edit type when old_string is present and no notebook indicators', () => {
  const r = editFingerprints({ tool_name: 'Edit', tool_input: { old_string: 'a', new_string: 'b' } });
  assert.deepEqual(r, { h: "ca978112ca1b", n: "3e23e8160039", t: "edit" });
});

test('returns write type when content is present and no old_string or notebook indicators', () => {
  const r = editFingerprints({ tool_name: 'Write', tool_input: { content: 'hello' } });
  assert.deepEqual(r, { n: "2cf24dba5fb0", t: "write" });
});

test('returns empty object when all input fields are undefined', () => {
  const r = editFingerprints({ tool_name: 'Edit', tool_input: {} });
  assert.deepEqual(r, {});
});
