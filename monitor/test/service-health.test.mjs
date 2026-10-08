// node --test monitor/test/ — the service lane (D2/L1) and the watcher's own pulse (D2/L3).
//
// Everything is injected: no launchctl, no network, no clock. The point of these two checks is to be
// trustworthy about availability, and a test that shells out would pass or fail for reasons that
// have nothing to do with the logic.
//
// The load-bearing assertions are the NULL ones. A tool that could not answer is not evidence the
// service is down, and the whole reason the 2026-08-22 outage went unseen for five and a half hours
// is that a check with nothing to say said `ok`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICE_FACTS, SERVICE_STATES, jobLoaded, portListening, httpAnswers, portOf,
  serviceHealth, stateFrom, watcherPulse,
} from '../service-health.mjs';

const okRun = () => ({ ok: true, status: 0, err: '' });
const noSuchJob = () => ({ ok: false, status: 113, err: 'Could not find service "x" in domain' });
const brokenTool = () => ({ ok: false, status: 127, err: 'launchctl: command not found' });
// Shaped like host-inventory's real output: one `entries` row per (port, proto). The first
// version of this fixture invented a `ports` field, so the tests passed against a shape the
// module would never see and every real service read UNKNOWN.
const inv = (ports) => ({ ok: true, entries: ports.map((p) => ({ port: p, proto: 'TCP', binding: 'loopback' })) });

// ── fact 1: supervision ─────────────────────────────────────────────────────────────────────────

test('a job launchd does not know is FALSE — nothing restarts that service', () => {
  const r = jobLoaded('com.portll.commitwork-panel', { run: noSuchJob, uid: 501 });
  assert.equal(r.value, false);
  assert.match(r.how, /NOT loaded/);
});

test('THE NULL: launchctl failing is UNKNOWN, never "not loaded"', () => {
  // "The tool did not work" and "the job is not loaded" are different findings, and only one of
  // them is about the service. Collapsing them would report every machine without launchctl as an
  // unsupervised fleet.
  const r = jobLoaded('x', { run: brokenTool, uid: 501 });
  assert.equal(r.value, null);
  assert.match(r.how, /UNKNOWN, not absent/);
});

test('an undeclared label is UNKNOWN, not false — undeclared is not the same as unsupervised', () => {
  assert.equal(jobLoaded(null, { run: okRun, uid: 501 }).value, null);
});

// ── fact 2: a listener ──────────────────────────────────────────────────────────────────────────

test('an unreadable inventory yields NULL for every service, not N assertions of silence', () => {
  const r = portListening(7878, { inv: { ok: false, reason: 'lsof failed' } });
  assert.equal(r.value, null);
  assert.match(r.how, /UNKNOWN, not empty/);
  assert.equal(portListening(7878, { inv: null }).value, null);
});

test('a port present in a readable inventory is true; absent is false', () => {
  assert.equal(portListening(7878, { inv: inv([7878, 7979]) }).value, true);
  assert.equal(portListening(9999, { inv: inv([7878]) }).value, false);
});

test('portOf reads the declared service URL, and defaults by scheme', () => {
  assert.equal(portOf('http://127.0.0.1:7878'), 7878);
  assert.equal(portOf('https://127.0.0.1:8099/'), 8099);
  assert.equal(portOf('https://example.test'), 443);
  assert.equal(portOf('http://example.test'), 80);
  assert.equal(portOf('nonsense'), null);
});

// ── fact 3: it answers ──────────────────────────────────────────────────────────────────────────

test('ANY answer proves the process is serving — a 401 is not "down"', () => {
  // Only the ABSENCE of an answer means wedged. A gate answering is a working gate.
  return httpAnswers('http://x/', { fetchImpl: async () => ({ status: 401 }) })
    .then((r) => { assert.equal(r.value, true); assert.equal(r.status, 401); });
});

test('answered-correctly is a SEPARATE fact from answered-at-all', async () => {
  const r = await httpAnswers('http://x/', { expect: [401], fetchImpl: async () => ({ status: 200 }) });
  assert.equal(r.value, true, 'it answered');
  assert.equal(r.unexpected, true, 'and it answered wrongly — two facts, not one');
});

test('no answer is FALSE and says which kind', async () => {
  // The fake MUST honour the abort signal, as real fetch does. A promise that ignores it never
  // settles and hangs the run — which is what the first version of this test did.
  const hangs = (_u, o) => new Promise((_res, rej) => {
    o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  });
  const t = await httpAnswers('http://x/', { timeoutMs: 5, fetchImpl: hangs });
  assert.equal(t.value, false);
  assert.match(t.how, /not serving/);
  const c = await httpAnswers('http://x/', { fetchImpl: () => { const e = new Error('nope'); e.code = 'ECONNREFUSED'; throw e; } });
  assert.equal(c.value, false);
  assert.match(c.how, /could not connect/);
});

