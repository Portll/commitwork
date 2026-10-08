// node --test bin/test/ — the off-box probe.
//
// Everything here injects `fetchImpl` and the clock: a test that reaches the network would fail on a
// runner with no egress and pass for the wrong reason on one with it, and this probe's whole job is
// to be trustworthy about availability.
//
// The load-bearing assertion is the inverted one. For an auth-gated hostname 200 is an ALARM, not
// health — it means the published surface is serving without its session gate. Every generic uptime
// monitor gets that backwards, so it is pinned here first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROBE_STATES, expectationFor, targetsFromRegistry, probeOne, probeAll, formatReport, explain,
} from '../probe-public.mjs';

const authed = { area: 'commitwork-admin', hostname: 'commitwork.online', expect: [401], note: '' };
const open = { area: 'clientD', hostname: 'client-d.example.net', expect: [200, 204, 301, 302, 303, 307, 308], note: '' };
const reply = (status) => async () => ({ status });
const clock = () => { let t = 1000; return () => (t += 5); };

test('THE INVERSION: 200 on an auth-gated hostname is an alarm, not health', async () => {
  const r = await probeOne(authed, { fetchImpl: reply(200), nowMs: clock() });
  assert.equal(r.ok, false, '200 here means the session gate is not in front of the panel');
  assert.equal(r.state, 'unexpected-status');
  assert.match(r.detail, /WITHOUT its session gate/);
});

test('401 on an auth-gated hostname IS health', async () => {
  const r = await probeOne(authed, { fetchImpl: reply(401), nowMs: clock() });
  assert.equal(r.ok, true);
  assert.equal(r.state, 'ok');
  assert.equal(r.detail, null);
});

test('the expectation is DERIVED from requiresAuth, not listed', () => {
  // A gate may deny with 401 OR 403 and both satisfy requiresAuth. Expecting 401 alone turned
  // overwatch-layer — which denies with 403 from its own origin — permanently red, and a probe that
  // calls a working gate an incident is the false-alarm direction of the house rule.
  assert.deepEqual(expectationFor({ requiresAuth: true }).expect, [401, 403]);
  const open2 = expectationFor({ requiresAuth: false }).expect;
  assert.ok(open2.includes(200) && open2.includes(301), 'a public site legitimately redirects');
  assert.equal(open2.includes(401), false, 'an ungated site answering 401 is not healthy either');
});

test('a 5xx says it cannot tell the origin from the tunnel; a 403 does NOT', () => {
  // The first draft attached the tunnel-vs-origin sentence to every mismatch, and the first live
  // run printed it under a 403 — an alarm sending the reader to check two machines over an answer
  // the edge gave on its own.
  assert.match(explain(502, [200]), /cannot distinguish the origin being down from the tunnel/);
  assert.doesNotMatch(explain(403, [401]), /tunnel being down/);
  assert.match(explain(403, [401]), /ROUTING or POLICY/);
});

test('a timeout and an unreachable host are DIFFERENT states', async () => {
  const t = await probeOne(open, {
    fetchImpl: () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, nowMs: clock(),
  });
  assert.equal(t.state, 'timeout');
  const u = await probeOne(open, {
    fetchImpl: () => { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }, nowMs: clock(),
  });
  assert.equal(u.state, 'unreachable');
  assert.notEqual(t.state, u.state, 'a host that answers slowly and one that does not exist are not the same finding');
});

test('a redirect is OBSERVED, never followed', async () => {
  // Following it would report some other hostname's status under this one's name.
  let opts = null;
  await probeOne(open, { fetchImpl: async (_u, o) => { opts = o; return { status: 301 }; }, nowMs: clock() });
  assert.equal(opts.redirect, 'manual');
});

test('the probe never throws, whatever fetch does', async () => {
  for (const boom of [() => { throw new Error('x'); }, () => { throw 'a string'; }, () => { throw null; }]) {
    const r = await probeOne(open, { fetchImpl: boom, nowMs: clock() });
    assert.equal(r.ok, false);
    assert.ok(PROBE_STATES.includes(r.state));
  }
});

test('no response body or header ever reaches the row — this output lands in a public log', async () => {
  const r = await probeOne(authed, {
    fetchImpl: async () => ({ status: 401, headers: { get: () => 'set-cookie: secret=abc' }, text: async () => 'SECRET BODY' }),
    nowMs: clock(),
  });
  const s = JSON.stringify(r);
  assert.equal(s.includes('SECRET'), false);
  assert.equal(s.includes('set-cookie'), false);
});

test('probeAll aggregates, and ok is true only when EVERY row is ok', async () => {
  const many = [authed, { ...open, hostname: 'a.example' }];
  let n = 0;
  const res = await probeAll(many, { fetchImpl: async () => ({ status: (n++ === 0 ? 401 : 502) }), nowMs: clock() });
  assert.equal(res.ok, false, 'one bad hostname makes the run bad');
  assert.equal(res.counts.ok, 1);
  assert.equal(res.counts['unexpected-status'], 1);
  // every declared state is present as a number, so a zero reads as measured rather than missing
  for (const s of PROBE_STATES) assert.equal(typeof res.counts[s], 'number', `${s} missing from counts`);
});

test('targets come from the registry, public hostnames only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-probe-'));
  const p = join(dir, 'projects.json');
  try {
    writeFileSync(p, JSON.stringify({
      areas: [
        { slug: 'gated', deploy: { public: true, requiresAuth: true, hostnames: ['g.example'] } },
        { slug: 'open', deploy: { public: true, requiresAuth: false, hostnames: ['o.example'] } },
        { slug: 'private', deploy: { public: false, requiresAuth: true, hostnames: ['p.example'] } },
        { slug: 'nodeploy' },
      ],
    }));
    const t = targetsFromRegistry(p);
    assert.deepEqual(t.map((x) => x.hostname), ['g.example', 'o.example'], 'a non-public hostname is not a published surface');
    assert.deepEqual(t.find((x) => x.hostname === 'g.example').expect, [401, 403]);
    assert.equal(t.find((x) => x.hostname === 'g.example').path, '/', 'no probePath declared means /');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a declared probePath is what gets asked for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-probe-p-'));
  const p = join(dir, 'projects.json');
  try {
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'overwatch-layer', deploy: {
      public: true, requiresAuth: true, probePath: '/app', hostnames: ['s.example'] } }] }));
    const t = targetsFromRegistry(p);
    assert.equal(t[0].path, '/app',
      'a hostname that serves a public front page and gates its app elsewhere must be probed at the gated path');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('probeOne asks for the declared path, not always /', async () => {
  let asked = null;
  await probeOne({ ...authed, path: '/app' }, { fetchImpl: async (u) => { asked = u; return { status: 403 }; }, nowMs: clock() });
  assert.match(asked, /\/app$/);
});

test('the report names the failing hostname and its reason', () => {
  const out = formatReport({
    rows: [{ ...authed, status: 200, ms: 5, ok: false, state: 'unexpected-status', detail: 'gate is gone' }],
    counts: { ok: 0, 'unexpected-status': 1 }, ok: false,
  });
  assert.match(out, /commitwork\.online/);
  assert.match(out, /gate is gone/);
  assert.match(out, /did NOT answer as declared/);
});
