// Checks whether a schema field is pinned to a specific version (bin/lib/format-freeze.mjs schemaPinsVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaPinsVersion } from '../lib/format-freeze.mjs';

test('returns error when schema is null', () => {
  const r = schemaPinsVersion(null, 'version', '1.0');
  assert.equal(r, "the schema declares no 'version' property");
});

test('returns error when schema has no properties', () => {
  const r = schemaPinsVersion({}, 'version', '1.0');
  assert.equal(r, "the schema declares no 'version' property");
});

test('returns error when field is not in properties', () => {
  const r = schemaPinsVersion({ properties: {} }, 'version', '1.0');
  assert.equal(r, "the schema declares no 'version' property");
});

test('returns error when field is not required', () => {
  const r = schemaPinsVersion({ properties: { version: { const: '1.0' } }, required: [] }, 'version', '1.0');
  assert.equal(r, "the schema does not require 'version'");
});

test('returns error when field is not pinned', () => {
  const r = schemaPinsVersion({ properties: { version: {} }, required: ['version'] }, 'version', '1.0');
  assert.equal(r, "'version' is not pinned by const or a one-member enum");
});

test('returns null when const matches version', () => {
  const r = schemaPinsVersion({ properties: { version: { const: '1.0' } }, required: ['version'] }, 'version', '1.0');
  assert.equal(r, null);
});

test('returns error when const does not match version', () => {
  const r = schemaPinsVersion({ properties: { version: { const: '1.0' } }, required: ['version'] }, 'version', '2.0');
  assert.equal(r, "'version' is pinned to \"1.0\", not \"2.0\"");
});

test('returns null when one-member enum matches version', () => {
  const r = schemaPinsVersion({ properties: { version: { enum: ['1.0'] } }, required: ['version'] }, 'version', '1.0');
  assert.equal(r, null);
});

test('returns error when one-member enum does not match version', () => {
  const r = schemaPinsVersion({ properties: { version: { enum: ['1.0'] } }, required: ['version'] }, 'version', '2.0');
  assert.equal(r, "'version' is pinned to \"1.0\", not \"2.0\"");
});

test('returns error when multi-member enum is not pinned', () => {
  const r = schemaPinsVersion({ properties: { version: { enum: ['1.0', '2.0'] } }, required: ['version'] }, 'version', '1.0');
  assert.equal(r, "'version' is not pinned by const or a one-member enum");
});