// ── the collapse ────────────────────────────────────────────────────────────────────────────────

test('the state ordering never lets a failure hide behind a success', () => {
  const f = (job, port, http, extra = {}) => ({
    jobLoaded: { value: job }, portListening: { value: port }, httpAnswers: { value: http, ...extra },
  });
  assert.equal(stateFrom(f(true, true, true)), 'ok');
  assert.equal(stateFrom(f(true, true, false)), 'down', 'not answering is down even with a loaded job');
  assert.equal(stateFrom(f(true, false, true)), 'down', 'nothing bound is down');
  assert.equal(stateFrom(f(false, true, true)), 'unsupervised',
    'serving right now, and nothing will restart it — the 2026-08-22 condition exactly');
  assert.equal(stateFrom(f(null, true, true)), 'unknown', 'an unmeasured fact is never ok');
  assert.equal(stateFrom(f(true, true, true, { unexpected: true })), 'degraded');
  for (const s of ['ok', 'down', 'degraded', 'unknown', 'unsupervised']) assert.ok(SERVICE_STATES.includes(s));
});

test('serviceHealth reports one row per DECLARED deployment, with every fact', async () => {
  const reg = { areas: [
    { slug: 'commitwork-admin', deploy: { service: 'http://127.0.0.1:7878', requiresAuth: true } },
    { slug: 'nodeploy' },
  ] };
  const r = await serviceHealth({
    reg, labelFor: () => 'com.portll.commitwork-panel', inv: inv([7878]),
    run: okRun, uid: 501, fetchImpl: async () => ({ status: 401 }),
  });
  assert.equal(r.checked, 1, 'an area with no deploy block declares no service');
  assert.equal(r.rows[0].state, 'ok');
  for (const f of SERVICE_FACTS) assert.ok(r.rows[0].facts[f], `${f} missing`);
  assert.equal(r.rows[0].reasons.length, SERVICE_FACTS.length, 'every fact carries its own evidence line');
  assert.equal(r.ok, true);
});

test('ok is false when ANY row is not ok, and an empty run is not a pass', async () => {
  const reg = { areas: [{ slug: 'a', deploy: { service: 'http://127.0.0.1:1', requiresAuth: false } }] };
  const bad = await serviceHealth({ reg, labelFor: () => null, inv: inv([]), run: brokenTool, fetchImpl: async () => ({ status: 200 }), uid: 501 });
  assert.equal(bad.ok, false);
  const none = await serviceHealth({ reg: { areas: [] }, inv: inv([]), run: okRun, uid: 501 });
  assert.equal(none.ok, false, 'nothing measured is not the same as everything healthy');
});

// ── L3: the watcher's own pulse ─────────────────────────────────────────────────────────────────

const rec = (isoAgeMin, now) => ({ at: new Date(now - isoAgeMin * 60000).toISOString() });

test('a recent record is fresh', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  const r = watcherPulse({ readJournalImpl: () => ({ records: [rec(30, now)] }), nowMs: now });
  assert.equal(r.state, 'fresh');
});

test('a GAP is found — but only retrospectively, and the message says so', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  const r = watcherPulse({ readJournalImpl: () => ({ records: [rec(600, now)] }), nowMs: now, expectedIntervalMs: 3600_000 });
  assert.equal(r.state, 'gap');
  // The honesty that makes this check worth having rather than reassuring: a watcher that is not
  // running cannot report that it is not running, and the alarm must not imply otherwise.
  assert.match(r.how, /retrospectively/);
  assert.match(r.how, /off-box probe/);
});

test('NEVER is not GAP — an unwired check is not a missed run', () => {
  const r = watcherPulse({ readJournalImpl: () => ({ records: [] }), nowMs: Date.now() });
  assert.equal(r.state, 'never');
  assert.match(r.how, /never run/);
});

test('an unreadable journal is UNKNOWN, never fine', () => {
  const r = watcherPulse({ readJournalImpl: () => { throw new Error('EACCES'); }, nowMs: Date.now() });
  assert.equal(r.state, 'unreadable');
  assert.match(r.how, /UNKNOWN, not fine/);
});

test('the reader is INJECTED so the rotation-aware one can be used', () => {
  // readJournal(gate) walks the rotation chain; readJournalFile(path) reads one file. They sit in
  // the same import and the wrong one is the shorter word. Right after a rotation the live file can
  // be empty, so the file-only reader would manufacture a `never` or a huge gap for a watcher that
  // ran a minute ago. Injecting it is what keeps that choice visible at the call site.
  let askedFor = null;
  watcherPulse({ readJournalImpl: (g) => { askedFor = g; return { records: [] }; }, gate: 'liveness' });
  assert.equal(askedFor, 'liveness', 'called by GATE name — the rotation-aware signature, not a file path');
});
