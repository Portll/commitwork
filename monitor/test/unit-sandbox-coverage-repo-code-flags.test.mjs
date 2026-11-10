// Maps each manifest check id to whether any manifest marks it executesRepoCode true (monitor/sandbox-coverage.mjs repoCodeFlags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoCodeFlags } from '../sandbox-coverage.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a missing directory is reported as unreadable with its error code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    const missing = join(dir, 'missing');
    const result = repoCodeFlags(missing);
    assert.deepEqual(result, { byCheck: new Map(), declared: 0, files: 0, unreadable: [`${missing}: ENOENT`], dir: missing });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('files without a json extension are skipped and not counted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map(), declared: 0, files: 0, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a json file that does not parse is listed as unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{invalid');
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map(), declared: 0, files: 0, unreadable: ['bad.json: unparseable'], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a json entry that cannot be read is listed with its error code and a non-array checks field is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: { id: 'x', executesRepoCode: true } }));
    mkdirSync(join(dir, 'sub.json'));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map(), declared: 0, files: 1, unreadable: ['sub.json: EISDIR'], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checks that are null or lack a string id are ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: [null, { id: 42 }, { executesRepoCode: true }] }));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map(), declared: 0, files: 1, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a check declared executesRepoCode true maps to true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: [{ id: 'x', executesRepoCode: true }] }));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map([['x', true]]), declared: 1, files: 1, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a check declared executesRepoCode false maps to false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: [{ id: 'x', executesRepoCode: false }] }));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map([['x', false]]), declared: 1, files: 1, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a check stays true when a later manifest omits executesRepoCode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: [{ id: 'x', executesRepoCode: true }] }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ checks: [{ id: 'x' }] }));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map([['x', true]]), declared: 1, files: 2, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a check stays true when a later manifest declares executesRepoCode false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: [{ id: 'x', executesRepoCode: true }] }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ checks: [{ id: 'x', executesRepoCode: false }] }));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map([['x', true]]), declared: 2, files: 2, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a check stays false when it is omitted first and declared false later', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repoCodeFlags-'));
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ checks: [{ id: 'x' }] }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ checks: [{ id: 'x', executesRepoCode: false }] }));
    const result = repoCodeFlags(dir);
    assert.deepEqual(result, { byCheck: new Map([['x', false]]), declared: 1, files: 2, unreadable: [], dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
