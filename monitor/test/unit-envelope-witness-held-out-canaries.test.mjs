// Maps held-out canary regex sources to RegExp instances (monitor/envelope-witness.mjs heldOutCanaries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldOutCanaries } from '../envelope-witness.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when canaries.json does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.deepEqual(heldOutCanaries(env), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when patterns is empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: [] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.deepEqual(heldOutCanaries(env), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns RegExp instances for valid string patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: ['foo', 'bar'] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    const result = heldOutCanaries(env);
    assert.equal(result.length, 2);
    assert.ok(result[0] instanceof RegExp);
    assert.ok(result[1] instanceof RegExp);
    assert.equal(result[0].source, 'foo');
    assert.equal(result[1].source, 'bar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when patterns is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: 'not-an-array' }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.throws(() => heldOutCanaries(env), /patterns must be an array of regex sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when patterns contains non-string element', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: ['valid', 42] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.throws(() => heldOutCanaries(env), /patterns must be an array of regex sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when patterns contains null element', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: [null] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.throws(() => heldOutCanaries(env), /patterns must be an array of regex sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when patterns contains object element', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: [{ source: 'x' }] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.throws(() => heldOutCanaries(env), /patterns must be an array of regex sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when patterns contains boolean element', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: [true] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    assert.throws(() => heldOutCanaries(env), /patterns must be an array of regex sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles single pattern with special regex characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns: ['a.b+c*'] }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    const result = heldOutCanaries(env);
    assert.equal(result.length, 1);
    assert.equal(result[0].source, 'a.b+c*');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple patterns with mixed content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heldOutCanaries-'));
  try {
    const corpus = join(dir, 'corpus');
    const heldOut = join(corpus, 'held-out');
    mkdirSync(heldOut, { recursive: true });
    const patterns = Array.from({ length: 5 }, (_, i) => `pattern${i}`);
    writeFileSync(join(heldOut, 'canaries.json'), JSON.stringify({ patterns }));
    const env = { CW_ENVELOPE_CORPUS: corpus };
    const result = heldOutCanaries(env);
    assert.equal(result.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(result[i].source, `pattern${i}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
