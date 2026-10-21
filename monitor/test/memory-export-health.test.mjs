// monitor/test/memory-export-health.test.mjs — the memory-layer export's own outcome.
//
// The defect under test is not a crash: it is that a receipts FILE was read as a clean export by
// both of its readers while 42 of the 390 receipts on this box recorded a write that never
// happened. So most of what is asserted here is the shape of a negative — that presence, absence,
// a fault and a dry run are four different answers and none of them is a pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyReceipts, readExportHealth, groupReasons, tallyDivergence, summariseExports,
  skippedExport, exportVerdict, exportHealthLine,
  EXPORT_STATES, EXPORT_RANK, rankOf, kindOf, RECEIPTS_FILE,
} from '../memory-export-health.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-mexp-'));
const receipt = (over = {}) => ({
  external_id: 'commitwork:rollup:a:b', adapter: 'veld', state: 'verified',
  storedForm: 'full', contentSha256: 'a'.repeat(64), storedSha256: 'a'.repeat(64),
  reason: null, truncated: false, ...over,
});
const payload = (receipts, over = {}) => ({
  generated: '2026-10-03T10:00:00.000Z', area: 'a', rollup: 'reports/a/rollup.json',
  contractVersion: 1, receipts, ...over,
});

// ── the declared set ────────────────────────────────────────────────────────────────────────────

test('every declared state has a rank and a kind, and an undeclared one grades BROKEN', () => {
  for (const s of EXPORT_STATES) {
    assert.equal(typeof EXPORT_RANK[s], 'number', `${s} has no rank`);
    assert.ok(['ok', 'behind', 'broken'].includes(kindOf(s)), `${s} has no declared kind`);
  }
  // Clean-by-omission is the failure this closed set exists to refuse: a state added upstream
  // tomorrow must arrive loud, not quiet.
  assert.equal(kindOf('a-state-nobody-declared'), 'broken');
  assert.equal(rankOf('a-state-nobody-declared'), 3);
});

// ── the four empties, kept apart ────────────────────────────────────────────────────────────────

test('ENOENT is absence and absence is NOT a pass — the lane exits 0 on every outcome', () => {
  const h = readExportHealth({ dir: dir() });
  assert.equal(h.state, 'absent');
  assert.equal(kindOf(h.state), 'behind');
  assert.match(h.reason, /exits 0 on every outcome/);
});

test('a receipts file present but recording ZERO attempts is absent, not clean', () => {
  const d = dir();
  writeFileSync(join(d, RECEIPTS_FILE), JSON.stringify(payload([])));
  const h = readExportHealth({ dir: d });
  assert.equal(h.state, 'absent');
  assert.equal(h.counts.total, 0);
  assert.match(h.reason, /ZERO write attempts/);
});

test('a parse failure is a FAULT, never an empty result', () => {
  const d = dir();
  writeFileSync(join(d, RECEIPTS_FILE), '{"receipts":[');
  const h = readExportHealth({ dir: d });
  assert.equal(h.state, 'unreadable');
  assert.equal(kindOf(h.state), 'broken');
  assert.match(h.reason, /unparseable/);
});

test('a non-ENOENT read error is unreadable and keeps its code — not absence', () => {
  const h = readExportHealth({
    dir: '/does-not-matter',
    readFile: () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; },
  });
  assert.equal(h.state, 'unreadable');
  assert.match(h.reason, /EACCES/);
  assert.match(h.reason, /a fault, not an absence/);
});

test('a payload with no `receipts` array is unreadable, not an export with nothing in it', () => {
  assert.equal(classifyReceipts(payload(undefined)).state, 'unreadable');
  assert.equal(classifyReceipts({ receipts: 'two' }).state, 'unreadable');
  assert.equal(classifyReceipts(null).state, 'unreadable');
  assert.equal(classifyReceipts([]).state, 'unreadable');
});

// ── the outcomes ────────────────────────────────────────────────────────────────────────────────

