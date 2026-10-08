import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spineStorePath } from '../spine-store-path.mjs';

function withEnv(vars, fn) {
  const keys = ['HOME', 'SPINE_TASKS_DB', 'SUBSTRATE_TASKS_DB'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const home = (stores) => {
  const h = mkdtempSync(join(tmpdir(), 'cw-spine-home-'));
  for (const dir of stores) { mkdirSync(join(h, dir)); writeFileSync(join(h, dir, 'tasks.db'), ''); }
  return h;
};

test('SPINE_TASKS_DB outranks SUBSTRATE_TASKS_DB, and either outranks the homes', () => {
  const h = home(['.spine', '.substrate']);
  try {
    assert.equal(withEnv({ HOME: h, SPINE_TASKS_DB: '/a.db', SUBSTRATE_TASKS_DB: '/b.db' }, spineStorePath), '/a.db');
    assert.equal(withEnv({ HOME: h, SUBSTRATE_TASKS_DB: '/b.db' }, spineStorePath), '/b.db');
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('a box holding only the legacy store reads it, and one holding both reads ~/.spine', () => {
  const legacyOnly = home(['.substrate']);
  const both = home(['.spine', '.substrate']);
  try {
    assert.equal(withEnv({ HOME: legacyOnly }, spineStorePath), join(legacyOnly, '.substrate', 'tasks.db'));
    assert.equal(withEnv({ HOME: both }, spineStorePath), join(both, '.spine', 'tasks.db'));
  } finally { for (const h of [legacyOnly, both]) rmSync(h, { recursive: true, force: true }); }
});

test('with no store at all the answer is ~/.spine, so absence is reported at the current home', () => {
  const none = home([]);
  try {
    assert.equal(withEnv({ HOME: none }, spineStorePath), join(none, '.spine', 'tasks.db'));
  } finally { rmSync(none, { recursive: true, force: true }); }
});
