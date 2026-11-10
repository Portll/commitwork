// Appends a row to a JSON lanes array in a report directory (bin/lib/egress-observe.mjs recordObservation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordObservation } from '../lib/egress-observe.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates file with new lane when directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'report');
    const r = recordObservation(reportDir, { id: 1 });
    assert.equal(r, join(reportDir, 'egress-observed.json'));
    const content = readFileSync(r, 'utf8');
    assert.equal(content, "{\n  \"lanes\": [\n    {\n      \"id\": 1\n    }\n  ]\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appends to existing valid lanes array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'report');
    mkdirSync(reportDir, { recursive: true });
    const filePath = join(reportDir, 'egress-observed.json');
    writeFileSync(filePath, JSON.stringify({ lanes: [{ id: 0 }] }, null, 2) + '\n');
    const r = recordObservation(reportDir, { id: 1 });
    assert.equal(r, filePath);
    const content = readFileSync(r, 'utf8');
    assert.equal(content, "{\n  \"lanes\": [\n    {\n      \"id\": 0\n    },\n    {\n      \"id\": 1\n    }\n  ]\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resets lanes when existing file has invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'report');
    mkdirSync(reportDir, { recursive: true });
    const filePath = join(reportDir, 'egress-observed.json');
    writeFileSync(filePath, 'not valid json');
    const r = recordObservation(reportDir, { id: 1 });
    assert.equal(r, filePath);
    const content = readFileSync(r, 'utf8');
    assert.equal(content, "{\n  \"lanes\": [\n    {\n      \"id\": 1\n    }\n  ],\n  \"unreadablePrevious\": true\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resets lanes when existing file has non-array lanes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'report');
    mkdirSync(reportDir, { recursive: true });
    const filePath = join(reportDir, 'egress-observed.json');
    writeFileSync(filePath, JSON.stringify({ lanes: 'not-an-array' }, null, 2) + '\n');
    const r = recordObservation(reportDir, { id: 1 });
    assert.equal(r, filePath);
    const content = readFileSync(r, 'utf8');
    assert.equal(content, "{\n  \"lanes\": [\n    {\n      \"id\": 1\n    }\n  ],\n  \"unreadablePrevious\": true\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps lanes when existing file has valid array lanes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'report');
    mkdirSync(reportDir, { recursive: true });
    const filePath = join(reportDir, 'egress-observed.json');
    writeFileSync(filePath, JSON.stringify({ lanes: [{ a: 1 }, { b: 2 }] }, null, 2) + '\n');
    const r = recordObservation(reportDir, { c: 3 });
    assert.equal(r, filePath);
    const content = readFileSync(r, 'utf8');
    assert.equal(content, "{\n  \"lanes\": [\n    {\n      \"a\": 1\n    },\n    {\n      \"b\": 2\n    },\n    {\n      \"c\": 3\n    }\n  ]\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates nested report directory recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'a', 'b', 'c');
    const r = recordObservation(reportDir, { x: 1 });
    assert.equal(r, join(reportDir, 'egress-observed.json'));
    assert.ok(existsSync(r));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordObservation-'));
  try {
    const reportDir = join(dir, 'report');
    const r = recordObservation(reportDir, { key: 'value' });
    assert.equal(r, join(reportDir, 'egress-observed.json'));
    const content = readFileSync(r, 'utf8');
    assert.equal(content, "{\n  \"lanes\": [\n    {\n      \"key\": \"value\"\n    }\n  ]\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
