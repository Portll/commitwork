// Re-anchors moved queue entries to their new line numbers (bin/anchor-staleness.mjs reanchor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reanchor } from '../anchor-staleness.mjs';

test('throws when headSha is missing', () => {
  assert.throws(() => reanchor({ queue: [] }, [], null), /reanchor needs the current HEAD sha/);
});

test('returns zero moved and empty skipped when queue is empty', () => {
  const result = reanchor({ queue: [] }, [], 'abc123');
  assert.deepEqual(result, { n: 0, skipped: [] });
});

test('skips entries whose result state is not MOVED', () => {
  const queue = { queue: [{ id: 'a', file: 'f.js', line: 10 }] };
  const results = [{ id: 'a', state: 'anchor-unchanged', nowLine: 12 }];
  const result = reanchor(queue, results, 'abc123');
  assert.equal(result.n, 0);
  assert.deepEqual(queue.queue[0], { id: 'a', file: 'f.js', line: 10 });
});

test('skips entries whose result has non-finite nowLine', () => {
  const queue = { queue: [{ id: 'a', file: 'f.js', line: 10 }] };
  const results = [{ id: 'a', state: 'anchor-moved', nowLine: NaN }];
  const result = reanchor(queue, results, 'abc123');
  assert.equal(result.n, 0);
  assert.deepEqual(queue.queue[0], { id: 'a', file: 'f.js', line: 10 });
});

test('skips entries where from line equals nowLine', () => {
  const queue = { queue: [{ id: 'a', file: 'f.js', line: 10 }] };
  const results = [{ id: 'a', state: 'anchor-moved', nowLine: 10, verifiedAtHead: 'old', anchorHash: 'h' }];
  const result = reanchor(queue, results, 'abc123');
  assert.equal(result.n, 0);
  assert.deepEqual(queue.queue[0], { id: 'a', file: 'f.js', line: 10 });
});

test('re-anchors a moved entry and updates line, anchor, and verifiedAtHead', () => {
  const queue = { queue: [{ id: 'a', file: 'f.js', line: 10 }] };
  const results = [{ id: 'a', state: 'anchor-moved', nowLine: 15, verifiedAtHead: 'old', anchorHash: 'h1' }];
  const result = reanchor(queue, results, 'abc123');
  assert.equal(result.n, 1);
  assert.deepEqual(result.skipped, []);
  const e = queue.queue[0];
  assert.equal(e.line, 15);
  assert.equal(e.anchor, 'f.js:15');
  assert.equal(e.verifiedAtHead, 'abc123');
  assert.deepEqual(e.reanchor, {
    fromLine: 10,
    fromRef: 'old',
    toLine: 15,
    delta: 5,
    anchorHash: 'h1',
    note: 'line moved; the anchored source text is unchanged. Re-based, NOT re-verified.',
  });
});

test('skips re-anchoring when file is in skipFiles set', () => {
  const queue = { queue: [{ id: 'a', file: 'f.js', line: 10 }] };
  const results = [{ id: 'a', state: 'anchor-moved', nowLine: 15, verifiedAtHead: 'old', anchorHash: 'h1' }];
  const result = reanchor(queue, results, 'abc123', { skipFiles: new Set(['f.js']) });
  assert.equal(result.n, 0);
  assert.deepEqual(result.skipped, ['f.js:10 (a)']);
  assert.equal(queue.queue[0].line, 10);
  assert.equal(queue.queue[0].reanchor, undefined);
});

test('handles multiple entries with mixed states correctly', () => {
  const queue = {
    queue: [
      { id: 'a', file: 'f1.js', line: 5 },
      { id: 'b', file: 'f2.js', line: 20 },
      { id: 'c', file: 'f3.js', line: 8 },
    ],
  };
  const results = [
    { id: 'a', state: 'anchor-moved', nowLine: 7, verifiedAtHead: 'old', anchorHash: 'ha' },
    { id: 'b', state: 'anchor-unchanged', nowLine: 20 },
    { id: 'c', state: 'anchor-moved', nowLine: 12, verifiedAtHead: 'old', anchorHash: 'hc' },
  ];
  const result = reanchor(queue, results, 'newsha');
  assert.equal(result.n, 2);
  assert.deepEqual(result.skipped, []);
  assert.equal(queue.queue[0].line, 7);
  assert.equal(queue.queue[1].line, 20);
  assert.equal(queue.queue[2].line, 12);
  assert.equal(queue.queue[0].verifiedAtHead, 'newsha');
  assert.equal(queue.queue[1].verifiedAtHead, undefined);
  assert.equal(queue.queue[2].verifiedAtHead, 'newsha');
});

test('skips entry when result id is not found in results', () => {
  const queue = { queue: [{ id: 'missing', file: 'f.js', line: 10 }] };
  const results = [];
  const result = reanchor(queue, results, 'abc123');
  assert.equal(result.n, 0);
  assert.deepEqual(queue.queue[0], { id: 'missing', file: 'f.js', line: 10 });
});
