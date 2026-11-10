// Whether a named check is enabled in a scan config (bin/lib/scan-config.mjs checkEnabled).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnabled } from '../lib/scan-config.mjs';

test('returns true when the named check has enabled set to true', () => {
  const cfg = { checks: { lint: { enabled: true } } };
  assert.equal(checkEnabled(cfg, 'lint'), true);
});

test('returns true when the named check has no enabled property', () => {
  const cfg = { checks: { lint: {} } };
  assert.equal(checkEnabled(cfg, 'lint'), true);
});

test('returns false when the named check has enabled set to false', () => {
  const cfg = { checks: { lint: { enabled: false } } };
  assert.equal(checkEnabled(cfg, 'lint'), false);
});

test('returns true when the named check is absent from checks', () => {
  const cfg = { checks: { other: { enabled: false } } };
  assert.equal(checkEnabled(cfg, 'lint'), true);
});

test('returns true when the config has no checks object', () => {
  const cfg = {};
  assert.equal(checkEnabled(cfg, 'lint'), true);
});

test('returns true when the config is null', () => {
  assert.throws(() => checkEnabled(null, 'lint'), { name: "TypeError", message: "Cannot read properties of null (reading 'checks')" });
});

test('returns true when the config is undefined', () => {
  assert.throws(() => checkEnabled(undefined, 'lint'), { name: "TypeError", message: "Cannot read properties of undefined (reading 'checks')" });
});

test('returns true when the named check is null', () => {
  const cfg = { checks: { lint: null } };
  assert.equal(checkEnabled(cfg, 'lint'), true);
});
