// bin/test/test-select-units.test.mjs — case tests for moduleIndex, suiteTests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moduleIndex, suiteTests } from '../test-select.mjs';

test('moduleIndex rejects non-string repo', async () => {
  await assert.rejects(() => moduleIndex(123), TypeError);
});

test('moduleIndex rejects null repo', async () => {
  await assert.rejects(() => moduleIndex(null), TypeError);
});

test('moduleIndex rejects undefined repo', async () => {
  await assert.rejects(() => moduleIndex(undefined), TypeError);
});

test('moduleIndex rejects boolean repo', async () => {
  await assert.rejects(() => moduleIndex(true), TypeError);
});

test('moduleIndex rejects object repo', async () => {
  await assert.rejects(() => moduleIndex({}), TypeError);
});

test('moduleIndex rejects array repo', async () => {
  await assert.rejects(() => moduleIndex([]), TypeError);
});

test('suiteTests returns empty array when no test dirs exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 't-'));
  try {
    assert.deepEqual(suiteTests(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('suiteTests finds .test.mjs files in bin', () => {
  const dir = mkdtempSync(join(tmpdir(), 't-'));
  try {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin', 'a.test.mjs'), '');
    writeFileSync(join(dir, 'bin', 'b.js'), '');
    assert.deepEqual(suiteTests(dir), ['bin/a.test.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('suiteTests finds .test.mjs files in lib', () => {
  const dir = mkdtempSync(join(tmpdir(), 't-'));
  try {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'x.test.mjs'), '');
    assert.deepEqual(suiteTests(dir), ['lib/x.test.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('suiteTests skips files in node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 't-'));
  try {
    mkdirSync(join(dir, 'bin', 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'bin', 'node_modules', 'skip.test.mjs'), '');
    assert.deepEqual(suiteTests(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('suiteTests returns sorted results across multiple dirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 't-'));
  try {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'z.test.mjs'), '');
    writeFileSync(join(dir, 'bin', 'a.test.mjs'), '');
    assert.deepEqual(suiteTests(dir), ['bin/a.test.mjs', 'lib/z.test.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('suiteTests ignores non-.test.mjs files', () => {
  const dir = mkdtempSync(join(tmpdir(), 't-'));
  try {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin', 'a.test.js'), '');
    writeFileSync(join(dir, 'bin', 'a.mjs'), '');
    assert.deepEqual(suiteTests(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
