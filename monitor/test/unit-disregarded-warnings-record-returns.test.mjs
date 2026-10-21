// Records return events into the disregarded-warnings register, deduplicating by key and setAsideAt (monitor/disregarded-warnings.mjs recordReturns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordReturns } from '../disregarded-warnings.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok with zero appended and zero already for empty events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const result = recordReturns(path, [], { now: '2024-01-01T00:00:00.000Z', via: 'reader1' });
    assert.deepEqual(result, { ok: true, appended: 0, already: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with zero appended and zero already for undefined events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const result = recordReturns(path, undefined, { now: '2024-01-01T00:00:00.000Z', via: 'reader1' });
    assert.deepEqual(result, { ok: true, appended: 0, already: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when register is absent and event is valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const ev = { source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js:10', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-03T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, false);
    assert.match(result.error, /no register to record a return in/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with appended 0 and already 1 when return is already on record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const existing = {
      disregarded: [],
      returned: [
        { key: 'eslint:no-unused-vars|src/a.js', source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z', recordedAt: '2024-01-03T00:00:00.000Z', via: 'reader1' }
      ]
    };
    writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
    const ev = { source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js:10', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-04T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, true);
    assert.equal(result.appended, 0);
    assert.equal(result.already, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with appended 1 and already 1 for mixed new and duplicate events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const existing = {
      disregarded: [],
      returned: [
        { key: 'eslint:no-unused-vars|src/a.js', source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z', recordedAt: '2024-01-03T00:00:00.000Z', via: 'reader1' }
      ]
    };
    writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
    const ev1 = { source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js:10', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const ev2 = { source: 'eslint', code: 'no-undef', subject: 'src/b.js:5', setAsideAt: '2024-01-05T00:00:00.000Z', seenAt: '2024-01-06T00:00:00.000Z' };
    const result = recordReturns(path, [ev1, ev2], { now: '2024-01-07T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, true);
    assert.equal(result.appended, 1);
    assert.equal(result.already, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when event has invalid source token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const ev = { source: 'bad source', code: 'no-unused-vars', subject: 'src/a.js:10', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-03T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, false);
    assert.match(result.error, /refused/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when event has invalid code token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const ev = { source: 'eslint', code: 'bad code', subject: 'src/a.js:10', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-03T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, false);
    assert.match(result.error, /refused/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when event has invalid subject', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const ev = { source: 'eslint', code: 'no-unused-vars', subject: 123, setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-03T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, false);
    assert.match(result.error, /refused/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when via is not a valid token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const ev = { source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js:10', setAsideAt: '2024-01-01T00:00:00.000Z', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-03T00:00:00.000Z', via: 'bad via' });
    assert.equal(result.ok, false);
    assert.match(result.error, /refused/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error when setAsideAt is not a valid timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordReturns-'));
  try {
    const path = join(dir, 'register.json');
    const ev = { source: 'eslint', code: 'no-unused-vars', subject: 'src/a.js:10', setAsideAt: 'not-a-date', seenAt: '2024-01-02T00:00:00.000Z' };
    const result = recordReturns(path, [ev], { now: '2024-01-03T00:00:00.000Z', via: 'reader1' });
    assert.equal(result.ok, false);
    assert.match(result.error, /refused/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
