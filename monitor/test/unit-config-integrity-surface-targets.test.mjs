// The list of config files and symlink paths to check for tampering (monitor/config-integrity.mjs surfaceTargets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceTargets } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaults(home) {
  return [
    { path: join(REPO, '.claude', 'settings.json'), kind: 'config' },
    { path: join(REPO, '.claude', 'settings.local.json'), kind: 'config' },
    { path: join(home, '.claude', 'settings.json'), kind: 'config' },
    { path: join(home, '.commitwork', 'secrets.json'), kind: 'config' },
    { path: join(REPO, 'evaluations'), kind: 'symlink' },
    { path: join(REPO, '.claude', 'store'), kind: 'symlink' },
    { path: join(REPO, '.claude', 'verdicts'), kind: 'symlink' },
  ];
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function inTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'surfaceTargets-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the parsed array from the CW_CONFINT_TARGETS fixture file unchanged', () => {
  inTmp((dir) => {
    const fixture = join(dir, 'targets.json');
    const data = [{ path: '/a', kind: 'config' }, { path: '/b', kind: 'symlink' }, 1, 'two', null];
    writeFileSync(fixture, JSON.stringify(data), 'utf8');
    const r = withEnv({ CW_CONFINT_TARGETS: fixture }, () => surfaceTargets(join(dir, 'home')));
    assert.deepEqual(r, [{ path: '/a', kind: 'config' }, { path: '/b', kind: 'symlink' }, 1, 'two', null]);
  });
});

test('returns an empty array when the fixture file holds an empty JSON array', () => {
  inTmp((dir) => {
    const fixture = join(dir, 'empty.json');
    writeFileSync(fixture, '[]', 'utf8');
    const r = withEnv({ CW_CONFINT_TARGETS: fixture }, () => surfaceTargets());
    assert.deepEqual(r, []);
  });
});

test('throws when the fixture file holds a JSON object instead of an array', () => {
  inTmp((dir) => {
    const fixture = join(dir, 'targets.json');
    writeFileSync(fixture, JSON.stringify({ not: 'array' }), 'utf8');
    withEnv({ CW_CONFINT_TARGETS: fixture }, () => {
      assert.throws(() => surfaceTargets(), { name: 'Error', message: 'CW_CONFINT_TARGETS is not a JSON array' });
    });
  });
});

test('throws when the fixture file holds JSON null', () => {
  inTmp((dir) => {
    const fixture = join(dir, 'null.json');
    writeFileSync(fixture, 'null', 'utf8');
    withEnv({ CW_CONFINT_TARGETS: fixture }, () => {
      assert.throws(() => surfaceTargets(), { name: 'Error', message: 'CW_CONFINT_TARGETS is not a JSON array' });
    });
  });
});

test('returns the seven default targets under the given home when CW_CONFINT_TARGETS is unset', () => {
  inTmp((dir) => {
    const home = join(dir, 'home');
    const r = withEnv({ CW_CONFINT_TARGETS: undefined }, () => surfaceTargets(home));
    assert.deepEqual(r, defaults(home));
  });
});

test('treats an empty CW_CONFINT_TARGETS as unset and returns the defaults', () => {
  inTmp((dir) => {
    const home = join(dir, 'home2');
    const r = withEnv({ CW_CONFINT_TARGETS: '' }, () => surfaceTargets(home));
    assert.deepEqual(r, defaults(home));
  });
});

test('uses CW_CONFINT_HOME as the home directory when no home argument is given', () => {
  inTmp((dir) => {
    const envHome = join(dir, 'envhome');
    const r = withEnv({ CW_CONFINT_TARGETS: undefined, CW_CONFINT_HOME: envHome }, () => surfaceTargets());
    assert.deepEqual(r, defaults(envHome));
  });
});

test('an explicit home argument overrides CW_CONFINT_HOME', () => {
  inTmp((dir) => {
    const envHome = join(dir, 'envhome');
    const argHome = join(dir, 'arghome');
    const r = withEnv({ CW_CONFINT_TARGETS: undefined, CW_CONFINT_HOME: envHome }, () => surfaceTargets(argHome));
    assert.deepEqual(r, defaults(argHome));
  });
});
