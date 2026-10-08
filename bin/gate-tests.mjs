#!/usr/bin/env node
// commitwork test gate — runs the suite in the background and wakes the model only on a REGRESSION.
//
// Ratchet rule: compare against a stored failure count and complain only when THIS turn made it
// worse — a co-session may keep the suite red for reasons unrelated to this turn.
//
// exit 0  no new failures        exit 2  more failures than the baseline (rewake)
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processState } from '../lib/pid-alive.mjs';
import { shouldEmit, silenceNote } from './hook-once.mjs';
import { journal } from './lib/verdict-journal-core.mjs';
import { measuredExec } from './measured.mjs';
import { testsBaseline, touchLedger } from './lib/store-paths.mjs';
import { generations } from './lib/ledger-rotate.mjs';
import { treeId } from './lib/store-paths.mjs';
import { parseSuiteOutput, initialVerdict, regressionVerdict, coverageVerdict, attributeFiles, treeEvidenceNote, unattributedKind, attributionBasis, basisNote } from './gate-tests-core.mjs';
import { sampleHeadroom, assessRun, describeRun, assessHostHeadroom, describeHost } from './lib/disk-headroom.mjs';
import { acquire as lockAcquire, release as lockRelease } from './lib/single-flight.mjs';
import { headPlan, targetedCmd } from './lib/head-partition.mjs';
import { newSinceLast, newSinceLastBlock } from './lib/new-since-last.mjs';
import { turnDecision, freshFailures, runSelector } from './lib/test-selection.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Both seams read at CALL time (house rule) — injectable so the e2e test can drive the real
// script over canned tallies and a scratch baseline.
// The store snapshot may sit above reality; gate-tests-core.mjs ratchets DOWN before anything
// else, so a stale floor is lowered on the first run rather than believed.
const BASELINE = () => testsBaseline();
const suiteCmd = () => process.env.CW_GATE_TESTS_CMD || 'npm test';

// The measurement act is recorded (bin/measured.mjs); the latest WORKING-TREE run wins — pristine
// HEAD runs measure a different population and never land here. okExit [0,1]: a failing suite's
// output IS the measurement; a signal-killed suite stays not-ok.
let SUITE_MEASURED = null;
const SUITE_TIMEOUT_MS = Number(process.env.CW_GATE_TESTS_TIMEOUT_MS) || 3_600_000;

function suite(cwd = REPO) {
  // 3_600_000 from 2026-09-16, doubled from 1_800_000: the first full run to finish after the docker
  // probes were bounded took 1733s — 67s of headroom under the old bound, which is noise on a box
  // carrying 18 sessions. Every run between 2026-09-14 and then died AT the bound and printed no
  // tally, and a bound the suite can reach converts "still running" into "NOT a pass" every turn.
  // Sized on the contended maximum, never the quiet middle.
  // 621s (measured, duration_ms on a completed run) and under fleet contention it exceeded 900s —
  // four consecutive gate firings read "exit 1, no tally line", which is what an execSync TIMEOUT
  // KILL looks like, not what a reporter change looks like. A timeout sized below the suite's real
  // ceiling converts "still running" into "NOT a pass" every turn, which is the alarm-fatigue diet
  // this gate exists to refuse. Sized at ~3x the clean-run measurement, not at the median (timing
  // bounds come from the contended maximum, never the quiet middle).
  const m = measuredExec(suiteCmd(), suiteCmd(), { cwd, timeout: SUITE_TIMEOUT_MS, okExit: [0, 1] });
  if (cwd === REPO) SUITE_MEASURED = m.measured;
  return parseSuiteOutput(m.out ?? '');   // parsing and every decision live in gate-tests-core.mjs (C21)
}

// Argv, not a command string — no shell, nothing to quote for. The --format argument must stay
// unquoted: with no shell, quotes would reach git as literal characters.
const git = (...args) => { try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

// ── ATTRIBUTION ─────────────────────────────────────────────────────────────────────────────────
// On a regression the suite runs again in a pristine HEAD checkout. COMPARE NAMES, NOT COUNTS: a
// clean worktree fails ~6 tests for environment reasons, so only tests already failing in the
// working tree are looked up at HEAD.
//   also fails at HEAD -> COMMITTED (attributable); passes at HEAD -> UNCOMMITTED work.
// A worktree named for a dead PID is a leak (killed runs never reach the finally); swept at START
// because the exit path is the one that did not run.
function pruneStaleHeadWorktrees() {
  let names = [];
  try { names = readdirSync(join(REPO, '.git')).filter((n) => /^gate-head-\d+$/.test(n)); } catch { return; }
  for (const n of names) {
    const pid = Number(n.slice('gate-head-'.length));
    if (pid === process.pid) continue;
    // Signal 0 tests existence; EPERM = exists but not ours; only ESRCH proves absence.
    let alive = true;
    try { process.kill(pid, 0); alive = processState(pid) !== 'Z'; } catch (e) { alive = e && e.code === 'EPERM'; }
    if (alive) continue;
    git('worktree', 'remove', '--force', join(REPO, '.git', n));
  }
  git('worktree', 'prune');
}

// `git worktree add` carries only what HEAD TRACKS, so every gitignored input the suite reads is
// absent there — the checkout is a control for code and for nothing else. Inputs only: reports/ and
// .claude/{store,verdicts} are OUTPUTS, and linking those would let a HEAD run write the live
// ledgers, which is worse than the confound it fixes.
const headInputs = () => (process.env.CW_GATE_HEAD_INPUTS ?? 'monitor/private,fixtures').split(',').filter(Boolean);

/** Link the declared inputs into `dir`. Returns the ones it could NOT provide — the degraded set.
 *  An input absent at SOURCE is degraded, not skipped: unprovable is unprovable, and a silent skip
 *  is how this returns to calling an environment failure a commit. */
function linkInputs(dir) {
  const missing = [];
  for (const rel of headInputs()) {
    const src = join(REPO, rel), dest = join(dir, rel);
    try {
      if (!existsSync(src)) { missing.push(rel); continue; }
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true });   // unlinks a link, never follows it
      symlinkSync(src, dest);
      if (!existsSync(dest)) missing.push(rel);         // existsSync FOLLOWS: assert it resolves
    } catch { missing.push(rel); }
  }
  return missing;
}

