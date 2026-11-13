// monitor/isolation-freshness.mjs — when container isolation was last MEASURED on this host, and
// what the measurement said. The sibling of monitor/freshness.mjs: that one ages a scan, this one
// ages the only check that proves the sandbox postures isolate what their flags claim.
//
// THE DEFECT THIS CLOSES, MEASURED. bin/test/sandbox-effects.test.mjs skips — correctly, loudly —
// when docker is absent. On this tree, with docker present:
//
//     # tests 5 · # suites 1 · # pass 5 · # fail 0 · # skipped 0        exit 0
//
// and with docker off PATH:
//
//     # tests 0 · # suites 1 · # pass 0 · # fail 0 · # skipped 0        exit 0
//
// A skipped top-level `describe` registers no subtest, so `skipped` is zero TOO. The not-run
// isolation check is invisible on every numeric channel a pass/fail gate reads — not just the
// failure counter — and its only trace is a `# SKIP <reason>` comment on the suite's own `ok` line.
// "Isolation has not been verified on this host for N days" was legible solely to someone reading
// raw TAP, which is not-run rendering as fine.
//
// So the measurement gets a record, and monitor/liveness.mjs carries a row for it beside the sweep
// freshness it already reports. `--measure` is a DELIBERATE act and never a side effect of
// `npm test`: bin/test-run.mjs redirects every ambient write into a scratch dir for
// reproducibility, so a suite that recorded its own verdict would record it into /tmp and the
// store would stay empty while looking wired.
//
// UNVERIFIED IS NEITHER A PASS NOR A FINDING. `verified` requires that the suite RAN and that every
// assertion in it passed. Every other outcome keeps its own name and the original claim with it:
// `failed` (measured, and isolation did not hold), `partial` (some assertions ran, some skipped),
// `unverified` (nothing ran, and the suite said why), `stale` (verified, too long ago), `unknown`
// (never measured, unreadable, or output this module could not parse). Only `failed` is a finding.
//
// env, read at call time: CW_ISOLATION_RECORD (the record this writes and liveness reads), CW_NOW
//
// Without --measure it reports the record; with it, it runs the suite and records what it said.
//
//   node monitor/isolation-freshness.mjs [--measure] [--json]
//   exit 0 verified · 1 the last measurement FAILED · 2 grey (never measured, stale, partial,
//   unverified, or unreadable)

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../lib/clock.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { exitFlushed } from '../lib/exit-flushed.mjs';
import { writeAtomic } from './lockfile.mjs';
import { reportsRootFor } from './store-paths.mjs';
import { unknown, isUnknown } from './unknown.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The suite under measurement. Repo-relative, so the record reads the same on every host. */
export const SUITE = 'bin/test/sandbox-effects.test.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a verified measurement stands for. A host's docker and kernel both move under it. */
export const MAX_AGE_DAYS = 7;

/**
 * The closed set a RECORD may carry. `stale` is absent on purpose: it is derived from a verified
 * record and the clock, never stored, so a reader can always re-age the same bytes.
 */
export const STATES = Object.freeze(['verified', 'partial', 'unverified', 'failed', 'unknown']);

/**
 * The record. HOST state, not fleet-area output — it says what this machine's sandbox does — so it
 * resolves through store-paths' reports root rather than the registry's declared one, which a
 * public checkout has no registry to answer. One resolver, used by the writer and the readers
 * alike; CW_ISOLATION_RECORD overrides, read at CALL time.
 */
export const recordPath = () => (process.env.CW_ISOLATION_RECORD
  ? resolve(process.env.CW_ISOLATION_RECORD)
  : join(reportsRootFor(ROOT), 'isolation-measured.json'));

