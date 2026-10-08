// The roster's second witness: is it being FED, and does a fed-once row still read as an answer?
//
// bin/test/session-roster.test.mjs already pins what the roster DOES. It passed every day the store
// sat unfed, because every assertion in it reads the roster — the same failure mode as the thing it
// checks. The tool was always writable; that was never the problem. So this file measures the
// roster against something with a different feed (the touch ledger, written by a PostToolUse hook)
// and pins the defect an unfed roster actually produces, which is not silence.
//
// Unmeasured is neither a pass nor a finding. In CI there is no harness, no hook and no ledger. The
// coverage test below therefore SKIPS with a stated reason rather than passing quietly or inventing
// a failure — a fabricated finding about a fleet that is not there costs more than a missed one.
// The fixture tests carry the regression pins and run everywhere.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirname, resolve as presolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { record, mirror, resolve, freshness, assess, feedLag, readRoster } from '../session-roster.mjs';
import { livePids, collisions } from '../lib/peer-headers.mjs';
import * as storePaths from '../lib/store-paths.mjs';
import { generations } from '../lib/ledger-rotate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = presolve(HERE, '..', 'session-roster.mjs');
const SELF = 'aaaaaaaaaaaa';
const HOUR = 3600_000;

const fixture = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-rosterfed-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, 'sessions.jsonl');
};

/** stdout of the CLI whatever its exit code — a non-zero exit is a RESULT here, not a failure. */
const cli = (args, path) => {
  const env = { ...process.env, CW_SESSION_ROSTER: path };
  try { return execFileSync('node', [CLI, ...args], { env, encoding: 'utf8' }); }
  catch (e) { return String(e.stdout ?? ''); }
};

// ── THE DEFECT AN UNFED ROSTER ACTUALLY PRODUCES ─────────────────────────────────────────────────
//
// Measured on the live store 2026-09-01: `--resolve 5e` printed `cw5e = [ref] = <transcript>` with
// no caveat, off ONE row three days old, while the live session of that name was a different one. The
// "reports the whole history when a name has moved" safety path never fired, because with a single
// row there is no history to report. Confidently wrong, not grey.

describe('a stale binding is a RECORD, never an address', () => {
  test('one aged row from a foreign checkout does not resolve as an answer', (t) => {
    const path = fixture(t);
    writeFileSync(path, `${JSON.stringify({ name: '5e', ref: 'a0b1c2', id: 'uuid-old',
      tree: 'ffffffffffff', at: new Date(Date.now() - 72 * HOUR).toISOString(), via: 'observed' })}\n`);
    const a = assess(resolve('5e', { path }), { self: SELF, live: new Set() });
    assert.equal(a.scored[0].verdict, 'stale');
    assert.equal(a.answer, null, 'a stale row was offered as the answer');
    // Through the CLI too, because the equality line is what a reader copies. It exits 3 here by
    // design, so the output must be read off the thrown error rather than a return value.
    assert.doesNotMatch(cli(['--resolve', '5e'], path), /cw5e = \[a0b1c2\]/,
      'the CLI published a stale binding as an equality');
    assert.match(cli(['--resolve', '5e'], path), /NOT AN ADDRESS/);
  });

  test('the CLI exits non-zero when nothing live corroborates the name', (t) => {
    const path = fixture(t);
    writeFileSync(path, `${JSON.stringify({ name: '5e', ref: 'a0b1c2', tree: 'ffffffffffff',
      at: new Date(Date.now() - 72 * HOUR).toISOString(), via: 'observed' })}\n`);
    // A caller must be able to NOTICE. Exit 0 here is how a script acts on a dead binding.
    let code = 0;
    try { execFileSync('node', [CLI, '--resolve', '5e'], { env: { ...process.env, CW_SESSION_ROSTER: path }, encoding: 'utf8' }); }
    catch (e) { code = e.status; }
    assert.equal(code, 3);
  });

  test('two LIVE holders of one name refuse to resolve — that is L8 itself', (t) => {
    const path = fixture(t);
    const now = new Date().toISOString();
    record({ name: 'cw8d', pid: '111', via: 'peer-header' }, { path, now });
    record({ name: 'cw8d', pid: '222', via: 'peer-header' }, { path, now });
    const a = assess(resolve('8d', { path }), { self: undefined, live: new Set(['111', '222']) });
    assert.equal(a.live, 2);
    assert.equal(a.answer, null, 'a contended name resolved to one of its holders');
  });
});

