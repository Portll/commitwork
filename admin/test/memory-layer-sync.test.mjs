// The sync reader. The assertion that matters is the one about `missing`: emitting it for a point
// nobody writes would paint 1,036 completed tasks red and describe this checker rather than the
// fleet — the unsupported finding half of the house invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncPoints, verdictFor, sessionTag, syncSummary, contractPath } from '../lib/memory-layer-sync.mjs';

test('the points are READ from the contract, never re-declared here', () => {
  const { points } = syncPoints();
  assert.ok(points.length >= 3);
  const byId = Object.fromEntries(points.map((p) => [p.id, p]));
  assert.equal(byId.P1.status, 'partially-wired');
  assert.equal(byId.P2.status, 'not-wired');
  assert.equal(byId.P3.status, 'not-wired');
  // Each point names the fields a writer owes, so a writer can be built from the contract alone.
  assert.ok(byId.P1.fields.includes('spine_session'));
});

test('an unreadable contract RAISES — it is never "the fleet owes nothing"', () => {
  assert.throws(() => syncPoints({ path: '/nonexistent/contract.json' }));
});

test('a zero on an unwired point is NOT missing', () => {
  const p2 = { id: 'P2', point: 'task complete', status: 'not-wired', note: 'nothing writes it' };
  const v = verdictFor(p2, { found: 0, reachable: true });
  assert.equal(v.verdict, 'not-wired');
  assert.match(v.why, /not a fault of the work/);
});

test('a zero on a WIRED point IS missing — the inversion, or the rule passes against itself', () => {
  const wired = { id: 'P1', point: 'session close', status: 'wired' };
  assert.equal(verdictFor(wired, { found: 0, reachable: true }).verdict, 'missing');
  assert.equal(verdictFor(wired, { found: 2, reachable: true }).verdict, 'synced');
});

test('unreachable outranks everything — absence of evidence is its own state', () => {
  const wired = { id: 'P1', point: 'session close', status: 'wired' };
  const v = verdictFor(wired, { found: 0, reachable: false });
  assert.equal(v.verdict, 'unverifiable');
  assert.match(v.why, /could not be reached|no credential/);
});

test('the tag is what makes the check strict', () => {
  assert.equal(sessionTag('s-abc'), 'spine-session:s-abc');
  const { key } = syncPoints();
  assert.equal(key.tag, 'spine-session:<id>');
});

test('a transport failure is not a zero — it must not read as an empty store', async () => {
  const s = await syncSummary({
    probeSessions: ['s-1'],
    env: { VELD_API_KEY: 'k' },
    fetchImpl: async () => { throw new Error('connection refused'); },
  });
  assert.equal(s.ok, true);
  assert.equal(s.probeWhy, 'connection refused', 'the client reason must be carried, not replaced by a generic one');
  const p1 = s.rows.find((r) => r.id === 'P1');
  assert.equal(p1.verdict, 'unverifiable', 'a failed probe must never be reported as "asked and found none"');
});

test('no credential yields unverifiable, never a clean sheet', async () => {
  const s = await syncSummary({ probeSessions: ['s-1'], env: {} });
  // credential() falls back to the keychain, so this asserts the SHAPE: whatever it resolves,
  // an unreachable state is unverifiable and never synced.
  for (const r of s.rows) assert.notEqual(r.verdict, 'synced');
});

test('the summary states that its coverage is a SAMPLE, not a rate', async () => {
  const s = await syncSummary({ probeSessions: [], env: {} });
  assert.match(s.caveat, /SAMPLE/);
  assert.match(s.caveat, /never a rate/);
});

test('NOT PROBED is not ABSENT — a wired point with no probe is unverifiable, never missing', () => {
  // This was a real defect in this module for a commit: `found === null` (nothing was asked) fell
  // through to the same branch as `found === 0` (asked, none found). Harmless only while every
  // point is unwired — the day a close hook lands and P1 becomes `wired`, every unprobed session
  // would have reported `missing`. A latent unsupported finding, inside the module written to prevent it.
  const wired = { id: 'P1', point: 'session close', status: 'wired' };
  assert.equal(verdictFor(wired, { found: null, reachable: true }).verdict, 'unverifiable');
  assert.match(verdictFor(wired, { found: null, reachable: true }).why, /not probed/);
  // ...and the inversion, or the rule passes against itself:
  assert.equal(verdictFor(wired, { found: 0, reachable: true }).verdict, 'missing');
});

test('an UNWIRED point is not-wired whether or not it was probed — the contract answers without asking', () => {
  const unwired = { id: 'P2', point: 'task complete', status: 'not-wired', note: 'nothing writes it' };
  // Order matters: status is knowable from the contract, so it outranks the not-probed case.
  assert.equal(verdictFor(unwired, { found: null, reachable: true }).verdict, 'not-wired');
  assert.equal(verdictFor(unwired, { found: 0, reachable: true }).verdict, 'not-wired');
});