test('all verified is the only clean answer', () => {
  const h = classifyReceipts(payload([receipt(), receipt()]));
  assert.equal(h.state, 'verified');
  assert.equal(h.rank, 0);
  assert.equal(h.counts.verified, 2);
});

test('ONE failed write makes the whole export failed, however many verified beside it', () => {
  // The live shape on this box: sleight had 30 verified, 1 accepted-unverified and 1 failed, and
  // read as healthy because 30 is a bigger number than 1.
  const rows = [...Array(30)].map(() => receipt())
    .concat(receipt({ state: 'accepted-unverified', storedForm: 'unknown', reason: 'request timed out' }))
    .concat(receipt({ state: 'failed', storedForm: 'unknown', reason: 'HTTP 500' }));
  const h = classifyReceipts(payload(rows));
  assert.equal(h.state, 'failed');
  assert.equal(h.kind, 'broken');
  assert.equal(h.counts.failed, 1);
  assert.match(h.reason, /1 of 32 record\(s\) were NOT written/);
});

test('accepted-unverified is DEGRADED — neither a pass nor a failure', () => {
  const h = classifyReceipts(payload([
    receipt(),
    receipt({ state: 'accepted-unverified', storedForm: 'unknown', storedSha256: null, reason: 'request timed out' }),
  ]));
  assert.equal(h.state, 'degraded');
  assert.equal(h.kind, 'behind');
  assert.equal(h.counts.acceptedUnverified, 1);
  assert.equal(h.counts.failed, 0, 'an unconfirmed write must never be counted as a failed one');
});

test('a preview-only store is degraded even with every state verified — storedForm is its own axis', () => {
  const h = classifyReceipts(payload([receipt({ storedForm: 'preview', storedSha256: 'b'.repeat(64) })]));
  assert.equal(h.state, 'degraded');
  assert.match(h.reason, /not a durable copy/);
});

test('divergent storage is reported as corruption and is louder than a preview', () => {
  const h = classifyReceipts(payload([
    receipt({ storedForm: 'divergent', storedSha256: 'c'.repeat(64) }),
    receipt({ storedForm: 'preview', storedSha256: 'b'.repeat(64) }),
  ]));
  assert.equal(h.state, 'degraded');
  assert.match(h.reason, /corruption/);
  assert.ok(h.reason.indexOf('corruption') < h.reason.indexOf('preview'),
    'corruption must be named before truncation, never swallowed by preview detection');
});

test('a dry run wrote nothing and lost nothing — it is never folded into failed', () => {
  const h = classifyReceipts(payload([receipt({ state: 'dry-run', storedForm: null, reason: 'dry run' })]));
  assert.equal(h.state, 'not-attempted');
  assert.equal(h.rank, 0);
  assert.equal(h.counts.failed, 0);
});

test('an undeclared receipt state counts on its own axis and grades unreadable, never failed', () => {
  const h = classifyReceipts(payload([receipt({ state: 'in-flight-maybe' })]));
  assert.equal(h.state, 'unreadable');
  assert.equal(h.counts.unknownState, 1);
  assert.equal(h.counts.failed, 0);
  assert.match(h.reason, /never binned into failed/);
});

test('a deliberate opt-out is `skipped` — not a fault, not a pass, and never a stale read', () => {
  const h = skippedExport('SUBSTRATE_EXPORT=0');
  assert.equal(h.state, 'skipped');
  assert.equal(h.kind, 'ok');
  assert.equal(h.counts, null, 'a skipped export has no counts to quote');
  assert.equal(h.path, null);
});

// ── the staleness gate ─────────────────────────────────────────────────────────────────────────

