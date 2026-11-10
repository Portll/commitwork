// Absolute path of a named file inside the harness store directory (flow/store.mjs storePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storePath } from '../store.mjs';

const cwd = process.cwd();

test('falls back to reports/harness under the working directory when the variable is unset', () => {
  const r = storePath('a.txt', {});
  assert.equal(r, `${cwd}/reports/harness/a.txt`);
});

test('falls back to reports/harness when the variable is an empty string', () => {
  const r = storePath('b.txt', { CW_HARNESS_STORE: '' });
  assert.equal(r, `${cwd}/reports/harness/b.txt`);
});

test('resolves a relative override against the working directory', () => {
  const r = storePath('c.txt', { CW_HARNESS_STORE: 'custom/dir' });
  assert.equal(r, `${cwd}/custom/dir/c.txt`);
});

test('uses an absolute override as the store directory unchanged', () => {
  const r = storePath('d.txt', { CW_HARNESS_STORE: '/abs/path' });
  assert.equal(r, '/abs/path/d.txt');
});

test('appends a nested relative name below the default store directory', () => {
  const r = storePath('sub/dir/e.txt', {});
  assert.equal(r, `${cwd}/reports/harness/sub/dir/e.txt`);
});

test('treats an absolute name as a segment under the store directory', () => {
  const r = storePath('/abs/file.txt', { CW_HARNESS_STORE: 'custom' });
  assert.equal(r, `${cwd}/custom/abs/file.txt`);
});

test('returns the store directory itself when the name is a dot', () => {
  const r = storePath('.', {});
  assert.equal(r, `${cwd}/reports/harness`);
});

test('steps up one level from the store directory when the name is a dot dot', () => {
  const r = storePath('..', { CW_HARNESS_STORE: 'a/b' });
  assert.equal(r, `${cwd}/a`);
});
