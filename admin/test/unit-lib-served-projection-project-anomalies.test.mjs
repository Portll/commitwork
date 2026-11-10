// Projects artifact-anomaly records into a sanitized served projection (admin/lib/served-projection.mjs projectAnomalies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectAnomalies } from '../lib/served-projection.mjs';

test('returns never-measured when input is null', () => {
  assert.deepEqual(projectAnomalies(null), { state: 'never-measured' });
});

test('returns never-measured when state is absent', () => {
  assert.deepEqual(projectAnomalies({ state: 'absent' }), { state: 'never-measured' });
});

test('returns unreadable with truncated detail when state is unreadable', () => {
  const detail = 'x'.repeat(50);
  const result = projectAnomalies({ state: 'unreadable', detail });
  assert.equal(result.state, 'unreadable');
  assert.equal(result.detail, 'x'.repeat(40));
});

test('returns unreadable with not-an-array when data is not an array', () => {
  const result = projectAnomalies({ state: 'measured', data: 'string' });
  assert.equal(result.state, 'unreadable');
  assert.equal(result.detail, 'not-an-array');
});

test('projects a single anomaly with all fields present', () => {
  const input = {
    state: 'measured',
    data: [{
      category: 'large-file',
      hash: 'abcdef1234567890',
      repoCount: 5,
      bytes: 1024,
      repos: ['repo-a', 'repo-b'],
      truncated: 2
    }]
  };
  const result = projectAnomalies(input);
  assert.equal(result.state, 'measured');
  assert.equal(result.count, 1);
  assert.equal(result.anomalies.length, 1);
  const a = result.anomalies[0];
  assert.equal(a.category, 'large-file');
  assert.equal(a.hash, "abcdef123456");
  assert.equal(a.repoCount, 5);
  assert.equal(a.bytes, 1024);
  assert.deepEqual(a.repos, ['repo-a', 'repo-b']);
  assert.equal(a.truncated, 2);
});

test('truncates repos to 20 and adds overflow to truncated count', () => {
  const repos = Array.from({ length: 25 }, (_, i) => 'repo-' + i);
  const input = {
    state: 'measured',
    data: [{
      category: 'many-repos',
      hash: '1234567890ab',
      repoCount: 25,
      bytes: 500,
      repos,
      truncated: 0
    }]
  };
  const result = projectAnomalies(input);
  const a = result.anomalies[0];
  assert.equal(a.repos.length, 20);
  assert.equal(a.truncated, 5);
});

test('handles missing repos array by using empty array', () => {
  const input = {
    state: 'measured',
    data: [{
      category: 'no-repos',
      hash: 'fedcba098765',
      repoCount: 0,
      bytes: 0,
      truncated: 1
    }]
  };
  const result = projectAnomalies(input);
  const a = result.anomalies[0];
  assert.deepEqual(a.repos, []);
  assert.equal(a.truncated, 1);
});

test('sets repoCount and bytes to null when not finite numbers', () => {
  const input = {
    state: 'measured',
    data: [{
      category: 'bad-nums',
      hash: '111111111111',
      repoCount: 'five',
      bytes: Infinity,
      repos: ['r1'],
      truncated: 0
    }]
  };
  const result = projectAnomalies(input);
  const a = result.anomalies[0];
  assert.equal(a.repoCount, null);
  assert.equal(a.bytes, null);
  assert.equal(a.truncated, 0);
});

test('truncates category to 80 chars and hash to 12 chars', () => {
  const input = {
    state: 'measured',
    data: [{
      category: 'c'.repeat(100),
      hash: 'h'.repeat(20),
      repoCount: 1,
      bytes: 10,
      repos: [],
      truncated: 0
    }]
  };
  const result = projectAnomalies(input);
  const a = result.anomalies[0];
  assert.equal(a.category, 'c'.repeat(80));
  assert.equal(a.hash, 'h'.repeat(12));
});

test('filters out non-string repos and truncates each to 120 chars', () => {
  const repos = [123, 'valid', null, 'y'.repeat(150), undefined];
  const input = {
    state: 'measured',
    data: [{
      category: 'mixed',
      hash: 'aaaa11112222',
      repoCount: 2,
      bytes: 100,
      repos,
      truncated: 0
    }]
  };
  const result = projectAnomalies(input);
  const a = result.anomalies[0];
  assert.equal(a.repos.length, 2);
  assert.equal(a.repos[0], 'valid');
  assert.equal(a.repos[1], 'y'.repeat(120));
  assert.equal(a.truncated, 0);
});
