// The Host section's endpoint — the load-bearing assertion is the REDACTION: the published shape
// answers the security question (which ports, project-vs-host, reachable off-box) without naming
// processes, pids or the account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostState, routes } from '../routes/host.mjs';

test('the route is registered read-only, at one path', () => {
  assert.equal(routes.length, 1);
  assert.equal(routes[0].method, 'GET');
  assert.equal(routes[0].path, '/api/host');
});

test('the published shape carries no command, pid or user; the operator shape does', () => {
  const full = hostState({ full: true });
  const red = hostState({ full: false });
  if (full.ok !== true) { assert.equal(red.ok, false); return; }   // no lsof in this environment
  const s = JSON.stringify(red);
  assert.ok(!/"command"/.test(s), 'a process name reached the published payload');
  assert.ok(!/"pid"/.test(s));
  assert.ok(!/"owners"/.test(s));
  assert.equal(red.detail, 'redacted');
  assert.equal(full.detail, 'full');
  assert.ok(/"command"/.test(JSON.stringify(full)), 'the operator port must still get the detail');
});

test('the published shape still answers the security question', () => {
  const red = hostState({ full: false });
  if (red.ok !== true) return;
  assert.ok(Array.isArray(red.entries));
  for (const e of red.entries) {
    assert.equal(typeof e.port, 'number');
    assert.ok(['TCP', 'UDP'].includes(e.proto));
    assert.ok(['project', 'host', 'unbound-unverifiable', 'unknown'].includes(e.owner));
  }
  assert.ok(red.counts && typeof red.counts.externalUndeclared === 'number',
    'externally bound and declared nowhere is the number this surface exists for');
  assert.ok('privileged' in red, 'a reader must be able to see whether the look could see everything');
});

test('the route hands the loopback gate straight through to the detail level', () => {
  const seen = [];
  const send = (code, body) => seen.push({ code, body });
  routes[0].handle({ send, isLoopbackReq: false });
  routes[0].handle({ send, isLoopbackReq: true });
  assert.equal(seen[0].code, 200);
  assert.equal(seen[0].body.detail, 'redacted', 'the published port must never get full detail');
  assert.equal(seen[1].body.detail, 'full');
});

test('a thrown observation is UNKNOWN with a reason — never an empty box', () => {
  // "Nothing is listening" is the most dangerous sentence this surface could print by accident.
  const { hostState: hs } = { hostState };
  const out = hs({ full: false, nowMs: Date.now() });
  if (out.ok === false) {
    assert.ok(out.reason, 'ok:false must always carry a reason');
    assert.equal(out.entries, undefined, 'there must be no entries array to mistake for zero');
  }
});

test('the observation age is reported, so freshness is visible rather than assumed', () => {
  const a = hostState({ full: false });
  assert.equal(typeof a.observedAgeMs, 'number');
  assert.ok(a.observedAgeMs >= 0);
});
