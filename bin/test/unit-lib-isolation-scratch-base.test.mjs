// Real path of the private commitwork boundary cache directory, created on demand (bin/lib/isolation.mjs scratchBase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scratchBase } from '../lib/isolation.mjs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scratchBase-'));
  try {
    fn(dir, realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function guarded(dir) {
  return {
    mkdirSync(p, o) {
      if (typeof p !== 'string' || !p.startsWith(`${dir}/`)) throw new Error(`outside ${p}`);
      return mkdirSync(p, o);
    },
    realpathSync,
  };
}

test('creates home/.cache/commitwork/boundary on linux without XDG_CACHE_HOME and returns its real path', () => {
  inTmp((dir, base) => {
    mkdirSync(join(dir, 'home'));
    const r = scratchBase({ home: join(dir, 'home'), env: {}, platform: 'linux' });
    assert.equal(r, join(base, 'home', '.cache', 'commitwork', 'boundary'));
    assert.deepEqual(readdirSync(join(dir, 'home', '.cache', 'commitwork')), ['boundary']);
    assert.deepEqual(readdirSync(r), []);
  });
});

test('returns the boundary directory when it already exists', () => {
  inTmp((dir, base) => {
    mkdirSync(join(dir, 'home', '.cache', 'commitwork', 'boundary'), { recursive: true });
    const r = scratchBase({ home: join(dir, 'home'), env: {}, platform: 'darwin' });
    assert.equal(r, join(base, 'home', '.cache', 'commitwork', 'boundary'));
  });
});

test('uses an absolute XDG_CACHE_HOME on linux instead of home/.cache', () => {
  inTmp((dir, base) => {
    mkdirSync(join(dir, 'home'));
    mkdirSync(join(dir, 'xdg'));
    const r = scratchBase({ home: join(dir, 'home'), env: { XDG_CACHE_HOME: join(dir, 'xdg') }, platform: 'linux' });
    assert.equal(r, join(base, 'xdg', 'commitwork', 'boundary'));
    assert.equal(existsSync(join(dir, 'home', '.cache')), false);
  });
});

test('ignores an absolute XDG_CACHE_HOME on darwin and uses home/.cache', () => {
  inTmp((dir, base) => {
    mkdirSync(join(dir, 'home'));
    mkdirSync(join(dir, 'xdg'));
    const r = scratchBase({ home: join(dir, 'home'), env: { XDG_CACHE_HOME: join(dir, 'xdg') }, platform: 'darwin' });
    assert.equal(r, join(base, 'home', '.cache', 'commitwork', 'boundary'));
    assert.equal(existsSync(join(dir, 'xdg', 'commitwork')), false);
  });
});

test('ignores a relative XDG_CACHE_HOME on linux and uses home/.cache', () => {
  inTmp((dir, base) => {
    mkdirSync(join(dir, 'home'));
    const r = scratchBase({ fs: guarded(dir), home: join(dir, 'home'), env: { XDG_CACHE_HOME: 'xdg' }, platform: 'linux' });
    assert.equal(r, join(base, 'home', '.cache', 'commitwork', 'boundary'));
  });
});

test('ignores a non-string XDG_CACHE_HOME on linux and uses home/.cache', () => {
  inTmp((dir, base) => {
    mkdirSync(join(dir, 'home'));
    const r = scratchBase({ fs: guarded(dir), home: join(dir, 'home'), env: { XDG_CACHE_HOME: 42 }, platform: 'linux' });
    assert.equal(r, join(base, 'home', '.cache', 'commitwork', 'boundary'));
  });
});

test('returns null when home is not a string', () => {
  inTmp((dir) => {
    mkdirSync(join(dir, 'xdg'));
    const r = scratchBase({ fs: guarded(dir), home: 123, env: { XDG_CACHE_HOME: join(dir, 'xdg') }, platform: 'linux' });
    assert.equal(r, null);
    assert.equal(existsSync(join(dir, 'xdg', 'commitwork')), false);
  });
});

test('returns null for a home without a leading slash and creates nothing', () => {
  inTmp((dir) => {
    mkdirSync(join(dir, 'xdg'));
    const r = scratchBase({ fs: guarded(dir), home: 'home', env: { XDG_CACHE_HOME: join(dir, 'xdg') }, platform: 'linux' });
    assert.equal(r, null);
    assert.equal(existsSync(join(dir, 'xdg', 'commitwork')), false);
  });
});

test('returns null when process.getuid is not a function', () => {
  inTmp((dir) => {
    mkdirSync(join(dir, 'home'));
    const saved = process.getuid;
    process.getuid = undefined;
    try {
      const r = scratchBase({ fs: guarded(dir), home: join(dir, 'home'), env: {}, platform: 'linux' });
      assert.equal(r, null);
    } finally {
      process.getuid = saved;
    }
    assert.equal(existsSync(join(dir, 'home', '.cache')), false);
  });
});

test('returns null when creating or resolving the directory throws', () => {
  inTmp((dir) => {
    const home = join(dir, 'home');
    const failMkdir = { mkdirSync() { throw new Error('EACCES'); }, realpathSync };
    assert.equal(scratchBase({ fs: failMkdir, home, env: {}, platform: 'linux' }), null);
    const failReal = { mkdirSync() {}, realpathSync() { throw new Error('ENOENT'); } };
    assert.equal(scratchBase({ fs: failReal, home, env: {}, platform: 'linux' }), null);
  });
});
