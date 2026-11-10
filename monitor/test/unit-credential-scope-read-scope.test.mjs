// Parsed credential scope object read from the repository scope file after schema validation (monitor/credential-scope.mjs readScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScope } from '../credential-scope.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const SCOPE = join(REPO, 'monitor', 'private', 'credential-scope.json');
const MISSING = `ENOENT: no such file or directory, open '${SCOPE}'`;

test('readScope throws ENOENT naming the scope file under monitor/private when it does not exist', () => {
  assert.throws(() => readScope(), { name: 'Error', message: MISSING });
});

test('readScope reports the failed open syscall with code ENOENT, errno -2 and the scope path', () => {
  assert.throws(() => readScope(), {
    name: 'Error',
    code: 'ENOENT',
    errno: -2,
    syscall: 'open',
    path: SCOPE,
    message: MISSING,
  });
});

test('readScope reads the repository path and ignores a scope file in the working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScope-'));
  const cwd = process.cwd();
  try {
    const decoy = join(dir, 'monitor', 'private', 'credential-scope.json');
    mkdirSync(dirname(decoy), { recursive: true });
    const body = JSON.stringify({ version: 1, entries: [] });
    writeFileSync(decoy, body);
    process.chdir(dir);
    assert.throws(() => readScope(), { name: 'Error', message: MISSING });
    assert.equal(readFileSync(decoy, 'utf8'), body);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readScope fails the same way on every call because it caches nothing', () => {
  assert.throws(() => readScope(), { name: 'Error', message: MISSING });
  assert.throws(() => readScope(), { name: 'Error', message: MISSING });
});

test('readScope does not create the missing scope file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readScope-'));
  try {
    const marker = join(dir, 'credential-scope.json');
    writeFileSync(marker, 'x'.repeat(8));
    assert.throws(() => readScope(), { name: 'Error', message: MISSING });
    assert.equal(existsSync(SCOPE), false);
    assert.equal(readFileSync(marker, 'utf8'), 'xxxxxxxx');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
