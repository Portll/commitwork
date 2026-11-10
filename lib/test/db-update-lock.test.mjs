// lib/db-update-lock.mjs — one database update per scanner at a time, none while fresh, staging cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearGrypeStaging, grypeCacheDir, updateOnce } from '../db-update-lock.mjs';

const NOW = Date.parse('2026-10-22T06:00:00Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'cw-db-update-'));

test('an update runs once, and a second inside the fresh window is skipped', () => {
  const dir = tmp();
  let runs = 0;
  const update = () => { runs++; return { status: 0 }; };
  assert.deepEqual(updateOnce('grype', update, { dir, now: NOW }), { ran: true, status: 0 });
  assert.deepEqual(updateOnce('grype', update, { dir, now: NOW + 3600_000 }), { ran: false, why: 'updated 60 min ago' });
  assert.equal(updateOnce('grype', update, { dir, now: NOW + 7 * 3600_000 }).ran, true);
  assert.equal(runs, 2);
});

test('a failed update stamps nothing, so the next one runs', () => {
  const dir = tmp();
  assert.deepEqual(updateOnce('trivy', () => ({ status: 1 }), { dir, now: NOW }), { ran: true, status: 1 });
  assert.equal(updateOnce('trivy', () => ({ status: 0 }), { dir, now: NOW + 60_000 }).ran, true);
});

test('a live holder is waited out by skipping; a dead holder\'s lock is reclaimed', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'grype.lock'));
  writeFileSync(join(dir, 'grype.lock', 'pid'), '4242');
  const ok = () => ({ status: 0 });
  assert.deepEqual(updateOnce('grype', ok, { dir, now: NOW, alive: () => true }), { ran: false, why: 'another update holds the lock (pid 4242)' });
  assert.deepEqual(updateOnce('grype', ok, { dir, now: NOW, alive: () => false }), { ran: true, status: 0 });
  assert.equal(existsSync(join(dir, 'grype.lock')), false, 'the lock is released');
});

test('the holder clears staging copies older than an hour and leaves the database and recent copies', () => {
  const cacheDir = tmp();
  for (const n of ['6', 'grype-db-download1', 'grype-db-download2']) mkdirSync(join(cacheDir, n));
  const old = (NOW - 2 * 3600_000) / 1000;
  utimesSync(join(cacheDir, 'grype-db-download1'), old, old);
  utimesSync(join(cacheDir, 'grype-db-download2'), NOW / 1000, NOW / 1000);
  let gone = null;
  updateOnce('grype', () => ({ status: 0 }), { dir: tmp(), now: NOW, after: ({ now }) => { gone = clearGrypeStaging({ cacheDir, now }); } });
  assert.deepEqual(gone, ['grype-db-download1']);
  assert.deepEqual([existsSync(join(cacheDir, '6')), existsSync(join(cacheDir, 'grype-db-download2'))], [true, true]);
});

test('grype\'s cache directory follows its override, then the platform default', () => {
  assert.equal(grypeCacheDir({ GRYPE_DB_CACHE_DIR: '/x' }, 'darwin'), '/x');
  assert.match(grypeCacheDir({}, 'darwin'), /Library\/Caches\/grype\/db$/);
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: '/c' }, 'linux'), '/c/grype/db');
});
