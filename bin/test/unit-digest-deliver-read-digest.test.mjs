// Computes a SHA-256 digest verification (bin/digest-deliver.mjs readDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDigest, Refused } from '../digest-deliver.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

function makeDigest(doc) {
  const id = createHash('sha256')
    .update(JSON.stringify({ ...doc, digestId: '' }))
    .digest('hex');
  return { ...doc, digestId: id };
}

test('returns raw and doc for a valid digest file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'commitwork.digest/1', sections: { a: 1 } });
    const path = join(dir, 'valid.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    const result = readDigest(path);
    assert.deepEqual(result, {
      raw: JSON.stringify(doc),
      doc
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const path = join(dir, 'missing.json');
    assert.throws(() => readDigest(path), Refused, `digest unreadable at ${path} (ENOENT)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when JSON is malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const path = join(dir, 'badjson.json');
    writeFileSync(path, '{ not: json', 'utf8');
    assert.throws(() => readDigest(path), Refused, "digest is not JSON (Expected property name or '}' in JSON at position 2 (line 1 column 3))");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when schema is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'wrong-schema', sections: { a: 1 } });
    const path = join(dir, 'wrong-schema.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest schema is "wrong-schema", expected commitwork.digest/1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when digestId format is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = { schema: 'commitwork.digest/1', sections: { a: 1 }, digestId: '123' };
    const path = join(dir, 'bad-id.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest carries no digestId');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when sections is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'commitwork.digest/1', sections: 42 });
    const path = join(dir, 'bad-sections-type.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest carries no sections');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when sections object is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'commitwork.digest/1', sections: {} });
    const path = join(dir, 'empty-sections.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest carries no sections');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when digestId does not verify', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = { schema: 'commitwork.digest/1', sections: { a: 1 }, digestId: 'f'.repeat(64) };
    const path = join(dir, 'bad-verify.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digestId does not verify (file says ffffffffffff\u2026, content hashes to 6f34ff39e6ba\u2026)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when file contains null JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const path = join(dir, 'null.json');
    writeFileSync(path, 'null', 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest schema is undefined, expected commitwork.digest/1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when sections is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'commitwork.digest/1' });
    delete doc.sections;
    const path = join(dir, 'missing-sections.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest carries no sections');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when sections is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'commitwork.digest/1', sections: null });
    const path = join(dir, 'null-sections.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest carries no sections');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when sections is empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readDigest-'));
  try {
    const doc = makeDigest({ schema: 'commitwork.digest/1', sections: [] });
    const path = join(dir, 'empty-array-sections.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => readDigest(path), Refused, 'digest carries no sections');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
