// Detects vendored package name and version from file banner text (bin/vendor-scan.mjs identify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify } from '../vendor-scan.mjs';

test('returns null for empty string input', () => {
  const r = identify('', 'file.js');
  assert.deepEqual(r, null);
});

test('returns null for null input', () => {
  const r = identify(null, 'file.js');
  assert.deepEqual(r, null);
});

test('returns null for undefined input', () => {
  const r = identify(undefined, 'file.js');
  assert.deepEqual(r, null);
});

test('returns null for text with no matching banner', () => {
  const r = identify('some random text without any library banners', 'file.js');
  assert.deepEqual(r, null);
});

test('identifies three.js with deep search past banner bytes', () => {
  const r = identify('x'.repeat(4096) + 'three.js r147', 'file.js');
  assert.deepEqual(r, { package: "three", version: "0.147.0", ecosystem: "npm", via: "banner" });
});

test('identifies jquery from banner in head', () => {
  const r = identify('/*! jQuery JavaScript Library v3.6.0 */', 'file.js');
  assert.deepEqual(r, { package: "jquery", version: "3.6.0", ecosystem: "npm", via: "banner" });
});

test('identifies bootstrap from banner in head', () => {
  const r = identify('/*! Bootstrap v5.2.3 */', 'file.js');
  assert.deepEqual(r, { package: "bootstrap", version: "5.2.3", ecosystem: "npm", via: "banner" });
});

test('identifies lodash from banner in head', () => {
  const r = identify('/*! lodash v4.17.21 */', 'file.js');
  assert.deepEqual(r, { package: "lodash", version: "4.17.21", ecosystem: "npm", via: "banner" });
});

test('identifies axios from banner in head', () => {
  const r = identify('/*! axios/1.4.0 */', 'file.js');
  assert.deepEqual(r, { package: "axios", version: "1.4.0", ecosystem: "npm", via: "banner" });
});

test('identifies generic UMD bundle via pkg fallback', () => {
  const r = identify('/*! mylib v2.1.0 */', 'file.js');
  assert.deepEqual(r, { package: "mylib", version: "2.1.0", ecosystem: "npm", via: "banner" });
});