// `cmd` narrows the HEAD run to the test FILES that actually failed (bin/lib/head-partition.mjs).
// The whole-suite default remains for every case where the mapping is incomplete: a partition
// computed from a partial mapping calls a committed failure uncommitted, which blames whoever
// stopped last. Passing no cmd is the old behaviour, unchanged.
function suiteAtHead(cmd = null) {
  const dir = join(REPO, '.git', `gate-head-${process.pid}`);
  try {
    if (!git('worktree', 'add', '--detach', '--quiet', dir, 'HEAD') && !existsSync(dir)) return null;
    const degraded = linkInputs(dir);
    if (!cmd) return { ...suite(dir), degraded };
    const m = measuredExec(cmd, cmd, { cwd: dir, timeout: SUITE_TIMEOUT_MS, okExit: [0, 1] });
    return { ...parseSuiteOutput(m.out ?? ''), degraded, measured: m.measured };
  } catch { return null; } finally {
    git('worktree', 'remove', '--force', dir);
  }
}

/** Every test file in the working tree, by the same directories package.json globs. The WORKING
 *  TREE, not `git ls-files`: a failing test may be declared in a file that is not yet tracked, and
 *  the index is not the tree (this repo's own trap list). */
function testFiles() {
  const dirs = (process.env.CW_GATE_TEST_DIRS ?? 'admin,bin,lib,monitor,sitemap,cra,map,chunk-diff,flow').split(',').filter(Boolean);
  const out = [];
  for (const d of dirs) {
    try {
      for (const rel of readdirSync(join(REPO, d), { recursive: true })) {
        const p = String(rel);
        if (p.endsWith('.test.mjs')) out.push(join(REPO, d, p));
      }
    } catch { /* a missing directory is not a failure to enumerate the rest */ }
  }
  return out;
}

/** Dirty files someone else may be mid-edit in. Two commands that emit BARE PATHS — a fixed
 *  porcelain slice mangles renames. */
const dirtyFiles = () => [
  ...git('diff', '--name-only', 'HEAD').split('\n'),                    // tracked, staged or not
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),     // untracked, minus ignored
].filter(Boolean).filter((f) => /\.(mjs|js|json|html|css|md)$/.test(f));

// ── WHOSE dirty files ───────────────────────────────────────────────────────────────────────────
// touch-ledger records session_id per edited file; this hook gets its own session_id on stdin.
// Absent ledger or session id degrades to the unattributed report — a wrong name is worse than
// none. One readSync gets the whole payload (the pipe is closed-on-write).
function readStdinSession() {
  try {
    const buf = Buffer.alloc(65536);
    let n = 0;
    try { n = readSync(0, buf, 0, buf.length, null); } catch { return null; }
    if (!n) return null;
    return JSON.parse(buf.subarray(0, n).toString('utf8') || '{}')?.session_id || null;
  } catch { return null; }
}
const MY_SESSION = readStdinSession();

/** { mine: [...], theirs: [...], unknown: [...] } over the given files. */
function attribute(files, mySession) {
  // Comparison rules live in gate-tests-core.mjs; this wrapper supplies only I/O. BOTH ledger
  // halves are read (rotation moves touches to `.1`), oldest first. CW_TOUCH_LEDGER read at call
  // time so fixtures can control the ledger.
  const read = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return null; } };
  // N1, 2026-08-29: this default was '.claude/touches.jsonl' while bin/touch-ledger.mjs:37 wrote
  // '.claude/store/touches.jsonl'. Two readers of one artifact disagreeing on WHERE IT LIVES —
  // and worse than a path split, because .claude/store is a symlink into the sidecar, so the two
  // defaults named different REPOSITORIES. Unset, this read an absent file, and the branch below
  // turns an absent ledger into every file `unknown`, which returns successfully and reads as
  // "nobody touched anything" rather than "the ledger could not be found".
  const ledger = touchLedger();
  // Every generation, oldest first. Was `[ledger.1, ledger]`, a fixed two-file window that would
  // silently drop a third generation once rotation stopped destroying them.
  const gens = generations(ledger);
  const live = gens.filter((f) => f === ledger);
  const rotated = gens.filter((f) => f !== ledger).flatMap((f) => read(f) ?? []);
  const current = live.length ? read(ledger) : null;
  // N1's SECOND HALF, 2026-08-29. Unifying the path above fixed today's symptom; this branch is
  // the defect, and it survives any path fix — one wrong CW_TOUCH_LEDGER, one rotation race, one
  // fresh clone, and it returns again. `unknown: files` with nothing beside it collapses two
  // states that license OPPOSITE actions:
  //     ledger ABSENT             — nothing was checked. These files are UNATTRIBUTABLE.
  //     ledger present, no rows   — attribution ran and matched nothing. Genuinely unowned.
  // A caller cannot tell "I checked and nobody owns these" from "I could not check", and the gate
  // downstream printed the first sentence for both.
  //
  // Deliberately a FLAG, not a throw. The house rule is "only ENOENT means legitimately absent",
  // which settles most stores — but not this one: on a fresh checkout nobody HAS touched anything,
  // so an absent ledger is a true empty as often as it is a void, and failing closed here would
  // fail on a legitimate state. Report WHICH of the two happened and let the caller decide.
  const ledgerPresent = current !== null || rotated.length > 0;
  if (!ledgerPresent) return { mine: [], theirs: [], unknown: files, others: new Set(), shared: [], undetermined: [], liveSessions: {}, torn: 0, ledgerPresent: false, sessionKnown: !!mySession };
  const lines = [...rotated, ...(current ?? [])];
  return { ...attributeFiles(files, mySession, {
    ledgerLines: lines,
    committedAt: (f) => git('log', '-1', '--format=%cI', '--', f) || '',
    myTree: treeId(),
    // A5 · `sessionKnown` is carried SEPARATELY from `ledgerPresent`. Both were being answered by
    // one flag: with no session_id on stdin, attributeFiles returns every file as `unknown`, and
    // spreading `ledgerPresent:true` over that made the consumer print "no ledger entry at all" —
    // a false statement, because the ledger read perfectly and it was the COMPARATOR that was
    // missing. Two different unknowns, one field, and the message named the wrong one.
  }), ledgerPresent: true, sessionKnown: !!mySession };
}

