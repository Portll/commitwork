// commitwork — gate-tests-core: the decisions of the test gate, pure. bin/gate-tests.mjs keeps
// the I/O. Every function here is total in its arguments — no fs, child_process, or env.
//
// treeClaim is the one import, and it is pure GIVEN BOTH ARGUMENTS. Its one-argument form defaults
// to treeId(), which reads the filesystem path of the module — so callers here must always pass
// the tree explicitly, and the contract above still holds.
import { treeClaim } from './lib/store-paths.mjs';
// R-C: ownership must rest on WRITE evidence, not on the mere existence of a touch row.
import { isWriteEvidence } from './lib/touch-ledger-core.mjs';

/**
 * Parse `npm test` output into {tests, fail, pass, names}. A missing tally is null (UNKNOWN), never zero.
 *
 * `tests` is the TOTAL and it is the only number that answers "did a test disappear". `pass` cannot:
 * it moves when a test vanishes AND when a flaky test fails, and the two are indistinguishable in it.
 * Measured 2026-08-29 on one unchanged tree, two consecutive runs: tests 5681 both times, pass 5668
 * then 5666. The coverage alarm fired on that, told every session in the fleet to go hunting a glob
 * that had stopped matching, and there was none.
 */
export function parseSuiteOutput(out) {
  const s = String(out ?? '');
  const num = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
  const names = [...s.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]);
  return {
    tests: num(/^ℹ tests (\d+)$/m),
    fail: num(/^ℹ fail (\d+)$/m),
    pass: num(/^ℹ pass (\d+)$/m),
    names: [...new Set(names)],
  };
}

/**
 * First-stage verdict from one suite measurement against the baseline. Terminal verdicts carry
 * `exit`; `-pending` verdicts request a second measurement — confirm before alarming.
 */
