// Computes a package specifier string from an advisory object (monitor/remediation-pr.mjs bumpSpec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpSpec } from '../remediation-pr.mjs';

test('returns module at to when bump has module and to', () => {
  const r = bumpSpec({ bump: { module: 'lodash', to: '4.17.21' } });
  assert.equal(r, "lodash@4.17.21");
});

test('returns empty string when bump is missing', () => {
  const r = bumpSpec({});
  assert.equal(r, "");
});

test('returns empty string when bump has module but no to', () => {
  const r = bumpSpec({ bump: { module: 'lodash' } });
  assert.equal(r, "");
});

test('returns empty string when bump has to but no module', () => {
  const r = bumpSpec({ bump: { to: '4.17.21' } });
  assert.equal(r, "");
});

test('returns package at fixed when package and fixed are present', () => {
  const r = bumpSpec({ package: 'express', fixed: '4.18.2' });
  assert.equal(r, "express@4.18.2");
});

test('returns empty string when package is present but fixed is missing', () => {
  const r = bumpSpec({ package: 'express' });
  assert.equal(r, "");
});

test('returns empty string when fixed is present but package is missing', () => {
  const r = bumpSpec({ fixed: '4.18.2' });
  assert.equal(r, "");
});

test('returns empty string when adv is null', () => {
  const r = bumpSpec(null);
  assert.equal(r, "");
});

test('returns empty string when adv is undefined', () => {
  const r = bumpSpec(undefined);
  assert.equal(r, "");
});
