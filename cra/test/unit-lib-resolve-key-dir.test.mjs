// computes the directory for attest keys (cra/lib.mjs resolveKeyDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeyDir } from '../lib.mjs';
import { join } from 'node:path';

test('returns the key directory derived from paths when CW_ATTEST_KEYDIR is not set', () => {
  const original = process.env.CW_ATTEST_KEYDIR;
  delete process.env.CW_ATTEST_KEYDIR;
  const paths = { reportsRoot: join('some', 'root') };
  assert.equal(resolveKeyDir(paths), "some/cra/.keys");
  if (original !== undefined) process.env.CW_ATTEST_KEYDIR = original;
});

test('returns the key directory derived from paths when CW_ATTEST_KEYDIR is empty string (falsy)', () => {
  const original = process.env.CW_ATTEST_KEYDIR;
  process.env.CW_ATTEST_KEYDIR = '';
  const paths = { reportsRoot: join('a', 'b') };
  assert.equal(resolveKeyDir(paths), "a/cra/.keys");
  if (original !== undefined) process.env.CW_ATTEST_KEYDIR = original; else delete process.env.CW_ATTEST_KEYDIR;
});

test('returns the value of CW_ATTEST_KEYDIR when it is a non\u2011empty string', () => {
  const original = process.env.CW_ATTEST_KEYDIR;
  process.env.CW_ATTEST_KEYDIR = join('custom', 'keydir');
  const paths = { reportsRoot: join('x', 'y') };
  assert.equal(resolveKeyDir(paths), "custom/keydir");
  if (original !== undefined) process.env.CW_ATTEST_KEYDIR = original; else delete process.env.CW_ATTEST_KEYDIR;
});

test('throws TypeError when paths.reportsRoot is missing', () => {
  const original = process.env.CW_ATTEST_KEYDIR;
  delete process.env.CW_ATTEST_KEYDIR;
  const paths = {};
  assert.throws(() => resolveKeyDir(paths), { name: "TypeError", message: "The \"path\" argument must be of type string. Received undefined" });
  if (original !== undefined) process.env.CW_ATTEST_KEYDIR = original;
});
