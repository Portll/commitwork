import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageGaps } from '../coverage-gaps.mjs';

const zero = { covered: 0, failed: 0, skipped: 0, unavailable: 0, 'not-run': 0, undeclared: 0 };

test('every declared pair measured is covered', () => {
  const r = coverageGaps({
    declared: [{ lane: 'alpha', subject: 's1' }, { lane: 'beta', subject: 's2' }],
    measured: [{ lane: 'alpha', subject: 's1', outcome: 'measured', reason: 'ok' }, { lane: 'beta', subject: 's2', outcome: 'measured' }],
  });
  assert.deepEqual(r.totals, { ...zero, covered: 2 });
  assert.deepEqual(r.rows.map((x) => [x.status, x.reason]), [['covered', 'ok'], ['covered', null]]);
});

test('failed, skipped, unavailable and absent pairs are never covered', () => {
  const r = coverageGaps({
    declared: ['s1', 's2', 's3', 's4', 's5'].map((subject) => ({ lane: 'alpha', subject })),
    measured: [
      { lane: 'alpha', subject: 's1', outcome: 'measured', reason: 'ok' },
      { lane: 'alpha', subject: 's2', outcome: 'failed', reason: 'exit 2' },
      { lane: 'alpha', subject: 's3', outcome: 'skipped', reason: 'no lockfile' },
      { lane: 'alpha', subject: 's4', outcome: 'unavailable', reason: 'tool missing' },
    ],
  });
  assert.deepEqual(r.totals, { covered: 1, failed: 1, skipped: 1, unavailable: 1, 'not-run': 1, undeclared: 0 });
  assert.deepEqual(r.rows.map((x) => [x.subject, x.status, x.reason]), [
    ['s1', 'covered', 'ok'], ['s2', 'failed', 'exit 2'], ['s3', 'skipped', 'no lockfile'], ['s4', 'unavailable', 'tool missing'], ['s5', 'not-run', null],
  ]);
});

test('an undeclared measured row keeps its outcome', () => {
  const r = coverageGaps({
    declared: [{ lane: 'alpha', subject: 's1' }],
    measured: [{ lane: 'alpha', subject: 's1', outcome: 'measured' }, { lane: 'beta', subject: 's2', outcome: 'failed', reason: 'crash' }],
  });
  assert.deepEqual(r.totals, { ...zero, covered: 1, undeclared: 1 });
  assert.deepEqual(r.rows[1], { lane: 'beta', subject: 's2', status: 'undeclared', outcome: 'failed', reason: 'crash' });
});

test('rows sort by lane then subject whatever the input order', () => {
  const declared = [{ lane: 'zeta', subject: 's1' }, { lane: 'alpha', subject: 's2' }, { lane: 'alpha', subject: 's1' }, { lane: 'zeta', subject: 's0' }];
  const a = coverageGaps({ declared, measured: [] });
  assert.deepEqual(a.rows.map((x) => `${x.lane}:${x.subject}`), ['alpha:s1', 'alpha:s2', 'zeta:s0', 'zeta:s1']);
  assert.deepEqual(coverageGaps({ declared: [...declared].reverse(), measured: [] }), a);
});

test('a lane/subject split cannot collide with another pair', () => {
  const r = coverageGaps({
    declared: [{ lane: 'a', subject: 'b:c' }, { lane: 'a:b', subject: 'c' }],
    measured: [{ lane: 'a', subject: 'b:c', outcome: 'measured' }],
  });
  assert.deepEqual(r.totals, { ...zero, covered: 1, 'not-run': 1 });
});

test('duplicate pairs, unknown outcomes and empty values are refused', () => {
  assert.throws(() => coverageGaps({ declared: [{ lane: 'a', subject: 's' }, { lane: 'a', subject: 's' }], measured: [] }), /duplicate declared pair/);
  assert.throws(() => coverageGaps({ declared: [], measured: [{ lane: 'a', subject: 's', outcome: 'measured' }, { lane: 'a', subject: 's', outcome: 'failed' }] }), /duplicate measured pair/);
  assert.throws(() => coverageGaps({ declared: [], measured: [{ lane: 'a', subject: 's', outcome: 'clean' }] }), /outcome must be one of/);
  assert.throws(() => coverageGaps({ declared: [], measured: [{ lane: 'a', subject: 's', outcome: 'toString' }] }), /outcome must be one of/);
  assert.throws(() => coverageGaps({ declared: [{ lane: '', subject: 's' }], measured: [] }), /declared\[0\]\.lane/);
  assert.throws(() => coverageGaps({ declared: [{ lane: 'a', subject: '  ' }], measured: [] }), /declared\[0\]\.subject/);
  assert.throws(() => coverageGaps({ declared: [], measured: [{ lane: 'a', subject: 's', outcome: 'measured', reason: 5 }] }), /reason must be a string/);
});

test('bad top-level arguments are refused', () => {
  assert.throws(() => coverageGaps({ declared: null, measured: [] }), /declared must be an array/);
  assert.throws(() => coverageGaps({ declared: [], measured: null }), /measured must be an array/);
  assert.throws(() => coverageGaps(), /declared must be an array/);
  assert.throws(() => coverageGaps({ declared: [null], measured: [] }), /declared\[0\] must be an object/);
});

test('empty inputs give empty rows and zero totals', () => {
  assert.deepEqual(coverageGaps({ declared: [], measured: [] }), { rows: [], totals: zero });
});
