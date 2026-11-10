import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, RunnerConfigError, defaultLabels, loadConfig, validateConfig } from '../config.mjs';

const EXAMPLE = new URL('../runner.example.json', import.meta.url).pathname;
const base = () => ({ repos: [{ repo: 'example-owner/example-private' }], slots: [{ id: 'slot-1', cpus: 4, memGb: 6 }] });
const refuses = (raw, code, pattern) => assert.throws(() => validateConfig(raw, { arch: 'arm64' }), (e) => {
  assert.ok(e instanceof RunnerConfigError);
  assert.equal(e.code, code);
  if (pattern) assert.match(e.message, pattern);
  return true;
});

test('CW_RUNNER_CONFIG is read at call time, after import', (t) => {
  const prior = process.env.CW_RUNNER_CONFIG;
  t.after(() => { if (prior === undefined) delete process.env.CW_RUNNER_CONFIG; else process.env.CW_RUNNER_CONFIG = prior; });
  process.env.CW_RUNNER_CONFIG = EXAMPLE;
  const config = loadConfig({ arch: 'arm64' });
  assert.deepEqual(config.repos.map((r) => r.repo), ['example-owner/example-private', 'example-owner/example-public']);
  assert.deepEqual(config.repos[1].labels, ['self-hosted', 'linux', 'arm64', 'commitwork', 'scan']);
  assert.deepEqual(config.repos[0].labels, config.labels, 'a repo without labels takes the global set');
  assert.equal(config.slots.length, 2);
});

test('an unknown key is refused by name, at every level', () => {
  refuses({ ...base(), pollsec: 30 }, 'config-unknown-key', /config\.pollsec/);
  refuses({ ...base(), repos: [{ repo: 'a/b', token: 'x' }] }, 'config-unknown-key', /config\.repos\[0\]\.token/);
  refuses({ ...base(), slots: [{ id: 'slot-1', cpus: 1, memGb: 1, gpu: 1 }] }, 'config-unknown-key', /slots\[0\]\.gpu/);
});

test('labels default to self-hosted, linux, the architecture and commitwork', () => {
  assert.deepEqual(validateConfig(base(), { arch: 'x64' }).labels, ['self-hosted', 'linux', 'x64', 'commitwork']);
  assert.deepEqual(defaultLabels('arm64'), ['self-hosted', 'linux', 'arm64', 'commitwork']);
  assert.throws(() => defaultLabels('ia32'), (e) => e.code === 'config-arch');
});

test('a label set without commitwork or self-hosted is refused', () => {
  refuses({ ...base(), labels: ['self-hosted', 'linux'] }, 'config-labels', /commitwork/);
  refuses({ ...base(), repos: [{ repo: 'a/b', labels: ['commitwork'] }] }, 'config-labels', /self-hosted/);
});

test('shape faults are named: repo form, duplicates, slot ids, numbers', () => {
  refuses({ ...base(), repos: [{ repo: 'no-slash' }] }, 'config-repos');
  refuses({ ...base(), repos: [] }, 'config-repos');
  refuses({ ...base(), repos: [{ repo: 'A/b' }, { repo: 'a/B' }] }, 'config-duplicate');
  refuses({ ...base(), slots: [{ id: 'Slot 1', cpus: 1, memGb: 1 }] }, 'config-slots');
  refuses({ ...base(), slots: [{ id: 's', cpus: 0, memGb: 1 }] }, 'config-number');
  refuses({ ...base(), pollSec: 2 }, 'config-number');
  refuses([], 'config-shape');
});

test('pollSec and staleRunnerSec default when absent', () => {
  const c = validateConfig(base(), { arch: 'arm64' });
  assert.equal(c.pollSec, DEFAULTS.pollSec);
  assert.equal(c.staleRunnerSec, DEFAULTS.staleRunnerSec);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.repos[0]));
});

test('absent and unparseable files are distinct named errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-runner-config-'));
  assert.throws(() => loadConfig({ path: join(dir, 'none.json') }), (e) => e.code === 'config-absent');
  writeFileSync(join(dir, 'bad.json'), '{ not json');
  assert.throws(() => loadConfig({ path: join(dir, 'bad.json') }), (e) => e.code === 'config-unparseable');
});

test('actors default to the repository owner; a top-level or per-repo list overrides it', () => {
  const owner = validateConfig(base(), { arch: 'arm64' });
  assert.deepEqual(owner.repos[0].actors, ['example-owner']);
  const top = validateConfig({ ...base(), actors: ['Example-Owner', 'helper'] }, { arch: 'arm64' });
  assert.deepEqual(top.repos[0].actors, ['example-owner', 'helper']);
  const per = validateConfig({ ...base(), actors: ['helper'], repos: [{ repo: 'example-owner/example-private', actors: ['solo'] }] }, { arch: 'arm64' });
  assert.deepEqual(per.repos[0].actors, ['solo']);
  refuses({ ...base(), actors: [] }, 'config-actors');
  refuses({ ...base(), actors: ['not a login'] }, 'config-actors');
});
