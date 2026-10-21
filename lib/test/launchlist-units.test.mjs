// lib/test/launchlist-units.test.mjs — case tests for safeSlug, projectsInStore, digestEvidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSlug, projectsInStore, digestEvidence } from '../launchlist.mjs';

test('returns a valid slug unchanged', () => {
  assert.equal(safeSlug('my-project'), 'my-project');
});

test('returns a valid slug with dots and underscores', () => {
  assert.equal(safeSlug('a.b_c'), 'a.b_c');
});

test('returns a single character slug', () => {
  assert.equal(safeSlug('a'), 'a');
});

test('returns a 100-character slug', () => {
  const s = 'a'.repeat(100);
  assert.equal(safeSlug(s), s);
});

test('throws on empty string', () => {
  assert.throws(() => safeSlug(''), /not a project slug/);
});

test('throws on null input', () => {
  assert.throws(() => safeSlug(null), /not a project slug/);
});

test('throws on undefined input', () => {
  assert.throws(() => safeSlug(undefined), /not a project slug/);
});

test('throws on slug with double dot', () => {
  assert.throws(() => safeSlug('a..b'), /not a project slug/);
});

test('throws on slug starting with dot', () => {
  assert.throws(() => safeSlug('.hidden'), /not a project slug/);
});

test('throws on slug with space', () => {
  assert.throws(() => safeSlug('my project'), /not a project slug/);
});

test('throws on slug with slash', () => {
  assert.throws(() => safeSlug('a/b'), /not a project slug/);
});

test('throws on 101-character slug', () => {
  const s = 'a'.repeat(101);
  assert.throws(() => safeSlug(s), /not a project slug/);
});

test('returns empty array when both config and state are empty', () => {
  const config = { projects: {} };
  const state = { items: {}, ticks: {} };
  assert.deepEqual(projectsInStore(config, state), []);
});

test('returns sorted project names from config only', () => {
  const config = { projects: { beta: {}, alpha: {} } };
  const state = { items: {}, ticks: {} };
  assert.deepEqual(projectsInStore(config, state), ['alpha', 'beta']);
});

test('returns sorted project names from state.items only', () => {
  const config = { projects: {} };
  const state = { items: { zeta: [], gamma: [] }, ticks: {} };
  assert.deepEqual(projectsInStore(config, state), ['gamma', 'zeta']);
});

test('returns sorted project names from state.ticks only', () => {
  const config = { projects: {} };
  const state = { items: {}, ticks: { delta: {}, epsilon: {} } };
  assert.deepEqual(projectsInStore(config, state), ['delta', 'epsilon']);
});

test('merges and deduplicates names from config, items, and ticks', () => {
  const config = { projects: { foo: {} } };
  const state = { items: { bar: [] }, ticks: { foo: {}, baz: {} } };
  assert.deepEqual(projectsInStore(config, state), ['bar', 'baz', 'foo']);
});

test('handles missing projects, items, or ticks keys gracefully', () => {
  const config = {};
  const state = {};
  assert.deepEqual(projectsInStore(config, state), []);
});

test('returns sorted unique names when all sources have overlapping keys', () => {
  const config = { projects: { app: {} } };
  const state = { items: { app: [], web: [] }, ticks: { app: {}, web: {}, api: {} } };
  assert.deepEqual(projectsInStore(config, state), ['api', 'app', 'web']);
});

test('returns null for null input', () => {
  assert.equal(digestEvidence(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(digestEvidence(undefined), null);
});

test('returns 16-char hex string for valid result', () => {
  const result = { status: 'pass', summary: 'ok', evidence: ['a', 'b'] };
  const digest = digestEvidence(result);
  assert.equal(typeof digest, 'string');
  assert.equal(digest.length, 16);
  assert.match(digest, /^[0-9a-f]{16}$/);
});

test('different evidence arrays produce different digests', () => {
  const r1 = { status: 'pass', summary: 'ok', evidence: ['a'] };
  const r2 = { status: 'pass', summary: 'ok', evidence: ['b'] };
  assert.notEqual(digestEvidence(r1), digestEvidence(r2));
});

test('missing evidence field is treated as empty array', () => {
  const r1 = { status: 'pass', summary: 'ok' };
  const r2 = { status: 'pass', summary: 'ok', evidence: [] };
  assert.equal(digestEvidence(r1), digestEvidence(r2));
});

test('different status values produce different digests', () => {
  const r1 = { status: 'pass', summary: 'ok', evidence: [] };
  const r2 = { status: 'fail', summary: 'ok', evidence: [] };
  assert.notEqual(digestEvidence(r1), digestEvidence(r2));
});

test('different summary values produce different digests', () => {
  const r1 = { status: 'pass', summary: 'all good', evidence: [] };
  const r2 = { status: 'pass', summary: 'all bad', evidence: [] };
  assert.notEqual(digestEvidence(r1), digestEvidence(r2));
});
