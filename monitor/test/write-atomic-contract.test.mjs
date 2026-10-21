// Tests for writeAtomic's contract and its single owner (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../lockfile.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the whole file is replaced and no tmp sibling remains', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wac-'));
  const p = join(dir, 'out.json');
  writeFileSync(p, 'old');
  writeAtomic(p, 'new');
  assert.equal(readFileSync(p, 'utf8'), 'new');
  assert.deepEqual(readdirSync(dir), ['out.json']);
});

test('a missing parent fails unless the caller asks for mkdir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wac-'));
  assert.throws(() => writeAtomic(join(dir, 'a', 'b.txt'), 'x'), { code: 'ENOENT' });
  writeAtomic(join(dir, 'a', 'b.txt'), 'x', { mkdir: true });
  assert.equal(readFileSync(join(dir, 'a', 'b.txt'), 'utf8'), 'x');
});

test('a failed rename leaves no tmp sibling behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wac-'));
  const target = join(dir, 'occupied');
  mkdirSync(join(target, 'child'), { recursive: true });
  assert.throws(() => writeAtomic(target, 'x'));
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), []);
});

test('mode lands on the target with the content, never after it', { skip: process.platform === 'win32' && 'no POSIX modes' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wac-'));
  const p = join(dir, 'hook');
  writeFileSync(p, 'old', { mode: 0o644 });
  writeAtomic(p, 'new', { mode: 0o755 });
  assert.equal(statSync(p).mode & 0o777, 0o755);
  writeAtomic(p, 'plain');
  assert.notEqual(statSync(p).mode & 0o111, 0o111, 'no mode asked, none granted');
  assert.deepEqual(readdirSync(dir), ['hook']);
});

test('no module outside lockfile.mjs defines its own atomic writer', () => {
  const files = execFileSync('git', ['-C', CW, 'ls-files', '*.mjs'], { encoding: 'utf8' }).split('\n')
    .filter((f) => f && !/(^|\/)(test|fixtures|vendor)\//.test(f) && f !== 'monitor/lockfile.mjs');
  const offenders = files.filter((f) => /^(export\s+)?function\s+(writeAtomic|atomicWrite)\s*\(/m.test(readFileSync(join(CW, f), 'utf8')));
  assert.deepEqual(offenders, []);
});
