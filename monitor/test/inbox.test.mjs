// monitor/inbox.mjs: each Inbox signal from the record it is about, item ids that never carry a
// line and survive a re-read, what was not measured listed with its reason, and a state store that
// fails closed on corruption, is per operator, and is bounded.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveInbox, withState, readInboxState, markInbox, PRIORITY_KINDS, STATE_CAP, INBOX_STATE_SCHEMA } from '../inbox.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-inbox-'));
const STATE = join(TMP, 'inbox-state.json');
after(() => rmSync(TMP, { recursive: true, force: true }));

const NONE = { verdict: 'none' };
const place = (over = {}) => ({ repo: 'acme', sub: 'GHSA-1', id: 'GHSA-1', package: 'left-pad', rows: 1, sev: 'crit', ...over });
const rollup = (over = {}) => ({
  generated: '2026-10-08T00:00:00.000Z', sliceId: 'sweep-2',
  scannerDelta: { comparable: true, prevSliceId: 'sweep-1', byCategory: {
    depsGo: { status: 'compared', new: 2, newBySev: { crit: 1, high: 1, med: 0, low: 0, unknown: 0 }, newPlaces: [place(), place({ id: 'GHSA-2', sub: 'GHSA-2', sev: 'high' })] },
    sastSemgrep: { status: 'compared', new: 0, newBySev: { crit: 0, high: 0, med: 0, low: 0, unknown: 0 }, newPlaces: [] },
    cspm: { status: 'cur-not-ran', new: null },
  } },
  scannerFindings: { depsGo: [
    { repo: 'acme', id: 'GHSA-1', package: 'left-pad', sev: 'crit', kev: true, line: 10 },
    { repo: 'acme', id: 'GHSA-2', package: 'left-pad', sev: 'high' },
    { repo: 'acme', id: 'GHSA-9', package: 'old', sev: 'high', kev: true },
  ] },
  scanners: { depsGo: { coverage: 'full' }, sastGo: { coverage: 'unknown', coverageReason: 'the log we were told to read is not there' } },
  ...over,
});
const byKind = (r, k) => r.items.filter((i) => i.kind === k);

test('a compared lane with new crit places is one priority item; KEV is read off the new places only', () => {
  const r = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: { generated: '2026-10-08T00:00:00.000Z' } });
  const crit = byKind(r, 'new-critical');
  assert.equal(crit.length, 1);
  assert.equal(crit[0].priority, true);
  assert.equal(crit[0].detail.count, 1);
  assert.deepEqual(crit[0].detail.places.map((p) => p.id), ['GHSA-1']);
  const kev = byKind(r, 'new-kev');
  assert.equal(kev.length, 1);
  assert.deepEqual(kev[0].detail.places.map((p) => p.id), ['GHSA-1'], 'GHSA-9 is KEV but not new, so it is not here');
  assert.equal(r.prevSliceId, 'sweep-1');
  for (const i of r.items) assert.doesNotMatch(i.id, /\|10\b|line/, 'no id carries a line');
});

test('ids are stable across a re-read, and a different slice is a different new-critical item', () => {
  const a = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: null });
  const b = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: null });
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  const c = deriveInbox({ project: 'alpha', rollup: rollup({ sliceId: 'sweep-3' }), inflight: NONE, lastIngest: null });
  assert.notEqual(byKind(a, 'new-critical')[0].id, byKind(c, 'new-critical')[0].id);
  assert.equal(byKind(a, 'lane-undetermined')[0].id, byKind(c, 'lane-undetermined')[0].id, 'the same undetermined reason is the same item across sweeps');
});

test('undetermined coverage is an Other item with its reason; a full lane is not', () => {
  const r = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: { generated: '2026-10-08T00:00:00.000Z' } });
  const u = byKind(r, 'lane-undetermined');
  assert.equal(u.length, 1);
  assert.equal(u[0].priority, false);
  assert.equal(u[0].detail.lane, 'sastGo');
  assert.match(u[0].detail.reason, /not there/);
});

test('a hung or unreadable in-flight marker is a sweep-failed priority item; none is nothing', () => {
  const hung = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: { verdict: 'hung', sliceId: 's9', ageMin: 300, pid: 42, pidState: 'dead', startedAt: 'T' }, lastIngest: null });
  assert.match(byKind(hung, 'sweep-failed')[0].title, /pid 42 is dead/);
  const bad = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: { verdict: 'unreadable', detail: 'unparseable' }, lastIngest: null });
  assert.match(byKind(bad, 'sweep-failed')[0].title, /cannot be read/);
  assert.equal(byKind(deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: null }), 'sweep-failed').length, 0);
  assert.ok(PRIORITY_KINDS.includes('sweep-failed'));
});

test('ingest: never ingested and older than the rollup are behind; equal is current; an unreadable store is not measured', () => {
  const never = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: null });
  assert.match(byKind(never, 'ingest-behind')[0].title, /never ingested/);
  const old = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: { generated: '2026-10-07T00:00:00.000Z' } });
  assert.match(byKind(old, 'ingest-behind')[0].title, /behind/);
  const cur = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, lastIngest: { generated: '2026-10-08T00:00:00.000Z' } });
  assert.equal(byKind(cur, 'ingest-behind').length, 0);
  const err = deriveInbox({ project: 'alpha', rollup: rollup(), inflight: NONE, ingestError: 'EACCES' });
  assert.equal(byKind(err, 'ingest-behind').length, 0);
  assert.ok(err.notMeasured.some((n) => n.signal === 'ingest-behind' && /EACCES/.test(n.reason)));
});

