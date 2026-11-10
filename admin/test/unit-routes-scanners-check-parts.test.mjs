// Extracts tool, image, and npx package references from a check definition (admin/routes/scanners.mjs checkParts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkParts } from '../routes/scanners.mjs';

test('returns empty arrays when check has no local, requires, or images', () => {
  const result = checkParts({});
  assert.deepEqual(result, { tools: [], images: [], npx: [] });
});

test('returns empty arrays when local is not an array', () => {
  const result = checkParts({ local: 'not an array' });
  assert.deepEqual(result, { tools: [], images: [], npx: [] });
});

test('extracts tools from requires.tools when it is an array', () => {
  const result = checkParts({ local: ['line1'], requires: { tools: ['eslint', 'prettier'] } });
  assert.deepEqual(result.tools, ['eslint', 'prettier']);
});

test('returns empty tools when requires.tools is not an array', () => {
  const result = checkParts({ local: ['line1'], requires: { tools: 'eslint' } });
  assert.deepEqual(result.tools, []);
});

test('returns empty tools when requires is present but has no tools key', () => {
  const result = checkParts({ local: ['line1'], requires: { other: 'value' } });
  assert.deepEqual(result.tools, []);
});

test('filters images to only those found in the joined local text', () => {
  const result = checkParts({ local: ['run docker image-a', 'run docker image-b'] }, ['image-a', 'image-b', 'image-c']);
  assert.deepEqual(result.images, ['image-a', 'image-b']);
});

test('returns empty images when no image appears in the text', () => {
  const result = checkParts({ local: ['no images here'] }, ['image-a', 'image-b']);
  assert.deepEqual(result.images, []);
});

test('extracts unique npx package names from local lines', () => {
  const result = checkParts({ local: ['npx eslint@8.0.0', 'npx eslint@8.0.0', 'npx prettier@3.1.0'] });
  assert.deepEqual(result.npx, ['eslint@8.0.0', 'prettier@3.1.0']);
});

test('extracts scoped npx package names', () => {
  const result = checkParts({ local: ['npx @babel/eslint-parser@7.20.0'] });
  assert.deepEqual(result.npx, ['@babel/eslint-parser@7.20.0']);
});

test('handles npx with --yes flag before package name', () => {
  const result = checkParts({ local: ['npx --yes eslint@8.0.0'] });
  assert.deepEqual(result.npx, ['eslint@8.0.0']);
});