export function initialVerdict({ fail, pass, tests }, base) {
  if (fail === null) return { verdict: 'no-tally', exit: 0 };
  if (!base || typeof base.fail !== 'number') return { verdict: 'armed', writeBaseline: true, exit: 0 };
  // RATCHET DOWN before anything else — a floor above reality is a deaf gate.
  if (fail < base.fail) return { verdict: 'floor-lowered', from: base.fail, to: fail, writeBaseline: true, exit: 0 };
  if (fail > base.fail) return { verdict: 'regression-pending' };
  // fail === base.fail: the failure mode left is tests that VANISH, and `tests` is what sees it.
  //
  // This compared `pass` until 2026-08-29, which conflates two different facts — how many tests
  // EXIST and how many passed this run — so a flaky failure read as a suite that had shrunk. The
  // suite here moves by 2-3 between identical runs, so the alarm fired continuously on noise while
  // instructing every session to look for a renamed directory.
  //
  // A baseline written before this field cannot answer the question. That is UNKNOWN, and an unknown
  // is not a finding: it does not alarm, and `coverageCheckable:false` says so rather than the caller
  // inferring a clean read from silence. Self-healing — the baseline written below carries `tests`,
  // so the check goes live on the next arm.
  // KNOWN BLIND SPOT, measured 2026-09-02 — `tests` counts a SKIPPED test as existing, so a suite
  // that is still present but no longer RUNS holds `tests` flat and is invisible here. Reproduction,
  // against a real baseline {tests:7123, pass:7109, fail:2} with 40 tests moved pass -> skip:
  //   coverageVerdict(7069, {tests:7123, pass:7069, fail:2}, base) -> coverage-transient, exit 0
  //   the same loss with `tests` absent from the baseline -> coverage-loss,       exit 2
  // i.e. the gate is strictly blinder for having the richer baseline, and `coverageVerdict` reports
  // `recovered: 7123` — the total that includes the tests which stopped running.
  //
  // NOT FIXED HERE, deliberately. The quantity that means "ran" is `pass + fail`, but at this point
  // `fail === base.fail`, so that reduces to comparing `pass` — exactly what the paragraph above
  // removed for firing continuously on noise. Whether `pass` was noisy for a reason that survives
  // the `fail === base.fail` guard is not answerable from the record, and reintroducing that alarm
  // for every session on a guess is the wrong trade.
  //
  // MEASURED 2026-09-02, three full-suite runs on an identical detached HEAD worktree:
  //   tests 7100/7100/7100 · pass 7004/7004/7004 · cancelled 20/20/20 · fail 47/48/48 · skipped 29/28/28
  // `pass` did not move at all. The only movement was ONE test flipping skipped <-> fail, which the
  // `fail === base.fail` guard above already excludes. So pass-noise is NOT intrinsic to this suite.
  //
  // REFUTED 2026-09-02, same day, by the test directly below this file's own coverage tests — and the
  // counterexample was already in the repo. `a FLAKY failure does not read as coverage loss` records
  // tests 5681/5681, fail 1/1, pass 5668 -> 5666 on ONE UNCHANGED TREE. fail is EQUAL there, so the
  // `fail === base.fail` guard does NOT exclude it, and the arithmetic says what moved: the
  // non-running channel (skipped+cancelled+todo) rose 12 -> 14 spontaneously. So `pass` DOES move
  // while `fail` holds, `pass+fail` is not invariant either (5669 -> 5667), and the three shared-tree
  // runs below simply did not sample it. A sampled zero is not a population zero.
  //
  // What that leaves: the noise lives in the SKIP CHANNEL ITSELF, so a bare count comparison on
  // `pass`, on `pass+fail`, or on `skipped` is unsound in the same way. A sound fix needs the signal
  // to be persistence or identity, not a single count: alarm only when a rise survives BOTH readings
  // the gate already takes, and by a margin wider than the ±2 measured here. Sizing that margin needs
  // the skip channel's distribution over many runs, which nobody has measured.
  //
  // The population caveat below still stands on its own terms: this ran in a pristine
  // worktree with no concurrent writers, while the gate runs in a tree up to ten sessions write to
  // while the suite reads it. Contention is a variance source the probe removes by construction, and
  // it is the likeliest explanation for the "moves by 2-3" the 2026-08-29 note recorded. So the
  // measurement narrows the question — pass-noise is environmental, not inherent — without answering
  // it for the environment that matters. Re-run these three on the SHARED tree to settle it.
  // Logged in BACKLOG-commitwork.md (cw-81 handoff item #19).
  const coverageCheckable = typeof base.tests === 'number' && typeof tests === 'number';
  if (coverageCheckable && tests < base.tests) return { verdict: 'coverage-pending', fromTests: base.tests, toTests: tests };
  // A rise raises the floor, so the next disappearance is measured against the high-water mark.
  const floorRaised = coverageCheckable ? tests > base.tests : (typeof base.pass !== 'number' || pass > base.pass);
  return { verdict: 'steady', exit: 0, floorRaised, writeBaseline: floorRaised, coverageCheckable };
}

/**
 * Regression attribution: partition this tree's failures by whether a pristine HEAD has them too.
 * Compare names, not counts.
 *
 * `head.degraded` lists inputs the HEAD checkout could not be given. A reading taken without them
 * cannot tell broken code from absent state, so its failures are UNDETERMINED, never committed —
 * measured 2026-08-29: 6 failing at HEAD without `monitor/private`, 4 with it, and the 4 are the
 * working tree's. `the live registry: clientA is paused` was in the 2 that vanished.
 */
