// spineStorePath follows spine's own resolution order, so the panel reads the store spine writes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spineStorePath } from '../lib/overwatch-layer-read.mjs';

const KEYS = ['HOME', 'SPINE_TASKS_DB', 'SUBSTRATE_TASKS_DB'];
let home, saved;
const store = (dir) => { mkdirSync(join(home, dir), { recursive: true }); writeFileSync(join(home, dir, 'tasks.db'), ''); };

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  home = mkdtempSync(join(tmpdir(), 'cw-spine-store-'));
  process.env.HOME = home;
  delete process.env.SPINE_TASKS_DB;
  delete process.env.SUBSTRATE_TASKS_DB;
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(home, { recursive: true, force: true });
});

test('SPINE_TASKS_DB wins, then the legacy SUBSTRATE_TASKS_DB', () => {
  process.env.SUBSTRATE_TASKS_DB = '/legacy.db';
  assert.equal(spineStorePath(), '/legacy.db');
  process.env.SPINE_TASKS_DB = '/spine.db';
  assert.equal(spineStorePath(), '/spine.db');
});

test('a moved store is read from ~/.spine, even when the old one is still on disk', () => {
  store('.spine');
  store('.substrate');
  assert.equal(spineStorePath(), join(home, '.spine', 'tasks.db'));
});

test('an unmoved store is still read from ~/.substrate', () => {
  store('.substrate');
  assert.equal(spineStorePath(), join(home, '.substrate', 'tasks.db'));
});

test('with neither on disk, a new store belongs in ~/.spine', () => {
  assert.equal(spineStorePath(), join(home, '.spine', 'tasks.db'));
});