// ── reading the runner ──────────────────────────────────────────────────────────────────────────
// The summary keys node's TAP reporter emits at column zero. `duration_ms` is deliberately absent:
// the record must be byte-identical over identical inputs, and a duration never is.
const SUMMARY_KEYS = Object.freeze(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']);

// The four a classification cannot be made without. `suites`/`cancelled`/`todo` are reported when
// present and never required — a reporter that drops one must not take the whole run to unknown.
const REQUIRED_KEYS = Object.freeze(['tests', 'pass', 'fail', 'skipped']);

/**
 * Counts and SKIP directives out of TAP.
 *
 * `counts` is null when any required key is missing, which is the whole fail-closed hinge: output
 * this cannot read is unparseable, never zero failures. The last occurrence of each key wins,
 * because a test that prints a summary-shaped line of its own would otherwise outrank the summary.
 */
export function parseTap(tap) {
  const counts = {};
  const skipped = [];
  for (const line of String(tap ?? '').split('\n')) {
    const m = /^# ([a-z_]+) (\d+)$/.exec(line);
    if (m && SUMMARY_KEYS.includes(m[1])) { counts[m[1]] = Number(m[2]); continue; }
    // The suite-level skip this module exists for lands here, not in the `skipped` counter.
    const s = /^\s*(?:not )?ok \d+ - (.*?) # SKIP(?: (.*))?$/.exec(line);
    if (s) skipped.push({ name: s[1].trim(), reason: (s[2] || '').trim() || null });
  }
  if (!REQUIRED_KEYS.every((k) => Number.isInteger(counts[k]))) return { counts: null, skipped };
  const full = {};
  for (const k of SUMMARY_KEYS) if (Number.isInteger(counts[k])) full[k] = counts[k];
  return { counts: full, skipped };
}

const reasonsOf = (skipped) => {
  const seen = [];
  for (const s of skipped) {
    const r = s.reason || `${s.name} (no reason given)`;
    if (!seen.includes(r)) seen.push(r);
  }
  return seen;
};

/**
 * What one run of the suite established. Pure over the runner's own output, so the two directions
 * can be asserted separately: a run that proves isolation, and a run that proves nothing.
 *
 * Order matters. `fail` is read BEFORE the exit code, because a suite with a real failure exits
 * non-zero and that is a measurement, not a broken runner.
 */
export function classifyRun({ exit = null, signal = null, tap = '', error = null } = {}) {
  const { counts, skipped } = parseTap(tap);
  const reasons = reasonsOf(skipped);
  const base = { counts, skipped, exit, signal };
  if (!counts) {
    return {
      ...base,
      ...unknown('unparseable', error
        ? `the runner produced no readable summary: ${error}`
        : 'the runner produced no readable TAP summary, so nothing about isolation was established'),
      state: 'unknown',
    };
  }
  if (counts.fail > 0) {
    return { ...base, state: 'failed', why: `${counts.fail} of ${counts.tests} isolation assertion(s) did not hold` };
  }
  if (signal) return { ...base, ...unknown('tool-failed', `the runner was killed by ${signal}`), state: 'unknown' };
  if (exit !== 0) return { ...base, ...unknown('tool-failed', `the runner exited ${exit} with no failing test`), state: 'unknown' };
  if (counts.pass === 0) {
    if (!reasons.length) {
      return { ...base, ...unknown('not-run', 'the suite registered no test and gave no reason — nothing ran and nothing said why'), state: 'unknown' };
    }
    return { ...base, state: 'unverified', why: `the suite ran nothing: ${reasons.join(' · ')}` };
  }
  if (counts.skipped > 0 || reasons.length) {
    return {
      ...base,
      state: 'partial',
      why: `${counts.pass} of ${counts.tests} assertion(s) passed; the rest were not measured: ${reasons.join(' · ') || 'no reason given'}`,
    };
  }
  return { ...base, state: 'verified', why: `${counts.pass} isolation assertion(s) measured and held` };
}

/**
 * The record, with its keys in a fixed order — JSON.stringify writes insertion order, and
 * "same inputs, byte-identical output" is a property of this function, not of the caller.
 */
export function recordFor(run, { at = nowISO(), suite = SUITE, platform = process.platform } = {}) {
  return {
    v: 1,
    at,
    suite,
    platform,
    state: run.state,
    why: run.why ?? run.unknownDetail ?? null,
    counts: run.counts ?? null,
    skipped: run.skipped ?? [],
    exit: run.exit ?? null,
    signal: run.signal ?? null,
    ...(isUnknown(run) ? { unknown: true, unknownReason: run.unknownReason } : {}),
  };
}

/**
 * Run the suite and record what it said. Returns the record; `written` carries the write outcome,
 * because a measurement nobody could store is not a measurement anybody can read later.
 */
export function measure({ suite = SUITE, path = null, timeoutMs = 10 * 60_000, at = null } = {}) {
  const target = path || recordPath();
  // NODE_TEST_CONTEXT MUST NOT REACH THE CHILD. node sets it for every process a test run spawns,
  // and a `node --test` that sees it refuses to run any file — "run() is being called recursively
  // within a test file. skipping running files" — then exits 0 with no summary at all. That reads
  // here as unparseable (grey, which is the safe direction) but it means this function can never
  // measure anything from inside a suite, which is the only place it is ever exercised.
  const { NODE_TEST_CONTEXT: _nested, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', suite], {
    cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 << 20, env,
  });
  const run = classifyRun({
    exit: r.status, signal: r.signal, tap: `${r.stdout || ''}\n${r.stderr || ''}`,
    error: r.error ? (r.error.code || r.error.message) : null,
  });
  const rec = recordFor(run, at ? { at, suite } : { suite });
  let written = { ok: true, path: target };
  try { writeAtomic(target, `${JSON.stringify(rec, null, 2)}\n`, { mkdir: true }); }
  catch (e) { written = { ok: false, path: target, why: e.code || e.message }; }
  return { ...rec, written };
}

