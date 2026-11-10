// The gate's own error rate from the latest sweep-area-verdict in a journal (admin/routes/rollups.mjs canaryOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaryOf } from '../routes/rollups.mjs';

test('returns unreadable with detail when state is unreadable', () => {
  const jr = { state: 'unreadable', detail: 'EACCES' };
  assert.deepEqual(canaryOf(jr), { state: 'unreadable', why: 'the sweep journal could not be read (EACCES)' });
});

test('returns not-measured when no sweep verdict is recorded', () => {
  const jr = { state: 'ok', records: [{ kind: 'other', at: '2024-01-01T00:00:00Z' }] };
  assert.deepEqual(canaryOf(jr), { state: 'not-measured', why: 'no sweep verdict is recorded for this area' });
});

test('returns not-measured with predates when canary is missing', () => {
  const jr = { state: 'ok', records: [{ kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z' }] };
  assert.deepEqual(canaryOf(jr), { state: 'not-measured', at: '2024-01-01T00:00:00Z', predates: true, why: 'the latest sweep verdict predates canary journaling' });
});

test('returns not-measured with predates when canary state is not a string', () => {
  const jr = { state: 'ok', records: [{ kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 42 } }] };
  assert.deepEqual(canaryOf(jr), { state: 'not-measured', at: '2024-01-01T00:00:00Z', predates: true, why: 'the latest sweep verdict predates canary journaling' });
});

test('returns canary fields with state and why when present', () => {
  const jr = { state: 'ok', records: [{ kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 'clean', why: 'all good' } }] };
  assert.deepEqual(canaryOf(jr), { state: 'clean', why: 'all good', at: '2024-01-01T00:00:00Z' });
});

test('includes falseClean with rate keys when present', () => {
  const jr = { state: 'ok', records: [{ kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 'clean', falseClean: { state: 'ok', n: 1, of: 10, rate: 0.1, why: 'x' } } }] };
  assert.deepEqual(canaryOf(jr), { state: 'clean', at: '2024-01-01T00:00:00Z', falseClean: { state: 'ok', n: 1, of: 10, rate: 0.1, why: 'x' } });
});

test('includes falseAlarm with rate keys when present', () => {
  const jr = { state: 'ok', records: [{ kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 'alarm', falseAlarm: { state: 'ok', n: 2, of: 5, rate: 0.4, why: 'y' } } }] };
  assert.deepEqual(canaryOf(jr), { state: 'alarm', at: '2024-01-01T00:00:00Z', falseAlarm: { state: 'ok', n: 2, of: 5, rate: 0.4, why: 'y' } });
});

test('includes attribution with scored and wrong when present', () => {
  const jr = { state: 'ok', records: [{ kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 'clean', attribution: { scored: 3, wrong: 1 } } }] };
  assert.deepEqual(canaryOf(jr), { state: 'clean', at: '2024-01-01T00:00:00Z', attribution: { scored: 3, wrong: 1 } });
});

test('picks the latest sweep verdict by timestamp when multiple exist', () => {
  const jr = { state: 'ok', records: [
    { kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 'old' } },
    { kind: 'sweep-area-verdict', at: '2024-01-02T00:00:00Z', canary: { state: 'new' } },
  ] };
  assert.deepEqual(canaryOf(jr), { state: 'new', at: '2024-01-02T00:00:00Z' });
});

test('skips records with invalid timestamps', () => {
  const jr = { state: 'ok', records: [
    { kind: 'sweep-area-verdict', at: 'not-a-date', canary: { state: 'bad' } },
    { kind: 'sweep-area-verdict', at: '2024-01-01T00:00:00Z', canary: { state: 'good' } },
  ] };
  assert.deepEqual(canaryOf(jr), { state: 'good', at: '2024-01-01T00:00:00Z' });
});
