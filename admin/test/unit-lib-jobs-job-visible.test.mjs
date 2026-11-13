// Whether a job is visible for a given scope (admin/lib/jobs.mjs jobVisible).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobVisible, jobs } from '../lib/jobs.mjs';

test('returns true when kind has no job record', () => {
  const kind = 'unknown-kind';
  const scope = { fleet: false, names: new Set() };
  const result = jobVisible(kind, scope);
  assert.equal(result, true);
});

test('returns true for scan-path kind with job record', () => {
  const kind = 'scan-path';
  jobs[kind] = { fleet: false, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set() };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, true);
});

test('returns false for non-scan-path job with fleet true and project defined when scope.fleet false', () => {
  const kind = 'kind3';
  jobs[kind] = { fleet: true, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set() };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, false);
});

test('returns true for job with fleet true and project defined when scope.fleet true', () => {
  const kind = 'kind4';
  jobs[kind] = { fleet: true, project: 'proj', repo: 'repo' };
  const scope = { fleet: true, names: new Set() };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, true);
});

test('returns true for job with fleet false and no project when scope.fleet true', () => {
  const kind = 'kind5';
  jobs[kind] = { fleet: false, project: undefined, repo: undefined };
  const scope = { fleet: true, names: new Set() };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, true);
});

test('returns false for job with project not in names and repo not in names', () => {
  const kind = 'kind6';
  jobs[kind] = { fleet: false, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set(['other']) };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, false);
});

test('returns true for job with project in names and repo not in names', () => {
  const kind = 'kind7';
  jobs[kind] = { fleet: false, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set(['proj']) };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, true);
});

test('returns true for job with repo in names and project not in names', () => {
  const kind = 'kind8';
  jobs[kind] = { fleet: false, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set(['repo']) };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, true);
});

test('returns false for job without a repo when only an empty repo name is in scope', () => {
  const kind = 'kind9';
  jobs[kind] = { fleet: false, project: 'proj', repo: '' };
  const scope = { fleet: false, names: new Set(['']) };
  const result = jobVisible(kind, scope);
  delete jobs[kind];
  assert.equal(result, false);
});
