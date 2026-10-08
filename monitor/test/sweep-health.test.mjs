// node --test monitor/test/sweep-health.test.mjs — the pid, not the age, decides a hang.
// fs and the pid probe are both injected: this suite never touches a real reports tree, never
// signals a real process, and never reads a clock (nowMs is passed in everywhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMarkers, classify, sweepHealth, defaultPidAlive, STATES } from '../sweep-health.mjs';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');
const MIN = 60_000;
const HANG = 4 * 60 * MIN;   // liveness.mjs's fleet-wide 4h constant, the one that mislabelled client-a
const KILL = 12 * 60 * MIN;

const started = (minsAgo) => new Date(NOW - minsAgo * MIN).toISOString();
const marker = (o = {}) => ({ sliceId: 'sweep-20260822103139', area: 'client-a', group: 'all', startedAt: started(30), pid: 16823, batch: 'reports/sweep-x-client-a', ...o });

// An injectable fs over a plain {dir: contents} map. A dir whose value is an Error throws it —
// that is how permission failures are exercised without a real chmod.
function fakeFs(tree, { readdirThrows = null } = {}) {
  return {
    readdir(root) {
      if (readdirThrows) throw readdirThrows;
      if (root !== '/reports') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return Object.keys(tree);
    },
    readFile(path) {
      // SEPARATOR-AGNOSTIC, and indexed from the END. The production module builds this path with
      // path.join(), which emits `\` on Windows — so `path.split('/')[2]` returned undefined here,
      // every marker lookup missed, and twelve tests read a fixture that was present as ABSENT.
      // The fake fs was the only POSIX assumption in a suite whose whole point is that it injects
      // both fs and the pid probe and touches neither for real.
      // Counting back from the end also survives a root of a different depth, which the old index
      // silently depended on.
      const parts = path.split(/[\\/]+/);
      const dir = parts[parts.length - 2];
      const v = tree[dir];
      if (v instanceof Error) throw v;
      if (v == null) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return v;
    },
  };
}
const err = (code) => Object.assign(new Error(code), { code });
const alwaysAlive = () => true;
const alwaysDead = () => false;

// ── THE REGRESSION THIS MODULE EXISTS FOR ───────────────────────────────────────────────────────

test('REGRESSION 2026-08-23: a 605-minute sweep with a LIVE pid is overrunning, NOT hung', () => {
  // client-a really ran 605 min with a live pid, a current log mtime and 289MB written, and was
  // labelled HUNG for ~6h by the age-only rule. 34 projects crosses 4h on every normal run.
  const c = classify(marker({ startedAt: started(605) }), { nowMs: NOW, hangMs: HANG, killMs: null, pidAlive: alwaysAlive });
  assert.equal(c.state, 'overrunning');
  assert.notEqual(c.state, 'hung');
  assert.equal(c.pidAlive, true);
  assert.equal(c.ageMs, 605 * MIN);
  assert.ok(c.reasons.some((r) => /ALIVE/.test(r)), `reasons must cite pid liveness as the evidence: ${JSON.stringify(c.reasons)}`);
  assert.ok(c.reasons.some((r) => /LONG, not hung/.test(r)));
});

test('MEASURED 2026-08-20: a 30-minute marker with a DEAD pid is hung — age is not the discriminator', () => {
  // The genuinely hung markers (client-a pid 36023, client-b pid 90944) had dead pids. Young
  // enough to pass any age threshold, and still a real hang.
  const c = classify(marker({ startedAt: started(30), pid: 36023 }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysDead });
  assert.equal(c.state, 'hung');
  assert.equal(c.pidAlive, false);
  assert.ok(c.reasons.some((r) => /DEAD/.test(r)));
  assert.ok(c.reasons.some((r) => /age is not the discriminator/.test(r)));
});

test('a dead pid is hung at ANY age — one minute old and one week old classify identically', () => {
  for (const mins of [1, 30, 605, 7 * 24 * 60]) {
    const c = classify(marker({ startedAt: started(mins) }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysDead });
    assert.equal(c.state, 'hung', `${mins} min with a dead pid must be hung`);
  }
});

test('a live pid under hangMs is running — the ordinary case stays quiet', () => {
  const c = classify(marker({ startedAt: started(30) }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysAlive });
  assert.equal(c.state, 'running');
});

// ── KILL ELIGIBILITY IS A DECLARATION, AND OPTIONAL ─────────────────────────────────────────────

