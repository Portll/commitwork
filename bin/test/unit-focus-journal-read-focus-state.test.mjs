// Reads the focus journal file and returns its parse state, streak, prompts, lastIso, and raw text (bin/focus-journal.mjs readFocusState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFocusState } from '../focus-journal.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'missing.json');
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'absent', streak: null, prompts: null, raw: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with error code when the file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'sub');
    const r = readFocusState(p);
    assert.deepEqual(r, { state: "absent", streak: null, prompts: null, raw: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable unparseable when the file contains invalid json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'unreadable', detail: 'unparseable', streak: null, prompts: null, raw: 'not json' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable no-streak-field when nudgeStreak is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'nostreak.json');
    writeFileSync(p, JSON.stringify({ prompts: 5 }));
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'unreadable', detail: 'no-streak-field', streak: null, prompts: null, raw: '{"prompts":5}' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable no-streak-field when nudgeStreak is not a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'strstreak.json');
    writeFileSync(p, JSON.stringify({ nudgeStreak: '3', prompts: 2 }));
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'unreadable', detail: 'no-streak-field', streak: null, prompts: null, raw: '{"nudgeStreak":"3","prompts":2}' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with streak and prompts when both are finite numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ nudgeStreak: 3, prompts: 7, lastIso: '2024-01-01T00:00:00Z' }));
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'ok', streak: 3, prompts: 7, lastIso: '2024-01-01T00:00:00Z', raw: '{"nudgeStreak":3,"prompts":7,"lastIso":"2024-01-01T00:00:00Z"}' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with null prompts when prompts is not a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'noprompts.json');
    writeFileSync(p, JSON.stringify({ nudgeStreak: 1, prompts: 'x' }));
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'ok', streak: 1, prompts: null, lastIso: null, raw: '{"nudgeStreak":1,"prompts":"x"}' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with null lastIso when lastIso is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFocusState-'));
  try {
    const p = join(dir, 'nolastiso.json');
    writeFileSync(p, JSON.stringify({ nudgeStreak: 2, prompts: 4, lastIso: 123 }));
    const r = readFocusState(p);
    assert.deepEqual(r, { state: 'ok', streak: 2, prompts: 4, lastIso: null, raw: '{"nudgeStreak":2,"prompts":4,"lastIso":123}' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