/**
 * The record on disk. ENOENT is the one legitimate absence — anything else is a store this process
 * could not read, which is never an empty store and never a clean host.
 */
export function readRecord(path = null) {
  const target = path || recordPath();
  let raw;
  try { raw = readFileSync(target, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') {
      return { path: target, ...unknown('not-run', `no isolation measurement at ${target} — isolation has never been measured on this host`), state: 'unknown' };
    }
    return { path: target, ...unknown('not-permitted', `${target} could not be read (${e.code}) — unreadable, not absent`), state: 'unknown' };
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { path: target, ...unknown('unparseable', `${target} does not parse (${e.message}) — treat as corrupt, never as unmeasured`), state: 'unknown' }; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string') {
    return { path: target, ...unknown('unparseable', `${target} carries no state field — it is not a measurement record`), state: 'unknown' };
  }
  // A state outside the closed set is a record written by a version this one cannot read. It becomes
  // unknown — which warns — and the claim it actually made is kept in `recordedState` rather than
  // being folded into whichever recognised state it resembles.
  if (!STATES.includes(parsed.state)) {
    return {
      ...parsed, path: target, recordedState: parsed.state,
      ...unknown('unparseable', `${target} records state ${JSON.stringify(parsed.state)}, which is not in this version's vocabulary (${STATES.join(', ')})`),
      state: 'unknown',
    };
  }
  return { ...parsed, path: target };
}

// Rank on the same scale monitor/liveness.mjs uses: 0 quiet, 1 warn, 3 fail the run.
//
// EVERYTHING GREY RANKS 1, AND ONLY A MEASURED FAILURE RANKS 3. A host that has never run the
// suite is not evidence that the sandbox leaks, and publishing it as one is the fabrication the
// house rules forbid — it also fires by construction on every fresh checkout, which is how a
// reader learns to stop reading the row. `failed` is the opposite case: it was measured, the
// isolation did not hold, and repository code is running on this machine without the confinement
// its posture claims. That earns the exit code.
export const RANK = Object.freeze({ verified: 0, stale: 1, partial: 1, unverified: 1, unknown: 1, failed: 3 });

