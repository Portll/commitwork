// Selects direct updates and lockfile/advisory flags from an audit report and policy (bin/lib/npm-update.mjs selectFromAudit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFromAudit } from '../lib/npm-update.mjs';

test('returns empty direct and false flags when no deps and no lockfile or advisories in policy', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['patch'], dev: ['minor'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: false, advisories: false });
});

test('returns empty direct and true lockfile flag when lockfile in prod but not dev', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['lockfile'], dev: ['patch'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: true, advisories: false });
});

test('returns empty direct and true advisories flag when advisories in dev but not prod', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['patch'], dev: ['advisories'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: false, advisories: true });
});

test('returns empty direct and false flags when lockfile in prod and dev but not advisories', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['lockfile'], dev: ['lockfile'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: true, advisories: false });
});

test('returns empty direct and true flags when both lockfile and advisories in prod and dev', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['lockfile', 'advisories'], dev: ['lockfile', 'advisories'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: true, advisories: true });
});

test('returns empty direct and false flags when lockfile in prod and advisories in dev', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['lockfile'], dev: ['advisories'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: true, advisories: true });
});

test('returns empty direct and true lockfile flag when lockfile in both prod and dev', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['lockfile'], dev: ['lockfile'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: true, advisories: false });
});

test('returns empty direct and false flags when no lockfile or advisories in either prod or dev', () => {
  const report = { deps: [] };
  const policy = { update: { prod: ['patch', 'minor'], dev: ['major'] } };
  const r = selectFromAudit(report, policy);
  assert.deepEqual(r, { direct: [], lockfile: false, advisories: false });
});