test('receipts predating the slice are STALE — the previous run is not this run', () => {
  // The whole reason the gate exists: the file sits at a fixed path and is overwritten per run, so
  // an export that skipped leaves yesterday's answer in place, and a stale reading reads exactly
  // like a live one.
  const d = dir();
  writeFileSync(join(d, RECEIPTS_FILE), JSON.stringify(payload([receipt()], { generated: '2026-09-01T00:00:00.000Z' })));
  const h = readExportHealth({ dir: d, since: '2026-10-03T09:00:00.000Z' });
  assert.equal(h.state, 'stale');
  assert.equal(kindOf(h.state), 'behind');
  assert.match(h.reason, /before this slice began/);
  // And without the gate it would have reported the old run's clean verdict as this one's.
  assert.equal(readExportHealth({ dir: d }).state, 'verified');
});

test('a receipts file with no parseable stamp is UNDATED, not fresh', () => {
  const h = classifyReceipts(payload([receipt()], { generated: null }), { since: '2026-10-03T09:00:00.000Z' });
  assert.equal(h.state, 'verified');
  assert.equal(h.undated, true, 'one fewer witness must say so rather than be graded as current');
});

// ── the recount, as a second witness ───────────────────────────────────────────────────────────

test('the stored tally is RECOUNTED, and a disagreement is a fault rather than a number to quote', () => {
  const rows = [receipt(), receipt({ state: 'failed', reason: 'HTTP 500' })];
  const honest = classifyReceipts(payload(rows, { tally: { total: 2, failed: 1, verified: 1 } }));
  assert.equal(honest.tallyDivergence.state, 'agrees');
  assert.equal(honest.state, 'failed');

  // A producer that under-reports its own failures is exactly what a reader-side recount catches.
  const lying = classifyReceipts(payload(rows, { tally: { total: 2, failed: 0, verified: 2 } }));
  assert.equal(lying.tallyDivergence.state, 'diverged');
  assert.equal(lying.state, 'unreadable');
  assert.deepEqual(lying.tallyDivergence.fields.map((f) => f.field).sort(), ['failed', 'verified']);
});

test('a key the stored tally never had is a contract version, not a divergence', () => {
  // Receipts written before storedFull/notAttempted existed must not raise a fault about a field
  // that did not exist when they were written.
  const d = tallyDivergence({ total: 1, verified: 1, storedFull: 1, notAttempted: 0 }, { total: 1, verified: 1 });
  assert.equal(d.state, 'agrees');
  assert.deepEqual(d.fields, []);
});

test('no stored tally at all is stated, never treated as agreement', () => {
  const d = tallyDivergence({ total: 1 }, undefined);
  assert.equal(d.state, 'no-stored-tally');
  assert.match(d.note, /no tally/);
});

// ── reasons ─────────────────────────────────────────────────────────────────────────────────────

test('reasons group so one upstream defect reads as one row, not twenty-two', () => {
  const rows = [...Array(22)].map((_, i) => receipt({ state: 'failed', reason: `HTTP 500 (id ${'ab12cd34ef'}${i})` }))
    .concat(receipt({ state: 'failed', reason: 'redaction gate refused: content embeds a credential-bearing field: password' }));
  const g = groupReasons(rows);
  assert.equal(g.length, 2, 'per-record ids must not split one defect into twenty-two findings');
  assert.equal(g[0].count, 22);
  assert.match(g[1].reason, /redaction gate refused/);
});

test('a degraded state with no reason is itself the finding', () => {
  const g = groupReasons([receipt({ state: 'failed', reason: null })]);
  assert.match(g[0].reason, /no reason recorded/);
});

// ── the fleet roll-up ──────────────────────────────────────────────────────────────────────────

test('summariseExports keeps its denominator and pre-seeds every state', () => {
  const s = summariseExports([
    classifyReceipts(payload([receipt()], { area: 'clean' })),
    classifyReceipts(payload([receipt({ state: 'failed', reason: 'HTTP 500' })], { area: 'broke' })),
    classifyReceipts(payload([receipt({ state: 'accepted-unverified', storedForm: 'unknown', reason: 't/o' })], { area: 'slow' })),
  ]);
  assert.equal(s.areasCounted, 3);
  for (const k of EXPORT_STATES) assert.equal(typeof s.byState[k], 'number', `${k} must count 0, never be absent`);
  assert.equal(s.failedReceipts, 1);
  assert.equal(s.unverifiedReceipts, 1);
  assert.equal(s.needsAttention, 2);
  assert.equal(s.worstRank, 3);
  assert.equal(s.alarming[0].state, 'failed', 'worst first');
});