const MEASURE_HINT = 'node monitor/isolation-freshness.mjs --measure';

/**
 * The row. `state` is the record's own state aged against the clock, so a verified measurement can
 * become `stale` without anything on disk changing.
 */
export function isolationRow({ record = null, nowMs = null, maxAgeDays = MAX_AGE_DAYS, path = null } = {}) {
  const rec = record || readRecord(path);
  const now = nowMs ?? Date.parse(nowISO());
  const t = typeof rec.at === 'string' ? Date.parse(rec.at) : NaN;
  const ageMs = Number.isFinite(t) ? now - t : null;

  // A measurement whose own timestamp cannot be aged is a record whose freshness is unknown — and
  // a future stamp is a clock or a record that is wrong, never a fresh pass.
  const where = rec.path || recordPath();
  if (rec.state !== 'unknown' && (ageMs === null || ageMs < 0)) {
    const why = ageMs === null
      ? `the record at ${where} has no readable timestamp (${JSON.stringify(rec.at ?? null)})`
      : `the record at ${where} is dated ${rec.at}, after now — the clock or the record is wrong, so its age is unknown`;
    return { state: 'unknown', rank: RANK.unknown, at: rec.at ?? null, days: null, why,
      line: `UNKNOWN — ${why}. ${MEASURE_HINT}` };
  }

  const days = ageMs === null || ageMs < 0 ? null : Math.floor(ageMs / DAY_MS);
  const since = `${rec.at} (${days} day(s) ago)`;
  const state = rec.state === 'verified' && days > maxAgeDays ? 'stale' : rec.state;
  const rank = RANK[state] ?? RANK.unknown;
  const why = rec.why || rec.unknownDetail || null;
  // An unknown that WAS recorded still has a date, and saying when nothing was established is the
  // difference between "never measured" and "the last attempt told us nothing".
  const dated = days === null ? '' : ` (recorded ${since})`;

  const line = state === 'verified' ? `verified ${since} — ${why}`
    : state === 'stale' ? `STALE — last verified ${since}, past the ${maxAgeDays}-day window; isolation is unverified since then. ${MEASURE_HINT}`
      : state === 'failed' ? `FAILED when measured ${since} — ${why}; the sandbox is not isolating what its flags claim`
        : state === 'partial' ? `PARTIAL ${since} — ${why}`
          : state === 'unverified' ? `UNVERIFIED since ${rec.at} (${days} day(s)) — ${why}`
            : `UNKNOWN${dated} — ${why || 'no reason recorded'}. ${MEASURE_HINT}`;
  return { state, rank, at: rec.at ?? null, days, why, line };
}

/** 0 verified · 1 a measured failure · 2 grey. The repo's lens convention. */
export const exitFor = (row) => (row.state === 'verified' ? 0 : row.state === 'failed' ? 1 : 2);

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node monitor/isolation-freshness.mjs [--measure] [--json]\n'
      + '  what the last measurement of container isolation on this host said, and how old it is;\n'
      + `  --measure runs ${SUITE} and records the result\n`
      + '  exit 0 verified, 1 the last measurement FAILED, 2 grey (never measured, stale, partial,\n'
      + '  unverified, or unreadable)');
    await exitFlushed(0);
  }
  const rec = argv.includes('--measure') ? measure() : readRecord();
  const row = isolationRow({ record: rec });
  if (argv.includes('--json')) console.log(JSON.stringify({ ...rec, row }, null, 2));
  else console.log(`isolation: ${row.line}`);
  // A measurement nobody could store leaves the host reading as never measured, so the run is grey
  // whatever the suite proved — the verdict stands, the job did not get done.
  if (rec.written && !rec.written.ok) {
    console.error(`isolation: the measurement could not be stored at ${rec.written.path} (${rec.written.why}) — it will read as never measured`);
    await exitFlushed(2);
  }
  await exitFlushed(exitFor(row));
}
