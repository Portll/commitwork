// Per-repository depth and intensity (monitor/repo-tuning.mjs, settings key repoTuning).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoLevels } from '../repo-tuning.mjs';
import { setSettings, resetSettingsWarnings } from '../settings.mjs';

let dir;
const KEYS = ['CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_SCAN_DEPTH', 'CW_SCAN_INTENSITY', 'CW_REPO_TUNING'];
const saved = {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-repo-tuning-'));
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CW_SETTINGS = join(dir, 'settings.json');
  resetSettingsWarnings();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(dir, { recursive: true, force: true });
});

test('with nothing stored every repository is at the declared defaults: depth 5, intensity 3', () => {
  const l = repoLevels('any');
  assert.equal(l.depth.value, 5);
  assert.equal(l.intensity.value, 3);
  assert.equal(l.overridden, false);
  assert.match(l.depth.source, /^fleet/);
});

test('a repository entry replaces only the fields it sets', () => {
  assert.equal(setSettings({ scanDepth: 4, repoTuning: { alpha: { depth: 2 } } }, { who: 'test' }).ok, true);
  const a = repoLevels('alpha');
  assert.equal(a.depth.value, 2);
  assert.match(a.depth.source, /^repository/);
  assert.equal(a.depth.fleet, 4);
  assert.equal(a.intensity.value, 3);
  assert.match(a.intensity.source, /^fleet/);
  assert.equal(repoLevels('beta').depth.value, 4);
});

test('the env shadow is read at call time', () => {
  process.env.CW_REPO_TUNING = JSON.stringify({ alpha: { intensity: 1 } });
  assert.equal(repoLevels('alpha').intensity.value, 1);
});

test('malformed tables are refused on write, naming the row', () => {
  const bad = [
    [{ alpha: {} }, /sets neither/],
    [{ alpha: { depth: 6 } }, /alpha\.depth/],
    [{ alpha: { depth: '3' } }, /alpha\.depth/],
    [{ alpha: { speed: 1 } }, /unknown field/],
    [{ '../x': { depth: 1 } }, /not a repository name/],
    [[], /must be an object/],
  ];
  for (const [v, re] of bad) {
    const r = setSettings({ repoTuning: v }, { who: 'test' });
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.match(r.errors.join(' '), re);
  }
});

test('a corrupt stored table falls back to the fleet and says so', () => {
  writeFileSync(process.env.CW_SETTINGS, JSON.stringify({ v: 1, settings: { repoTuning: { value: { alpha: { depth: 9 } } } } }));
  const l = repoLevels('alpha');
  assert.equal(l.depth.value, 5);
  assert.ok(l.notes.some((n) => /repoTuning/.test(n)));
});