test('summariseExports over nothing reports an empty population, never a clean one', () => {
  const s = summariseExports([]);
  assert.equal(s.areasCounted, 0);
  assert.equal(s.failedReceipts, 0);
  assert.equal(s.worstRank, 0);
  assert.equal(s.needsAttention, 0);
  // The CALLER must read areasCounted before reading failedReceipts as a reading; the zero here is
  // a count over no areas, and the panel tile renders it as unobserved for that reason.
  assert.deepEqual(s.alarming, []);
});

// ── the served field ───────────────────────────────────────────────────────────────────────────

test('the verdict field carries the state, the counts and no record content', () => {
  const v = exportVerdict(classifyReceipts(payload([
    receipt({ state: 'failed', reason: 'redaction gate refused: content embeds a credential-bearing field: password' }),
  ])));
  assert.equal(v.state, 'failed');
  assert.equal(v.counts.failed, 1);
  assert.equal(v.tallyDivergence, 'no-stored-tally');
  assert.equal(v.receiptsAt, '2026-10-03T10:00:00.000Z');
  // A reason may name a FIELD and never a value — the gate's own rule, held at the serving edge.
  assert.match(v.failedReasons[0].reason, /credential-bearing field: password/);
  assert.equal(JSON.stringify(v).includes('contentSha256'), false);
});

test('the log line names the state, the split and the loudest reason', () => {
  const line = exportHealthLine(classifyReceipts(payload([
    receipt(), receipt({ state: 'failed', reason: 'HTTP 500' }),
  ])));
  assert.match(line, /FAILED/);
  assert.match(line, /2 record\(s\): 1 verified, 0 accepted-unverified, 1 failed/);
  assert.match(line, /loudest: HTTP <n>/);
});

// ── determinism ────────────────────────────────────────────────────────────────────────────────

test('the same receipts file yields a byte-identical classification', () => {
  const d = dir();
  writeFileSync(join(d, RECEIPTS_FILE), JSON.stringify(payload([
    receipt(), receipt({ state: 'failed', reason: 'HTTP 500' }), receipt({ state: 'accepted-unverified', storedForm: 'unknown', reason: 't/o' }),
  ])));
  const a = JSON.stringify(readExportHealth({ dir: d }));
  const b = JSON.stringify(readExportHealth({ dir: d }));
  assert.equal(a, b);
});

// ── a directory where a file belongs ───────────────────────────────────────────────────────────

test('a DIRECTORY at the receipts path is a fault, not an absence', () => {
  const d = dir();
  mkdirSync(join(d, RECEIPTS_FILE));
  const h = readExportHealth({ dir: d });
  assert.equal(h.state, 'unreadable');
  assert.notEqual(h.state, 'absent');
});

test('no directory given is unreadable rather than a silent clean answer', () => {
  const h = readExportHealth({});
  assert.equal(h.state, 'unreadable');
  assert.equal(h.path, null);
});

// POSIX-only: an unreadable file must not read as an absent one. Skipped with a STATED reason
// rather than silently, because a skipped test reads exactly like a passing one.
test('an unreadable receipts file is NOT an absent one', { skip: process.platform === 'win32' ? 'no POSIX modes' : false }, () => {
  const d = dir();
  const p = join(d, RECEIPTS_FILE);
  writeFileSync(p, JSON.stringify(payload([receipt()])));
  chmodSync(p, 0o000);
  if ((statSync(p).mode & 0o777) !== 0) return; // running as root: the condition cannot be created
  const h = readExportHealth({ dir: d });
  assert.equal(h.state, 'unreadable');
  assert.match(h.reason, /EACCES|EPERM/);
});
