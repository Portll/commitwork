// monitor/isolation-freshness.mjs — the record that makes a SKIPPED isolation suite legible, and
// the liveness row that carries it.
//
// THE DEFECT UNDER TEST, as measured on this tree. `node --test bin/test/sandbox-effects.test.mjs`
// with docker present reports `# pass 5 / # fail 0 / # skipped 0`; with docker off PATH it reports
// `# tests 0 / # pass 0 / # fail 0 / # skipped 0` and exits 0. A skipped top-level `describe`
// registers no subtest, so even the skip counter stays zero — the not-run isolation check is
// invisible on every numeric channel, and only a `# SKIP <reason>` comment says so.
//
// TWO WITNESSES, because a TAP parser that agrees with itself proves nothing. The stored fixtures
// below are the real suite's own output in both host states. The `--measure` tests then run the
// REAL node test runner over synthetic suites whose outcome is known by construction, which cannot
// share a parsing mistake with the fixtures. Both directions are asserted separately every time:
// that a run which establishes isolation reads as `verified`, AND that a run which establishes
// nothing never does. Only the second one lies to you.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTap, classifyRun, recordFor, readRecord, isolationRow, measure, exitFor,
  recordPath, MAX_AGE_DAYS, DAY_MS, RANK, STATES,
} from '../isolation-freshness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';
import { denyRead, isRefusal, ignoresPermissions } from '../../lib/fs-unreadable.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const LIVENESS = join(CW, 'monitor', 'liveness.mjs');