export function regressionVerdict(names, head, { tests = null } = {}) {
  if (!head || head.fail === null) return { verdict: 'regression-unattributed', exit: 2 };
  const atHead = new Set(head.names);
  const committed = names.filter((n) => atHead.has(n));

  // R17 · CORRESPONDENCE. Absence from `head.names` means "did not FAIL at HEAD", and that is two
  // different facts wearing one shape: the test ran and passed, or it never ran at all. Blaming the
  // second on uncommitted work is a confident wrong answer, and it is the mechanism behind the
  // false "committed and attributable" lines this gate has been publishing — a run that executes
  // fewer cases (a glob that stopped matching, a crash, a port already bound, a timeout) makes
  // every unexecuted test look like somebody's local break.
  //
  // The populations are comparable only when HEAD ran at least as many cases as the tree. When it
  // ran FEWER, the difference is not evidence about anybody, and these names are `undetermined`.
  // Note the asymmetry: `committed` stays sound either way — a test that FAILED at HEAD failed at
  // HEAD, whatever else did or did not run.
  const comparable = !(typeof tests === 'number' && typeof head.tests === 'number' && head.tests < tests);
  const absent = names.filter((n) => !atHead.has(n));
  const degraded = Array.isArray(head.degraded) && head.degraded.length ? head.degraded : null;
  if (degraded) {
    return committed.length
      ? { verdict: 'regression-undetermined', committed: [], undetermined: committed,
          uncommitted: absent, degraded, population: null, exit: 2 }
      : { verdict: 'regression-uncommitted', committed: [], undetermined: [],
          uncommitted: absent, degraded, population: null, exit: 2 };
  }
  const uncommitted = comparable ? absent : [];
  const undetermined = comparable ? [] : absent;
  const population = (typeof tests === 'number' && typeof head.tests === 'number')
    ? { tests, headTests: head.tests, shortfall: Math.max(0, tests - head.tests) }
    : null;

  return committed.length
    ? { verdict: 'regression-committed', committed, uncommitted, undetermined, population, exit: 2 }
    : uncommitted.length
      ? { verdict: 'regression-uncommitted', committed, uncommitted, undetermined, population, exit: 2 }
      // Nothing could be placed. Not "uncommitted" — that would name a culprit for a comparison
      // that never happened.
      : { verdict: 'regression-incomparable', committed, uncommitted, undetermined, population, exit: 2 };
}

/**
 * Coverage confirmation: the second reading wins — a mid-write refactor dips, a real loss reproduces.
 *
 * Confirms on `tests` when both readings carry it, for the same reason initialVerdict does: `pass`
 * recovers on its own when a flaky test happens to pass the second time, so a `pass`-based
 * confirmation turns a coin-flip into a verdict in both directions.
 */
export function coverageVerdict(firstPass, second, base) {
  const byTotal = typeof base.tests === 'number' && typeof second.tests === 'number';
  if (byTotal) {
    if (second.tests >= base.tests) return { verdict: 'coverage-transient', dip: firstPass, recovered: second.tests, exit: 0 };
    return { verdict: 'coverage-loss', fromPass: base.tests, toPass: second.tests, exit: 2 };
  }
  if (second.pass !== null && second.pass >= base.pass) {
    return { verdict: 'coverage-transient', dip: firstPass, recovered: second.pass, exit: 0 };
  }
  return { verdict: 'coverage-loss', fromPass: base.pass, toPass: second.pass ?? firstPass, exit: 2 };
}

/**
 * Ownership of dirty files, pure. `ledgerLines` are raw touches.jsonl lines; `committedAt(f)`
 * answers "when was this path last committed" (ISO or '').
 *
 * The answer is a SET of sessions with live work; mine/theirs/shared are memberships, so a
 * co-owned file is not reported as exclusively mine. `shared` ⊂ `theirs`, `undetermined` ⊂ `unknown`.
 *
 * Compare timestamps as INSTANTS, never strings: git `%cI` carries a local offset, the ledger
 * writes UTC, so a lexical compare misorders them. A touch inside the commit's own second is live.
 *
 * When every touch predates the boundary the file is still dirty, so it is `undetermined` (whose
 * work cannot be recovered from git) — distinct from "no ledger entry", never called nobody's.
 * Absent ledger/session degrades to unattributed; unparseable lines are counted in `torn`, never dropped.
 */
const instant = (t) => { const n = Date.parse(String(t ?? '')); return Number.isFinite(n) ? n : null; };

