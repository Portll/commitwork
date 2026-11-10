// Maps fleet-roster.jsonl rows into a sessionId-keyed roster (admin/lib/session-view.mjs readRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoster } from '../lib/session-view.mjs';

test('returns ok true with absent true and empty map when file is missing', () => {
  const readFile = () => { const e = new Error('no file'); e.code = 'ENOENT'; throw e; };
  const res = readRoster({ dir: '/tmp/x', readFile });
  assert.equal(res.ok, true);
  assert.equal(res.absent, true);
  assert.equal(res.byId.size, 0);
});

test('returns ok false with why and empty map when readFile throws non-ENOENT', () => {
  const readFile = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; };
  const res = readRoster({ dir: '/tmp/x', readFile });
  assert.equal(res.ok, false);
  assert.equal(res.why, '/tmp/x/fleet-roster.jsonl: EACCES');
  assert.equal(res.byId.size, 0);
});

test('returns ok false with why and empty map when readFile throws without code', () => {
  const readFile = () => { throw new Error('boom'); };
  const res = readRoster({ dir: '/tmp/x', readFile });
  assert.equal(res.ok, false);
  assert.equal(res.why, "/tmp/x/fleet-roster.jsonl: Error: boom");
  assert.equal(res.byId.size, 0);
});

test('returns ok true with absent false and empty map when file is empty', () => {
  const res = readRoster({ dir: '/tmp/x', readFile: () => '' });
  assert.equal(res.ok, true);
  assert.equal(res.absent, false);
  assert.equal(res.byId.size, 0);
});

test('parses valid rows into byId keyed by sessionId', () => {
  const txt = JSON.stringify({ sessionId: 'a', name: 'alpha' }) + '\n' + JSON.stringify({ sessionId: 'b', name: 'beta' });
  const res = readRoster({ dir: '/tmp/x', readFile: () => txt });
  assert.equal(res.ok, true);
  assert.equal(res.absent, false);
  assert.equal(res.byId.size, 2);
  assert.deepEqual(res.byId.get('a'), { sessionId: 'a', name: 'alpha' });
  assert.deepEqual(res.byId.get('b'), { sessionId: 'b', name: 'beta' });
});

test('skips rows without a string sessionId', () => {
  const txt = JSON.stringify({ name: 'no-id' }) + '\n' + JSON.stringify({ sessionId: 42 }) + '\n' + JSON.stringify({ sessionId: 'ok' });
  const res = readRoster({ dir: '/tmp/x', readFile: () => txt });
  assert.equal(res.byId.size, 1);
  assert.equal(res.byId.has('ok'), true);
  assert.equal(res.byId.has(42), false);
});

test('skips null rows and torn JSON lines', () => {
  const txt = 'null\n{bad json\n' + JSON.stringify({ sessionId: 's1' });
  const res = readRoster({ dir: '/tmp/x', readFile: () => txt });
  assert.equal(res.byId.size, 1);
  assert.equal(res.byId.has('s1'), true);
});

test('merges later rows with same sessionId over earlier fields', () => {
  const txt = JSON.stringify({ sessionId: 'dup', a: 1, b: 2 }) + '\n' + JSON.stringify({ sessionId: 'dup', b: 3, c: 4 });
  const res = readRoster({ dir: '/tmp/x', readFile: () => txt });
  assert.equal(res.byId.size, 1);
  assert.deepEqual(res.byId.get('dup'), { sessionId: 'dup', a: 1, b: 3, c: 4 });
});

test('skips blank lines and lines with only whitespace', () => {
  const txt = '\n   \n' + JSON.stringify({ sessionId: 'x' }) + '\n\t\n';
  const res = readRoster({ dir: '/tmp/x', readFile: () => txt });
  assert.equal(res.byId.size, 1);
  assert.equal(res.byId.has('x'), true);
});
