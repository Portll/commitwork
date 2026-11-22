// A lane that runs in Docker, on a repository it applies to, with no Docker to run in, is a void
// one action clears: noscan and blocked, never `skipped — n/a`. The rollup counts n/a as a correct
// exclusion, so an n/a here reads a stopped daemon as a repository with nothing to scan.
// Measured 2026-11-22: deps-osv recorded n/a on this repository with Docker stopped, while
// container/requirements.txt pinned three packages under seven open advisories.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'commitwork.mjs');

function runWithoutDocker(check) {
  const T = mkdtempSync(join(tmpdir(), 'cw-docker-down-'));
  try {
    const repo = join(T, 'repo');
    mkdirSync(repo);
    writeFileSync(join(repo, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    const manifest = join(T, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ repo: 'fixture', checks: [check], groups: { all: [check.id] } }));
    const reports = join(T, 'reports');
    mkdirSync(reports);
    // No docker on PATH: lib/docker-reachable.mjs resolves no binary and reports the daemon down.
    // A private probe cache, so a cached "up" from this machine cannot answer for the test.
    const env = { ...process.env, PATH: dirname(process.execPath), CW_REPORT_DIR: reports,
      CW_DOCKER_PROBE_CACHE: join(T, 'probe.json'), DOCKER_HOST: '' };
    const r = spawnSync(process.execPath, [CLI, 'run', check.id, '--manifest', manifest, '--repo', repo],
      { env, encoding: 'utf8', timeout: 120000 });
    let status = null;
    try { status = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); } catch { /* asserted below */ }
    return { r, status };
  } finally { rmSync(T, { recursive: true, force: true }); }
}

test('a Docker lane that applies here, with Docker down, is a blocked void, never n/a', () => {
  const { r, status } = runWithoutDocker({ id: 'dock-lane', description: 'needs docker',
    requires: { docker: true }, appliesIfExists: ['./package-lock.json'], local: ['true'] });
  assert.ok(Array.isArray(status), `no checks-status.json written (exit ${r.status}): ${r.stderr.slice(0, 400)}`);
  const row = status.find((x) => x.check === 'dock-lane' || x.id === 'dock-lane');
  assert.ok(row, 'the lane has no status row');
  assert.equal(row.status, 'noscan', `recorded ${row.status} (${row.reason}): a stopped daemon is a void, not an exclusion`);
  assert.match(row.reason, /docker daemon not running/, 'the row names what to start');
  assert.equal(row.coverage, 'unknown');
  assert.match(row.coverageReason, /the Docker daemon it runs in is not running/);
  assert.doesNotMatch(String(row.reason), /^n\/a/);
  assert.match(r.stdout, /BLOCKED/, 'the run names it BLOCKED: starting Docker clears it');
});

test('a Docker lane whose trigger does not match stays n/a: the repository has nothing for it', () => {
  const { status } = runWithoutDocker({ id: 'dock-lane', description: 'needs docker',
    requires: { docker: true }, appliesIfExists: ['Cargo.lock'], local: ['true'] });
  const row = status.find((x) => x.check === 'dock-lane' || x.id === 'dock-lane');
  assert.equal(row.status, 'skip', 'skipped on the wire (monitor/check-vocabulary.mjs toWireStatus)');
  assert.match(row.reason, /^n\/a — none of Cargo\.lock present/);
});
