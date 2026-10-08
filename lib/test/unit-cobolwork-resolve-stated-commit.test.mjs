// Extracts the commit id a packed cobolwork states in lib/revision.json, or the reason it states none (lib/cobolwork-resolve.mjs statedCommit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statedCommit } from '../cobolwork-resolve.mjs';

test('returns a reason when the entries list has no revision entry', () => {
  const entries = [
    { path: 'package/lib/other.json', data: Buffer.from('{}') },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'the package has no lib/revision.json, so it states no commit' });
});

test('returns the commit when the revision entry contains a valid 40-character hex string', () => {
  const commit = 'a'.repeat(40);
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from(JSON.stringify({ commit })) },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { commit });
});

test('returns a reason when the commit is a 39-character hex string', () => {
  const commit = 'a'.repeat(39);
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from(JSON.stringify({ commit })) },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: `package/lib/revision.json states no commit id ("${commit}")` });
});

test('returns a reason when the commit is a 41-character hex string', () => {
  const commit = 'a'.repeat(41);
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from(JSON.stringify({ commit })) },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: `package/lib/revision.json states no commit id ("${commit}")` });
});

test('returns a reason when the commit is 40 characters but contains a non-hex character', () => {
  const commit = 'g'.repeat(40);
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from(JSON.stringify({ commit })) },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: `package/lib/revision.json states no commit id ("${commit}")` });
});

test('returns a reason when the commit is a number', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from(JSON.stringify({ commit: 12345 })) },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'package/lib/revision.json states no commit id (12345)' });
});

test('returns a reason when the commit is null', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from(JSON.stringify({ commit: null })) },
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'package/lib/revision.json states no commit id (null)' });
});

test('returns a reason when the revision entry data is not valid JSON', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('not json') },
  ];
  const result = statedCommit(entries);
  assert.equal(result.reason.startsWith('package/lib/revision.json is not JSON ('), true);
  assert.equal(result.reason.endsWith(')'), true);
});

test('returns a reason when the revision entry data is empty', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('') },
  ];
  const result = statedCommit(entries);
  assert.equal(result.reason.startsWith('package/lib/revision.json is not JSON ('), true);
  assert.equal(result.reason.endsWith(')'), true);
});