test('killMs null: kill-eligible never occurs even at enormous age, and its count is 0 (not absent)', () => {
  const c = classify(marker({ startedAt: started(30 * 24 * 60) }), { nowMs: NOW, hangMs: HANG, killMs: null, pidAlive: alwaysAlive });
  assert.equal(c.state, 'overrunning');
  const h = sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: null, pidAlive: alwaysAlive,
    ...fakeFs({ 'client-a': JSON.stringify(marker({ startedAt: started(30 * 24 * 60) })) }),
  });
  assert.equal(h.rows[0].state, 'overrunning');
  assert.equal(h.counts['kill-eligible'], 0);
  assert.ok(Object.hasOwn(h.counts, 'kill-eligible'), 'a state that cannot occur must count 0, never be absent — absent reads as "no data"');
  for (const s of STATES) assert.ok(Object.hasOwn(h.counts, s), `counts must pre-seed every state (${s})`);
});

test('killMs set: a live pid past it is kill-eligible; just under it is still only overrunning', () => {
  const past = classify(marker({ startedAt: started(13 * 60) }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysAlive });
  assert.equal(past.state, 'kill-eligible');
  assert.ok(past.reasons.some((r) => /does not kill/.test(r)), 'the label must say it is a declaration, not an action');
  const under = classify(marker({ startedAt: started(11 * 60) }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysAlive });
  assert.equal(under.state, 'overrunning');
});

test('a DEAD pid past killMs is hung, not kill-eligible — there is nothing left to kill', () => {
  const c = classify(marker({ startedAt: started(20 * 60) }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysDead });
  assert.equal(c.state, 'hung');
});

// ── THE PID PROBE ───────────────────────────────────────────────────────────────────────────────

test('EPERM from the pid probe counts as ALIVE — the direction that avoids inventing a hang', () => {
  const eperm = () => { throw err('EPERM'); };

  // THE PROPERTY IS ABOUT THE ERRNO, NOT ABOUT PID 1. This asserted `defaultPidAlive(1) === true`
  // because on POSIX pid 1 is root-owned and an ordinary user gets EPERM probing it. Windows has no
  // such pid; process.kill(1, 0) reports ESRCH, the probe answered false, and the failure read
  // "a pid owned by another user is alive" about a pid that does not exist here — a platform fact
  // wearing the words of a contract violation.
  //
  // So drive the errno itself, which is what the branch actually turns on, and keep the real-syscall
  // form where it is meaningful. Two witnesses on POSIX, one everywhere, and the one that runs
  // everywhere is the one that names the property.
  const realKill = process.kill.bind(process);
  try {
    process.kill = () => { throw err('EPERM'); };
    assert.equal(defaultPidAlive(4242), true,
      'EPERM must read as ALIVE — the direction that refuses to invent a hang out of a permission');
  } finally { process.kill = realKill; }

  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    // the same branch through the real syscall: pid 1 is root-owned, so this process gets EPERM
    assert.equal(defaultPidAlive(1), true, 'a pid owned by another user is alive');
  }
  assert.equal(defaultPidAlive(process.pid), true, 'a genuinely running pid is alive on any platform');
  assert.equal(defaultPidAlive(2_147_483_646), false, 'ESRCH — nothing is running');
  // and through classify, with an injected probe, at an age that would otherwise scream
  const c = classify(marker({ startedAt: started(605) }), {
    nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: (pid) => defaultPidAlive(pid) || eperm(),
  });
  assert.notEqual(c.state, 'hung');
  assert.equal(c.pidAlive, true);
});

test('an unclassifiable probe error is unknown, never hung — explicit uncertainty', () => {
  const c = classify(marker(), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: () => { throw err('EINVAL'); } });
  assert.equal(c.state, 'unknown');
  assert.equal(c.pidAlive, null);
  assert.ok(c.reasons.some((r) => /UNKNOWN, not dead/.test(r)));
});

test('a marker with a non-numeric or missing pid is unknown, not hung', () => {
  for (const pid of [undefined, null, 'abc', NaN, 1.5, '16823']) {
    const c = classify(marker({ pid }), { nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysDead });
    assert.equal(c.state, 'unknown', `pid ${JSON.stringify(pid)} must be unknown`);
    assert.equal(c.pidAlive, null);
  }
});

test('pid 0 is refused — process.kill(0, 0) signals the whole process GROUP', () => {
  const c = classify(marker({ pid: 0 }), { nowMs: NOW, hangMs: HANG, pidAlive: () => { throw new Error('the probe must never be reached with pid 0'); } });
  assert.equal(c.state, 'unknown');
});

test('a live pid with an unparseable startedAt is unknown — running cannot be told from overrunning', () => {
  const c = classify(marker({ startedAt: 'not-a-date' }), { nowMs: NOW, hangMs: HANG, pidAlive: alwaysAlive });
  assert.equal(c.state, 'unknown');
  assert.equal(c.ageMs, null);
  assert.ok(c.reasons.some((r) => /age not computable/.test(r)));
});

