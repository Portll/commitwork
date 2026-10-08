import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readJsonl, readTouches, readRoster, transcriptPath, lastOutput, collectFiles, buildRows,
  fleetTokens, tokenBudget,
} from '../lib/session-view.mjs';

const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const enoent = () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; };
const eacces = () => { const e = new Error('nope'); e.code = 'EACCES'; throw e; };

// ── fail closed ─────────────────────────────────────────────────────────────────────────────────
// "touched nothing" and "could not be asked" are different facts about an agent, and only one of
// them is safe to render as an empty cell.

test('ENOENT is an absent store; EACCES is UNREADABLE and never an empty list', () => {
  const missing = readJsonl('/x', { readFile: enoent });
  assert.equal(missing.ok, true);
  assert.equal(missing.absent, true);

  const denied = readJsonl('/x', { readFile: eacces });
  assert.equal(denied.ok, false);
  assert.match(denied.why, /EACCES/);
});

test('an unreadable touch ledger makes files UNREADABLE, not "none"', () => {
  const t = readTouches({ readFile: eacces });
  assert.equal(t.ok, false);
  const f = collectFiles({ pid: 1 }, 'abcd1234', t);
  assert.equal(f.state, 'unreadable', 'rendering this as "none" would report a busy agent as idle');
});

test('no touch ledger supplied at all is UNKNOWN, distinct from unreadable and from none', () => {
  assert.equal(collectFiles({ pid: 1 }, 'ref', null).state, 'unknown');
});

test('a torn line is skipped without losing the rest of the store', () => {
  const r = readJsonl('/x', { readFile: () => '{"a":1}\nNOT JSON\n{"a":2}\n' });
  assert.equal(r.rows.length, 2);
});

// ── the join ────────────────────────────────────────────────────────────────────────────────────
// A pid can be recycled; a uuid prefix cannot. This is the correctness core of the module.

const touchStore = (...rows) => readTouches({ readFile: () => jsonl(...rows) });

test('the uuid prefix is authoritative and needs no lifetime test', () => {
  const t = touchStore({ s: 'aabbccdd', p: 999, x: 'a.mjs', at: '2020-01-01T00:00:00Z', access: 'edit' });
  const f = collectFiles({ pid: 1, startedAt: '2026-01-01T00:00:00Z' }, 'aabbccdd', t);
  assert.equal(f.state, 'live');
  assert.deepEqual(f.paths, ['a.mjs'], 'a prefix match holds even when the timestamp predates the session row');
});

test('a pid match OUTSIDE the session lifetime is refused — pids are recycled', () => {
  const t = touchStore({ s: 'other111', p: 4242, x: 'ghost.mjs', at: '2026-01-01T00:00:00Z' });
  const f = collectFiles({ pid: 4242, startedAt: '2026-09-01T00:00:00Z' }, 'nomatch0', t, Date.parse('2026-09-02T00:00:00Z'));
  assert.equal(f.state, 'none',
    "a dead session's edits must not be attributed to whoever inherited its pid");
});

test('a pid match INSIDE the lifetime is accepted, and says it came via pid', () => {
  const t = touchStore({ s: 'other111', p: 4242, x: 'real.mjs', at: '2026-09-01T12:00:00Z' });
  const f = collectFiles({ pid: 4242, startedAt: '2026-09-01T00:00:00Z' }, 'nomatch0', t, Date.parse('2026-09-02T00:00:00Z'));
  assert.equal(f.state, 'live');
  assert.equal(f.viaPid, true, 'a weaker join must declare itself');
});

test('a pid match with NO timestamp is refused rather than assumed current', () => {
  const t = touchStore({ s: 'other111', p: 4242, x: 'undated.mjs' });
  const f = collectFiles({ pid: 4242, startedAt: '2026-09-01T00:00:00Z' }, 'nomatch0', t);
  assert.equal(f.state, 'none', 'an untestable match is exactly the one that misattributes');
});

