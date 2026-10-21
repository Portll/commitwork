// Classifies a prompt-envelope witness file as absent, unreadable, failed, stale, or fresh (monitor/stpa-sweep.mjs readEnvelopeWitness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEnvelopeWitness } from '../stpa-sweep.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent when the witness file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'missing.json');
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'absent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with why not JSON when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json at all');
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'unreadable', why: 'not JSON' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns failed with the recorded at when pass is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    writeFileSync(p, JSON.stringify({ pass: false, at: '2024-01-01T00:00:00.000Z' }));
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'failed', at: '2024-01-01T00:00:00.000Z' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns failed with the recorded at when pass is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    writeFileSync(p, JSON.stringify({ at: '2024-01-01T00:00:00.000Z' }));
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'failed', at: '2024-01-01T00:00:00.000Z' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns failed with the recorded at when pass is missing and at is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    writeFileSync(p, JSON.stringify({}));
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'failed', at: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns fresh when pass is true and age is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    const at = '2024-01-10T00:00:00.000Z';
    writeFileSync(p, JSON.stringify({ pass: true, at }));
    const now = at;
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'fresh', at });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns fresh when pass is true and age is exactly seven days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    const at = '2024-01-03T00:00:00.000Z';
    writeFileSync(p, JSON.stringify({ pass: true, at }));
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'fresh', at });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns stale when pass is true and age exceeds seven days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    const at = '2024-01-02T23:59:59.000Z';
    writeFileSync(p, JSON.stringify({ pass: true, at }));
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'stale', at });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns stale when pass is true and at is in the future relative to now', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readEnvelopeWitness-'));
  try {
    const p = join(dir, 'w.json');
    const at = '2024-01-11T00:00:00.000Z';
    writeFileSync(p, JSON.stringify({ pass: true, at }));
    const now = '2024-01-10T00:00:00.000Z';
    assert.deepEqual(readEnvelopeWitness(p, now), { state: 'stale', at });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