test('a DEAD pid with an unparseable startedAt is still hung — the deciding evidence is present', () => {
  const c = classify(marker({ startedAt: 'not-a-date' }), { nowMs: NOW, hangMs: HANG, pidAlive: alwaysDead });
  assert.equal(c.state, 'hung');
  assert.equal(c.ageMs, null);
});

// ── FAIL CLOSED ON READING ──────────────────────────────────────────────────────────────────────

test('a corrupt marker lands in unreadable, does not throw, and appears in NO row or state count', () => {
  const h = sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysAlive,
    ...fakeFs({ 'client-a': JSON.stringify(marker()), broken: '{ this is not json', 'also-broken': '[1,2,3]' }),
  });
  assert.equal(h.ok, false, 'an unreadable marker means the picture is incomplete — never ok');
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].area, 'client-a');
  assert.equal(h.unreadable.length, 2);
  assert.deepEqual(h.unreadable.map((u) => u.area).sort(), ['also-broken', 'broken']);
  assert.equal(h.counts.unreadable, 2);
  const stateTotal = STATES.reduce((n, s) => n + h.counts[s], 0);
  assert.equal(stateTotal, 1, 'an unreadable marker must not be counted into any state');
});

test('a marker that exists but cannot be read (EACCES) is unreadable, never absent', () => {
  const r = readMarkers({ reportsRoot: '/reports', ...fakeFs({ 'client-a': err('EACCES') }) });
  assert.equal(r.ok, false);
  assert.equal(r.markers.length, 0);
  assert.equal(r.unreadable.length, 1);
  assert.match(r.unreadable[0].reason, /EACCES/);
});

test('a missing reports dir is ok:true with zero rows — absence is legitimate', () => {
  const h = sweepHealth({ reportsRoot: '/nope', nowMs: NOW, hangMs: HANG, pidAlive: alwaysAlive, ...fakeFs({}) });
  assert.equal(h.ok, true);
  assert.equal(h.rows.length, 0);
  assert.equal(h.unreadable.length, 0);
  assert.equal(h.rootMissing, true);
  assert.equal(h.rootUnreadable, false);
});

test('a reports dir that could not be READ is DISTINGUISHABLE from a missing one', () => {
  const h = sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, pidAlive: alwaysAlive,
    ...fakeFs({}, { readdirThrows: err('EACCES') }),
  });
  assert.equal(h.ok, false, 'blindness is not absence');
  assert.equal(h.rootMissing, false);
  assert.equal(h.rootUnreadable, true);
  assert.equal(h.rows.length, 0);
  assert.equal(h.unreadable.length, 1);
  assert.match(h.unreadable[0].reason, /EACCES/);
  // the two cases must not render the same
  const missing = sweepHealth({ reportsRoot: '/nope', nowMs: NOW, pidAlive: alwaysAlive, ...fakeFs({}) });
  assert.notDeepEqual(
    { ok: h.ok, rootMissing: h.rootMissing, rootUnreadable: h.rootUnreadable },
    { ok: missing.ok, rootMissing: missing.rootMissing, rootUnreadable: missing.rootUnreadable },
  );
});

test('an area dir with no marker is simply absent — no row, no unreadable entry', () => {
  const r = readMarkers({ reportsRoot: '/reports', ...fakeFs({ 'client-a': JSON.stringify(marker()), quiet: null }) });
  assert.equal(r.ok, true);
  assert.equal(r.markers.length, 1);
  assert.equal(r.unreadable.length, 0);
});

test('ENOTDIR (a plain file beside the area dirs) is absence, not a failure', () => {
  const r = readMarkers({ reportsRoot: '/reports', ...fakeFs({ 'index.html': err('ENOTDIR') }) });
  assert.equal(r.ok, true);
  assert.equal(r.unreadable.length, 0);
});

// ── PER-AREA THRESHOLDS AND PROVENANCE ──────────────────────────────────────────────────────────

test('resolveFor overrides beat the globals, and the row records WHICH source it used', () => {
  // client-a crosses the 4h global on every normal run; a 12h per-area hangMs puts it back to running.
  const tree = {
    'client-a-monorepo': JSON.stringify(marker({ area: 'client-a', startedAt: started(605), pid: 63759 })),
    tiny: JSON.stringify(marker({ area: 'tiny', startedAt: started(605), pid: 100 })),
  };
  const h = sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: null, pidAlive: alwaysAlive,
    resolveFor: (area) => (area === 'client-a' ? { hangMs: 12 * 60 * MIN, killMs: 24 * 60 * MIN } : null),
    ...tree && fakeFs(tree),
  });
  const sq = h.rows.find((r) => r.area === 'client-a');
  const tiny = h.rows.find((r) => r.area === 'tiny');
  assert.equal(sq.state, 'running', 'the per-area 12h threshold must beat the 4h global');
  assert.equal(sq.hangMs, 12 * 60 * MIN);
  assert.equal(sq.killMs, 24 * 60 * MIN);
  assert.deepEqual(sq.thresholdSource, { hangMs: 'area', killMs: 'area' });
  assert.equal(tiny.state, 'overrunning', 'an area with no override still uses the global');
  assert.equal(tiny.hangMs, HANG);
  assert.deepEqual(tiny.thresholdSource, { hangMs: 'global', killMs: 'none' });
  assert.equal(h.counts.running, 1);
  assert.equal(h.counts.overrunning, 1);
  assert.equal(h.counts.hung, 0);
  // the row's area is the marker's registry SLUG, and the OUT dir travels beside it
  assert.equal(sq.areaOut, 'client-a-monorepo');
});

