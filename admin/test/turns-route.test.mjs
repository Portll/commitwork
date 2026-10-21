// admin/routes/turns.mjs — the loopback gate, the redaction boundary, and the denominators.
//
// The assertion that matters most here is the LOOPBACK one. The other surfaces carrying this data
// are local by construction — the CLI runs on the box, the MCP tool speaks stdio to a process on
// the same machine. The panel is published through a tunnel at a routed hostname, so a route here
// is reachable from the internet the moment it exists, and this one reads the operator's own agent
// transcripts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { routes, summarise, listSessions, fleetTotals } from '../routes/turns.mjs';

const route = routes.find((r) => r.path === '/api/turns');

const usage = (o) => ({ input_tokens: 1, output_tokens: o, cache_read_input_tokens: 8, cache_creation_input_tokens: 1 });
const prompt = (u) => ({ type: 'user', uuid: u, sessionId: 's', message: { content: 'go' } });
const say = (t) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'text', text: t }], usage: usage(10) } });
const call = (n) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'tool_use', name: n, input: {} }], usage: usage(10) } });

function plant(records, name = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') {
  const dir = mkdtempSync(join(tmpdir(), 'cw-turns-route-'));
  writeFileSync(join(dir, `${name}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n'));
  return dir;
}

/** Invoke the route handler with a captured send(). */
function invoke({ loopback = true, dir = null, limit = null } = {}) {
  const captured = {};
  const send = (status, body) => { captured.status = status; captured.body = body; return captured; };
  const query = new URLSearchParams(limit ? `limit=${limit}` : '');
  const prev = process.env.CW_TRANSCRIPT_DIR;
  if (dir) process.env.CW_TRANSCRIPT_DIR = dir;
  try {
    route.handle({ send, query, isLoopbackReq: loopback });
  } finally {
    if (dir) { if (prev === undefined) delete process.env.CW_TRANSCRIPT_DIR; else process.env.CW_TRANSCRIPT_DIR = prev; }
  }
  return captured;
}

describe('the loopback gate', () => {
  test('OFF loopback it REFUSES — this must never travel through the published tunnel', () => {
    const r = invoke({ loopback: false });
    assert.equal(r.status, 403);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /operator port only/);
  });

  test('the refusal carries no session data at all, not even counts', () => {
    const r = invoke({ loopback: false });
    assert.equal(r.body.sessions, undefined);
    assert.equal(r.body.totals, undefined);
  });

  test('403 and not 404 — an operator debugging a missing feature deserves the real reason', () => {
    const r = invoke({ loopback: false });
    assert.notEqual(r.status, 404);
    assert.match(r.body.detail, /loopback|tunnel/i);
  });

  test('NOT VACUOUS: ON loopback it answers, or the refusal above proves nothing', () => {
    const dir = plant([prompt('p1'), call('Bash'), say('done')]);
    const r = invoke({ dir });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.sessions.length, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('no session prose crosses the boundary', () => {
  test('a planted secret in the session text is absent from the whole response', () => {
    const records = [];
    for (let i = 0; i < 6; i++) {
      records.push(prompt(`p${i}`), say(`I verified it. Key AKIAIOSFODNN7EXAMPLE, password hunter2-${i}.`));
    }
    const dir = plant(records);
    const r = invoke({ dir });
    const whole = JSON.stringify(r.body);
    assert.equal(r.body.sessions[0].outcome, 'block', 'the planted session must actually trip a rule, or this proves nothing');
    assert.doesNotMatch(whole, /AKIA/, 'a session secret reached an HTTP response');
    assert.doesNotMatch(whole, /hunter2/);
    assert.doesNotMatch(whole, /I verified it/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('sessions are named by basename — no home directory, no project layout', () => {
    const dir = plant([prompt('p1'), call('Bash')]);
    const r = invoke({ dir });
    assert.equal(r.body.sessions[0].session, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.doesNotMatch(JSON.stringify(r.body), /\/Users\//);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('unanswerable states stay unanswerable', () => {
  test('an absent transcript directory is REPORTED, not returned as an empty list', () => {
    const r = invoke({ dir: join(tmpdir(), 'cw-turns-definitely-absent-xyz') });
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /absent/);
    assert.equal(r.body.sessions, null, 'an empty array would read as "measured, nothing found"');
  });

  test('a corrupt transcript is undetermined, never a rate over an unknown denominator', () => {
    const dir = plant([prompt('p1'), call('Bash')]);
    writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{ broken\n{"type":"user","uuid":"p1","message":{"content":"go"}}');
    const r = invoke({ dir });
    assert.equal(r.body.sessions[0].outcome, 'unknown');
    assert.equal(r.body.sessions[0].vetoedBy, 'record-integrity');
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unreadable session is counted apart from a quiet one', () => {
    const rows = [{ session: 'a', outcome: 'unknown', reason: 'transcript unreadable (EACCES)' }];
    assert.equal(fleetTotals(rows).sessionsUnreadable, 1);
    assert.equal(fleetTotals(rows).sessions, 0,
      'a fleet whose transcripts could not be opened must not look like a small quiet fleet');
  });
});

describe('denominators', () => {
  test('every ratio is null, never 0, when its denominator is absent', () => {
    const t = fleetTotals([]);
    assert.equal(t.cacheHitRatio, null);
    assert.equal(t.outputPerTurn, null);
    assert.equal(t.sessions, 0);
  });

  test('counts and ratios are reported together', () => {
    const dir = plant([prompt('p1'), call('Bash'), prompt('p2'), say('talking')]);
    const r = invoke({ dir });
    const t = r.body.totals;
    assert.equal(t.turns, 2);
    assert.ok(t.output > 0);
    assert.ok(t.cacheHitRatio > 0 && t.cacheHitRatio < 1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the count of transcripts AVAILABLE is reported beside the number shown', () => {
    const dir = plant([prompt('p1'), call('Bash')]);
    const r = invoke({ dir });
    assert.equal(r.body.transcriptsAvailable, 1);
    assert.equal(r.body.shown, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('limit is clamped — a caller cannot ask for the whole disk', () => {
    const dir = plant([prompt('p1'), call('Bash')]);
    const listed = listSessions(dir, 9999);
    assert.ok(listed.files.length <= 50);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('summarise', () => {
  test('an absent file is unknown with a stated reason, not a throw', () => {
    const r = summarise(join(tmpdir(), 'cw-no-such-transcript-xyz.jsonl'));
    assert.equal(r.outcome, 'unknown');
    assert.match(r.reason, /absent/);
  });
  test('rules carry name and verdict only — no evidence field', () => {
    const dir = plant([prompt('p1'), call('Bash')]);
    const r = summarise(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'));
    for (const rule of r.rules) assert.deepEqual(Object.keys(rule).sort(), ['rule', 'verdict']);
    rmSync(dir, { recursive: true, force: true });
  });
});
