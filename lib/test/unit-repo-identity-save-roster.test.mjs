// Writes the roster as two-space indented JSON with a trailing newline to the roster path and returns that path (lib/repo-identity.mjs saveRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveRoster } from '../repo-identity.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('writes the roster as two-space JSON with a trailing newline and returns the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'roster.json');
    const r = saveRoster({ name: 'repo', refs: ['main', 'dev'] }, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "name": "repo",\n  "refs": [\n    "main",\n    "dev"\n  ]\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates missing parent directories before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'nested', 'deep', 'roster.json');
    const r = saveRoster({ a: 1 }, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(r, target);
    assert.equal(statSync(join(dir, 'nested', 'deep')).isDirectory(), true);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "a": 1\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes into a parent directory that already exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    mkdirSync(join(dir, 'monitor'));
    const target = join(dir, 'monitor', 'repo-identity.json');
    const r = saveRoster({ b: [true] }, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "b": [\n    true\n  ]\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes an empty roster object as an empty JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'empty.json');
    const r = saveRoster({}, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes nested arrays and null values with two-space indentation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'nested.json');
    saveRoster({ tags: ['a', 'b'], meta: null, count: 0 }, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(readFileSync(target, 'utf8'), '{\n  "tags": [\n    "a",\n    "b"\n  ],\n  "meta": null,\n  "count": 0\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites an existing roster file and leaves it with mode 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'perm.json');
    writeFileSync(target, 'old contents', { mode: 0o644 });
    const r = saveRoster({ secret: 'token' }, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "secret": "token"\n}\n');
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not leave the temporary file behind after the rename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'tmp.json');
    saveRoster({ k: 'v' }, { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(existsSync(`${target}.tmp-${process.pid}`), false);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "k": "v"\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a long string and a generated number array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'long.json');
    const roster = { key: 'x'.repeat(50), val: Array.from({ length: 5 }, (_, i) => i) };
    saveRoster(roster, { CW_REPO_IDENTITY_ROSTER: target });
    const expected = `{\n  "key": "${'x'.repeat(50)}",\n  "val": [\n    0,\n    1,\n    2,\n    3,\n    4\n  ]\n}\n`;
    assert.equal(readFileSync(target, 'utf8'), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a top-level array roster with nested indentation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveRoster-'));
  try {
    const target = join(dir, 'array.json');
    const r = saveRoster([1, [2]], { CW_REPO_IDENTITY_ROSTER: target });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '[\n  1,\n  [\n    2\n  ]\n]\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
