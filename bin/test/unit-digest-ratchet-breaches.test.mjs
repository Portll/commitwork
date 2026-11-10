// Floor breaches per gate and subject, with undetermined runs and coverage, from verdict journals in a window (bin/digest.mjs ratchetBreaches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratchetBreaches } from '../digest.mjs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const fs = process.getBuiltinModule('node:fs');
const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
const W = { since: '2026-01-01', until: '2026-01-31' };
const ABSENT = ' journal absent \u2014 the gate has never recorded a run here';
let seq = 0;

function run(journals, gates) {
  const dir = `/vj/${++seq}`;
  const files = new Map(Object.entries(journals).map(([g, lines]) => [
    join(dir, `${g}.jsonl`),
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
  ]));
  const has = (p) => files.has(String(p));
  const missing = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });
  const saved = { readFileSync: fs.readFileSync, existsSync: fs.existsSync, statSync: fs.statSync };
  Object.assign(fs, {
    readFileSync: (p, o) => {
      if (!has(p)) throw missing(p);
      const text = files.get(String(p));
      return (typeof o === 'string' ? o : o?.encoding) ? text : Buffer.from(text);
    },
    existsSync: has,
    statSync: (p, o) => {
      if (has(p)) return { size: Buffer.byteLength(files.get(String(p))), mtimeMs: seq, isFile: () => true, isDirectory: () => false };
      if (o?.throwIfNoEntry === false) return undefined;
      throw missing(p);
    },
  });
  syncBuiltinESMExports();
  try {
    return ratchetBreaches({ root: dir, window: W, dir, gates });
  } finally {
    Object.assign(fs, saved);
    syncBuiltinESMExports();
  }
}

const view = ({ caveats, items, ...rest }) => ({ ...rest, items: items.map(({ key, ...item }) => item) });
const input = (gate, state = 'read') => ({ name: `${gate} verdict journal`, path: `${gate}.jsonl`, state });
const worse = (at, metrics, baseline) => ({ at, verdict: 'worse', metrics, baseline });
const item = (gate, subject, baseline, peak, latest, firstAt, lastAt, runs, standing, runsInWindow) =>
  ({ gate, subject, baseline, peak, latest, firstAt, lastAt, runs, standing, runsInWindow });

test('every default gate without a journal is absent and the section is not measured', () => {
  assert.deepEqual(view(run({})), {
    title: 'Ratchet breaches',
    input: [input('gate-ratchet', 'absent'), input('gate-tests', 'absent')],
    notMeasured: [`gate-ratchet:${ABSENT}`, `gate-tests:${ABSENT}`],
    items: [],
    undetermined: [],
    status: 'not-measured',
  });
});

test('only undetermined runs inside the window are counted by verdict and the last record is named', () => {
  const r = run({ 'gate-tests': [
    { at: '2026-01-01', verdict: 'regression-new', headFail: 1 },
    { at: '2026-01-05', verdict: 'deferred' },
    { at: '2026-01-06', verdict: 'deferred' },
    { at: '2026-01-31', verdict: 'baseline-unreadable' },
    { at: '2026-02-01', verdict: 'no-tally' },
  ] }, ['gate-tests']);
  assert.deepEqual(view(r), {
    title: 'Ratchet breaches',
    input: [input('gate-tests')],
    notMeasured: ['gate-tests: no decided run in window (3 undetermined; last record 2026-02-01)'],
    items: [],
    undetermined: [{ gate: 'gate-tests', runs: 3, byVerdict: { 'baseline-unreadable': 1, deferred: 2 } }],
    status: 'not-measured',
  });
});

test('ratchet metrics over their baseline are grouped with runs, peak, latest and standing', () => {
  const r = run({ 'gate-ratchet': [
    worse('2026-01-01', { lint: 50 }, { lint: 1 }),
    worse('2026-01-02', { lint: 5, size: 3 }, { lint: 2, size: 3 }),
    { at: '2026-01-03', verdict: 'same', metrics: {}, baseline: {} },
    worse('2026-01-04', { lint: 9, size: 4 }, { lint: 2, size: 3 }),
    { at: '2026-01-05', verdict: 'deferred' },
    worse('2026-01-31', { lint: 6 }, { lint: 2 }),
  ] }, ['gate-ratchet']);
  assert.deepEqual(view(r), {
    title: 'Ratchet breaches',
    input: [input('gate-ratchet')],
    notMeasured: [],
    items: [
      item('gate-ratchet', 'lint', 2, 9, 6, '2026-01-02', '2026-01-31', 3, true, 4),
      item('gate-ratchet', 'size', 3, 4, 4, '2026-01-04', '2026-01-04', 1, false, 4),
    ],
    undetermined: [{ gate: 'gate-ratchet', runs: 1, byVerdict: { deferred: 1 } }],
    status: 'measured',
  });
});

test('test gate breaches are keyed by verdict and pending regressions are not breaches', () => {
  const r = run({ 'gate-tests': [
    { at: '2026-01-02', verdict: 'regression-new-failures', names: ['a', 'b'], baseline: { fail: 0 } },
    { at: '2026-01-03', verdict: 'regression-pending', headFail: 9 },
    { at: '2026-01-04', verdict: 'regression-new-failures', headFail: 4, baseline: { fail: 0 } },
    { at: '2026-01-05', verdict: 'coverage-drop', headFail: 3 },
  ] }, ['gate-tests']);
  assert.deepEqual(view(r), {
    title: 'Ratchet breaches',
    input: [input('gate-tests')],
    notMeasured: [],
    items: [
      item('gate-tests', 'coverage-drop', null, 3, 3, '2026-01-05', '2026-01-05', 1, true, 4),
      item('gate-tests', 'regression-new-failures', 0, 4, 4, '2026-01-02', '2026-01-04', 2, false, 4),
    ],
    undetermined: [],
    status: 'measured',
  });
});

test('an equal later value does not replace the peak and a breach with no metric over baseline is unattributed', () => {
  const r = run({ 'gate-ratchet': [
    '{"at":"2026-01-02","verdict":"worse","metrics":{"x":-0},"baseline":{"x":-1}}',
    '{"at":"2026-01-03","verdict":"worse","metrics":{"x":0},"baseline":{"x":-1}}',
    worse('2026-01-04', { x: 1 }, { x: 1 }),
  ] }, ['gate-ratchet']);
  assert.deepEqual(view(r).items, [
    item('gate-ratchet', 'unattributed', null, null, null, '2026-01-04', '2026-01-04', 1, true, 3),
    item('gate-ratchet', 'x', -1, -0, 0, '2026-01-02', '2026-01-03', 2, false, 3),
  ]);
});

test('one measured gate out of the two defaults makes the section partial', () => {
  const r = run({ 'gate-ratchet': [worse('2026-01-10', { lint: 3 }, { lint: 2 })] });
  assert.deepEqual(view(r), {
    title: 'Ratchet breaches',
    input: [input('gate-ratchet'), input('gate-tests', 'absent')],
    notMeasured: [`gate-tests:${ABSENT}`],
    items: [item('gate-ratchet', 'lint', 2, 3, 3, '2026-01-10', '2026-01-10', 1, true, 1)],
    undetermined: [],
    status: 'partial',
  });
});