export function attributeFiles(files, mySession, { ledgerLines = [], committedAt = () => '', myTree = null } = {}) {
  const base = { mine: [], theirs: [], unknown: [], others: new Set(), shared: [], undetermined: [], unevidenced: [], liveSessions: {}, torn: 0, treeUnknownRows: 0, foreignTreeRows: 0, treeMineRows: 0 };
  if (!mySession) return { ...base, unknown: files };
  const me = String(mySession).slice(0, 8);
  const owners = new Map();
  const evidenced = new Set();
  let torn = 0;
  let treeUnknownRows = 0;
  let treeMineRows = 0;
  let foreignTreeRows = 0;
  for (const l of ledgerLines) {
    try {
      const r = JSON.parse(l); if (!r.f) continue;
      // WHICH TREE wrote this row. Paths are stored relative to the writer's own repo, and one store
      // is shared by several checkouts, so `bin/x.mjs` from another tree is byte-identical to this
      // one's — attributing it to a local session is a confident false blame.
      //
      // Three-valued, and the third value is the honest one. A row stamped with another tree is
      // dropped. A row with no stamp CANNOT be placed: the field was added 2026-08-29 and 14,880 of
      // 15,614 rows predate it, so dropping those would delete 95% of all attribution evidence
      // while excluding no known foreign row (zero rows carry a foreign stamp today; the ~3,700
      // genuinely foreign ones are legacy and indistinguishable). They are counted instead, and the
      // count travels with the result so a caller states the population rather than implying one.
      // treeClaim, not a second inline comparison: one concept, one definition. It is PURE when
      // both arguments are supplied, which is why importing it does not break this file's
      // no-env contract — never call it with one argument here.
      const tc = myTree ? treeClaim(r, myTree) : 'unknown';
      if (tc === 'other') { foreignTreeRows++; continue; }
      if (tc === 'unknown') treeUnknownRows++; else if (tc === 'mine') treeMineRows++;
      // `via:'exec'` means the session RAN this file, not that it wrote it — running `node --test
      // x.test.mjs` must never make x.test.mjs yours. Current exec records carry the script under
      // `x` and are already skipped by the !r.f guard above; this catches the 37 written on
      // 2026-08-24 while the record type briefly used `f`, which would otherwise assign ownership
      // of three files to a co-session that had only executed them. Belt and braces, deliberately:
      // the field split is the fix, and this is the guard for data already on disk.
      if (r.via === 'exec') continue;
      // R-C · EVIDENCE, SEPARATELY FROM PRESENCE. `isWriteEvidence` is true only for a row that
      // PROVES a write: payload fingerprints, a commit git confirmed, or a parser hit the mtime
      // window corroborated. A bare touch proves the path appeared in a command string and nothing
      // more. Measured 2026-08-30: 18,762 file rows, 6,528 with evidence — and this function
      // consulted none of it, so every "ANOTHER session touched" line was drawn from all 18,762.
      // That cost real work: a correct change sat unlanded because two sessions each declined to
      // commit it out of courtesy to an author neither could identify, and nine were polled.
      // R2 · KEYED ON (file, session), NOT file. Keyed on file alone, ONE session's genuine write
      // laundered every OTHER session's evidence-free row on the same path: the file read as
      // "evidenced" and the bucket stayed empty. Measured 2026-08-30 against the live ledger —
      // `unevidenced` was [] both with and without the false rows, so the guard written to catch
      // exactly this said nothing. A per-file key cannot express a per-session question.
      if (isWriteEvidence(r)) evidenced.add(`${r.f}\u0000${r.s}`);
      const m = owners.get(r.f) || owners.set(r.f, new Map()).get(r.f);
      const prev = m.get(r.s);
      // latest touch per (file, session). Both sides come from the ledger, so they share a format
      // and a lexical compare is safe HERE — unlike the boundary compare below, which does not.
      if (!prev || String(r.at) > String(prev)) m.set(r.s, r.at);
    } catch { torn++; }
  }
  const out = { ...base, others: new Set(), torn, treeUnknownRows, foreignTreeRows, treeMineRows };
  for (const f of files) {
    const o = owners.get(f);
    if (!o) { out.unknown.push(f); continue; }        // no ledger entry — the only true unknown
    const boundary = instant(committedAt(f) || '');   // absent/unparseable ⇒ no boundary ⇒ all live
    const live = [];
    let undecided = false;
    for (const [s, at] of o) {
      const touch = instant(at);
      if (touch === null) { undecided = true; continue; }   // cannot place this touch at all
      if (boundary === null || touch >= boundary) live.push(s);
    }
    if (!live.length) { out.undetermined.push(f); out.unknown.push(f); continue; }
    out.liveSessions[f] = live;
    const mineLive = live.includes(me);
    const theirsLive = live.filter((s) => s !== me);
    if (theirsLive.length) { out.theirs.push(f); for (const s of theirsLive) out.others.add(s); }
    if (mineLive && theirsLive.length) out.shared.push(f);
    else if (mineLive) out.mine.push(f);
    if (undecided && !out.undetermined.includes(f)) out.undetermined.push(f);
    // Additive on purpose. The existing buckets keep their meaning so no caller regresses; this one
    // says which of those answers rest on a touch rather than on proof. Today, with Bash-routed
    // edits invisible, that is most of them — and a gate that cannot say so is the reason nobody
    // knew.
    // Unevidenced when NONE of the sessions actually attributed to this file can prove a write.
    // `live` is that set, so the question is asked about the sessions being named — not about
    // whether anyone, anywhere, ever wrote the path.
    // ANY named session without proof flags the file. Not "no session has evidence" — if A provably
    // wrote it and B is named alongside on a bare touch, the file IS being used to name B wrongly,
    // and B is exactly who would be asked to answer for it. That asymmetry is the laundering.
    if (live.some((sid) => !evidenced.has(`${f}\u0000${sid}`))) out.unevidenced.push(f);
  }
  return out;
}

