// Maps a finding row and its category to a normalized severity level and source (monitor/daily.mjs severityOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { severityOf } from '../daily.mjs';

test('returns critical severity from row when sev is crit', () => {
  const result = severityOf({ sev: 'crit' }, 'other');
  assert.deepEqual(result, { severity: 'critical', severitySource: 'row' });
});

test('returns critical severity from row when severity is critical', () => {
  const result = severityOf({ severity: 'critical' }, 'other');
  assert.deepEqual(result, { severity: 'critical', severitySource: 'row' });
});

test('returns high severity from row when sev is error', () => {
  const result = severityOf({ sev: 'error' }, 'other');
  assert.deepEqual(result, { severity: 'high', severitySource: 'row' });
});

test('returns medium severity from row when sev is warning', () => {
  const result = severityOf({ sev: 'warning' }, 'other');
  assert.deepEqual(result, { severity: 'medium', severitySource: 'row' });
});

test('returns low severity from row when sev is note', () => {
  const result = severityOf({ sev: 'note' }, 'other');
  assert.deepEqual(result, { severity: 'low', severitySource: 'row' });
});

test('returns info severity from row when sev is info', () => {
  const result = severityOf({ sev: 'info' }, 'other');
  assert.deepEqual(result, { severity: 'info', severitySource: 'row' });
});

test('returns high severity from category default when category is secrets and row has no severity', () => {
  const result = severityOf({}, 'secrets');
  assert.deepEqual(result, { severity: 'high', severitySource: 'category-default' });
});

test('returns high severity from category default when category is secretsHistory and row has no severity', () => {
  const result = severityOf({}, 'secretsHistory');
  assert.deepEqual(result, { severity: 'high', severitySource: 'category-default' });
});

test('returns high severity from category default when category is mainframeSecrets and row has no severity', () => {
  const result = severityOf({}, 'mainframeSecrets');
  assert.deepEqual(result, { severity: 'high', severitySource: 'category-default' });
});

test('returns low severity from category default when category is not in secret categories and row has no severity', () => {
  const result = severityOf({}, 'other');
  assert.deepEqual(result, { severity: 'low', severitySource: 'category-default' });
});
