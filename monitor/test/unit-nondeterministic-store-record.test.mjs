// Appends a scored observation to a per-subject/dimension JSONL file, trimming to hot depth (monitor/nondeterministic-store.mjs record).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { record } from '../nondeterministic-store.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('throws when subject is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    assert.throws(() => record({ dimension: 'd', score: 0.5 }), /subject and dimension are required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when dimension is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    assert.throws(() => record({ subject: 's', score: 0.5 }), /subject and dimension are required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when score is below zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    assert.throws(() => record({ subject: 's', dimension: 'd', score: -0.1 }), /score must be a number in \[0,1\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when score is above one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    assert.throws(() => record({ subject: 's', dimension: 'd', score: 1.1 }), /score must be a number in \[0,1\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when score is NaN', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    assert.throws(() => record({ subject: 's', dimension: 'd', score: NaN }), /score must be a number in \[0,1\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when score is not a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    assert.throws(() => record({ subject: 's', dimension: 'd', score: '0.5' }), /score must be a number in \[0,1\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records a valid observation and returns path and counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    const result = record({ subject: 'test-subject', dimension: 'test-dim', score: 0.75, detail: 'some detail' });
    assert.ok(result.path.endsWith('test-subject.jsonl'));
    assert.equal(result.kept, 1);
    assert.equal(result.dropped, 0);
    assert.ok(existsSync(result.path));
    const content = readFileSync(result.path, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.subject, 'test-subject');
    assert.equal(parsed.dimension, 'test-dim');
    assert.equal(parsed.score, 0.75);
    assert.equal(parsed.detail, 'some detail');
    assert.ok(parsed.ts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appends to existing file and keeps multiple rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    const r1 = record({ subject: 's', dimension: 'd', score: 0.1 });
    const r2 = record({ subject: 's', dimension: 'd', score: 0.2 });
    assert.equal(r1.kept, 1);
    assert.equal(r1.dropped, 0);
    assert.equal(r2.kept, 2);
    assert.equal(r2.dropped, 0);
    const content = readFileSync(r2.path, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const parsed0 = JSON.parse(lines[0]);
    const parsed1 = JSON.parse(lines[1]);
    assert.equal(parsed0.score, 0.1);
    assert.equal(parsed1.score, 0.2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trims rows beyond hot depth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    process.env.CW_NONDET_HOT = '2';
    record({ subject: 's', dimension: 'd', score: 0.1 });
    record({ subject: 's', dimension: 'd', score: 0.2 });
    const r3 = record({ subject: 's', dimension: 'd', score: 0.3 });
    assert.equal(r3.kept, 2);
    assert.equal(r3.dropped, 1);
    const content = readFileSync(r3.path, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const parsed0 = JSON.parse(lines[0]);
    const parsed1 = JSON.parse(lines[1]);
    assert.equal(parsed0.score, 0.2);
    assert.equal(parsed1.score, 0.3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts score of zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    const result = record({ subject: 's', dimension: 'd', score: 0 });
    assert.equal(result.kept, 1);
    assert.equal(result.dropped, 0);
    const content = readFileSync(result.path, 'utf8');
    const parsed = JSON.parse(content.split('\n')[0]);
    assert.equal(parsed.score, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts score of one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-'));
  try {
    process.env.CW_NONDET_STORE = join(dir, 'store');
    const result = record({ subject: 's', dimension: 'd', score: 1 });
    assert.equal(result.kept, 1);
    assert.equal(result.dropped, 0);
    const content = readFileSync(result.path, 'utf8');
    const parsed = JSON.parse(content.split('\n')[0]);
    assert.equal(parsed.score, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