describe('freshness is three-valued, and the third value is not a verdict', () => {
  const row = (o) => ({ name: 'aa', tree: SELF, at: new Date().toISOString(), via: 'observed', ...o });

  test('a live socket corroborates', () => {
    assert.equal(freshness(row({ pid: '77' }), { self: SELF, live: new Set(['77']) }).verdict, 'live');
  });

  test('a dead socket contradicts, and outranks every softer signal', () => {
    const f = freshness(row({ pid: '77', tree: 'ffffffffffff' }), { self: SELF, live: new Set() });
    assert.equal(f.verdict, 'stale');
    assert.ok(f.reasons.includes('socket-gone'));
  });

  test('UNMEASURED liveness is not a dead session', () => {
    // The trap this pins: collapsing "could not read the socket dir" into an empty live set turns
    // every binding in the store into a contradiction at once.
    const f = freshness(row({ pid: '77' }), { self: SELF, live: null });
    assert.equal(f.verdict, 'unverifiable');
    assert.ok(f.reasons.includes('liveness-unmeasured'));
  });

  test('a fresh same-tree row with no pid is UNVERIFIABLE, not live and not stale', () => {
    // Nothing on this machine resolves a harness `ref`, so a ref-only row can never be corroborated
    // locally. It must not be published as either a pass or a finding.
    assert.equal(freshness(row({ ref: 'abc123' }), { self: SELF, live: new Set() }).verdict, 'unverifiable');
  });

  test('livePids returns null, not an empty Set, when the socket dir is unreadable', (t) => {
    const d = mkdtempSync(join(tmpdir(), 'cw-sock-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    const f = join(d, 'a-file');
    writeFileSync(f, '');
    assert.equal(livePids({ dir: f }), null, 'ENOTDIR read as "nobody is live"');
    assert.deepEqual(livePids({ dir: join(d, 'gone') }), new Set(), 'ENOENT is a legitimate empty');
  });
});

// ── THE TITLE MIRROR IS POPULATED AND WRONG ──────────────────────────────────────────────────────
//
// Measured 2026-09-01: one session carries a title reading `cw-15`; its harness name is `c5`.
// A backfill walking titles writes false bindings with the same confidence as true ones, and
// append-only makes them permanent.

describe('a title that contradicts a better source is refused, not used as a fallback', () => {
  test('mirror refuses a title name for a uuid an observed row already binds', (t) => {
    const path = fixture(t);
    const id = '00000000-0000-4000-8000-000000000001';
    record({ name: 'c5', ref: 'e887b8', id }, { path });
    const readSessions = () => [{ id, title: 'Roster work (cw15)' }];
    const { added, refused } = mirror({ path, readSessions });
    assert.equal(added.length, 0, 'a false binding was written and is now permanent');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].titleName, '15');
    assert.equal(refused[0].boundName, 'c5');
  });

  test('an unclaimed uuid still mirrors — the guard refuses contradiction, not the source', (t) => {
    const path = fixture(t);
    const { added, refused } = mirror({ path, readSessions: () => [{ id: 'u-1', title: 'x (cw11)' }] });
    assert.equal(added.length, 1);
    assert.equal(refused.length, 0);
  });
});

// ── COVERAGE: THE WITNESS THAT CANNOT SHARE THE ROSTER'S FAILURE MODE ────────────────────────────

