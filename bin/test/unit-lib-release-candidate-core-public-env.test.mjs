// Builds a child-process env of allowlisted variables plus a scratch HOME and fixed git settings (bin/lib/release-candidate-core.mjs publicEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicEnv } from '../lib/release-candidate-core.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixed = (scratch) => ({
  HOME: join(scratch, 'home'),
  USERPROFILE: join(scratch, 'home'),
  GIT_CONFIG_NOSYSTEM: '1',
  CW_SIDECAR: join(scratch, 'no-sidecar'),
});

test('copies every allowlisted variable present in env and adds the fixed keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const env = { PATH: '/usr/bin', LANG: 'en_US.UTF-8', LC_ALL: 'C', LC_CTYPE: 'C', TMPDIR: '/tmp', TERM: 'xterm', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe', PATHEXT: '.COM;.EXE', TEMP: '/tmp', TMP: '/tmp' };
    const r = publicEnv(dir, env);
    assert.deepEqual(r, { ...env, ...fixed(dir) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves out allowlisted variables that env does not contain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const r = publicEnv(dir, { PATH: '/usr/bin' });
    assert.deepEqual(r, { PATH: '/usr/bin', ...fixed(dir) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns only the fixed keys when env is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const r = publicEnv(dir, {});
    assert.deepEqual(r, fixed(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps empty string and null values but drops undefined ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const r = publicEnv(dir, { LANG: '', TERM: null, TMP: undefined });
    assert.deepEqual(r, { LANG: '', TERM: null, ...fixed(dir) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores variables outside the allowlist and overrides HOME and git settings from env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const env = { HOME: '/root', USERPROFILE: 'C:\\Users\\x', GIT_CONFIG_NOSYSTEM: '0', CW_SIDECAR: '/s', path: '/x', FOO: 'bar' };
    const r = publicEnv(dir, env);
    assert.deepEqual(r, fixed(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates an empty home directory and nothing else under scratch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    publicEnv(dir, { PATH: '/bin' });
    assert.deepEqual(readdirSync(dir), ['home']);
    assert.deepEqual(readdirSync(join(dir, 'home')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reuses an existing home directory without touching its contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    mkdirSync(join(dir, 'home'));
    writeFileSync(join(dir, 'home', 'keep.txt'), 'kept');
    const r = publicEnv(dir, { TERM: 'dumb' });
    assert.deepEqual(r, { TERM: 'dumb', ...fixed(dir) });
    assert.equal(readFileSync(join(dir, 'home', 'keep.txt'), 'utf8'), 'kept');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates missing parent directories of the scratch path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const scratch = join(dir, 'a', 'b');
    const r = publicEnv(scratch, {});
    assert.deepEqual(r, fixed(scratch));
    assert.deepEqual(readdirSync(scratch), ['home']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the same result when called twice on the same scratch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publicEnv-'));
  try {
    const first = publicEnv(dir, { LC_ALL: 'C' });
    const second = publicEnv(dir, { LC_ALL: 'C' });
    assert.deepEqual(first, { LC_ALL: 'C', ...fixed(dir) });
    assert.deepEqual(second, { LC_ALL: 'C', ...fixed(dir) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
