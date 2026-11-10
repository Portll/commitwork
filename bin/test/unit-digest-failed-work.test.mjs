// The digest's failed-work section from sweep and scheduled-job journals (bin/digest.mjs failedWork).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedWork } from '../digest.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const W = { since: '2025-01-01T00:00:00.000Z', until: '2025-01-02T00:00:00.000Z' };
const JOURNALS = 'rr/{,*/}sweep{,-fleet}-journal.jsonl';
const ms = (iso, d) => new Date(Date.parse(iso) + d).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const fleet = (at, stamp, areas, finalize = {}) => ({ kind: 'sweep-fleet-verdict', at, stamp, areas, finalize });
const pick = (r) => r.items.map(({ at, area, sliceId, type, subject, detail }) => ({ at, area, sliceId, type, subject, detail }));
const put = (rr, rel, rows) => {
  mkdirSync(join(rr, rel, '..'), { recursive: true });
  writeFileSync(join(rr, rel), jl(rows));
};

function run(build) {
  const dir = mkdtempSync(join(tmpdir(), 'failedWork-'));
  try {
    const rr = join(dir, 'rr');
    build(rr);
    return failedWork({ root: dir, window: W, reportsRoot: rr });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('an absent reports root is reported absent and nothing is measured', () => {
  assert.deepEqual(run(() => {}), {
    title: 'Failed work', input: [{ name: 'reports root', path: 'rr', state: 'absent' }],
    notMeasured: ['reports root absent at rr'], caveats: [], items: [], undetermined: [], status: 'not-measured',
  });
});

test('a reports root that is a file is reported unreadable with its error code', () => {
  assert.deepEqual(run((rr) => writeFileSync(rr, 'x')), {
    title: 'Failed work', input: [{ name: 'reports root', path: 'rr', state: 'unreadable' }],
    notMeasured: ['reports root unreadable (ENOTDIR)'], caveats: [], items: [], undetermined: [], status: 'not-measured',
  });
});

test('an empty reports root reads no journal and records no verdict', () => {
  const r = run((rr) => mkdirSync(rr));
  assert.deepEqual(r.input.slice(0, 3), [
    { name: 'reports root', path: 'rr', state: 'read' },
    { name: 'sweep verdict journals', path: JOURNALS, state: 'absent', files: 0, unreadable: 0 },
    { name: 'scheduled job journal', path: 'rr/scheduled-job-journal.jsonl', state: 'absent' },
  ]);
  assert.deepEqual(r.caveats, ['rr/scheduled-job-journal.jsonl absent: no scheduled run has been recorded here']);
  assert.equal(r.notMeasured.at(-1), 'no sweep verdict recorded in window (0 journal(s) read)');
  assert.deepEqual([r.items, r.undetermined, r.coverage, r.status], [[], [], { verdictsInWindow: 0, journalsRead: 0 }, 'not-measured']);
});

test('fleet verdicts count only after the window start and up to and including its end', () => {
  const r = run((rr) => put(rr, 'sweep-fleet-journal.jsonl', [
    fleet(W.since, 'a', [{ slug: 's', code: 1 }]),
    fleet(ms(W.since, 1), 'b', [{ slug: 'p', timedOut: true, secs: 7 }]),
    { kind: 'other', at: '2025-01-01T08:00:00.000Z' },
    fleet('2025-01-01T09:00:00.000Z', 'c', [{ slug: 'ok', code: 0 }]),
    fleet(W.until, 'd', [{ slug: 'u', code: null }]),
    fleet(ms(W.until, 1), 'e', [{ slug: 'v', code: 2 }]),
  ]));
  assert.deepEqual(pick(r), [
    { at: '2025-01-01T00:00:00.001Z', area: 'p', sliceId: 'sweep-b', type: 'area-sweep-timed-out', subject: 'p', detail: 'after 7s' },
    { at: W.until, area: 'u', sliceId: 'sweep-d', type: 'area-sweep-failed', subject: 'u', detail: 'exit null' },
  ]);
  assert.deepEqual([r.coverage, r.status], [{ verdictsInWindow: 3, journalsRead: 1 }, 'measured']);
});

test('failures sort by time, then area, then type, then subject', () => {
  const t1 = '2025-01-01T06:00:00.000Z';
  const t2 = '2025-01-01T12:00:00.000Z';
  const r = run((rr) => put(rr, 'sweep-fleet-journal.jsonl', [
    fleet(t2, 'x', [{ slug: 'a', code: 1 }]),
    fleet(t1, 'y', [{ slug: 'b', code: 3 }], { z: 'failed' }),
    fleet(t1, 'y', [], { m: 'ok', a: 'failed' }),
  ]));
  const step = (k) => ({ at: t1, area: null, sliceId: 'sweep-y', type: 'step-failed', subject: `fleet.finalize.${k}`, detail: null });
  assert.deepEqual(pick(r), [
    { at: t1, area: 'b', sliceId: 'sweep-y', type: 'area-sweep-failed', subject: 'b', detail: 'exit 3' },
    step('a'),
    step('z'),
    { at: t2, area: 'a', sliceId: 'sweep-x', type: 'area-sweep-failed', subject: 'a', detail: 'exit 1' },
  ]);
  assert.deepEqual(r.coverage, { verdictsInWindow: 3, journalsRead: 1 });
});

test('area verdicts yield their failures and count fields the sweep left unknown', () => {
  const at = '2025-01-01T10:00:00.000Z';
  const r = run((rr) => put(rr, 'a/sweep-journal.jsonl', [
    {
      kind: 'sweep-area-verdict', at, area: 'a', sliceId: 's1', rollup: 'published', preflight: 'ok', hostInventory: 'unknown',
      races: 'failed', issues: 'unknown', memoryExport: { kind: 'ok' }, steps: { b: 'failed', a: 'ok' },
      repos: { scans: [{ name: 'npm', manifest: 'package.json', ran: false, why: 'no node' }, { name: 'go', ran: true }], missing: ['/r/x'] },
    },
    { kind: 'sweep-area-verdict', at: '2025-01-01T11:00:00.000Z' },
  ]));
  const item = (type, subject, detail) => ({ at, area: 'a', sliceId: 's1', type, subject, detail });
  assert.deepEqual(pick(r), [
    item('repo-missing', '/r/x', 'repository path absent at sweep time'),
    item('scan-not-run', 'npm (package.json)', 'no node'),
    item('step-failed', 'races', null),
    item('step-failed', 'steps.b', null),
  ]);
  assert.deepEqual(r.undetermined, [{ source: 'sweep verdicts', fields: 5, why: 'verdict fields the sweep never supplied (recorded as unknown)' }]);
  assert.deepEqual(r.input[1], { name: 'sweep verdict journals', path: JOURNALS, state: 'read', files: 1, unreadable: 0 });
  assert.deepEqual([r.coverage, r.status], [{ verdictsInWindow: 2, journalsRead: 1 }, 'measured']);
});

test('an unreadable area journal leaves the verdicts partial', () => {
  const r = run((rr) => {
    put(rr, 'sweep-fleet-journal.jsonl', [fleet('2025-01-01T12:00:00.000Z', 'x', [])]);
    mkdirSync(join(rr, 'b', 'sweep-journal.jsonl'), { recursive: true });
  });
  assert.deepEqual(r.input.slice(0, 3), [
    { name: 'reports root', path: 'rr', state: 'read' },
    { name: 'sweep verdict journal', path: 'rr/b/sweep-journal.jsonl', state: 'unreadable' },
    { name: 'sweep verdict journals', path: JOURNALS, state: 'read', files: 1, unreadable: 1 },
  ]);
  assert.deepEqual([r.items, r.coverage, r.status], [[], { verdictsInWindow: 1, journalsRead: 1 }, 'partial']);
});

test('scheduled job steps that failed count from the window start inclusive', () => {
  const job = (at, name, steps) => ({ kind: 'scheduled-job-verdict', at, job: name, steps });
  const r = run((rr) => put(rr, 'scheduled-job-journal.jsonl', [
    job(ms(W.since, -1), 'nightly', [{ step: 'old', failed: true, exit: 9, outcome: 'crash' }]),
    job(W.since, 'nightly', [{ step: 'scan', failed: true, exit: 1, outcome: 'crash', reason: 'boom' }, { step: 'post', failed: false, outcome: 'ok' }]),
    job('2025-01-01T05:00:00.000Z', 'nightly'),
    job(W.until, 'weekly', [{ step: 'x', failed: true, outcome: 'killed' }]),
  ]));
  assert.deepEqual(pick(r), [
    { at: W.since, area: null, sliceId: null, type: 'scheduled-job-failed', subject: 'nightly/scan', detail: 'exit 1: crash \u2014 boom' },
    { at: W.until, area: null, sliceId: null, type: 'scheduled-job-failed', subject: 'weekly/x', detail: 'exit none: killed' },
  ]);
  assert.deepEqual(r.undetermined, [{ source: 'scheduled job journal', why: '1 run record(s) carry no step outcomes' }]);
  assert.deepEqual(r.input[2], { name: 'scheduled job journal', path: 'rr/scheduled-job-journal.jsonl', state: 'read' });
  assert.deepEqual([r.coverage, r.status], [{ verdictsInWindow: 0, journalsRead: 0 }, 'not-measured']);
});