const scratch = (t, tag) => {
  const dir = mkdtempSync(join(tmpdir(), `cw-iso-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// ── the real suite's own output, both host states, verbatim ─────────────────────────────────────
// Captured from `node --test --test-reporter=tap bin/test/sandbox-effects.test.mjs` on 2026-10-20,
// once with the docker daemon up and once with docker off PATH.
const TAP_VERIFIED = `TAP version 13
# Subtest: sandbox isolation, measured
    ok 1 - instrument scratch EXECUTES — without this the sanitizer tier is impossible
    ok 2 - analyse scratch REFUSES to execute — the control that proves noexec is real
    1..5
ok 1 - sandbox isolation, measured
1..1
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 7595.733958
`;

const TAP_SKIPPED = `TAP version 13
# Subtest: sandbox isolation, measured
ok 1 - sandbox isolation, measured # SKIP docker or alpine:latest unavailable — isolation NOT verified on this host
  ---
  duration_ms: 0.268334
  type: 'suite'
  ...
1..1
# tests 0
# suites 1
# pass 0
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 70.138875
`;

test('the skipped suite is numerically indistinguishable from a clean one — which is the defect', () => {
  const clean = parseTap(TAP_VERIFIED).counts;
  const skipped = parseTap(TAP_SKIPPED).counts;
  assert.equal(clean.fail, 0);
  assert.equal(skipped.fail, 0, 'a failure counter cannot see a skipped suite');
  assert.equal(skipped.skipped, 0,
    'nor can the SKIP counter: a skipped top-level describe registers no subtest, so the gate has no number at all');
  assert.deepEqual(parseTap(TAP_SKIPPED).skipped, [{
    name: 'sandbox isolation, measured',
    reason: 'docker or alpine:latest unavailable — isolation NOT verified on this host',
  }], 'the directive comment is the ONLY channel carrying the fact, so it must be read');
});

test('the real suite verified reads as verified; the real suite skipped NEVER does', () => {
  const ok = classifyRun({ exit: 0, tap: TAP_VERIFIED });
  assert.equal(ok.state, 'verified');
  assert.equal(RANK[ok.state], 0, 'a measured, held isolation is quiet');

  const skipped = classifyRun({ exit: 0, tap: TAP_SKIPPED });
  assert.equal(skipped.state, 'unverified');
  assert.notEqual(skipped.state, 'verified', 'the direction that lies: not-run must never read as proven');
  assert.notEqual(skipped.state, 'failed', 'and it must not read as a finding either — nothing was measured');
  assert.match(skipped.why, /docker or alpine:latest unavailable/, 'the original claim survives into the record');
  assert.equal(RANK[skipped.state], 1, 'unverified warns');
});

test('unreadable runner output is unparseable, never zero failures', () => {
  for (const tap of ['', 'TAP version 13\nok 1 - something\n', '# pass 3\n', 'segfault\n']) {
    const r = classifyRun({ exit: 0, tap });
    assert.equal(r.state, 'unknown', `${JSON.stringify(tap)} must not classify`);
    assert.equal(r.unknownReason, 'unparseable');
    assert.equal(r.counts, null, 'counts a parser could not establish must be absent, not zeroed');
  }
});

test('a failing suite is a measurement, not a broken runner — fail is read before the exit code', () => {
  const r = classifyRun({ exit: 1, tap: TAP_VERIFIED.replace('# fail 0', '# fail 2').replace('# pass 5', '# pass 3') });
  assert.equal(r.state, 'failed');
  assert.equal(RANK[r.state], 3, 'isolation measured and broken is the one state that fails the run');
  assert.match(r.why, /2 of 5/);
});

test('a runner that died says so: tool-failed, not verified and not a finding', () => {
  const killed = classifyRun({ exit: null, signal: 'SIGKILL', tap: TAP_VERIFIED.replace('# pass 5', '# pass 0') });
  assert.equal(killed.state, 'unknown');
  assert.equal(killed.unknownReason, 'tool-failed');
  const odd = classifyRun({ exit: 7, tap: TAP_VERIFIED });
  assert.equal(odd.state, 'unknown', 'passes with a non-zero exit and no failure is a runner we do not understand');
  assert.equal(odd.unknownReason, 'tool-failed');
});

test('a suite that registered nothing and said WHY NOT is unverified; one that said nothing is unknown', () => {
  const silent = classifyRun({ exit: 0, tap: TAP_SKIPPED.replace(/ # SKIP.*/, '') });
  assert.equal(silent.state, 'unknown');
  assert.equal(silent.unknownReason, 'not-run');
  assert.equal(classifyRun({ exit: 0, tap: TAP_SKIPPED }).state, 'unverified');
});

// ── the second witness: the real runner over suites whose outcome is known by construction ──────
// Nothing here shares a failure mode with the fixtures above — if the parser misreads node's TAP,
// these disagree with what the suite was built to do.

const SUITES = {
  verified: `import { test, describe } from 'node:test';
describe('s', () => { test('a', () => {}); test('b', () => {}); });
`,
  'whole-suite skipped': `import { test, describe } from 'node:test';
describe('s', { skip: 'the jail could not be built on this host' }, () => { test('a', () => {}); });
`,
  partial: `import { test, describe } from 'node:test';
describe('s', () => { test('a', () => {}); test('b', { skip: 'this host has no egress' }, () => {}); });
`,
  failed: `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
describe('s', () => { test('a', () => {}); test('b', () => assert.equal(1, 2)); });
`,
};

const EXPECTED = { verified: 'verified', 'whole-suite skipped': 'unverified', partial: 'partial', failed: 'failed' };

for (const [name, src] of Object.entries(SUITES)) {
  test(`the real test runner over a ${name} suite records ${EXPECTED[name]}`, (t) => {
    const dir = scratch(t, 'suite');
    const suite = join(dir, 'probe.test.mjs');
    writeFileSync(suite, src);
    const path = join(dir, 'record.json');
    const rec = measure({ suite, path, timeoutMs: 120_000, at: '2026-10-20T00:00:00.000Z' });

    assert.equal(rec.state, EXPECTED[name], `why: ${rec.why} · counts: ${JSON.stringify(rec.counts)}`);
    assert.ok(rec.written.ok, `the record must reach disk: ${rec.written.why}`);
    if (name !== 'verified') {
      assert.notEqual(rec.state, 'verified', 'a run that did not establish isolation must never read as proof of it');
    }
    if (name === 'whole-suite skipped' || name === 'partial') {
      assert.equal(rec.counts.fail, 0, 'the premise: the runner reports no failure');
      assert.match(rec.why, name === 'partial' ? /no egress/ : /could not be built/, 'the stated reason is kept');
    }
    // The row a reader sees, derived from the record on disk rather than the in-memory result.
    const row = isolationRow({ path, nowMs: Date.parse('2026-10-20T00:00:00.000Z') });
    assert.equal(row.state, EXPECTED[name]);
    assert.equal(row.rank, RANK[EXPECTED[name]]);
  });
}

test('a suite file that is not there is unknown — never a pass, never a finding', (t) => {
  const dir = scratch(t, 'nosuite');
  const path = join(dir, 'record.json');
  const rec = measure({ suite: join(dir, 'absent.test.mjs'), path, timeoutMs: 60_000, at: '2026-10-20T00:00:00.000Z' });
  assert.equal(rec.state, 'unknown', `why: ${rec.why}`);
  assert.equal(exitFor(isolationRow({ path })), 2, 'grey exits grey');
});

test('two measurements of the same suite at the same pinned instant are byte-identical, and leave no temp behind', (t) => {
  const dir = scratch(t, 'det');
  const suite = join(dir, 'probe.test.mjs');
  writeFileSync(suite, SUITES.verified);
  const path = join(dir, 'record.json');
  const opts = { suite, path, timeoutMs: 120_000, at: '2026-10-20T00:00:00.000Z' };
  measure(opts);
  const first = readFileSync(path, 'utf8');
  measure(opts);
  assert.equal(readFileSync(path, 'utf8'), first, 'same inputs, same bytes — a duration in the record would break this');
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.tmp-')), [], 'the write is atomic: no temp file survives it');
});

// ── the store: absent, unreadable and corrupt are three different facts ─────────────────────────

test('never measured is unknown/not-run — the row says so and says how to clear it', (t) => {
  const dir = scratch(t, 'absent');
  const row = isolationRow({ path: join(dir, 'nothing.json') });
  assert.equal(row.state, 'unknown');
  assert.equal(row.rank, 1, 'a host nobody measured is not evidence the sandbox leaks');
  assert.match(row.line, /never been measured on this host/);
  assert.match(row.line, /--measure/, 'an alarm must name the act that satisfies it');
});

test('an unreadable record is UNKNOWN, never absent and never clean', (t) => {
  if (ignoresPermissions()) { t.skip('running as root — a deny ACE cannot be enforced against it'); return; }
  const dir = scratch(t, 'denied');
  const path = join(dir, 'record.json');
  writeFileSync(path, JSON.stringify(recordFor({ state: 'verified', why: 'x', counts: {}, skipped: [] }, { at: '2026-10-20T00:00:00.000Z' })));
  const d = denyRead(path);
  if (!d.ok) { t.skip(`could not make the record unreadable: ${d.why}`); return; }
  try {
    const r = readRecord(path);
    assert.equal(r.state, 'unknown');
    assert.equal(r.unknownReason, 'not-permitted', 'only ENOENT may say "absent"');
    assert.ok(isRefusal(r.unknownDetail.match(/\(([A-Z]+)\)/)?.[1]), `the errno is reported: ${r.unknownDetail}`);
    assert.match(r.unknownDetail, /unreadable, not absent/);
  } finally { d.restore(); }
});

test('a corrupt or state-less record is unparseable, not unmeasured', (t) => {
  const dir = scratch(t, 'corrupt');
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{"at": "2026-10-20T00:00:00.000Z"');
  assert.equal(readRecord(bad).unknownReason, 'unparseable');
  const stateless = join(dir, 'stateless.json');
  writeFileSync(stateless, JSON.stringify({ at: '2026-10-20T00:00:00.000Z' }));
  assert.equal(readRecord(stateless).unknownReason, 'unparseable');
  assert.equal(readRecord(stateless).state, 'unknown');
});

test('a state this version does not know becomes unknown, with the claim it made kept', (t) => {
  const dir = scratch(t, 'vocab');
  const p = join(dir, 'r.json');
  writeFileSync(p, JSON.stringify({ v: 2, at: '2026-10-20T00:00:00.000Z', state: 'confined-ok', why: 'a later version said so' }));
  const r = readRecord(p);
  assert.equal(r.state, 'unknown', 'an unrecognised state must not be read as a pass');
  assert.equal(r.recordedState, 'confined-ok', 'nor erased — the original claim is what a reader needs to act on');
  assert.equal(isolationRow({ path: p, nowMs: Date.parse('2026-10-20T00:00:00.000Z') }).rank, 1, 'it warns, it does not fail the run');
  assert.ok(!STATES.includes('stale'), 'stale is derived from a verified record and the clock, never stored — so the same bytes can always be re-aged');
  assert.ok(Object.keys(RANK).every((k) => k === 'stale' || STATES.includes(k)), 'every ranked state is a record state or the derived one');
});

test('CW_ISOLATION_RECORD is read at CALL time, so a test can never touch the live record', (t) => {
  const before = recordPath();
  const prior = process.env.CW_ISOLATION_RECORD;
  const dir = scratch(t, 'env');
  process.env.CW_ISOLATION_RECORD = join(dir, 'r.json');
  // Restored, not deleted: bin/test-run.mjs sets this for the whole suite, and deleting it would
  // hand the rest of this process the LIVE path.
  t.after(() => { if (prior === undefined) delete process.env.CW_ISOLATION_RECORD; else process.env.CW_ISOLATION_RECORD = prior; });
  assert.equal(recordPath(), join(dir, 'r.json'), 'a module-load read would still answer the live path here');
  assert.notEqual(recordPath(), before);
});

test('the suite can never publish an isolation verdict for the host — the record is a scoped output', async () => {
  const { AMBIENT_OUTPUTS, scopedOutputEnv } = await import('../../bin/test-run.mjs');
  const entry = AMBIENT_OUTPUTS.find((o) => o.env === 'CW_ISOLATION_RECORD');
  assert.ok(entry, 'an unlisted write target is one the reproducibility self-check cannot see');
  assert.equal(entry.live, join(CW, 'reports', 'isolation-measured.json'), 'the entry must name the path recordPath() defaults to');
  // The effect, not the entry: the env the runner hands the suite moves the write off the live path.
  const scoped = scopedOutputEnv('/scratch', {});
  assert.ok(String(scoped.CW_ISOLATION_RECORD).includes('scratch'));
});

// ── ageing: a verified measurement does not stand forever, and no other state improves with age ──

test('a verified record goes STALE past the window; nothing else is improved by the clock', (t) => {
  const dir = scratch(t, 'age');
  const write = (state, ageDays, extra = {}) => {
    const p = join(dir, `${state}-${ageDays}.json`);
    writeFileSync(p, JSON.stringify({
      v: 1, at: new Date(Date.parse('2026-10-20T00:00:00.000Z') - ageDays * DAY_MS).toISOString(),
      state, why: 'measured', ...extra,
    }));
    return p;
  };
  const now = Date.parse('2026-10-20T00:00:00.000Z');

  const fresh = isolationRow({ path: write('verified', 1), nowMs: now });
  assert.equal(fresh.state, 'verified');
  assert.equal(fresh.rank, 0);
  assert.equal(fresh.days, 1);

  const old = isolationRow({ path: write('verified', MAX_AGE_DAYS + 3), nowMs: now });
  assert.equal(old.state, 'stale', 'a measurement this host made ten days ago is not a statement about today');
  assert.equal(old.rank, 1);
  assert.match(old.line, /unverified since then/);

  for (const state of ['unverified', 'partial', 'failed']) {
    const r = isolationRow({ path: write(state, 0), nowMs: now });
    assert.equal(r.state, state, `${state} must not be rewritten by the clock`);
    assert.notEqual(r.state, 'verified');
  }
});

test('a record dated in the future is UNKNOWN — a wrong clock is not a fresh pass', (t) => {
  const dir = scratch(t, 'future');
  const p = join(dir, 'r.json');
  writeFileSync(p, JSON.stringify({ v: 1, at: '2027-01-01T00:00:00.000Z', state: 'verified', why: 'measured' }));
  const row = isolationRow({ path: p, nowMs: Date.parse('2026-10-20T00:00:00.000Z') });
  assert.equal(row.state, 'unknown');
  assert.equal(row.days, null);
  assert.match(row.line, /the clock or the record is wrong/);
});

test('a record with no usable timestamp cannot be aged, so its freshness is unknown', (t) => {
  const dir = scratch(t, 'nostamp');
  const p = join(dir, 'r.json');
  writeFileSync(p, JSON.stringify({ v: 1, at: 'last tuesday', state: 'verified', why: 'measured' }));
  assert.equal(isolationRow({ path: p, nowMs: Date.now() }).state, 'unknown');
});

// ── THE EFFECT: the fact is now in the deadman's output, and the deadman's exit answers to it ───
// Asserting the module classifies correctly is a marker. The thing the item is about is whether a
// gate can see it, so this spawns the real deadman over a synthetic area and reads what it says.

function runLiveness(t, record) {
  const dir = scratch(t, 'liveness');
  const area = join(dir, 'area');
  mkdirSync(join(area, 'history'), { recursive: true });
  const generated = new Date(Date.now() - 3600_000).toISOString();
  const sliceId = `sweep-${generated.replace(/[-:T]/g, '').slice(0, 14)}`;
  const rollup = join(area, 'rollup.json');
  writeFileSync(rollup, JSON.stringify({ sliceId, generated, freshness: { generated } }));
  appendRecord(join(area, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: generated, sliceId, area: 'probe' });

  const recPath = join(dir, 'record.json');
  if (record) writeFileSync(recPath, JSON.stringify({ v: 1, at: new Date().toISOString(), why: 'measured', ...record }));
  const verdicts = join(dir, 'verdicts');
  const r = spawnSync(process.execPath, [LIVENESS, rollup], {
    encoding: 'utf8',
    env: { ...process.env, CW_VERDICT_DIR: verdicts, CW_ISOLATION_RECORD: recPath },
    timeout: 120_000,
  });
  return { ...r, verdicts };
}

test('liveness carries the isolation row — and an unmeasured host warns without failing the run', (t) => {
  const r = runLiveness(t, null);
  assert.match(r.stderr, /^isolation: UNKNOWN .*never been measured on this host/m,
    `the row must reach the operator's own board; stderr was: ${r.stderr.slice(0, 600)}`);
  assert.equal(r.status, 0, 'a host nobody has measured must not fail the nightly gate — that alarm gets switched off');
});

test('liveness stays quiet on a verified host, and FAILS on one where isolation was measured and did not hold', (t) => {
  // The control. Without it the exit code below is attributable to anything on this machine.
  const ok = runLiveness(t, { state: 'verified' });
  assert.match(ok.stdout, /^isolation: verified /m, `stdout was: ${ok.stdout.slice(0, 600)}`);
  assert.doesNotMatch(ok.stderr, /^isolation:/m, 'a verified host must raise nothing — a row that always alarms is a background colour');
  assert.equal(ok.status, 0);

  const bad = runLiveness(t, { state: 'failed', why: '2 of 5 isolation assertion(s) did not hold' });
  assert.match(bad.stderr, /^isolation: FAILED /m, `stderr was: ${bad.stderr.slice(0, 600)}`);
  assert.equal(bad.status, 1, 'isolation measured and broken is what the deadman exists to catch');
});

test('the deadman JOURNALS the isolation state, so the fact outlives the run that printed it', (t) => {
  const r = runLiveness(t, { state: 'verified' });
  const rows = readFileSync(join(r.verdicts, 'liveness.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 1, `expected one verdict record; stderr was: ${r.stderr.slice(0, 400)}`);
  assert.equal(rows[0].isolation.state, 'verified');
  assert.equal(rows[0].isolation.days, 0);
  assert.ok(typeof rows[0].isolation.at === 'string', 'and WHEN it was measured, or staleness cannot be re-derived');
});