// Resolve session ids to human labels. Lazy and defensive — a cosmetic feature must not kill the gate.
async function sessionLabels(shortIds) {
  if (!shortIds.size) return '';
  try {
    const { labelFor } = await import('./session-title.mjs');
    return [...shortIds].map((s) => labelFor(s)).join(', ');
  } catch { return [...shortIds].join(', '); }
}

// The disk is a witness to this run. Bracketed so a volume that filled DURING the suite can be told
// from a genuine regression — see bin/lib/disk-headroom.mjs for why that is not paranoia.
const diskBefore = sampleHeadroom({ path: REPO });

// ── SINGLE FLIGHT ───────────────────────────────────────────────────────────────────────────────
// Measured 2026-09-06 18:35-18:37 with no lock in place: 22 -> 25 -> 27 concurrent `npm test`
// wrappers, 64 `node --test` processes, load 58/64/63, ages 17s to 26m53s. Contending runs each
// died on their own timeout before printing a tally, so every one reported "NOT a pass" — the gate
// was measuring its own congestion. One suite at a time; everyone else defers and says so.
const LOCK = join(dirname(BASELINE()), 'gate-tests.lock');
const lockIo = {
  writeNew: (p, text) => {
    try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, { flag: 'wx' }); return true; }
    catch (e) { return e && e.code === 'EEXIST' ? 'EEXIST' : (() => { throw e; })(); }
  },
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  remove: (p) => { try { rmSync(p, { force: true }); } catch { /* another run cleared it first */ } },
  exists: (pid) => { try { process.kill(pid, 0); return processState(pid) !== 'Z'; } catch (e) { return !!(e && e.code === 'EPERM'); } },
  // ps prints LOCAL time; the stored value is epoch ms. Compare EPOCHS — a UTC string subtracted
  // from a local one yields a plausible offset that reads as a process restart (measured, +0930).
  startedAt: (pid) => {
    try {
      const ls = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      if (!ls) return null;
      const t = Date.parse(ls);
      return Number.isFinite(t) ? Math.floor(t / 1000) : null;
    } catch { return null; }
  },
};
const SELF = { pid: process.pid, pidStart: Date.now() - Math.round(process.uptime() * 1000), at: new Date().toISOString() };
// An unwritable store (ENOSPC, EACCES) throws out of `writeNew`. Losing the whole gate to that is
// worse than losing this turn's run: report grey and exit, the same shape as every other
// can't-measure branch here. Never proceed unlocked — that is the stampede with the alarm removed.
let lock;
try {
  lock = (process.env.CW_GATE_TESTS_NOLOCK === '1') ? { ok: true, disabled: true } : lockAcquire(LOCK, SELF, lockIo);
} catch (e) {
  lock = { ok: false, reason: `the run lock could not be written (${e && e.code ? e.code : e}) — the store may be full or unwritable` };
}
if (!lock.ok) {
  // DEFERRED IS GREY. A skipped run that reports success turns the gate into decoration, which is
  // the failure class this repo names most often.
  const h = lock.holder || {};
  const headline = `commitwork tests: DEFERRED — ${lock.reason}${h.pid ? ` (holder pid ${h.pid}${h.at ? `, started ${h.at}` : ''})` : ''}. The suite was NOT run this turn, so this is neither a pass nor a failure.`;
  // JOURNAL THE DEFERRAL. Without this the one verdict that means "no measurement happened" is the
  // only one absent from the record, so nobody could ever measure how often the gate declines to
  // run — the lock would be invisible in exactly the way that lets a silent gate look healthy.
  // Called directly rather than through `record`, which needs a tally this run never obtained.
  let jn = '';
  try {
    const r = journal('gate-tests', { verdict: 'deferred', exit: 0, holder: h.pid ?? null, reason: lock.reason, headline }, { session: MY_SESSION });
    if (!r.ok) jn = ` (verdict journal write failed: ${r.error})`;
  } catch (e) { jn = ` (verdict journal write threw: ${e && e.code ? e.code : e})`; }
  process.stdout.write(`${JSON.stringify({ systemMessage: `${headline}${jn}` })}\n`);
  process.exit(0);
}
process.on('exit', () => { if (!lock.disabled) lockRelease(LOCK, SELF, lockIo); });