/**
 * R-C · WHO WROTE THIS PATH — answered from evidence, or not at all.
 *
 * Returns `{ session, basis }` where `basis` is one of:
 *   'write'         — a row PROVES this session wrote it (payload fingerprints, a git-confirmed
 *                     commit, or a parser hit corroborated by the mtime window).
 *   'unknown'       — nothing proves it. `session` is null. This is the answer more often than not
 *                     today, and saying so is the entire point: the previous behaviour was to name
 *                     whichever sessions had a touch row, which is a list of readers presented as a
 *                     list of authors.
 *   'contested'     — more than one session has write evidence. A real answer, not a failure.
 *
 * NEVER guesses. A caller wanting "who probably" can read `attributeFiles`; this one exists so that
 * a caller wanting "who provably" has somewhere to go, and so the difference is visible in the code
 * rather than remembered.
 */
export function authorOf(path, { ledgerLines = [], myTree = null } = {}) {
  const sessions = new Set();
  for (const l of ledgerLines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (!r.f || r.f !== path) continue;
    if (myTree && treeClaim(r, myTree) === 'other') continue;
    if (!isWriteEvidence(r)) continue;
    if (r.s) sessions.add(r.s);
  }
  if (sessions.size === 0) return { session: null, basis: 'unknown' };
  if (sessions.size > 1) return { session: null, basis: 'contested', sessions: [...sessions] };
  return { session: [...sessions][0], basis: 'write' };
}

/**
 * A5 · WHICH unknown this is. Three states that were previously two, because one flag was answering
 * two questions.
 *
 *   'no-ledger'   — the store could not be read. Nothing was checked.
 *   'no-session'  — the store read fine; this run had no session id, so there was nothing to compare
 *                   it AGAINST. Previously this returned `ledgerPresent:true` and every file as
 *                   `unknown`, which the reporter rendered as "no ledger entry at all" — a false
 *                   statement about a ledger that had just been read successfully.
 *   'no-entry'    — the store read, the session is known, and these paths genuinely have no rows.
 *
 * Only the third is "nobody touched them". The first two are "we could not tell", and conflating
 * them is the house's own unsupported pass rule applied to attribution.
 */
export function unattributedKind({ ledgerPresent, sessionKnown } = {}) {
  if (ledgerPresent === false) return 'no-ledger';
  if (sessionKnown === false) return 'no-session';
  return 'no-entry';
}

/**
 * A5 · THE BASIS an attribution rests on, as a value that travels with the record.
 *
 * Measured 2026-08-30: `basis` appeared in **0 of 4,983** gate journal records. Every published
 * attribution therefore stated WHO without stating what the claim was made from — how many files
 * had write evidence, how many sessions were in the population, or whether the comparison was even
 * possible. A reader could not tell a well-evidenced answer from a guess, and neither could the
 * gate's own author a week later.
 *
 * Deliberately counts, not lists: this is journalled on every run and a list grows without bound.
 * The lists are already in `attribution`; this says what they are worth.
 */