test('paths are de-duplicated but the touch count is kept', () => {
  const t = touchStore(
    { s: 'aa', p: 1, x: 'same.mjs', at: '2026-09-01T00:00:00Z' },
    { s: 'aa', p: 1, x: 'same.mjs', at: '2026-09-01T00:01:00Z' },
    { s: 'aa', p: 1, x: 'other.mjs', at: '2026-09-01T00:02:00Z' },
  );
  const f = collectFiles({ pid: 1 }, 'aa', t);
  assert.equal(f.count, 2);
  assert.equal(f.touches, 3);
  assert.equal(f.recent.path, 'other.mjs', 'the most recent touch wins, not the last row read');
});

// ── identity ────────────────────────────────────────────────────────────────────────────────────

test('a session is named by what an operator recognises, and a uuid is the LAST resort', () => {
  const roster = readRoster({ readFile: () => jsonl({ sessionId: 'u-1', name: 'from-roster', cwd: '/a/b/proj' }) });
  const withFleet = buildRows([{ id: 's1', ids: { fleetName: 'Docker Wedging', cwd: '/x/y/commitwork', transcript: 'u-1' } }], { roster, transcripts: false })[0];
  assert.equal(withFleet.name, 'Docker Wedging');
  assert.equal(withFleet.project, 'commitwork', 'the project is the cwd basename, not the full path');

  const viaRoster = buildRows([{ id: 's2', ids: { transcript: 'u-1' } }], { roster, transcripts: false })[0];
  assert.equal(viaRoster.name, 'from-roster');
  assert.equal(viaRoster.project, 'proj');

  const nameless = buildRows([{ id: 's3', ids: {} }], { transcripts: false })[0];
  assert.equal(nameless.name, null, 'a null name renders as unknown; it must not silently become the uuid');
});

test('transcriptPath needs BOTH the uuid and the cwd, and returns null rather than guessing', () => {
  assert.equal(transcriptPath({ transcript: 'u', cwd: null }), null);
  assert.equal(transcriptPath({ transcript: null, cwd: '/a' }), null);
  assert.match(transcriptPath({ transcript: 'u-1', cwd: '/work/Repositories/commitwork' }, { root: '/R' }),
    /^\/R\/-work-Repositories-commitwork\/u-1\.jsonl$/);
});

// ── turn output ─────────────────────────────────────────────────────────────────────────────────

test('a session with no transcript id is UNKNOWN, not "said nothing"', () => {
  assert.equal(lastOutput(null).state, 'unknown');
  const r = buildRows([{ id: 'x', ids: {} }], { transcripts: true })[0];
  assert.equal(r.output.state, 'unknown');
  assert.equal(r.tokens.state, 'unknown');
});

test('a missing transcript is ABSENT and a broken read is UNREADABLE', () => {
  assert.equal(lastOutput('/definitely/not/here.jsonl').state, 'absent');
});

// ── fleet totals ────────────────────────────────────────────────────────────────────────────────

test('the fleet total states its denominator — a total over 2 of 14 is not a fleet total', () => {
  const rows = [
    { id: 'a', tokens: { state: 'live', turns: 2, totals: { input: 10, output: 100, cacheRead: 5, cacheCreation: 1 } } },
    { id: 'b', tokens: { state: 'live', turns: 3, totals: { input: 20, output: 200, cacheRead: 7, cacheCreation: 2 } } },
    { id: 'c', tokens: { state: 'unreadable', why: 'torn' } },
  ];
  const f = fleetTokens(rows);
  assert.equal(f.measured, 2);
  assert.equal(f.of, 3);
  assert.equal(f.totals.output, 300);
  assert.equal(f.turns, 5);
  assert.deepEqual(f.unmeasured.map((u) => u.id), ['c'], 'the unmeasured are named, never folded into the total');
});

test('an all-null field stays null rather than collapsing to 0', () => {
  const f = fleetTokens([{ id: 'a', tokens: { state: 'live', turns: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null } } }]);
  assert.equal(f.totals.output, null, '0 would read as a measured zero');
});

test('no measurable session yields nulls and measured 0, never a confident zero fleet', () => {
  const f = fleetTokens([{ id: 'a', tokens: { state: 'absent' } }]);
  assert.equal(f.measured, 0);
  assert.equal(f.of, 1);
  assert.equal(f.totals.output, null);
});

test('tokenBudget refuses a path it was not given', () => {
  assert.equal(tokenBudget(null).state, 'unknown');
  assert.equal(tokenBudget('/no/such/transcript.jsonl').state, 'absent');
});
