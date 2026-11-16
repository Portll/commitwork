// monitor/test/anchor-disposition-join.test.mjs — case tests for joinKinds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinKinds, PROBEABLE_KINDS } from '../anchor-disposition.mjs';

const staleRow = (anchor) => ({ anchor, state: 'drifted', baselineHash: 'base', currentHash: 'cur' });

test('joins a matched row to the queue kind', () => {
  const { rows, counts } = joinKinds(
    [staleRow('src/a.js:10')],
    [{ anchor: 'src/a.js:10', kind: 'dead' }],
  );
  assert.deepEqual(rows, [
    { anchor: 'src/a.js:10', state: 'drifted', baselineHash: 'base', currentHash: 'cur', kind: 'dead', kindSource: 'queue' },
  ]);
  assert.deepEqual(counts, { total: 1, joined: 1, unjoined: 0, ambiguous: 0, probeable: 1 });
});

test('marks a row with no queue entry as kind null / none', () => {
  const { rows, counts } = joinKinds([staleRow('src/a.js:10')], [{ anchor: 'src/b.js:3', kind: 'dead' }]);
  assert.deepEqual(rows, [
    { anchor: 'src/a.js:10', state: 'drifted', baselineHash: 'base', currentHash: 'cur', kind: null, kindSource: 'none' },
  ]);
  assert.deepEqual(counts, { total: 1, joined: 0, unjoined: 1, ambiguous: 0, probeable: 0 });
});

test('marks a queue entry with no string kind as none', () => {
  const { rows } = joinKinds([staleRow('src/a.js:10')], [{ anchor: 'src/a.js:10', kind: 7 }]);
  assert.equal(rows[0].kind, null);
  assert.equal(rows[0].kindSource, 'none');
});

test('marks an anchor whose queue rows disagree as ambiguous', () => {
  const { rows, counts } = joinKinds(
    [staleRow('src/a.js:10')],
    [{ anchor: 'src/a.js:10', kind: 'dead' }, { anchor: 'src/a.js:10', kind: 'stub' }],
  );
  assert.equal(rows[0].kind, null);
  assert.equal(rows[0].kindSource, 'ambiguous');
  assert.deepEqual(counts, { total: 1, joined: 0, unjoined: 1, ambiguous: 1, probeable: 0 });
});

test('uses the shared kind when duplicate queue rows agree', () => {
  const { rows, counts } = joinKinds(
    [staleRow('src/a.js:10')],
    [{ anchor: 'src/a.js:10', kind: 'hardcoded' }, { anchor: 'src/a.js:10', kind: 'hardcoded' }],
  );
  assert.equal(rows[0].kind, 'hardcoded');
  assert.equal(rows[0].kindSource, 'queue');
  assert.deepEqual(counts, { total: 1, joined: 1, unjoined: 0, ambiguous: 0, probeable: 1 });
});

test('keeps a string kind the stale row already carries', () => {
  const stale = [{ anchor: 'src/a.js:10', state: 'drifted', kind: 'race' }];
  const { rows, counts } = joinKinds(stale, []);
  assert.deepEqual(rows, [{ anchor: 'src/a.js:10', state: 'drifted', kind: 'race', kindSource: 'row' }]);
  assert.deepEqual(counts, { total: 1, joined: 1, unjoined: 0, ambiguous: 0, probeable: 0 });
});

test('the stale row own kind wins over the queue kind', () => {
  const { rows } = joinKinds(
    [{ anchor: 'src/a.js:10', kind: 'race' }],
    [{ anchor: 'src/a.js:10', kind: 'dead' }],
  );
  assert.equal(rows[0].kind, 'race');
  assert.equal(rows[0].kindSource, 'row');
});

test('does not mutate either input', () => {
  const stale = [staleRow('src/a.js:10'), { anchor: 'src/b.js:2', kind: 'race' }];
  const queue = [{ anchor: 'src/a.js:10', kind: 'dead' }, { anchor: 'src/b.js:2', kind: 'stub' }];
  const staleClone = structuredClone(stale);
  const queueClone = structuredClone(queue);
  const { rows } = joinKinds(stale, queue);
  assert.deepEqual(stale, staleClone);
  assert.deepEqual(queue, queueClone);
  assert.notEqual(rows[0], stale[0]);
  assert.notEqual(rows[1], stale[1]);
});

test('counts a mixed set', () => {
  const stale = [
    staleRow('src/a.js:1'),
    staleRow('src/b.js:2'),
    staleRow('src/c.js:3'),
    staleRow('src/d.js:4'),
    staleRow('src/e.js:5'),
  ];
  const queue = [
    { anchor: 'src/a.js:1', kind: 'hardcoded' },
    { anchor: 'src/b.js:2', kind: 'stub' },
    { anchor: 'src/c.js:3', kind: 'taint' },
    { anchor: 'src/e.js:5', kind: 'dead' },
    { anchor: 'src/e.js:5', kind: 'stub' },
  ];
  const { rows, counts } = joinKinds(stale, queue);
  assert.deepEqual(rows.map((r) => r.anchor), ['src/a.js:1', 'src/b.js:2', 'src/c.js:3', 'src/d.js:4', 'src/e.js:5']);
  assert.deepEqual(rows.map((r) => [r.kind, r.kindSource]), [
    ['hardcoded', 'queue'],
    ['stub', 'queue'],
    ['taint', 'queue'],
    [null, 'none'],
    [null, 'ambiguous'],
  ]);
  assert.deepEqual(counts, { total: 5, joined: 3, unjoined: 2, ambiguous: 1, probeable: 2 });
});

test('staleness rows with no queue rows report unjoined, not "nothing probeable"', () => {
  const stale = [staleRow('src/a.js:1'), staleRow('src/b.js:2'), staleRow('src/c.js:3')];
  const { rows, counts } = joinKinds(stale, []);
  assert.equal(counts.probeable, 0);
  assert.equal(counts.unjoined, counts.total);
  assert.equal(counts.total, 3);
  assert.deepEqual(rows.map((r) => r.kind), [null, null, null]);
});

test('probeable counts only kinds in PROBEABLE_KINDS', () => {
  const queue = PROBEABLE_KINDS.map((kind, i) => ({ anchor: `src/p${i}.js:1`, kind }));
  queue.push({ anchor: 'src/q.js:1', kind: 'taint' });
  const stale = queue.map((q) => staleRow(q.anchor));
  const { counts } = joinKinds(stale, queue);
  assert.equal(counts.probeable, PROBEABLE_KINDS.length);
  assert.equal(counts.joined, PROBEABLE_KINDS.length + 1);
});

test('throws a TypeError naming staleRows when it is not an array', () => {
  assert.throws(() => joinKinds(null, []), { name: 'TypeError', message: /staleRows/ });
});

test('throws a TypeError naming queueRows when it is not an array', () => {
  assert.throws(() => joinKinds([], {}), { name: 'TypeError', message: /queueRows/ });
});