describe('feedLag fires on an unfed roster and stays silent on a fed one', () => {
  const ledger = (n, spanH) => Array.from({ length: n }, (_, i) => ({
    s: `sess${i}`, r: SELF, at: new Date(Date.now() - (spanH - (i * spanH) / n) * HOUR).toISOString(),
  }));

  // Both directions asserted separately. Only one of them is the direction that lies to you.
  test('POSITIVE: days of activity with no roster row for this tree is UNFED', () => {
    const r = feedLag({ rosterRows: [{ name: '5e', tree: 'ffffffffffff', at: new Date().toISOString() }],
      ledgerRows: ledger(40, 72), self: SELF });
    assert.equal(r.state, 'unfed');
    assert.equal(r.reason, 'no-roster-row-for-this-tree');
  });

  test('POSITIVE: a roster whose newest row lags the ledger past the budget is UNFED', () => {
    const r = feedLag({ rosterRows: [{ name: '08', tree: SELF, at: new Date(Date.now() - 72 * HOUR).toISOString() }],
      ledgerRows: ledger(40, 48), self: SELF });
    assert.equal(r.state, 'unfed');
    assert.equal(r.reason, 'roster-lags-ledger');
  });

  test('NEGATIVE: a roster bound within the budget is OK', () => {
    const r = feedLag({ rosterRows: [{ name: '08', tree: SELF, at: new Date().toISOString() }],
      ledgerRows: ledger(40, 48), self: SELF });
    assert.equal(r.state, 'ok');
  });

  test('NEGATIVE: an unreadable ledger is UNMEASURABLE — never unfed', () => {
    assert.equal(feedLag({ rosterRows: [], ledgerRows: null, self: SELF }).state, 'unmeasurable');
  });

  test('NEGATIVE: a young checkout is UNMEASURABLE — a new tree is not a neglected one', () => {
    const r = feedLag({ rosterRows: [], ledgerRows: ledger(10, 1), self: SELF });
    assert.equal(r.state, 'unmeasurable');
    assert.equal(r.reason, 'insufficient-activity-span');
  });

  test("NEGATIVE: another checkout's activity cannot vouch for this one", () => {
    // The stores are shared across checkouts. Counting foreign rows would let a busy tree elsewhere
    // certify this tree's bookkeeping.
    const r = feedLag({ rosterRows: [], ledgerRows: ledger(40, 72).map((x) => ({ ...x, r: 'ffffffffffff' })), self: SELF });
    assert.equal(r.state, 'unmeasurable');
    assert.equal(r.reason, 'no-ledger-activity-for-this-tree');
  });
});

describe('the live roster is fed (measured, or explicitly not measured)', () => {
  test('this tree has a roster binding no older than the lag budget', (t) => {
    let ledgerRows = null;
    try {
      ledgerRows = [];
      for (const f of generations(storePaths.touchLedger())) {
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try { ledgerRows.push(JSON.parse(line)); } catch { /* a torn tail line is normal */ }
        }
      }
    } catch { ledgerRows = null; }

    const r = feedLag({ rosterRows: readRoster(), ledgerRows });
    // explicit uncertainty: with no hook, no ledger or too short a history there is
    // nothing to assert, and the reason is stated rather than swallowed.
    if (r.state === 'unmeasurable') return t.skip(`roster feed not measurable here: ${r.reason}`);
    assert.equal(r.state, 'ok',
      `the roster went unfed: ${r.reason}. ${r.sessions} session(s) edited this tree over `
      + `${Math.round(r.span / HOUR)}h, and the newest roster binding is `
      + `${r.lag === null ? 'ABSENT' : `${Math.round(r.lag / HOUR)}h behind the newest edit`}. `
      + 'Run `node bin/session-roster.mjs --scan`, or ListAgents + --record.');
  });
});

describe('collisions are computed from evidence, not remembered', () => {
  test('a name held by two pids is reported; liveness is null when unmeasured', () => {
    const b = [{ name: '8d', pid: '1' }, { name: '8d', pid: '2' }, { name: 'aa', pid: '3' }];
    const [c] = collisions(b, null);
    assert.equal(c.name, '8d');
    assert.equal(c.holders, 2);
    assert.equal(c.liveNow, null, 'unmeasured liveness reported as zero live holders');
    assert.equal(collisions(b, new Set(['1', '2']))[0].liveNow, 2);
  });
});
