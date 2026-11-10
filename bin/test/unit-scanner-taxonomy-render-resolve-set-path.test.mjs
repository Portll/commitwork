// Maps a declared set path to an absolute path, or to a missing-input reason when its $CW_ base is unavailable (bin/scanner-taxonomy-render.mjs resolveSetPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSetPath } from '../scanner-taxonomy-render.mjs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'resolveSetPath-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    return fn(dir, repo);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[name] = saved;
    else delete process.env[name];
  }
}

test('a plain relative path is resolved against the repo root', () => {
  withDir((dir, repo) => {
    const r = resolveSetPath('src/index.js', repo);
    assert.deepEqual(r, { path: join(repo, 'src', 'index.js') });
  });
});

test('a dollar prefix that is not CW_ followed by uppercase is treated as a plain path', () => {
  withDir((dir, repo) => {
    assert.deepEqual(resolveSetPath('$HOME/x.json', repo), { path: join(repo, '$HOME', 'x.json') });
    assert.deepEqual(resolveSetPath('$CW_lower/x.json', repo), { path: join(repo, '$CW_lower', 'x.json') });
    assert.deepEqual(resolveSetPath('$CW_EMPTY/', repo), { path: join(repo, '$CW_EMPTY') });
  });
});

test('an unset variable other than CW_SIDECAR reports that it has no default', () => {
  withDir((dir, repo) => {
    withEnv('CW_CUSTOM', undefined, () => {
      const r = resolveSetPath('$CW_CUSTOM/data.json', repo);
      assert.deepEqual(r, { path: null, why: 'missing input: CW_CUSTOM is unset and has no default' });
    });
  });
});

test('a variable set to the empty string counts as unset and has no default', () => {
  withDir((dir, repo) => {
    withEnv('CW_CUSTOM', '', () => {
      const r = resolveSetPath('$CW_CUSTOM/data.json', repo);
      assert.deepEqual(r, { path: null, why: 'missing input: CW_CUSTOM is unset and has no default' });
    });
  });
});

test('an unset CW_SIDECAR whose sibling default directory is missing reports the default path', () => {
  withDir((dir, repo) => {
    withEnv('CW_SIDECAR', undefined, () => {
      const r = resolveSetPath('$CW_SIDECAR/config.yaml', repo);
      const def = join(dir, 'commitwork-sidecar');
      assert.deepEqual(r, { path: null, why: `missing input: CW_SIDECAR is unset and its default ${def} does not exist` });
    });
  });
});

test('an unset CW_SIDECAR resolves against the existing sibling commitwork-sidecar directory', () => {
  withDir((dir, repo) => {
    const sidecar = join(dir, 'commitwork-sidecar');
    mkdirSync(sidecar, { recursive: true });
    withEnv('CW_SIDECAR', undefined, () => {
      const r = resolveSetPath('$CW_SIDECAR/config.yaml', repo);
      assert.deepEqual(r, { path: join(sidecar, 'config.yaml') });
    });
  });
});

test('a set variable naming an existing directory resolves the rest against it', () => {
  withDir((dir, repo) => {
    const base = join(dir, 'custom-base');
    mkdirSync(base, { recursive: true });
    withEnv('CW_CUSTOM', base, () => {
      assert.deepEqual(resolveSetPath('$CW_CUSTOM/data.json', repo), { path: join(base, 'data.json') });
      assert.deepEqual(resolveSetPath('$CW_CUSTOM/a/../b.json', repo), { path: join(base, 'b.json') });
    });
  });
});

test('a set CW_SIDECAR overrides the sibling default', () => {
  withDir((dir, repo) => {
    const base = join(dir, 'other-sidecar');
    mkdirSync(base, { recursive: true });
    withEnv('CW_SIDECAR', base, () => {
      const r = resolveSetPath('$CW_SIDECAR/config.yaml', repo);
      assert.deepEqual(r, { path: join(base, 'config.yaml') });
    });
  });
});

test('a set variable naming a missing directory reports the path it names', () => {
  withDir((dir, repo) => {
    const base = join(dir, 'nonexistent-base');
    withEnv('CW_CUSTOM', base, () => {
      const r = resolveSetPath('$CW_CUSTOM/data.json', repo);
      assert.deepEqual(r, { path: null, why: `missing input: CW_CUSTOM names ${base}, which does not exist` });
    });
  });
});
