// Scans a buffer for secrets and sensitive context, returning findings or an unscanned reason (bin/secrets-sweep.mjs scanBuffer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBuffer } from '../secrets-sweep.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');

test('returns binary-extension unscanned for a png path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from('hello world');
    const r = scanBuffer(buf, 'a.png');
    assert.deepEqual(r, { rel: "a.png", unscanned: "binary-extension", findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns binary-content unscanned when a NUL byte is in the first byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from([0, 104, 105]);
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", unscanned: "binary-content", findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns binary-content unscanned when a NUL byte is at offset one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from([104, 0, 105]);
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", unscanned: "binary-content", findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty findings for a clean text buffer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from('hello world\n');
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports an AWS key on the first line with line number one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from(`key=${AWS_KEY}\n`);
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", findings: [{ file: "a.txt", line: 1, col: 5, cls: "provider-key/aws", verdict: "FALSE-POSITIVE", reason: "placeholder", match: AWS_KEY, fingerprint: "16cbbe3918a1dc83" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports an AWS key on the second line with line number two', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from(`clean line\nkey=${AWS_KEY}\n`);
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", findings: [{ file: "a.txt", line: 2, col: 5, cls: "provider-key/aws", verdict: "FALSE-POSITIVE", reason: "placeholder", match: AWS_KEY, fingerprint: "16cbbe3918a1dc83" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks the result as fixture when the marker is declared in the first twenty-five lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from(`secrets-sweep-fixture\nkey=${AWS_KEY}\n`);
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", findings: [{ file: "a.txt", line: 2, col: 5, cls: "provider-key/aws", verdict: "FALSE-POSITIVE", reason: "placeholder", match: AWS_KEY, fingerprint: "16cbbe3918a1dc83" }], fixture: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not mark the result as fixture when the marker is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanBuffer-'));
  try {
    const buf = Buffer.from('just a normal line\n');
    const r = scanBuffer(buf, 'a.txt');
    assert.deepEqual(r, { rel: "a.txt", findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
