// Resolves the grype vulnerability database cache directory path (lib/db-update-lock.mjs grypeCacheDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grypeCacheDir } from '../db-update-lock.mjs';
import { dirname, join } from 'node:path';

function homeFromLinuxDefault() {
  return dirname(dirname(dirname(grypeCacheDir({}, 'linux'))));
}

test('returns GRYPE_DB_CACHE_DIR verbatim on linux even when XDG_CACHE_HOME is set', () => {
  const env = { GRYPE_DB_CACHE_DIR: '/custom//grype/', XDG_CACHE_HOME: '/xdg' };
  assert.equal(grypeCacheDir(env, 'linux'), '/custom//grype/');
});

test('returns GRYPE_DB_CACHE_DIR on darwin instead of the Library Caches path', () => {
  assert.equal(grypeCacheDir({ GRYPE_DB_CACHE_DIR: '/override' }, 'darwin'), '/override');
});

test('an empty GRYPE_DB_CACHE_DIR falls through to the XDG_CACHE_HOME path', () => {
  const env = { GRYPE_DB_CACHE_DIR: '', XDG_CACHE_HOME: '/xdg' };
  assert.equal(grypeCacheDir(env, 'linux'), '/xdg/grype/db');
});

test('appends grype/db to XDG_CACHE_HOME on linux', () => {
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: '/home/user/.cache' }, 'linux'), '/home/user/.cache/grype/db');
});

test('normalizes a trailing slash in XDG_CACHE_HOME on win32', () => {
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: '/xdg/' }, 'win32'), '/xdg/grype/db');
});

test('treats a capitalized Darwin platform as non-darwin and uses XDG_CACHE_HOME', () => {
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: '/xdg' }, 'Darwin'), '/xdg/grype/db');
});

test('keeps a relative XDG_CACHE_HOME relative', () => {
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: 'cache' }, 'linux'), 'cache/grype/db');
});

test('darwin uses Library/Caches/grype/db under the same home as the linux .cache default', () => {
  const linux = grypeCacheDir({}, 'linux');
  const home = dirname(dirname(dirname(linux)));
  assert.equal(linux, join(home, '.cache', 'grype', 'db'));
  assert.equal(grypeCacheDir({}, 'darwin'), join(home, 'Library', 'Caches', 'grype', 'db'));
});

test('darwin ignores XDG_CACHE_HOME and still uses the Library Caches path', () => {
  const home = homeFromLinuxDefault();
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: '/xdg' }, 'darwin'), join(home, 'Library', 'Caches', 'grype', 'db'));
});

test('an empty XDG_CACHE_HOME falls back to the home .cache directory', () => {
  const home = homeFromLinuxDefault();
  assert.equal(grypeCacheDir({ XDG_CACHE_HOME: '' }, 'linux'), join(home, '.cache', 'grype', 'db'));
});
