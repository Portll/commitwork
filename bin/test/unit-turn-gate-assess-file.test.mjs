// assessFile reads a transcript file and returns its gate verdicts or an unknown outcome when it cannot be read (bin/turn-gate.mjs assessFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFile } from '../turn-gate.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('a missing transcript file is reported as absent with an unknown outcome', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assessFile-'));
  try {
    const missingPath = join(dir, 'nope.txt');
    const result = assessFile(missingPath);
    assert.deepEqual(result, {
      file: missingPath,
      outcome: 'unknown',
      reason: 'transcript is absent',
      verdicts: [],
      tokens: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing transcript file is still reported as absent when a session id is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assessFile-'));
  try {
    const missingPath = join(dir, 'missing.txt');
    const result = assessFile(missingPath, undefined, 'session-123');
    assert.deepEqual(result, {
      file: missingPath,
      outcome: 'unknown',
      reason: 'transcript is absent',
      verdicts: [],
      tokens: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory in place of the transcript is reported as unreadable with its error code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assessFile-'));
  try {
    const dirPath = join(dir, 'transcript.jsonl');
    mkdirSync(dirPath);
    const result = assessFile(dirPath);
    assert.deepEqual(result, {
      file: dirPath,
      outcome: 'unknown',
      reason: 'transcript is unreadable (EISDIR)',
      verdicts: [],
      tokens: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a path running through a regular file is reported as unreadable with ENOTDIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assessFile-'));
  try {
    const filePath = join(dir, 'plain.txt');
    writeFileSync(filePath, 'data');
    const badPath = join(filePath, 'inner.jsonl');
    const result = assessFile(badPath);
    assert.deepEqual(result, {
      file: badPath,
      outcome: 'unknown',
      reason: 'transcript is unreadable (ENOTDIR)',
      verdicts: [],
      tokens: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a readable transcript with no parseable records yields a record-integrity unknown verdict and empty token summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assessFile-'));
  try {
    const goodPath = join(dir, 'good.txt');
    writeFileSync(goodPath, 'User: hi\nAssistant: hello');
    const result = assessFile(goodPath);
    const reason = 'no records read \u2014 an absent or empty transcript is not a clean session';
    assert.equal(result.file, goodPath);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.verdicts[0], {
      evidence: { steps: 0, unparseable: 2 },
      policy: {},
      reason,
      rule: 'record-integrity',
      verdict: 'unknown',
    });
    assert.equal(result.tokens.turns, 0);
    assert.equal(result.tokens.syntheticTurns, 0);
    assert.equal(result.tokens.turnsWithoutTools, 0);
    assert.equal(result.tokens.turnsWithoutUsage, 0);
    assert.deepEqual(result.tokens.totals, {
      cacheCreation: null,
      cacheRead: null,
      input: null,
      output: null,
      thinking: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
