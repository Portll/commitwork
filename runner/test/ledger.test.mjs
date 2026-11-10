import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ledgerPath, openLedger } from '../ledger.mjs';
import { MIGRATIONS } from '../ledger-schema.mjs';

const T0 = Date.parse('2026-10-22T09:00:00Z');
const tmp = () => join(mkdtempSync(join(tmpdir(), 'cw-ledger-')), 'ledger.db');
const DAY = 86_400_000;
const REPO = 'example-owner/example-private';
const NAME = 'cw-slot-1-501-1792573200';
const REPORT = {
  slotId: 'slot-1', boot: 'b'.repeat(32), code: 0, signal: null, wallSec: 42.5,
  leftovers: { killed: 2, left: 0 }, totals: { cpuSec: 30.25, memPeakBytes: 209715200, io: { rbytes: 4096, wbytes: 8192 } },
  runnerName: NAME, repo: REPO, jobId: 501,
};

function clockAt(ms) {
  const c = () => c.ms;
  c.ms = ms;
  return c;
}

test('a decision, a mint, a claim and a finished job round-trip', () => {
  const now = clockAt(T0);
  const l = openLedger(tmp(), { now });
  const d = { repo: REPO, runId: 900, jobId: 501, admit: true, code: 'admitted', reason: 'passed admission' };
  assert.deepEqual(l.recordDecision({ kind: 'record', decision: d }), { id: 1, repeated: false });
  assert.equal(l.runnerMinted({ name: NAME, repo: REPO, runId: 900, jobId: 501, slotId: 'slot-1', runnerId: 77 }), true);
  assert.deepEqual(l.runners({ open: true }).map((r) => r.claimedAt), [null]);
  now.ms += 5000;
  assert.equal(l.runnerClaimed(NAME, 'slot-2'), false, 'another slot cannot claim it');
  assert.equal(l.runnerClaimed(NAME, 'slot-1'), true);
  assert.equal(l.runnerClaimed(NAME, 'slot-1'), false, 'one claim per runner');
  now.ms += 60_000;
  assert.equal(l.jobFinished(REPORT), true);
  assert.equal(l.jobFinished(REPORT), false, 'a repeated report is not counted twice');
  assert.deepEqual(l.decisions(), [{
    id: 1, at: '2026-10-22T09:00:00.000Z', lastAt: '2026-10-22T09:00:00.000Z', seen: 1, repo: REPO, runId: 900, jobId: 501,
    admit: true, code: 'admitted', outcome: 'admit', reason: 'passed admission',
  }]);
  assert.deepEqual(l.jobs(), [{
    id: 1, at: '2026-10-22T09:01:05.000Z', runnerName: NAME, repo: REPO, runId: 900, jobId: 501, slotId: 'slot-1',
    exitCode: 0, signal: null, wallSec: 42.5, cpuSec: 30.25, memPeakBytes: 209715200, io: { rbytes: 4096, wbytes: 8192 },
    leftovers: { killed: 2, left: 0 }, mintedAt: '2026-10-22T09:00:00.000Z', claimedAt: '2026-10-22T09:00:05.000Z',
  }]);
  assert.deepEqual(l.runners({ open: true }), []);
  assert.equal(l.runners()[0].finishedAt, '2026-10-22T09:01:05.000Z');
  l.close();
});

test('a decision repeated tick after tick is one row with a count; a new code is a new row', () => {
  const now = clockAt(T0);
  const l = openLedger(tmp(), { now });
  const wait = { repo: REPO, runId: 900, jobId: 501, admit: true, code: 'capacity-wait', reason: 'no free slot' };
  l.recordDecision(wait);
  now.ms += 30_000;
  assert.equal(l.recordDecision(wait).repeated, true);
  l.recordDecision({ ...wait, code: 'admitted', reason: 'passed' });
  const rows = l.decisions();
  assert.deepEqual(rows.map((r) => [r.code, r.seen, r.outcome]), [['admitted', 1, 'admit'], ['capacity-wait', 2, 'wait']]);
  assert.equal(rows[1].lastAt, '2026-10-22T09:00:30.000Z');
  assert.equal(l.decisions({ since: T0 + 1 }).length, 2);
  assert.equal(l.decisions({ limit: 1 }).length, 1);
  l.close();
});

test('unknown figures stay null, and bad input is refused', () => {
  const l = openLedger(tmp(), { now: clockAt(T0) });
  l.jobFinished({ slotId: 'slot-1', code: null, totals: { cpuSec: 1, memPeakBytes: null, io: {} }, repo: REPO });
  const [j] = l.jobs();
  assert.equal(j.memPeakBytes, null);
  assert.equal(j.exitCode, null);
  assert.deepEqual(j.io, { rbytes: null, wbytes: null });
  assert.throws(() => l.recordDecision({ repo: REPO }), /ledger-input/);
  assert.throws(() => l.runnerMinted({ name: NAME }), /ledger-input/);
  assert.throws(() => l.decisions({ since: 'yesterday' }), /not a time/);
  l.close();
});

test('retention drops rows past the age limit and beyond the row cap', () => {
  const now = clockAt(T0);
  const l = openLedger(tmp(), { now, retainDays: 30, maxRows: 3, pruneEvery: 1000 });
  for (let i = 0; i < 5; i++) l.recordDecision({ repo: REPO, runId: i + 1, jobId: i + 1, admit: false, code: 'event-privileged', reason: 'r', at: T0 - (40 - i) * DAY });
  for (let i = 0; i < 5; i++) l.recordDecision({ repo: REPO, runId: 100 + i, jobId: 100 + i, admit: false, code: 'head-foreign', reason: 'r' });
  assert.equal(l.decisions({ limit: 50 }).length, 10);
  assert.equal(l.prune(), 7);
  assert.deepEqual(l.decisions({ limit: 50 }).map((r) => r.runId), [104, 103, 102]);
  l.close();
});

test('one connection per process per path, WAL mode, and the schema version', () => {
  const path = tmp();
  const a = openLedger(path);
  const b = openLedger(path);
  assert.equal(a, b);
  a.close();
  assert.equal(b.check().status, 'live', 'the second holder keeps it open');
  b.close();
  const db = new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  db.close();
  assert.throws(() => openLedger(path), /ledger-newer/);
});

test('the default path honours CW_RUNNER_LEDGER at call time', () => {
  const before = process.env.CW_RUNNER_LEDGER;
  try {
    process.env.CW_RUNNER_LEDGER = '/tmp/x/ledger.db';
    assert.equal(ledgerPath(), '/tmp/x/ledger.db');
    delete process.env.CW_RUNNER_LEDGER;
    assert.match(ledgerPath('/srv/cw'), /\/srv\/cw\/monitor\/private\/runner-ledger\.db$/);
  } finally {
    if (before === undefined) delete process.env.CW_RUNNER_LEDGER; else process.env.CW_RUNNER_LEDGER = before;
  }
});