// ── SELECTIVE TURN ──────────────────────────────────────────────────────────────────────────────
// A turn changes a handful of files; the full suite is 600+ files and ~10 minutes. So a turn runs
// the tests that can reach its changes (bin/lib/test-selection.mjs) and compares their failures by
// NAME against the last FULL run. The full run below still happens when one is due, when selection
// cannot decide, and whenever a selected test fails in a way the last full run did not record, so
// confirmation and attribution keep their one implementation. A selective result never writes the
// floor or the names store: it measured a different population.
const LAST_FULL_STORE = join(dirname(BASELINE()), 'gate-tests-last-names.json');
let FULL_BECAUSE = null;
{
  // CW_GATE_TESTS_CMD is the e2e seam for canned tallies; those tests opt into selection explicitly.
  const selecting = process.env.CW_GATE_TESTS_SELECT_CMD || !process.env.CW_GATE_TESTS_CMD;
  if (process.env.CW_GATE_TESTS_SELECTIVE !== '0' && selecting) {
    const lastFull = (() => { try { return JSON.parse(readFileSync(LAST_FULL_STORE, 'utf8')); } catch { return null; } })();
    const sel = runSelector(REPO);
    let plan = null;
    if (sel.measured.ok) { try { plan = JSON.parse(String(sel.out).trim().split('\n').pop()); } catch { plan = null; } }
    const fullEveryMs = Number(process.env.CW_GATE_TESTS_FULL_EVERY_MS) || undefined;
    const decision = turnDecision(plan, lastFull, { fullEveryMs });
    const say = (verdict, headline, extra = {}) => {
      let jn = '';
      try {
        const r = journal('gate-tests', { verdict, exit: 0, headline, selection: { run: decision.run, reason: decision.reason, tests: plan?.tests?.length ?? null }, ...extra }, { session: MY_SESSION });
        if (!r.ok) jn = ` (verdict journal write failed: ${r.error})`;
      } catch (e) { jn = ` (verdict journal write threw: ${e && e.code ? e.code : e})`; }
      const seen = shouldEmit('gate-tests', headline);
      if (seen.changed || jn) process.stdout.write(`${JSON.stringify({ systemMessage: `${headline}${jn}` })}\n`);
      process.exit(0);
    };
    if (decision.run === 'skip') {
      say('selective-skip', `commitwork tests: not run this turn — ${decision.reason}. The last full run (${lastFull.at}, ${lastFull.fail ?? '?'} failing) stands.`);
    }
    if (decision.run === 'selective') {
      const cmd = process.env.CW_GATE_TESTS_CMD || targetedCmd(plan.tests);
      const run = measuredExec(cmd, cmd, { cwd: REPO, timeout: SUITE_TIMEOUT_MS, okExit: [0, 1] });
      const r = parseSuiteOutput(run.out ?? '');
      if (r.fail === null) {
        FULL_BECAUSE = `a selective run of ${plan.tests.length} file(s) printed no tally`;
      } else {
        const fresh = freshFailures(r.names, lastFull.names);
        if (!fresh.length) {
          say('selective-steady', `commitwork tests (selective): ${r.pass} passing, ${r.fail} failing in the ${plan.tests.length} test file(s) that can reach this turn's changes; ${r.fail ? 'every failure was already failing' : 'nothing fails'} at the last full run (${lastFull.at}). The other test files were not run.`, { fail: r.fail, pass: r.pass, measured: run.measured });
        }
        FULL_BECAUSE = `a selective run of ${plan.tests.length} file(s) found ${fresh.length} failure(s) the last full run did not record`;
      }
    } else {
      FULL_BECAUSE = decision.reason;
    }
  }
}

let { fail, pass, tests, names } = suite();
const diskAfter = sampleHeadroom({ path: REPO });

const emit = (systemMessage, extra = {}) =>
  process.stdout.write(`${JSON.stringify({ systemMessage, ...extra })}\n`);

// One key for both keyspaces (say-once suppression AND the verdict journal).
const GATE = 'gate-tests';
// Sweep first, unconditionally: worktrees accumulate on the runs that DIE, which never reach
// later branches.
pruneStaleHeadWorktrees();

const HEAD_SHA = git('rev-parse', 'HEAD') || null;
// Journal adjacent to every exit. A write failure costs evidence only, never a verdict; a
// suppressed turn with a failed write emits a distinct failure-only line.
const record = (rec) => {
  const r = journal(GATE, { fail, pass, headSha: HEAD_SHA, measured: SUITE_MEASURED, fullBecause: FULL_BECAUSE, ...rec }, { session: MY_SESSION });
  return r.ok ? '' : ` (verdict journal write failed: ${r.error} — decisions are not being recorded)`;
};

// No parseable tally is unknown, and unknown must never read as green.
//
// The REASON is measured, not guessed. This used to assert "the suite did not run, or its reporter
// changed" — two causes it had no evidence for, while measuredExec had already recorded the exit
// code, the signal and the first line of stderr and this branch discarded all three. A gate that
// names the wrong cause gets discounted, and a discounted gate is how the next genuine unreadable
// gets waved through.
//
// THAT WARNING THEN CAME TRUE ABOUT THIS COMMENT. It went on to name the 900s timeout as "the
// common cause", and by 2026-09-04 that was doubly wrong: the timeout is SUITE_TIMEOUT_MS (3_600_000 since 2026-09-16), and
// 81 of the 146 no-tally records carry ok:true — which measuredExec only sets when there was NO
// signal, so those runs were never killed at all. The stale explanation survived because it was
// plausible and nobody re-measured it.
//
// WHAT WAS ACTUALLY HAPPENING, walked 2026-09-04 from a `sample` of the hung runner: the leaf was
// SyncProcessRunner::Spawn -> uv_run -> kevent, i.e. spawnSync blocked forever. The chain was
// bin/test/boot-harness.test.mjs -> bin/boot-harness.sh -> `docker info` on a WEDGED daemon, which
// blocks instead of failing (measured rc=124 under `timeout 8`; 46 orphaned `docker info`
// processes had accumulated, one per suite run). A synchronous spawn freezes the whole event loop,
// so every test printed and the summary never came. Both ends are now bounded. If this branch
// fires again, `sample <pid>` on the stalled runner is the first move, not a timeout raise.
// THREE causes, not two, and the third is the one that was misfiled for months.
//   exit 0, no tally      — the suite ran to completion and printed no summary. That IS a reporter
//                           question, and the only arm for which it was ever the right answer.
//   exit non-zero, NO signal — it did not run to completion and was not killed by the timeout
//                           either: it died or was truncated mid-flight. 81 of the 146 records sat
//                           here while the message called them a reporter change.
//   killed (signal)       — measuredExec sets ok:false; the timeout arm below.
const m = SUITE_MEASURED;
const why = !m ? 'the suite was never measured'
  : m.ok && m.exit === 0
    ? 'the suite exited 0 and produced output with no tally line — its reporter may have changed'
    : m.ok
      ? `the suite exited ${m.exit} with NO signal and printed no tally — it did not finish, and the timeout did not kill it, so it died or was truncated mid-flight; if a run is STALLED rather than dead, \`sample <pid>\` on the node --test process names the blocking call`
      : `the suite did not complete: exit ${m.exit}${m.detail ? ` — ${m.detail}` : ''} (killed at the timeout leaves real but truncated output)`;
if (fail === null) {
  const headline = `commitwork tests: could not read a pass/fail tally from \`npm test\` — ${why}. This is NOT a pass.`;
  const jn = record({ verdict: 'no-tally', exit: 0, headline });
  emit(`${headline}${jn}`);
  process.exit(0);   // do not rewake on a broken harness; say so and let a human look
}