export function attributionBasis(who = {}) {
  const liveSessions = who.liveSessions || {};
  const sessions = new Set();
  for (const v of Object.values(liveSessions)) for (const s of v) sessions.add(s);
  const files = (who.mine?.length || 0) + (who.theirs?.length || 0) + (who.unknown?.length || 0);
  const unevidenced = who.unevidenced?.length || 0;
  return {
    kind: unattributedKind(who),
    files,
    // Files whose answer rests on a row that PROVES a write, versus one that merely names the path.
    evidenced: Math.max(0, files - (who.unknown?.length || 0) - unevidenced),
    unevidenced,
    sessionsConsidered: sessions.size,
    // Row-level population, so a reader can weigh the above. treeUnknown dominating means most rows
    // could not be placed in a tree at all — see treeEvidenceNote for the prose form.
    rows: {
      treeMine: who.treeMineRows || 0,
      treeUnknown: who.treeUnknownRows || 0,
      foreign: who.foreignTreeRows || 0,
      torn: who.torn || 0,
    },
  };
}

/**
 * The population the attribution was computed over, as a sentence — '' when there is nothing to say.
 *
 * One store is shared by several checkouts and paths are stored relative to the writer's own repo,
 * so a row from another tree is indistinguishable from a local one unless it carries a tree stamp.
 * The stamp was added 2026-08-29, so most rows predate it. Counting that and not SAYING it is how a
 * claim whose evidence is 99% unplaceable comes to read like one whose evidence is complete —
 * which is the whole reason the counts exist.
 */
/**
 * A6 · what the attribution above rests on, as a sentence.
 *
 * The alarms printed FILE counts and never the size of the population those files were judged
 * against — how many sessions were in play, or how many answers rest on proof rather than on a path
 * appearing in a command. A reader could not weigh "another session touched 22 files" without
 * knowing whether that came from 2 sessions or 9, or whether any of it was evidenced.
 *
 * '' when there is nothing to say, so it never becomes furniture — the same rule treeEvidenceNote
 * follows, and the same rule the unscanned disclosure in scan-images follows.
 */
export function basisNote(basis = {}) {
  const { files = 0, evidenced = 0, unevidenced = 0, sessionsConsidered = 0 } = basis;
  if (!files) return '';
  const parts = [`${evidenced} of ${files} attributed on WRITE evidence`];
  if (unevidenced) parts.push(`${unevidenced} on a bare touch`);
  parts.push(`${sessionsConsidered} session(s) considered`);
  return `\n\nBasis: ${parts.join(' · ')}.`;
}

export function treeEvidenceNote({ treeUnknownRows = 0, foreignTreeRows = 0, treeMineRows = 0 } = {}) {
  if (!treeUnknownRows && !foreignTreeRows) return '';
  const total = treeUnknownRows + foreignTreeRows + treeMineRows;
  const pct = Math.round((treeUnknownRows / total) * 100);
  return `\n\nEvidence quality: ${treeUnknownRows} of ${total} ledger rows carry NO tree identity (${pct}%)`
    + `${foreignTreeRows ? `, and ${foreignTreeRows} were dropped as another checkout's` : ''}.`
    + ' Unstamped rows cannot be placed in a tree, so any "theirs" above may name a session from a different checkout.';
}

