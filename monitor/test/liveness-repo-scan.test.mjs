// node --test monitor/test/  — the per-repo deadman: an area is never fresher than the repo whose
// scheduled sweep is oldest, whatever slice happens to be published.
// Scratch dirs, real stamps, a real hash-chained journal; never the live reports/ tree.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOne, RANK } from '../liveness.mjs';
import { repoScanFreshness, overdueNote, SCHEDULED_GROUP } from '../repo-scan-freshness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

const HOUR = 3600_000;
const NOW = Date.parse('2026-11-28T12:00:00.000Z');
const stampAt = (hoursAgo) => `sweep-${new Date(NOW - hoursAgo * HOUR).toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
const rec = (hoursAgo, group, scans, extra = {}) => ({
  v: 1, kind: 'sweep-area-verdict', at: new Date(NOW - hoursAgo * HOUR).toISOString(), sliceId: stampAt(hoursAgo),
  group, rollup: 'published',
  repos: { resolved: scans.length, scanned: scans.length, scans: scans.map((s) => (typeof s === 'string' ? { name: s, ran: true, why: 'clean' } : s)) },
  ...extra,
});

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'cw-liveness-repo-scan-')); });
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function makeArea(name, records) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'history'), { recursive: true });
  const newest = records.reduce((a, b) => (a.sliceId > b.sliceId ? a : b));
  writeFileSync(join(dir, 'rollup.json'), JSON.stringify({
    sliceId: newest.sliceId, generated: newest.at, freshness: { generated: newest.at },
    coverage: { resolved: 3, swept: newest.repos.scans.length, unswept: [], unsweptInScope: [], scope: 'area-scoped' },
  }));
  for (const r of [...records].sort((a, b) => (a.at < b.at ? -1 : 1))) appendRecord(join(dir, 'sweep-journal.jsonl'), { ...r, area: name });
  return join(dir, 'rollup.json');
}

test('a one-repo re-scan does not make the rest of the area current', () => {
  const p = makeArea('narrow-rescan', [
    rec(120, 'all', ['core', 'web', 'docs']),
    rec(2, 'all', ['web']),
  ]);
  const r = checkOne(p, 'narrow-rescan', { scheduled: true, nowMs: NOW });
  assert.equal(r.state, 'expired', 'two repos were last scanned five days ago; the area is as old as they are');
  assert.equal(RANK[r.state], 3);
  assert.match(r.line, /2 of 3 repo\(s\) have no completed `all` sweep/);
  assert.match(r.line, /core \(sweep-\d{14}, 120h ago\)/);
  assert.match(r.line, /docs \(/);
  assert.doesNotMatch(r.line, /web \(sweep/, 'the repo that WAS re-scanned is not named');
  assert.match(r.line, /published slice: fresh/, 'the slice-level reading stays on the line');
});

test('a fast pass over every repo does not stand in for the scheduled group', () => {
  const p = makeArea('fast-only', [
    rec(200, 'all', ['core', 'web']),
    rec(1, 'fast', ['core', 'web']),
  ]);
  const r = checkOne(p, 'fast-only', { scheduled: true, nowMs: NOW });
  assert.equal(r.state, 'expired');
  assert.match(r.line, /2 of 2 repo\(s\)/);
});

test('a scan that did not run leaves the repo on its previous sweep', () => {
  const p = makeArea('killed', [
    rec(40, 'all', ['core', 'web']),
    rec(3, 'all', [{ name: 'core', ran: false, why: 'killed by SIGTERM' }, 'web']),
  ]);
  const r = checkOne(p, 'killed', { scheduled: true, nowMs: NOW });
  assert.equal(r.state, 'stale', 'core is one missed cadence old: stale, not expired');
  assert.match(r.line, /1 of 2 repo\(s\)/);
  assert.match(r.line, /core \(/);
});

test('an area whose every repo has a recent scheduled sweep stays fresh', () => {
  const p = makeArea('healthy', [
    rec(30, 'all', ['core', 'web', 'docs']),
    rec(6, 'all', ['core', 'web', 'docs']),
    rec(1, 'all', ['web']),
  ]);
  const r = checkOne(p, 'healthy', { scheduled: true, nowMs: NOW });
  assert.equal(r.state, 'fresh');
  assert.doesNotMatch(r.line, /no completed/);
});

test('a repo that left the area is not asked about after the next area-wide sweep', () => {
  const p = makeArea('retired-repo', [
    rec(900, 'all', ['core', 'web', 'gone']),
    rec(5, 'all', ['core', 'web']),
  ]);
  const r = checkOne(p, 'retired-repo', { scheduled: true, nowMs: NOW });
  assert.equal(r.state, 'fresh');
});

test('an unscheduled or paused reading is left alone', () => {
  const p = makeArea('ghost', [rec(300, 'all', ['core', 'web']), rec(1, 'fast', ['core', 'web'])]);
  const r = checkOne(p, 'ghost', { scheduled: false, nowMs: NOW });
  assert.equal(r.state, 'fresh', 'nothing schedules an undeclared area, so nothing can satisfy the alarm');
});

test('a journal behind the rollup makes no per-repo claim; the missing verdict is the fault named', () => {
  const p = makeArea('verdict-lost', [rec(120, 'all', ['core', 'web'])]);
  const at = new Date(NOW - 2 * HOUR).toISOString();
  writeFileSync(p, JSON.stringify({ sliceId: stampAt(2), generated: at, freshness: { generated: at } }));
  const r = checkOne(p, 'verdict-lost', { scheduled: true, nowMs: NOW });
  assert.equal(r.state, 'unjournaled', 'the sweep that published is not in the journal, so the journal cannot say what it scanned');
  assert.match(r.line, /BEHIND the rollup/);
  assert.doesNotMatch(r.line, /no completed/);
});

test('a journal with no scheduled-group sweep makes no claim', () => {
  const none = repoScanFreshness([rec(1, 'fast', ['core'])], NOW);
  assert.equal(none.measured, false);
  assert.equal(none.worst, null);
  const legacy = repoScanFreshness([{ sliceId: stampAt(400), group: 'all', rollup: 'published', repos: { resolved: 2, scanned: 2 } }], NOW);
  assert.equal(legacy.measured, false, 'records from before per-repo outcomes were written name no repo');
  assert.equal(overdueNote(none), '');
});

test('an unpublished sweep does not count, and a never-scanned repo ages from when it was first named', () => {
  const r = repoScanFreshness([
    rec(100, 'all', ['core']),
    rec(4, 'all', ['core', 'web'], { rollup: 'lock-contention' }),
    rec(3, 'fast', ['core', 'web']),
    rec(2, 'all', ['web']),
  ], NOW);
  assert.equal(r.measured, true);
  assert.equal(r.group, SCHEDULED_GROUP);
  const core = r.repos.find((x) => x.name === 'core');
  assert.equal(core.state, 'expired');
  assert.equal(core.sliceId, stampAt(100));
  assert.equal(r.repos.find((x) => x.name === 'web').state, 'fresh');
  assert.equal(r.worst, 'expired');

  const fresh = repoScanFreshness([rec(30, 'all', ['core']), rec(3, 'fast', ['core', 'new']), rec(2, 'all', ['core'])], NOW);
  const added = fresh.repos.find((x) => x.name === 'new');
  assert.equal(added.never, true);
  assert.equal(added.state, 'fresh', 'named three hours ago: the scheduled sweep has not had its turn yet');
  assert.equal(fresh.worst, null);
});

test('a declared weekly cadence is honoured per repo', () => {
  const week = 7 * 24 * HOUR;
  const r = repoScanFreshness([rec(100, 'all', ['core', 'web']), rec(1, 'all', ['web'])], NOW, { cadenceMs: week });
  assert.equal(r.worst, null, 'four days is inside a weekly cadence');
});
