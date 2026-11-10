// explains why a feature is orphaned (bin/feature-census.mjs orphanReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orphanReason } from '../feature-census.mjs';

test('returns null for an http route that is wired', () => {
  const r = orphanReason({ surface: 'http-route', wired: true });
  assert.equal(r, null);
});

test('returns the orphan reason for an http route that is not wired', () => {
  const r = orphanReason({ surface: 'http-route', wired: false });
  assert.equal(r, "its route module is not spread into MODULAR_ROUTES, so nothing serves these paths");
});

test('returns null for a ui view that is reachable', () => {
  const r = orphanReason({ surface: 'ui-view', uiReachable: true });
  assert.equal(r, null);
});

test('returns the orphan reason for a ui view that is not reachable', () => {
  const r = orphanReason({ surface: 'ui-view', uiReachable: false });
  assert.equal(r, "no tab strip button, rail link or nav group reaches it");
});

test('returns null for an mcp tool that has a handler', () => {
  const r = orphanReason({ surface: 'mcp-tool', hasHandler: true });
  assert.equal(r, null);
});

test('returns the orphan reason for an mcp tool without a handler', () => {
  const r = orphanReason({ surface: 'mcp-tool', hasHandler: false });
  assert.equal(r, "a descriptor on the wire with no handler behind it");
});

test('returns null for a cli script guard that is referenced', () => {
  const r = orphanReason({ surface: 'cli-script', entryKind: 'guard', referencedFrom: ['a.mjs'] });
  assert.equal(r, null);
});

test('returns the orphan reason for a cli script guard with no references', () => {
  const r = orphanReason({ surface: 'cli-script', entryKind: 'guard', referencedFrom: [] });
  assert.equal(r, "no shebang, and no non-test file in the tree names it");
});

test('returns null for a config flag that is read in production', () => {
  const r = orphanReason({ surface: 'config-flag', readSites: 1 });
  assert.equal(r, null);
});

test('returns the orphan reason for a config flag read only from tests', () => {
  const r = orphanReason({ surface: 'config-flag', readSites: 0 });
  assert.equal(r, "read only from tests \u2014 nothing in production consults it");
});