test('a throwing resolveFor falls back to the globals and says so — one bad override is not an outage', () => {
  const h = sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysAlive,
    resolveFor: () => { throw err('EBADF'); },
    ...fakeFs({ 'client-a': JSON.stringify(marker({ startedAt: started(605) })) }),
  });
  assert.equal(h.rows[0].state, 'overrunning');
  assert.equal(h.rows[0].hangMs, HANG);
  assert.deepEqual(h.rows[0].thresholdSource, { hangMs: 'global', killMs: 'global' });
  assert.ok(h.rows[0].reasons.some((r) => /threshold lookup failed/.test(r)));
});

test('rows carry the full evidence a UI needs, and reasons are non-empty human strings', () => {
  const h = sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: alwaysAlive,
    ...fakeFs({ 'client-a': JSON.stringify(marker({ startedAt: started(605) })) }),
  });
  const r = h.rows[0];
  for (const k of ['area', 'sliceId', 'startedAt', 'ageMs', 'pid', 'pidAlive', 'state', 'reasons', 'hangMs', 'killMs', 'thresholdSource']) {
    assert.ok(Object.hasOwn(r, k), `row must carry ${k}`);
  }
  assert.equal(r.sliceId, 'sweep-20260822103139');
  assert.equal(r.pid, 16823);
  assert.ok(r.reasons.length >= 2 && r.reasons.every((s) => typeof s === 'string' && s.length > 0));
});

// ── DETERMINISM, AND THE NO-SIDE-EFFECTS BOUNDARY ───────────────────────────────────────────────

test('same inputs produce a byte-identical result, and no clock is read inside the logic', () => {
  const tree = { a: JSON.stringify(marker({ area: 'a', startedAt: started(605) })), b: JSON.stringify(marker({ area: 'b', pid: 4 })), c: '{bad' };
  const run = () => sweepHealth({ reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: KILL, pidAlive: (p) => p !== 4, ...fakeFs(tree) });
  assert.equal(JSON.stringify(run()), JSON.stringify(run()));
  // nowMs is the only clock: a different nowMs must be the only thing that moves the verdict
  const later = sweepHealth({ reportsRoot: '/reports', nowMs: NOW + 10 * MIN, hangMs: HANG, killMs: KILL, pidAlive: () => true, ...fakeFs({ a: JSON.stringify(marker({ startedAt: started(605) })) }) });
  assert.equal(later.rows[0].ageMs, 615 * MIN);
});

test('rows are ordered deterministically by area dir regardless of readdir order', () => {
  const contents = { zulu: JSON.stringify(marker({ area: 'zulu' })), alpha: JSON.stringify(marker({ area: 'alpha' })), mike: JSON.stringify(marker({ area: 'mike' })) };
  const h = sweepHealth({ reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, pidAlive: alwaysAlive, ...fakeFs(contents) });
  assert.deepEqual(h.rows.map((r) => r.areaOut), ['alpha', 'mike', 'zulu']);
});

test('the module never writes and never kills — the injected fs is read-only and no signal is sent', () => {
  // Passing a write-capable surface it must not use: any attempt to signal for real would need
  // process.kill, and the injected probe below records every call instead.
  const probed = [];
  sweepHealth({
    reportsRoot: '/reports', nowMs: NOW, hangMs: HANG, killMs: 1, pidAlive: (p) => { probed.push(p); return true; },
    ...fakeFs({ 'client-a': JSON.stringify(marker({ startedAt: started(605) })) }),
  });
  assert.deepEqual(probed, [16823], 'the pid is probed exactly once, with signal 0 semantics');
});

test('readdir returning Dirent-like objects works as well as strings', () => {
  const base = fakeFs({ 'client-a': JSON.stringify(marker()) });
  const r = readMarkers({ reportsRoot: '/reports', readFile: base.readFile, readdir: () => [{ name: 'client-a', isDirectory: () => true }] });
  assert.equal(r.ok, true);
  assert.equal(r.markers.length, 1);
});

test('no reportsRoot at all is a failure, not an empty clean result', () => {
  const r = readMarkers({});
  assert.equal(r.ok, false);
  assert.equal(r.unreadable.length, 1);
});
