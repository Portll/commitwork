// Groups touch rows by session ref (admin/lib/session-view.mjs readTouches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTouches } from '../lib/session-view.mjs';

test('returns ok false with empty byRef when readFile throws non-ENOENT', () => {
  const err = new Error('boom');
  err.code = 'EACCES';
  const res = readTouches({ dir: '/d', readFile: () => { throw err; } });
  assert.equal(res.ok, false);
  assert.equal(res.why, '/d/touches.jsonl: EACCES');
  assert.equal(res.byRef.size, 0);
  assert.equal(res.rows.length, 0);
});

test('returns ok true with absent true and empty byRef when file is missing', () => {
  const err = new Error('no file');
  err.code = 'ENOENT';
  const res = readTouches({ dir: '/d', readFile: () => { throw err; } });
  assert.equal(res.ok, true);
  assert.equal(res.absent, true);
  assert.equal(res.byRef.size, 0);
  assert.equal(res.rows.length, 0);
});

test('returns ok true with absent false and empty byRef when file is empty', () => {
  const res = readTouches({ dir: '/d', readFile: () => '' });
  assert.equal(res.ok, true);
  assert.equal(res.absent, false);
  assert.equal(res.byRef.size, 0);
  assert.equal(res.rows.length, 0);
});

test('groups rows by session ref and skips rows without valid x or s', () => {
  const content = [
    JSON.stringify({ x: 'a', s: 'sess1' }),
    JSON.stringify({ x: 'b', s: 'sess1' }),
    JSON.stringify({ x: 'c', s: 'sess2' }),
    JSON.stringify({ x: 'd' }),
    JSON.stringify({ s: 'sess3' }),
    JSON.stringify({ x: 1, s: 'sess4' }),
    JSON.stringify({ x: 'e', s: 42 }),
    '',
    '   ',
    'not-json',
  ].join('\n');
  const res = readTouches({ dir: '/d', readFile: () => content });
  assert.equal(res.ok, true);
  assert.equal(res.absent, false);
  assert.equal(res.rows.length, 7);
  assert.equal(res.byRef.size, 2);
  assert.equal(res.byRef.get('sess1').length, 2);
  assert.equal(res.byRef.get('sess1')[0].x, 'a');
  assert.equal(res.byRef.get('sess1')[1].x, 'b');
  assert.equal(res.byRef.get('sess2').length, 1);
  assert.equal(res.byRef.get('sess2')[0].x, 'c');
});

test('skips null rows and rows with non-string x', () => {
  const content = [
    'null',
    JSON.stringify({ x: null, s: 's1' }),
    JSON.stringify({ x: 'valid', s: 's1' }),
  ].join('\n');
  const res = readTouches({ dir: '/d', readFile: () => content });
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 3);
  assert.equal(res.byRef.size, 1);
  assert.equal(res.byRef.get('s1').length, 1);
  assert.equal(res.byRef.get('s1')[0].x, 'valid');
});

test('handles multiple sessions with repeated refs', () => {
  const rows = Array.from({ length: 5 }, (_, i) => JSON.stringify({ x: `x${i}`, s: i % 2 === 0 ? 'even' : 'odd' }));
  const res = readTouches({ dir: '/d', readFile: () => rows.join('\n') });
  assert.equal(res.ok, true);
  assert.equal(res.byRef.size, 2);
  assert.equal(res.byRef.get('even').length, 3);
  assert.equal(res.byRef.get('odd').length, 2);
});
