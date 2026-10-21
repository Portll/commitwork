// Reads a JSON artifact file and validates it contains a dimensions object (bin/eval-delta.mjs loadArtifact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadArtifact } from '../eval-delta.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed document when the file contains valid JSON with a dimensions object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'artifact.json');
    const doc = { dimensions: { accuracy: 0.95, recall: 0.88 } };
    writeFileSync(filePath, JSON.stringify(doc), 'utf8');
    const result = loadArtifact(filePath);
    assert.deepEqual(result, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a no-such-artifact error when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'missing.json');
    assert.throws(() => loadArtifact(filePath), /no such artifact: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'bad.json');
    writeFileSync(filePath, '{ not valid json', 'utf8');
    assert.throws(() => loadArtifact(filePath), /not valid JSON; refusing to treat it as empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the parsed JSON is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'null.json');
    writeFileSync(filePath, 'null', 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the parsed JSON is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'string.json');
    writeFileSync(filePath, '"hello"', 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the parsed JSON is a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'number.json');
    writeFileSync(filePath, '42', 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the parsed JSON is a boolean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'bool.json');
    writeFileSync(filePath, 'true', 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the parsed JSON object has no dimensions property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'nodims.json');
    writeFileSync(filePath, JSON.stringify({ scores: { a: 1 } }), 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when dimensions is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'dimstr.json');
    writeFileSync(filePath, JSON.stringify({ dimensions: 'not-an-object' }), 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when dimensions is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadArtifact-'));
  try {
    const filePath = join(dir, 'dimarr.json');
    writeFileSync(filePath, JSON.stringify({ dimensions: [1, 2, 3] }), 'utf8');
    assert.throws(() => loadArtifact(filePath), /carries no dimensions map/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
