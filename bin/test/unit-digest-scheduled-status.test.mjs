// Lists recent scheduled digest runs from the job journal (bin/digest-scheduled.mjs status).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { status } from '../digest-scheduled.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'no-such-status-root');
const NONE = 'no scheduled digest run recorded in ';
const DOT = ' \u00b7 ';
const DASH = ' \u2014 ';

const run = (records, { replace = false, ...opts } = {}) => {
  const logs = [];
  const warns = [];
  const filter = Array.prototype.filter;
  Array.prototype.filter = function (fn, self) {
    if (!String(fn).includes('JOB_RECORD_KIND')) return filter.call(this, fn, self);
    return replace ? records : filter.call(records, fn, self);
  };
  try {
    const code = status({ root: ROOT, ...opts, log: (s) => logs.push(s), warn: (s) => warns.push(s) });
    return { code, logs, warns };
  } finally {
    Array.prototype.filter = filter;
  }
};

const heads = (logs) => logs.map((s) => s.slice(0, NONE.length));
const plain = (n) => Array.from({ length: n }, (_, i) => ({ at: `t${i}`, exit: i, steps: [] }));
const lines = (from, to) => Array.from({ length: to - from }, (_, i) => `t${from + i}  exit ${from + i}  \n`);

test('reports that no run is recorded and returns 0 when the journal has no records', () => {
  const r = run([]);
  assert.equal(r.code, 0);
  assert.deepEqual(heads(r.logs), [NONE]);
  assert.deepEqual(r.warns, []);
});

test('ignores a digest record whose kind is not the job record kind', () => {
  const r = run([{ kind: 'not-a-job-record', job: 'digest', at: 'T1', exit: 0, steps: [] }]);
  assert.equal(r.code, 0);
  assert.deepEqual(heads(r.logs), [NONE]);
  assert.deepEqual(r.warns, []);
});

test('ignores null, undefined and zero entries in the journal', () => {
  const r = run([null, undefined, 0]);
  assert.equal(r.code, 0);
  assert.deepEqual(heads(r.logs), [NONE]);
});

test('prints a run with its exit code and every step outcome joined by a middle dot', () => {
  const steps = [{ step: 'build', outcome: 'ok' }, { step: 'deliver', outcome: 'sent' }];
  const r = run([{ at: '2026-10-01T03:00:00.000Z', exit: 0, steps }], { replace: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, [`2026-10-01T03:00:00.000Z  exit 0  build ok${DOT}deliver sent\n`]);
  assert.deepEqual(r.warns, []);
});

test('lists failed steps with their reason, or their outcome when no reason is given', () => {
  const steps = [
    { step: 'build', outcome: 'ok' },
    { step: 'deliver', outcome: 'refused', failed: true, reason: 'no destination' },
    { step: 'record', outcome: 'error', failed: true },
  ];
  const r = run([{ at: 'A', exit: 21, steps }], { replace: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, [
    `A  exit 21  build ok${DOT}deliver refused${DOT}record error  FAILED: deliver${DASH}no destination; record${DASH}error\n`,
  ]);
});

test('shows a question mark for a missing exit and treats non-array steps as none', () => {
  const r = run([{ at: 'B', steps: 'build' }, { at: 'C', exit: null, steps: [null] }], { replace: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, ['B  exit ?  \n', 'C  exit ?  undefined undefined\n']);
});

test('shows only the last limit runs, oldest first, when limit is one less than the run count', () => {
  const r = run(plain(3), { replace: true, limit: 2 });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, lines(1, 3));
});

test('shows every run when limit equals the run count', () => {
  const r = run(plain(3), { replace: true, limit: 3 });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, lines(0, 3));
});

test('shows the last ten runs by default', () => {
  const r = run(plain(11), { replace: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, lines(1, 11));
});