// ── WP1 (b) + (c) · BASIS PER PATH: declared before inferred, and the union with git ────────────
// Registry classes C9 (attribution absence) and P13 (ledger blind to write path). Every attributed
// path now says WHICH source produced the claim, in this order of authority:
//   'declared'          a live, fresh spine claim names the path (claim_files) — a session SAID so
//   'write'             a ledger row PROVES a write (payload fingerprints, a git-confirmed commit,
//                       a corroborated parser hit)
//   'commit'            only a via:'commit' row — the ledger saw the path in a commit
//   'touch'             rows exist and none proves anything
//   'unknown'           no row at all
// and, orthogonally, the GIT UNION: commits that changed the path and that NO ledger row records
// (`unrecordedCommits`). A shell write, a codemod or a git apply never reaches the ledger; once it
// is committed, git knows it changed and the ledger does not, and that gap is what P13 measures.
// The union cannot name the session — no git metadata distinguishes one — but it can say "changed
// by a commit nobody recorded", which is the honest form and the one nothing printed before.
//
// `declared` is the index from bin/lib/declared-claims.mjs; `measured:false` there means the store
// could not be read, and the summary carries that flag so "no declared claims" is never printed
// over an unread store. A STALE claim (older than the reaper's horizon) is reported but does not
// take the top basis — the documented claim-lifetime gap (b51bdb0) is exactly an unreaped claim
// outranking a live ledger row.
export function basisFor(files, { ledgerLines = [], declared = { measured: false, byPath: new Map() }, commitsFor = () => [], myTree = null } = {}) {
  const byFile = new Map();
  for (const f of files) byFile.set(f, { file: f, sessions: new Set(), writeSessions: new Set(), commitShas: new Set(), rows: 0 });
  for (const l of ledgerLines) {
    let r;
    try { r = typeof l === 'string' ? JSON.parse(l) : l; } catch { continue; }
    if (!r || !r.f || !byFile.has(r.f)) continue;
    if (myTree && treeClaim(r, myTree) === 'other') continue;
    if (r.via === 'exec') continue;
    const e = byFile.get(r.f);
    e.rows++;
    if (r.s) e.sessions.add(r.s);
    // A commit row is write EVIDENCE for the ledger's purposes, but committing is not authoring
    // (27% of via:'commit' rows name a file another session holds edit evidence for — see
    // recordCommit in bin/commit-phase.mjs), so it ranks below a payload or parser witness here.
    if (r.via === 'commit') { if (r.sha) e.commitShas.add(String(r.sha)); continue; }
    if (isWriteEvidence(r) && r.s) e.writeSessions.add(r.s);
  }
  const out = [];
  for (const [f, e] of byFile) {
    const claims = declared.byPath.get(f) || [];
    const fresh = claims.filter((c) => c.fresh);
    const commits = (commitsFor(f) || []).map(String);
    const recorded = new Set([...e.commitShas].map((s) => s.slice(0, 7)));
    const unrecorded = commits.filter((sha) => !recorded.has(sha.slice(0, 7)));
    let basis;
    if (fresh.length) basis = 'declared';
    else if (e.writeSessions.size) basis = 'write';
    else if (e.commitShas.size) basis = 'commit';
    else if (e.rows) basis = 'touch';
    else basis = 'unknown';
    out.push({
      file: f, basis,
      declaredBy: fresh.map((c) => `${c.planId}/${c.taskId}`),
      staleClaims: claims.length - fresh.length,
      sessions: [...e.sessions].sort(),
      writeSessions: [...e.writeSessions].sort(),
      unrecordedCommits: unrecorded,
    });
  }
  const counts = {};
  for (const o of out) counts[o.basis] = (counts[o.basis] || 0) + 1;
  return {
    perFile: out,
    counts,
    declaredMeasured: !!declared.measured,
    unrecordedCommitFiles: out.filter((o) => o.unrecordedCommits.length).map((o) => o.file),
  };
}

/** One line for a gate to print beside its attribution. */
export function basisLine(b) {
  if (!b) return 'basis: not computed';
  const parts = Object.entries(b.counts).sort().map(([k, v]) => `${k} ${v}`);
  const declared = b.declaredMeasured ? '' : ' · declared claims NOT READ (spine store unavailable), so "declared" is unmeasured, not absent';
  const union = b.unrecordedCommitFiles.length
    ? ` · ${b.unrecordedCommitFiles.length} file(s) changed by a commit no ledger row records (P13): ${b.unrecordedCommitFiles.slice(0, 5).join(', ')}${b.unrecordedCommitFiles.length > 5 ? ', …' : ''}`
    : '';
  return `basis: ${parts.join(' · ') || 'no files'}${declared}${union}`;
}