test('what cannot be measured is listed: no delta, nothing comparable, KEV past the cap, and SLA always', () => {
  const nod = deriveInbox({ project: 'alpha', rollup: rollup({ scannerDelta: undefined }), inflight: NONE, lastIngest: null });
  assert.ok(nod.notMeasured.some((n) => n.signal === 'new-since-last-sweep' && /no scannerDelta/.test(n.reason)));
  const inc = deriveInbox({ project: 'alpha', rollup: rollup({ scannerDelta: { comparable: false, prevSliceId: null, byCategory: {} } }), inflight: NONE, lastIngest: null });
  assert.ok(inc.notMeasured.some((n) => /no lane was comparable/.test(n.reason)));
  const capped = rollup();
  capped.scannerDelta.byCategory.depsGo.truncated = { newPlaces: 40 };
  const cap = deriveInbox({ project: 'alpha', rollup: capped, inflight: NONE, lastIngest: null });
  assert.ok(cap.notMeasured.some((n) => n.signal === 'new-kev:depsGo' && /40 new place/.test(n.reason)));
  assert.equal(byKind(cap, 'new-critical')[0].detail.beyondCap, 40);
  assert.ok(nod.notMeasured.some((n) => n.signal === 'sla-due-soon'));
});

test('state: absent is empty; corrupt or foreign refuses, and markInbox will not write over it', () => {
  assert.deepEqual(readInboxState(join(TMP, 'none.json')).entries, {});
  const bad = join(TMP, 'bad.json');
  writeFileSync(bad, '{nope');
  assert.throws(() => readInboxState(bad), /not JSON/);
  const r = markInbox({ ids: ['x'], action: 'read', who: 'op', nowIso: '2026-10-08T00:00:00.000Z', path: bad });
  assert.equal(r.code, 503);
  assert.equal(readFileSync(bad, 'utf8'), '{nope', 'left exactly as found');
  writeFileSync(bad, JSON.stringify({ schema: 'other/1', entries: {} }));
  assert.throws(() => readInboxState(bad), /is not commitwork\.inbox-state\/1/);
});

test('state: read and snooze are per operator; a lapsed snooze reads as unsnoozed; bad input refuses', () => {
  const now = '2026-10-08T00:00:00.000Z';
  assert.equal(markInbox({ ids: ['a', 'b'], action: 'read', who: 'op1', nowIso: now, path: STATE }).ok, true);
  assert.equal(markInbox({ ids: ['b'], action: 'snooze', days: 7, who: 'op1', nowIso: now, path: STATE }).ok, true);
  const st = readInboxState(STATE);
  assert.equal(st.schema, INBOX_STATE_SCHEMA);
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const op1 = withState(items, st, 'op1', now);
  assert.deepEqual(op1.map((i) => [i.read, !!i.snoozedUntil]), [[true, false], [true, true], [false, false]]);
  assert.deepEqual(withState(items, st, 'op2', now).map((i) => i.read), [false, false, false], 'another operator reads nothing of op1');
  assert.equal(withState(items, st, 'op1', '2026-10-16T00:00:00.000Z')[1].snoozedUntil, null, 'lapsed');
  assert.equal(markInbox({ ids: ['a'], action: 'unread', who: 'op1', nowIso: now, path: STATE }).ok, true);
  assert.equal(withState(items, readInboxState(STATE), 'op1', now)[0].read, false);
  assert.equal(markInbox({ ids: ['a'], action: 'archive', who: 'op1', nowIso: now, path: STATE }).code, 400);
  assert.equal(markInbox({ ids: [], action: 'read', who: 'op1', nowIso: now, path: STATE }).code, 400);
  assert.equal(markInbox({ ids: ['a'], action: 'snooze', days: 0, who: 'op1', nowIso: now, path: STATE }).code, 400);
  assert.equal(markInbox({ ids: ['a'], action: 'read', who: '', nowIso: now, path: STATE }).code, 401);
});

test('state: bounded at STATE_CAP, oldest dropped first, and the write is byte-identical for the same input', () => {
  const p = join(TMP, 'cap.json');
  const ids = Array.from({ length: 500 }, (_, i) => `id-${String(i).padStart(4, '0')}`);
  for (let round = 0; round < Math.ceil(STATE_CAP / 500) + 1; round++) {
    const at = new Date(Date.UTC(2026, 9, 1, 0, round)).toISOString();
    assert.equal(markInbox({ ids: ids.map((x) => `${round}-${x}`), action: 'read', who: 'op', nowIso: at, path: p }).ok, true);
  }
  const st = readInboxState(p);
  assert.equal(Object.keys(st.entries).length, STATE_CAP);
  assert.ok(!Object.keys(st.entries).some((k) => k.includes('\u00000-')), 'the oldest round was dropped');
  const q1 = join(TMP, 'det1.json'), q2 = join(TMP, 'det2.json');
  for (const q of [q1, q2]) markInbox({ ids: ['z', 'a', 'm'], action: 'read', who: 'op', nowIso: '2026-10-08T00:00:00.000Z', path: q });
  assert.equal(readFileSync(q1, 'utf8'), readFileSync(q2, 'utf8'));
});
