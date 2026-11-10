// Computes the report directory name for a given area slug or registry (monitor/area.mjs outNameFor).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outNameFor } from '../area.mjs';

test('returns areaOut result when a slug is provided', () => {
  const reg = { monitorOutput: 'unused', areas: [] };
  const result = outNameFor('my-area', reg);
  assert.strictEqual(result, 'my-area');
});

test('returns monitorOutput when slug is falsy and monitorOutput is set', () => {
  const reg = { monitorOutput: 'custom-output', areas: [] };
  const result = outNameFor(undefined, reg);
  assert.strictEqual(result, 'custom-output');
});

test('throws with specific message when no slug, no monitorOutput, and no primary area', () => {
  const reg = { monitorOutput: undefined, areas: [] };
  assert.throws(() => outNameFor(undefined, reg), /area: cannot resolve a report directory \u2014 monitor\/projects\.json declares no areas\[\] and no monitorOutput\. Declare an area \(primary:true\), pass an area slug, or set CW_MONITOR_OUT\./);
});

test('returns areaOut of primary area when slug is falsy and no monitorOutput', () => {
  const reg = { monitorOutput: undefined, areas: [{ slug: 'primary-area', primary: true }] };
  const result = outNameFor(null, reg);
  assert.strictEqual(result, 'primary-area');
});

test('returns monitorOutput when slug is empty string and monitorOutput is set', () => {
  const reg = { monitorOutput: 'fallback', areas: [] };
  const result = outNameFor('', reg);
  assert.strictEqual(result, 'fallback');
});

test('returns areaOut of primary area when slug is empty string and no monitorOutput', () => {
  const reg = { monitorOutput: undefined, areas: [{ slug: 'main', primary: true }] };
  const result = outNameFor('', reg);
  assert.strictEqual(result, 'main');
});

test('throws when slug is falsy, monitorOutput is empty string, and no primary area', () => {
  const reg = { monitorOutput: '', areas: [] };
  assert.throws(() => outNameFor(undefined, reg), /area: cannot resolve a report directory \u2014 monitor\/projects\.json declares no areas\[\] and no monitorOutput\. Declare an area \(primary:true\), pass an area slug, or set CW_MONITOR_OUT\./);
});

test('returns areaOut result when slug is a non-empty string', () => {
  const reg = { monitorOutput: 'should-not-use', areas: [] };
  const result = outNameFor('another-slug', reg);
  assert.strictEqual(result, 'another-slug');
});