// ── NEW SINCE LAST RUN ──────────────────────────────────────────────────────────────────────────
// The failing list is printed every turn, and with 6-13 standing failures it gets read past: a
// reader who classified the block once carries that classification forward, and a name that JOINS
// the set inherits a verdict nobody made about it. Measured 2026-09-06 by a peer, whose own defect
// sat inside such a block — named in this gate's own output — for hours.
// Membership becomes COMPUTED rather than remembered. Fleet-wide by design: the store is shared, so
// "since the last run" means the last run by any session on this tree, which is the honest scope.
// Attribution is a different question and regressionVerdict already answers it.
const NAMES_STORE = LAST_FULL_STORE;
// ONE read, not two. The first cut read this file twice — once for the names and once for the case
// count — which is both wasteful and a race: a peer's run can rewrite it between the two reads, and
// the pair would then describe two different measurements while looking like one.
const prev = (() => {
  try {
    const j = JSON.parse(readFileSync(NAMES_STORE, 'utf8'));
    return { names: Array.isArray(j?.names) ? j.names : null, tests: typeof j?.tests === 'number' ? j.tests : null };
  } catch { return { names: null, tests: null }; }    // absent or malformed -> no comparison, not an empty one
})();
const NEW_BLOCK = newSinceLastBlock(newSinceLast(prev.names, names, { prevTests: prev.tests, tests }));
try {                                                   // atomic; evidence only, never a verdict
  mkdirSync(dirname(NAMES_STORE), { recursive: true });
  const tmp = `${NAMES_STORE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ names, tests, fail, headSha: HEAD_SHA, at: new Date().toISOString() }, null, 2));
  renameSync(tmp, NAMES_STORE);
} catch { /* a store that cannot be written costs the NEXT run its comparison, and nothing else */ }

// Split ENOENT (genuine first run → null) from corrupt (→ {_error: true})
const read = () => {
  try {
    return JSON.parse(readFileSync(BASELINE(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;  // legitimate absence
    // Any other error: corrupt JSON, permission denied, etc.
    return { _error: true, message: e.message };
  }
};
function write(f) {
  const p = BASELINE();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  // `tests` is the total and is what the coverage check compares — `pass` moves on flakiness and
  // cannot tell a vanished test from a failing one. Written alongside `pass` rather than instead of
  // it: readers of the old shape keep working, and the coverage check goes live once this lands.
  writeFileSync(tmp, `${JSON.stringify({ fail: f, pass, tests, at: new Date().toISOString() }, null, 2)}\n`);
  renameSync(tmp, p);
}

const base = read();

// CORRUPT BASELINE: record the verdict, leave file untouched, exit without banking a new floor.
if (base && base._error) {
  const headline = `commitwork tests: baseline file is corrupt or unreadable (${base.message}). It remains untouched. This is NOT a pass — fix the baseline and re-run.`;
  const jn = record({ verdict: 'baseline-unreadable', exit: 0, message: base.message, headline });
  emit(`${headline}${jn}`);
  process.exit(0);   // do not rewake on a corrupted baseline; say so and let a human look
}

// Every verdict from here down comes from gate-tests-core.mjs — the script measures and reports;
// the core decides, and its branch matrix is provable by `node --test` instead of by reading.
const iv = initialVerdict({ fail, pass, tests }, base);

if (iv.verdict === 'armed') {
  write(fail);
  const headline = `commitwork tests armed: ${pass} passing, ${fail} failing — that failure count is now the floor. Future turns rewake only if it rises.`;
  const jn = record({ verdict: 'armed', exit: 0, headline });
  emit(`${headline}${jn}`);
  process.exit(0);
}

// Ratchet down: a floor above reality is a DEAF gate. Lowering is direction-safe — it can only
// produce MORE alarms. A pristine-checkout count must never become a floor (different population).
if (iv.verdict === 'floor-lowered') {
  write(fail);
  const headline = `commitwork tests: floor lowered ${base.fail} -> ${fail} (${pass} passing). The previous floor sat ABOVE reality, so up to ${base.fail - fail} real regression(s) could have landed unreported.`;
  const jn = record({ verdict: 'floor-lowered', exit: 0, baseline: base, headline });
  emit(`${headline}${jn}`);
  process.exit(0);
}

// ── CONFIRM BEFORE ALARMING ─────────────────────────────────────────────────────────────────────
// One sample of a tree with a live co-author is an observation, not a measurement. The SECOND
// reading wins.
if (iv.verdict === 'regression-pending') {
  // A run measured over a full or unreadable volume is not evidence about a commit. ENOSPC is not
  // loud here — it is swallowed by bare catches and surfaces as unrelated red across write-touching
  // suites, which this gate then files under "committed and attributable", the bucket a reader
  // trusts. Measured 2026-08-30: four false attributions were published that way in one day, three
  // of them passing 12/12 standalone once the disk was clear.
  // Sibling of the regression-unattributed branch below, and the same doctrine: unknown is not a
  // verdict. The DECISION is assessRun()'s and is provable by `node --test` against
  // bin/test/disk-headroom.test.mjs; this block only measures and reports, per the split above.
  // Checked BEFORE suiteAtHead(), which would materialise a ~26MB worktree onto the very volume
  // whose headroom is in question.
  const disk = assessRun(diskBefore, diskAfter);
  if (!disk.attributable) {
    const headline = `commitwork tests: ${fail} failing (floor ${base.fail}), but ${describeRun(disk)} Nothing is attributed from this run — clear space and re-run before acting on any of it.`;
    const jn = record({ verdict: 'regression-disk-undetermined', exit: 2, baseline: base, disk, names: names.slice(0, 100), headline });
    emit(`${headline}${jn}`);
    process.exit(2);
  }

  // Run at HEAD only the FILES that carry the failing test names. The comparison is only ever
  // asked about tests that failed — 0 to ~13 of ~7500 — so re-running all 596 files answers a
  // question nobody posed, at 621s a time. Falls back to the whole suite whenever the name->file
  // mapping is incomplete (bin/lib/head-partition.mjs).
  const plan = headPlan(names, testFiles(), (f) => readFileSync(f, 'utf8'));
  const head = plan.mode === 'targeted' ? suiteAtHead(targetedCmd(plan.files)) : suiteAtHead();

  // POPULATION, and why a targeted run passes `tests: null` rather than the tree's total.
  // `regressionVerdict` compares counts because "absent from head.names" is ambiguous: the test
  // passed at HEAD, or it never ran there. A targeted run RESOLVES that ambiguity by construction —
  // it runs exactly the files declaring the names being asked about, so an absent name provably ran
  // and provably passed. Handing it the tree's total would report a shortfall of thousands and call
  // every real answer `undetermined`, which is a false negative dressed as caution.
  const targeted = plan.mode === 'targeted' && head && head.fail !== null && head.tests > 0;
  const rv = regressionVerdict(names, head, targeted ? {} : { tests });

  // HEAD cannot be measured — say so rather than guessing a culprit. Unknown is not a verdict.
  if (rv.verdict === 'regression-unattributed') {
    const headline = `commitwork tests: ${fail} failing (floor ${base.fail}), but a pristine HEAD checkout could not be measured, so this is UNATTRIBUTED — it may be yours or a co-author's. Re-run \`npm test\` and check \`git status\` before acting.`;
    const jn = record({ verdict: rv.verdict, exit: 2, baseline: base, names: names.slice(0, 100), headline });
    emit(`${headline}${jn}`);
    process.exit(2);
  }

  const { committed, uncommitted, undetermined = [], population = null } = rv;
  // R17 · state the shortfall where the verdict is read, not only in the journal. A comparison over
  // unequal populations is not a weaker answer, it is a different question, and a reader who is not
  // told cannot know which one was answered.
  const shortfallNote = population && population.shortfall
    ? `\n\n⚠ POPULATIONS DIFFER: the working tree ran ${population.tests} cases, HEAD only ${population.headTests} (${population.shortfall} fewer). `
      + `A test absent from HEAD's failures may simply never have RUN there, so ${undetermined.length} name(s) below are UNDETERMINED — not yours, not anyone's:\n`
      + undetermined.slice(0, 30).map((n) => `  ? ${n}`).join('\n')
    : '';

  // Inputs were missing at HEAD, so "fails there too" proves nothing. Undetermined gets its own
  // field and its own verdict — it is not committed breakage and must never be baselined as one.
  if (rv.verdict === 'regression-undetermined') {
    const headline = `commitwork tests: ${rv.undetermined.length} test(s) also fail at HEAD, but the checkout could not be given ${rv.degraded.join(', ')} — so this is UNDETERMINED, not committed breakage.`;
    const jn = record({
      verdict: rv.verdict, exit: 2, baseline: base, degraded: rv.degraded,
      undetermined: rv.undetermined.slice(0, 100), uncommitted: uncommitted.slice(0, 100), headline,
    });
    emit(`${headline}${jn}`,
      { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `${NEW_BLOCK}A pristine HEAD checkout carries only what HEAD TRACKS. These inputs could not be linked into it: ${rv.degraded.join(', ')}.\n\nThese fail in the working tree AND at HEAD, but a HEAD run without those inputs cannot tell broken code from absent state, so they are UNDETERMINED — do not attribute them to a commit:\n${rv.undetermined.map((n) => `  ✖ ${n}`).join('\n')}\n${uncommitted.length ? `\nThese fail only in the working tree (uncommitted work, possibly someone else's):\n${uncommitted.map((n) => `  ✖ ${n}`).join('\n')}\n` : ''}\nTo attribute them, make the inputs reachable and re-run. Do NOT accept the baseline — that banks an unknown as the floor.` } });
    process.exit(2);
  }

  if (rv.verdict === 'regression-committed') {
    // Committed and attributable — name the commits since the floor was set.
    const since = base.at ? git('log', `--since=${base.at}`, '--format=%h|%an|%s') : '';
    const log = since ? since.split('\n').slice(0, 8).map((l) => `  ${l}`).join('\n') : '  (no commit range — baseline predates the stamp)';
    // Every session commits as the same git user, so attribute the files CHANGED since the floor
    // via the touch ledger.
    const changed = base.at ? git('diff', '--name-only', `@{${base.at}}..HEAD`).split('\n').filter(Boolean) : [];
    const cWho = attribute(changed, MY_SESSION);
    const cNames = await sessionLabels(cWho.others);
    const cLine = cWho.mine.length || cWho.theirs.length
      ? `\nOf the ${changed.length} file(s) committed since the floor, YOU touched ${cWho.mine.length}${cWho.theirs.length ? ` and ${cNames || 'another session'} touched ${cWho.theirs.length}` : ''}.`
      : '';
    const headline = `commitwork tests: ${committed.length} test(s) fail in a PRISTINE HEAD CHECKOUT too — the break is COMMITTED, not uncommitted work.`;
    const jn = record({
      verdict: rv.verdict, exit: 2, baseline: base,
      committed: committed.slice(0, 100), uncommitted: uncommitted.slice(0, 100),
      undetermined: undetermined.slice(0, 100), population,
      attribution: { basis: attributionBasis(cWho), mine: cWho.mine.slice(0, 50), theirs: cWho.theirs.slice(0, 50), unknown: cWho.unknown.slice(0, 50), others: [...cWho.others], ledgerPresent: cWho.ledgerPresent !== false },
      headline,
    });
    emit(`${headline}${jn}`,
      { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `${NEW_BLOCK}${shortfallNote}\n\nThese fail in the working tree AND in a clean checkout of HEAD, so they are committed and attributable:\n${committed.map((n) => `  \u2716 ${n}`).join('\n')}\n${uncommitted.length ? `\nThese fail only in the working tree (uncommitted work, possibly someone else's):\n${uncommitted.map((n) => `  \u2716 ${n}`).join('\n')}\n` : ''}\nCommits since the floor was set (sha|author|subject \u2014 author is the SAME human for every session, so read the attribution line below it, not that column):\n${log}${cLine}\n\nIf one is yours, fix it. If it is another session's commit, say so rather than fixing it out from under them. If the increase is deliberate, accept it with:\n  node -e "require('node:fs').writeFileSync(process.env.CW_GATE_TESTS_BASELINE || '${BASELINE()}', JSON.stringify({fail:${fail},pass:${pass},tests:${tests},at:new Date().toISOString()},null,2))"` } });
    process.exit(2);
  }

  // HEAD green, working tree not: the break is uncommitted. Never phrase as "you broke it".
  const dirty = dirtyFiles();
  const who = attribute(dirty, MY_SESSION);
  const otherNames = await sessionLabels(who.others);
  const list = (a) => (a.length ? a.slice(0, 12).map((f) => `  ${f}`).join('\n') + (a.length > 12 ? `\n  … +${a.length - 12} more` : '') : '  (none)');
  // Names WHICH of the two states produced this list — see attribute()'s ledgerPresent. Reporting
  // "no ledger entry at all" when there was no ledger at all is a false claim about the files.
  // R-C · which of the answers above rest on PROOF. `unevidenced` is a file whose ledger rows carry
  // no write evidence at all — the path appeared, nothing shows anyone wrote it. Printed rather than
  // silently folded in, because the previous behaviour named sessions from exactly these rows and it
  // cost real work: a correct change sat unlanded while nine sessions were polled and nine
  // disclaimed it. Empty on a healthy run, so it is not permanent furniture.
  const unevidencedBlock = (w) => (w.unevidenced && w.unevidenced.length
    ? `\n\nNamed WITHOUT WRITE EVIDENCE (${w.unevidenced.length}) — these rows show the path, not an author. Do NOT ask a session to answer for one of these; ask who can PROVE it:\n${list(w.unevidenced)}`
    : '');
  const unattributedBlock = (w) => {
    const rest = w.unknown.filter((f) => !w.undetermined.includes(f));
    const kind = unattributedKind(w);   // the DECISION lives in the core (C21); this only renders it
    const head = kind === 'no-session'
      ? `Dirty, UNATTRIBUTABLE (${rest.length}) — this run had no session id, so there was nothing to compare the ledger AGAINST. The ledger itself read fine. This is "we could not tell", NOT "nobody touched them":\n${list(rest)}`
      : kind === 'no-ledger'
      ? `Dirty, UNATTRIBUTABLE (${rest.length}) — the touch ledger could not be read, so nothing was checked. This is "we could not tell", NOT "nobody touched them":\n${list(rest)}`
      : `Dirty, no ledger entry at all (${rest.length}):\n${list(rest)}`;
    return `${head}${treeEvidenceNote(w)}${basisNote(attributionBasis(w))}`;
  };

  const verdict = who.mine.length === 0 && (who.theirs.length > 0)
    ? `NONE of the dirty files were touched by this session — this is work in flight belonging to ${otherNames || 'another session'}. Say so and leave it alone.`
    : who.mine.length
      ? 'Some dirty files ARE yours (below) — check those first.'
      : 'Attribution unavailable (no touch ledger yet), so this is UNATTRIBUTED — verify before acting.';
  // Lead with WHO and WHAT: name the session, then the files it is holding.
  const waitingOn = who.theirs.length
    ? ` — waiting on ${otherNames || 'another session'}: ${who.theirs.slice(0, 3).join(', ')}${who.theirs.length > 3 ? ` +${who.theirs.length - 3} more` : ''}`
    : '';
  const headline = `commitwork tests: ${fail} failing in the WORKING TREE, ${head.fail} at HEAD${waitingOn}. ${who.mine.length ? `${who.mine.length} dirty file(s) are yours.` : 'None of it is yours.'}`;
  // Say it once (bin/hook-once.mjs): a co-author's in-flight break persists across turns.
  const seen = shouldEmit(GATE, headline);
  const recBase = {
    verdict: rv.verdict, baseline: base, headFail: head.fail, names: names.slice(0, 100),
    attribution: { basis: attributionBasis(who), mine: who.mine.slice(0, 50), theirs: who.theirs.slice(0, 50), unknown: who.unknown.slice(0, 50), others: [...who.others], ledgerPresent: who.ledgerPresent !== false },
    headline,
  };
  if (!seen.changed) {
    // Suppressed is still a DECISION — journal it. Only a journal FAILURE may speak here.
    const jn = record({ ...recBase, exit: 0, suppressed: true, silenced: seen.silenced });
    if (jn) emit(`commitwork gate-tests${jn}`);
    process.exit(0);
  }
  const jn = record({ ...recBase, exit: 2, suppressed: false, silenced: seen.silenced });
  emit(`${headline}${silenceNote(seen.silenced)}${jn}`,
    { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `${NEW_BLOCK}A pristine HEAD checkout is at the floor (${head.fail} failing, ${head.pass} passing); the working tree is at ${fail}. Nothing committed is broken — the failure comes from edits nobody has landed yet.\n\n${verdict}\n\nFailing:\n${names.length ? names.map((n) => `  ✖ ${n}`).join('\n') : '  (none parsed)'}\n\nDirty files YOU touched (${who.mine.length}):\n${list(who.mine)}\n\nDirty files ANOTHER session touched (${who.theirs.length})${otherNames ? ` — ${otherNames}` : ''}:\n${list(who.theirs)}${who.shared.length ? `\n\nOf those, HELD BY YOU AND THEM AT ONCE (${who.shared.length}) — your hunks and theirs are in the same file, so "yours" is not the whole story:\n${list(who.shared)}` : ''}\n\nDirty, ownership UNDETERMINED (${who.undetermined.length}) — touched, but every touch predates the last commit of the file, and git cannot say whose hunks that commit carried:\n${list(who.undetermined)}\n\n${unattributedBlock(who)}${unevidencedBlock(who)}\n\nDo NOT baseline a co-author's break — that banks their half-landed change as the permanent floor and hides their next real one.` } });
  process.exit(2);
}

// ── COVERAGE RATCHET ────────────────────────────────────────────────────────────────────────────
// A failure count cannot see a test that VANISHED (node --test exits 0 on a glob matching
// nothing); only the pass count can. HEAD is not consulted — a pristine checkout is a different
// population, so tree-now against tree-then is the only honest comparison.
if (iv.verdict === 'coverage-pending') {
  // Confirm before alarming, as on the regression path.
  const second = suite();
  const cv = coverageVerdict(pass, second, base);
  if (cv.verdict === 'coverage-transient') {
    const headline = `commitwork tests: coverage dipped to ${pass} and recovered to ${second.pass} — transient, not a real loss.`;
    const jn = record({ verdict: cv.verdict, exit: 0, baseline: base, dip: pass, recovered: second.pass, headline });
    emit(`${headline}${jn}`);
    process.exit(0);
  }
  const now = cv.toPass;
  const dirty = dirtyFiles();
  const who = attribute(dirty, MY_SESSION);
  const otherNames = await sessionLabels(who.others);
  const list = (a) => (a.length ? a.slice(0, 12).map((f) => `  ${f}`).join('\n') + (a.length > 12 ? `\n  … +${a.length - 12} more` : '') : '  (none)');
  // Names WHICH of the two states produced this list — see attribute()'s ledgerPresent. Reporting
  // "no ledger entry at all" when there was no ledger at all is a false claim about the files.
  // Was a STALE COPY of the block above: it still branched on `ledgerPresent` alone, so it carried
  // the very false claim A5 removed from its twin — "no ledger entry at all" printed when the
  // ledger read fine and only the SESSION was missing. It also rendered neither evidence note.
  // Two branches of one gate reporting attribution differently is how a fix comes to be half-landed.
  const unattributedBlock = (w) => {
    const rest = w.unknown.filter((f) => !w.undetermined.includes(f));
    const kind = unattributedKind(w);
    const head = kind === 'no-session'
      ? `Dirty, UNATTRIBUTABLE (${rest.length}) — this run had no session id, so there was nothing to compare the ledger AGAINST. The ledger itself read fine. This is "we could not tell", NOT "nobody touched them":\n${list(rest)}`
      : kind === 'no-ledger'
        ? `Dirty, UNATTRIBUTABLE (${rest.length}) — the touch ledger could not be read, so nothing was checked. This is "we could not tell", NOT "nobody touched them":\n${list(rest)}`
        : `Dirty, no ledger entry at all (${rest.length}):\n${list(rest)}`;
    return `${head}${treeEvidenceNote(w)}${basisNote(attributionBasis(w))}`;
  };
  const headline = `commitwork tests: ${cv.fromPass - now} test(s) DISAPPEARED — ${cv.fromPass} → ${now} total, failures flat at ${fail}. Vanished tests do not fail, so nothing else in this gate can see them.`;
  const jn = record({
    verdict: cv.verdict, exit: 2, baseline: base, fromPass: cv.fromPass, toPass: now,
    attribution: { basis: attributionBasis(who), mine: who.mine.slice(0, 50), theirs: who.theirs.slice(0, 50), unknown: who.unknown.slice(0, 50), others: [...who.others], ledgerPresent: who.ledgerPresent !== false },
    headline,
  });
  emit(`${headline}${jn}`,
    { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `The suite got SMALLER, not redder: ${cv.fromPass} total at the floor, ${now} now, ${fail} failing (floor ${base.fail}).\n\nThis is what a glob that stopped matching looks like. \`node --test\` exits 0 when it matches no files, so a renamed directory — or a test moved out of \`admin/**\`, \`bin/**\`, \`monitor/**\`, \`cra/**\` — drops its cases silently.\n\nCheck in this order:\n  1. Run each glob alone and look for \`pass 0\`:\n     for g in admin bin lib monitor sitemap cra map chunk-diff; do echo -n "$g: "; node --test "$g/**/*.test.mjs" 2>&1 | grep '^ℹ pass'; done\n  2. \`git status\` for renamed or deleted test files.\n  3. If tests were deliberately removed, accept the new floor.\n\nDirty files YOU touched (${who.mine.length}):\n${list(who.mine)}\n\nDirty files ANOTHER session touched (${who.theirs.length})${otherNames ? ` — ${otherNames}` : ''}:\n${list(who.theirs)}${who.shared.length ? `\n\nOf those, HELD BY YOU AND THEM AT ONCE (${who.shared.length}) — your hunks and theirs are in the same file, so "yours" is not the whole story:\n${list(who.shared)}` : ''}\n\nDirty, ownership UNDETERMINED (${who.undetermined.length}) — touched, but every touch predates the last commit of the file, and git cannot say whose hunks that commit carried:\n${list(who.undetermined)}\n\n${unattributedBlock(who)}\n\nDo NOT accept a co-author's loss as the floor. Deliberate and yours? Then:\n  node -e "require('node:fs').writeFileSync(process.env.CW_GATE_TESTS_BASELINE || '${BASELINE()}', JSON.stringify({fail:${fail},pass:${second.pass},tests:${second.tests},at:new Date().toISOString()},null,2))"` } });
  process.exit(2);
}

// A rise raises the floor — direction-safe: it can only produce more alarms.
if (iv.writeBaseline) write(fail);

const steady = fail === 0
  ? `commitwork tests: ${pass} passing, 0 failing.`
  : `commitwork tests: ${pass} passing, ${fail} failing (unchanged — pre-existing, not from this turn).`;
// The steady line repeats by construction — say-once. The coverage-floor raise is a named fact
// on the record (`floorRaised`), not a silent write.
// Host posture rides along with the steady line because a GREEN run is exactly when nothing else
// reports the disk: assessRun's 512 MB floor answers "could this run write", and on 2026-09-24 it
// answered yes for days while the volume sat at 3% and Docker returned EIO on every image read.
// Deliberately NOT part of the say-once key — the percentage moves every run, so keying on it would
// re-emit the steady line forever — but it DOES override suppression, because a gate that goes
// quiet about a filling volume is the failure this check exists to stop.
const host = assessHostHeadroom(diskAfter);
const hostNote = host.healthy ? '' : `\n${describeHost(host)}`;

const seenSteady = shouldEmit(GATE, steady);
const steadyRec = { verdict: 'steady', baseline: base, floorRaised: !!iv.floorRaised, host, headline: steady };
if (!seenSteady.changed && host.healthy) {
  const jn = record({ ...steadyRec, exit: 0, suppressed: true, silenced: seenSteady.silenced });
  if (jn) emit(`commitwork gate-tests${jn}`);
  process.exit(0);
}
const jn = record({ ...steadyRec, exit: 0, suppressed: false, silenced: seenSteady.silenced });
emit(`${steady}${hostNote}${silenceNote(seenSteady.silenced)}${jn}`);
process.exit(0);
