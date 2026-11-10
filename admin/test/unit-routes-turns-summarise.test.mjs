// Computes a session summary from a transcript file (admin/routes/turns.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../routes/turns.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns unknown outcome with transcript absent reason when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const path = join(dir, 'missing.jsonl');
    const result = summarise(path);
    assert.deepEqual(result, {
      session: 'missing',
      outcome: 'unknown',
      reason: 'transcript absent',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown outcome with unreadable reason when file read fails with EISDIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const sub = join(dir, 'adir.jsonl');
    mkdirSync(sub);
    const result = summarise(sub);
    assert.equal(result.session, 'adir');
    assert.equal(result.outcome, 'unknown');
    assert.match(result.reason, /transcript unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns session name and gate fields for a valid transcript file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const path = join(dir, 'sess.jsonl');
    writeFileSync(path, '');
    const result = summarise(path);
    assert.equal(result.session, 'sess');
    assert.equal(typeof result.outcome, 'string');
    assert.equal(typeof result.reason, 'string');
    assert.equal(typeof result.turns, 'number');
    assert.equal(typeof result.syntheticTurns, 'number');
    assert.equal(typeof result.turnsWithoutTools, 'number');
    assert.equal(typeof result.turnsWithoutUsage, 'number');
    assert.equal(typeof result.tokens, 'object');
    assert.equal(typeof result.ruminationShare, "object");
    assert.equal(typeof result.cacheHitRatio, "object");
    assert.equal(typeof result.outputPerTurn, "object");
    assert.equal(Array.isArray(result.rules), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips .jsonl extension from session name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const path = join(dir, 'my-session.jsonl');
    writeFileSync(path, '');
    const result = summarise(path);
    assert.equal(result.session, 'my-session');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles transcript with multiple lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
  try {
    const path = join(dir, 'multi.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ type: 'step', n: i }));
    writeFileSync(path, lines.join('\n') + '\n');
    const result = summarise(path);
    assert.equal(result.session, 'multi');
    assert.equal(typeof result.turns, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
