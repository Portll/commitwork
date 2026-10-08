// The secret lanes skip commitwork's declared-synthetic corpora ONLY when the scan target is
// commitwork itself, identified by root commit. A scanned repository must not be able to choose its
// own blind spots, so the same paths in any other repository have to stay scanned.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suffixFor } from '../scan-config-suffix.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const M = (f) => readFileSync(join(CW, 'manifests', f), 'utf8');
const have = (bin) => spawnSync(bin, ['version'], { encoding: 'utf8' }).status === 0;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' } });
const lane = (id) => JSON.parse(M('security-baseline.json')).checks.find((c) => c.id === id).local[0];
// assembled at run time so this source carries no provider-shaped token
const PLANT = `gh: ${['ghp', '_'].join('')}${'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5'.slice(0, 36)}\n`;

function plantedRepo(rootFrom) {
  const d = mkdtempSync(join(tmpdir(), 'cw-self-'));
  if (rootFrom) {
    const root = git(CW, 'rev-list', '--max-parents=0', 'HEAD').stdout.trim().split('\n')[0];
    git(d, 'init', '-q');
    const f = git(d, 'fetch', '-q', CW, root);
    assert.equal(f.status, 0, f.stderr);
    git(d, 'checkout', '-q', '-b', 'x', 'FETCH_HEAD');
  } else {
    git(d, 'init', '-q');
    writeFileSync(join(d, 'README'), 'unrelated repository\n');
    git(d, 'add', '.'); git(d, 'commit', '-q', '-m', 'init');
  }
  for (const p of ['fixtures/scan-canary/dirty', 'monitor/test/fixtures']) {
    mkdirSync(join(d, p), { recursive: true });
    writeFileSync(join(d, p, 'x.txt'), PLANT);
  }
  return d;
}

function runLane(id, target, report) {
  const out = mkdtempSync(join(tmpdir(), 'cw-rep-'));
  const r = spawnSync('sh', ['-c', lane(id)], { cwd: target, encoding: 'utf8',
    env: { ...process.env, CW_ROOT: CW, CW_REPORT_DIR: out } });
  assert.equal(r.status, 0, r.stderr);
  const raw = readFileSync(join(out, report), 'utf8').trim();
  if (!raw) return [];
  const j = JSON.parse(raw);
  return Array.isArray(j) ? j : [j];
}

describe('self-only scan configuration', () => {
  test('the fleet files name no commitwork path', () => {
    for (const f of ['gitleaks.toml']) {
      assert.doesNotMatch(M(f), /scan-canary|secrets-canary|monitor\/test\/fixtures|secrets-sweep\\\.test/, f);
    }
  });

  test('the self copies still contain the fleet scope verbatim', () => {
    assert.ok(M('gitleaks.self.toml').includes(M('gitleaks.toml')), 'gitleaks.self.toml drifted from gitleaks.toml');
    assert.ok(M('betterleaks.self.toml').includes(M('gitleaks.self.toml')), 'betterleaks.self.toml drifted from gitleaks.self.toml');
  });

  test('every trufflehog self exclusion is an anchored regex', () => {
    const lines = M('trufflehog-exclude.self.txt').split('\n').filter((l) => l && !l.startsWith('#'));
    assert.ok(lines.length > 0);
    for (const l of lines) { assert.ok(l.startsWith('^'), l); assert.doesNotThrow(() => new RegExp(l)); }
  });

  test('(b) commitwork itself gets the self config', () => {
    assert.equal(suffixFor(CW, CW), '.self');
  });

  test('a repository with another root commit, or no git, gets the fleet config', () => {
    assert.equal(suffixFor(plantedRepo(false), CW), '');
    assert.equal(suffixFor(mkdtempSync(join(tmpdir(), 'cw-nogit-')), CW), '');
    assert.equal(suffixFor(CW, mkdtempSync(join(tmpdir(), 'cw-nogit-'))), '', 'an unreadable reference is not a match');
  });

  test('(a) gitleaks lane: another repository still finds a value planted under the self-only paths', (t) => {
    if (!have('gitleaks')) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed');
    const rows = runLane('secrets-gitleaks', plantedRepo(false), 'gitleaks.json');
    const files = rows.map((f) => f.File);
    assert.ok(files.some((f) => f.startsWith('fixtures/scan-canary/dirty/')), JSON.stringify(files));
    assert.ok(files.some((f) => f.startsWith('monitor/test/fixtures/')), JSON.stringify(files));
  });

  test('(b) gitleaks lane: a repository with commitwork\'s root commit skips them', (t) => {
    if (!have('gitleaks')) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed');
    const d = plantedRepo(true);
    const files = runLane('secrets-gitleaks', d, 'gitleaks.json').map((f) => f.File);
    assert.deepEqual(files.filter((f) => /^(fixtures\/scan-canary\/dirty|monitor\/test\/fixtures)\//.test(f)), [],
      'control for the test above: the self config must differ from the fleet one');
  });

  test('(a) trufflehog and betterleaks lanes pick the fleet files for another repository', () => {
    for (const id of ['secrets', 'secrets-betterleaks']) {
      const c = lane(id);
      assert.match(c, /scan-config-suffix\.mjs/, id);
      assert.match(c, /\|\| true\)/, `${id}: an identity failure must fall back, not abort`);
    }
  });
});
