// The SessionStart hook that asks a session to bind its own name.
//
// The thing worth pinning is not that it can emit — it is WHEN IT STAYS SILENT, and that it never
// fails a session start. A hook that throws on a malformed payload breaks the startup of every
// session on this machine, which is a far worse defect than the missing bookkeeping it exists for.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { alreadyBound, bindingRequest, sessionPid, psPpid } from '../session-start-roster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, '..', 'session-start-roster.mjs');

const ID = 'fa495aaf-10de-40af-aea2-f840b68faab5';
const ROW = (o) => JSON.stringify(o);

/** Run the hook as the harness runs it: a JSON payload on stdin, roster path overridden. */
function runHook(payload, rosterContent) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sshook-'));
  const path = join(dir, 'sessions.jsonl');
  if (rosterContent !== null) writeFileSync(path, rosterContent);
  return execFileSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, CW_SESSION_ROSTER: path },
    encoding: 'utf8',
  });
}

describe('a bound session is left alone — silence is what keeps it from becoming wallpaper', () => {
  test('a row with this id AND a name suppresses the prompt', () => {
    const roster = `${ROW({ name: '08', ref: '96fb96', id: ID })}\n`;
    assert.equal(alreadyBound(ID, roster), true);
    assert.equal(runHook({ session_id: ID }, roster), '');
  });

  test('a row for a DIFFERENT session does not suppress it', () => {
    const roster = `${ROW({ name: 'c5', ref: 'e887b8', id: '00000000-0000-4000-8000-000000000001' })}\n`;
    assert.equal(alreadyBound(ID, roster), false);
    assert.match(runHook({ session_id: ID }, roster), /SESSION ROSTER/);
  });

  test('an id-only row is NOT a binding — the name is the half that was missing', () => {
    // The hook cannot write a name, so a nameless row must never read as "this session is bound".
    assert.equal(alreadyBound(ID, `${ROW({ id: ID, tree: 'abc' })}\n`), false);
  });
});

describe('uncertainty prompts — only a positive parsed row buys silence', () => {
  test('an absent roster prompts rather than assuming bound', () => {
    assert.equal(alreadyBound(ID, ''), false);
    assert.match(runHook({ session_id: ID }, null), /SESSION ROSTER/);
  });

  test('a torn line is skipped, and does not suppress a prompt on its own', () => {
    assert.equal(alreadyBound(ID, '{"name":"08","id":"fa4954\n'), false);
  });

  test('a torn line does not hide a GOOD row later in the file', () => {
    const roster = `{"name":"08","id":"trunc\n${ROW({ name: '08', ref: '96fb96', id: ID })}\n`;
    assert.equal(alreadyBound(ID, roster), true);
  });
});

describe('it never fails a session start', () => {
  for (const [label, payload] of [
    ['an empty object', {}],
    ['a payload with no session_id', { cwd: '/tmp', source: 'startup' }],
    ['a non-JSON payload', 'not json at all'],
    ['an empty payload', ''],
    ['a session_id of the wrong type', { session_id: 42 }],
  ]) {
    test(`${label} exits 0 and emits nothing that breaks the harness`, () => {
      const out = runHook(payload, null);           // execFileSync throws on non-zero exit
      if (out.trim()) JSON.parse(out);              // whatever it did emit must be parseable JSON
    });
  }
});

describe('the injected context is usable on its own', () => {
  const text = bindingRequest(ID);

  test('it carries the session id, so the agent need not go find it', () => {
    assert.match(text, new RegExp(ID));
  });

  test('it names ListAgents as the authority and warns off the two measured wrong sources', () => {
    assert.match(text, /ListAgents/);
    assert.match(text, /Do NOT derive the name from the session id or from the transcript title/);
  });

  test('the command it tells the agent to run is the roster CLI, spelled correctly', () => {
    assert.match(text, /node bin\/session-roster\.mjs --record <NN> <ref> /);
  });

  test('emitted output is valid hook JSON with the SessionStart event name', () => {
    const out = JSON.parse(runHook({ session_id: ID }, null));
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /SESSION ROSTER/);
  });
});

