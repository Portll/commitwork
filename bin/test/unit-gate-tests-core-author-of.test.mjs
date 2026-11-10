// Which single session wrote a path, per touch-ledger lines (bin/gate-tests-core.mjs authorOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorOf } from '../gate-tests-core.mjs';

const WRITE = { tool: 'Write', t: 'write', k: 'write', kind: 'write', op: 'write', type: 'write', action: 'write', ev: 'write', evidence: 'write', event: 'PostToolUse', w: true, write: true };
const wrote = (fields) => JSON.stringify({ ...WRITE, ...fields });

test('returns unknown with no ledger lines or no options at all', () => {
  assert.deepEqual(authorOf('a.txt'), { session: null, basis: 'unknown' });
  assert.deepEqual(authorOf('a.txt', { ledgerLines: [] }), { session: null, basis: 'unknown' });
});

test('attributes a path to the one session whose write line names it', () => {
  const r = authorOf('a.txt', { ledgerLines: [wrote({ f: 'a.txt', s: 's1' })] });
  assert.deepEqual(r, { session: 's1', basis: 'write' });
});

test('reports contested with both sessions when two sessions wrote the path', () => {
  const r = authorOf('a.txt', { ledgerLines: [wrote({ f: 'a.txt', s: 's1' }), wrote({ f: 'a.txt', s: 's2' })] });
  assert.deepEqual(r, { session: null, basis: 'contested', sessions: ['s1', 's2'] });
});

test('counts repeated writes by one session once and skips unparseable lines', () => {
  const lines = ['{not json', ...Array.from({ length: 3 }, () => wrote({ f: 'a.txt', s: 's1' }))];
  assert.deepEqual(authorOf('a.txt', { ledgerLines: lines }), { session: 's1', basis: 'write' });
});

test('ignores write lines for a different path', () => {
  const r = authorOf('a.txt', { ledgerLines: [wrote({ f: 'b.txt', s: 's1' })] });
  assert.deepEqual(r, { session: null, basis: 'unknown' });
});

test('ignores lines with an empty path field even when the path asked for is empty', () => {
  const r = authorOf('', { ledgerLines: [wrote({ f: '', s: 's1' })] });
  assert.deepEqual(r, { session: null, basis: 'unknown' });
});

test('ignores matching lines that are not write evidence', () => {
  const r = authorOf('a.txt', { ledgerLines: [JSON.stringify({ f: 'a.txt', s: 's1' })] });
  assert.deepEqual(r, { session: null, basis: 'unknown' });
});

test('attributes to the writer when another session only has a non-write line', () => {
  const r = authorOf('a.txt', { ledgerLines: [JSON.stringify({ f: 'a.txt', s: 's2' }), wrote({ f: 'a.txt', s: 's1' })] });
  assert.deepEqual(r, { session: 's1', basis: 'write' });
});

test('returns unknown when the write lines carry no session', () => {
  const r = authorOf('a.txt', { ledgerLines: [wrote({ f: 'a.txt' }), wrote({ f: 'a.txt', s: '' })] });
  assert.deepEqual(r, { session: null, basis: 'unknown' });
});

test('keeps write lines claimed by the current tree when myTree is given', () => {
  const tree = '/w/repo';
  const path = `${tree}/a.txt`;
  const r = authorOf(path, { myTree: tree, ledgerLines: [wrote({ f: path, s: 's1', tree, wt: tree, cwd: tree, root: tree })] });
  assert.deepEqual(r, { session: 's1', basis: 'write' });
});
