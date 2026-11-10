// areaRepos computes the exposure join for one area slug (monitor/registry.mjs areaRepos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaRepos } from '../registry.mjs';

test('areaRepos throws a TypeError when repos is not an array', () => {
  assert.throws(() => areaRepos('web', { areas: [] }, { repos: null }), {
    name: 'TypeError',
    message: 'areaRepos: `repos` is required \u2014 pass resolveRepos(reg, \u2026).repos. Defaulting it would report every area as not-scanned and make a forgotten argument look like a finding.',
  });
});

test('areaRepos returns unmapped with null area for an invalid slug', () => {
  const r = areaRepos('Bad Slug', { areas: [] }, { repos: [] });
  assert.deepEqual(r, { area: "Bad Slug", declared: false, out: null, repos: [], count: 0, status: "unmapped", reason: "'Bad Slug' is not a valid area slug (/^[a-z0-9][a-z0-9-]*$/)" });
});

test('areaRepos returns unmapped with empty string area for a null slug', () => {
  const r = areaRepos(null, { areas: [] }, { repos: [] });
  assert.deepEqual(r, { area: null, declared: false, out: null, repos: [], count: 0, status: "unmapped", reason: "'' is not a valid area slug (/^[a-z0-9][a-z0-9-]*$/)" });
});

test('areaRepos returns mapped when a repo resolves into the area', () => {
  const reg = { areas: [{ slug: 'web' }], projects: [{ name: 'web-app', area: 'web' }] };
  const repos = [{ name: 'web-app', area: 'web' }];
  const r = areaRepos('web', reg, { repos });
  assert.deepEqual(r, { area: "web", declared: true, out: "web", repos: [{ name: "web-app", area: "web" }], count: 1, status: "mapped", reason: "1 repo(s) resolve to area 'web'" });
});

test('areaRepos returns not-scanned for a declared area with no repos', () => {
  const reg = { areas: [{ slug: 'infra' }] };
  const r = areaRepos('infra', reg, { repos: [] });
  assert.deepEqual(r, { area: "infra", declared: true, out: "infra", repos: [], count: 0, status: "not-scanned", reason: "area 'infra' is declared and NO repo resolves into it \u2014 nothing scans it, so nothing is known. This is not \"clean\"." });
});

test('areaRepos returns not-scanned with deploy note for a deploy-only area', () => {
  const reg = { areas: [{ slug: 'deploy', deploy: true }] };
  const r = areaRepos('deploy', reg, { repos: [] });
  assert.deepEqual(r, { area: "deploy", declared: true, out: "deploy", repos: [], count: 0, status: "not-scanned", reason: "area 'deploy' is declared (deploy-only: it publishes hostnames but declares no code) and NO repo resolves into it \u2014 nothing scans it, so nothing is known. This is not \"clean\"." });
});

test('areaRepos returns unmapped for an undeclared area with no repos', () => {
  const reg = { areas: [{ slug: 'web' }] };
  const r = areaRepos('ghost', reg, { repos: [] });
  assert.deepEqual(r, { area: "ghost", declared: false, out: null, repos: [], count: 0, status: "unmapped", reason: "no areas[] block declares 'ghost' and no repo resolves into it" });
});

test('areaRepos returns mapped when a repo matches via areaOf fallback', () => {
  const reg = { areas: [{ slug: 'web' }] };
  const repos = [{ name: 'web' }];
  const r = areaRepos('web', reg, { repos });
  assert.deepEqual(r, { area: "web", declared: true, out: "web", repos: [{ name: "web" }], count: 1, status: "mapped", reason: "1 repo(s) resolve to area 'web'" });
});