// ── The pid the hook can supply ──────────────────────────────────────────────────────────────────
//
// Added 2026-09-06. The instruction told agents to record name + ref + uuid, and every row that
// produced was filed 'unverifiable' on arrival, because `freshness()` corroborates a row only
// through a pid that still holds a session socket. The hook cannot see a NAME at any price — that
// is this file's whole premise — but the pid is an ancestor of its own process, so it can.
//
// Both directions, and the second is the load-bearing one: finding the right pid is worth little if
// a chain with no session in it returns something anyway. A confidently wrong pid mints a row that
// reads 'live' while naming another session's process, which is worse than the gap it closes.
describe('the pid the hook supplies', () => {
  test('it returns the ancestor that holds a session socket, not merely the nearest parent', () => {
    // This process is a descendant of nothing that holds a socket in a fixture dir, so plant its own
    // pid: sessionPid must accept the walk's very first hop when that hop is the live one.
    const live = new Set([String(process.pid)]);
    assert.equal(sessionPid({ live, start: process.pid }), String(process.pid));
  });

  test('an ancestor chain with NO live session returns null — it never falls back to a parent', () => {
    // A pid that is certainly not in the set. The walk must exhaust and yield null rather than
    // return the shell, VS Code, or init as though one of them were the session.
    assert.equal(sessionPid({ live: new Set(['999999']), start: process.pid }), null);
  });

  test('an unmeasurable or empty socket set yields null, never a guess', () => {
    assert.equal(sessionPid({ live: null, start: process.pid }), null);
    assert.equal(sessionPid({ live: new Set(), start: process.pid }), null);
  });

  test('the walk is bounded — a cyclic or deep chain cannot hang a session start', () => {
    assert.equal(sessionPid({ live: new Set(['999999']), start: process.pid, maxHops: 1 }), null);
  });

  // C2, repaired 2026-09-06 from its detector: the walk read ps's OUTPUT and never
  // its STATUS, so a ps that could not run produced the same null as a chain with no session in it.
  // Both fail closed, so no caller can tell the repair happened — which is exactly why it needed a
  // test rather than an inspection.
  test('a ps that CANNOT RUN stops the walk instead of being retried once per hop', () => {
    let calls = 0;
    const ppidOf = () => { calls++; return { failed: true, why: 'ENOENT' }; };
    assert.equal(sessionPid({ live: new Set(['999999']), start: 1000, maxHops: 12, ppidOf }), null);
    assert.equal(calls, 1,
      'an instrument that cannot run was probed again — twelve failing spawns per session start');
  });

  test('NEGATIVE: a pid with no readable parent still walks exactly as before', () => {
    let calls = 0;
    const ppidOf = () => { calls++; return { parent: null }; };
    assert.equal(sessionPid({ live: new Set(['999999']), start: 1000, maxHops: 12, ppidOf }), null);
    assert.equal(calls, 1, 'the no-parent case must terminate on its own answer, not on the failure path');
  });

  test('a real chain still resolves through the injected prober, so the seam is not a stub', () => {
    const chain = { 1000: 1001, 1001: 1002 };
    const ppidOf = (pid) => ({ parent: chain[pid] ?? null });
    assert.equal(sessionPid({ live: new Set(['1002']), start: 1000, maxHops: 12, ppidOf }), '1002');
  });

  test('psPpid reports a FAILED probe distinctly from a pid that has no parent', () => {
    // The default prober against a pid that cannot exist: ps runs and answers nothing, which is
    // `parent: null` — NOT `failed`. Conflating these two is the defect this pair pins.
    const answer = psPpid(999999);
    assert.equal(answer.failed, undefined, 'a ps that RAN must not report itself as having failed');
    assert.equal(answer.parent, null);
  });

  test('the instruction carries the pid when known, and omits the argument when not', () => {
    const withPid = bindingRequest('uuid-1', '4242');
    assert.match(withPid, /--record <NN> <ref> uuid-1 4242/);
    assert.match(withPid, /makes the row an ADDRESS/, 'the reason must travel with the argument');

    const without = bindingRequest('uuid-1', null);
    assert.match(without, /--record <NN> <ref> uuid-1$/m, 'no trailing placeholder to be pasted literally');
    assert.doesNotMatch(without, /ADDRESS/, 'no dangling explanation for an argument that is not there');
  });
});
