#!/usr/bin/env node
// commitwork gate ratchet — fail on NEW debt, never on inherited debt.
//
// WHY A RATCHET AND NOT A GATE. The three checks this repository added
// (`npm test`, `bin/reconcile-findings.mjs`, `bin/anchor-staleness.mjs`) were specified as commands
// a human runs — which is the "exit code with no subscriber" pattern this codebase indicts four
// separate times: cra-watch.plist:25, run-ci.sh:74's universal `|| true`, the uninstalled deadman,
// and `deploy --verify`. Adding three more unsubscribed exit codes was a fifth instance.
//
// But two of the three are RED and stay red until someone reads 95 backlog entries and re-reads 27
// findings. A hook that blocks on inherited debt gets bypassed within a day, and a bypass everyone
// uses is worse than no hook — the same alarm-fatigue death monitor/liveness.mjs names in its own
// comments, and the reason R10 made the deadman survivable BEFORE it could be installed.
//
// So: a stored baseline, and a refusal only when a number goes UP. Existing debt is reported as an
// advisory. Nobody has an excuse to bypass a gate that only fires on what they just added.
//
// EXIT CODES are the hook contract, not a convention:
//   0  nothing got worse            (advisory text on stdout, still shown)
//   2  something got worse          -> Claude Code treats this as a blocking error / rewake
//
// usage:
//   node bin/gate-ratchet.mjs             compare against the baseline, then update it
//   node bin/gate-ratchet.mjs --baseline  (re)write the baseline from current state, exit 0
//   node bin/gate-ratchet.mjs --show      print current vs baseline, change nothing
//
// The baseline lives in .claude/, which is gitignored here — it is per-machine state about a
// per-machine working tree, not a fact about the repository, and committing it would make every
// clone inherit one machine's debt as its floor.
import { readFileSync, writeFileSync, mkdirSync, renameSync, readSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldEmit, forget, silenceNote } from './hook-once.mjs';
import { journal, readJournal } from './lib/verdict-journal-core.mjs';
import { headSha } from './head-sha.mjs';
import { measuredRun, measuredFromArtifact } from './measured.mjs';
import { gateBaseline, touchLedger, treeId } from './lib/store-paths.mjs';
import { auditDirFor } from '../monitor/store-paths.mjs';
import { generations } from './lib/ledger-rotate.mjs';
import { attributeFiles, attributionBasis, basisFor, basisLine } from './gate-tests-core.mjs';
import { readDeclaredClaims, declaredIndex } from './lib/declared-claims.mjs';
import { standingSince, attributionClaim, worseHeadline, advice, emptyAttribution} from './gate-ratchet-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
// Read at CALL time, never at module load (house rule) — a const would silently defeat the
// override for any test or harness that sets it after import.
// An ENOENT baseline re-arms the floor at the CURRENT value — after 981 `worse` verdicts that is
// a laundering path wearing first-run clothes. Keep this pointed where the writer writes.
const baselinePath = () => gateBaseline();
// ONE key for both keyspaces (say-once suppression AND the verdict journal) — two literals
// drifting apart would fragment the record across names, a journal that reads as sparse for a
// gate that ran every turn.
const GATE = 'gate-ratchet';
// Writer identity: Claude Code hands a Stop hook its session_id on stdin, and without it on the
// record the attribution-accuracy metric cannot be computed (a record about "someone" cannot be
// scored right or wrong). One readSync — the pipe is closed-on-write by the caller; an empty or
// failed read degrades to null, an honest absence, never a fabricated identity. Same mechanics
// as gate-tests.mjs.
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
// fact: a journal failure must cost EVIDENCE, never a verdict — but it must be said / on speaking turns the suffix rides the systemMessage, on suppressed turns the caller emits a distinct minimal failure-only line so say-once is not defeated (expiry: never, prev: broken)
// fact: `headSha` is stamped HERE rather than by each caller, so no exit path can omit it / this gate's first 377 records are permanently un-re-derivable because nothing central owned the question (expiry: never, prev: missing)
// fact: it is resolved PER RECORD, never once at module load / this gate runs as a Stop hook and the tree can be committed between two runs of the same process (expiry: never, prev: wrong)
const record = (rec) => {
  const r = journal(GATE, { headSha: headSha(), measured: anchorMeasured(), ...rec }, { session: MY_SESSION });
  return r.ok ? '' : ` (verdict journal write failed: ${r.error} — decisions are not being recorded)`;
};

const run = (args) => {
  try {
    return { out: execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
  } catch (e) {
    // A nonzero exit is the NORMAL state for these two — they are gates. Their stdout is still the
    // measurement, so it must not be discarded with the error.
    return { out: String(e.stdout || ''), code: typeof e.status === 'number' ? e.status : 1, err: String(e.stderr || '') };
  }
};

// The anchor-staleness report, read ONCE per process and shared by every consumer. Memoised lazily,
// never at module load: the env override below must be readable by a test or harness that sets it
// after import (house rule), and `measure()` runs before the baseline is even opened.
//
// Null on ANY failure — spawn error, unparseable bytes, a document without `results`. Null is the
// unknown value throughout this file and is never coerced to an empty set or a zero; an
// anchor tool that broke must not read as "nothing drifted", which is the C1 class this gate exists
// to refuse.
let ANCHOR_REPORT;   // undefined = not yet read; null = read and unusable
let ANCHOR_MEASURED; // undefined = no read attempted; null = attempted and unrecordable
function anchorReport() {
  if (ANCHOR_REPORT !== undefined) return ANCHOR_REPORT;
  // fact: CW_ANCHOR_STALENESS_JSON (read at call time, same fixture idiom as CW_GATE_TESTS_CMD) covers BOTH consumers / it reached driftedSet() only, so a canary could plant WHO owns the drift but not THAT there was any, and the claim scenarios skipped on a clean tree (expiry: never, prev: broken)
  // fact: the MEASUREMENT ACT is journalled, not just its result / 339 consecutive `steady` records over three days carried byte-identical metrics and none said whether the scanner had run — a live gate on a static world and a gate returning a cache produce the same journal (expiry: never, prev: missing)
  // fact: `digest` is of the scanner's RAW output BEFORE parsing / only that distinguishes a source that moved while the reading held still from one that never moved (expiry: never, prev: not built)
  const override = process.env.CW_ANCHOR_STALENESS_JSON;
  let raw = null;
  try {
    if (override) {
      raw = readFileSync(override, 'utf8');
      // `artifact:` is not decoration. A reading pinned to a fixture is EXACTLY the state a stuck
      // gate is in, so the canary that plants one asserts on this prefix.
      ANCHOR_MEASURED = measuredFromArtifact(override, raw);
    } else {
      const m = measuredRun('anchor-staleness.mjs --json', [join(REPO, 'bin', 'anchor-staleness.mjs'), '--json'], { cwd: REPO, timeout: 120_000, okExit: [0, 1] });
      raw = m.out;
      ANCHOR_MEASURED = m.measured;
    }
    const doc = JSON.parse(raw);
    ANCHOR_REPORT = doc && typeof doc === 'object' ? doc : null;
  } catch {
    ANCHOR_REPORT = null;
    // A measurement that was ATTEMPTED and failed is evidence, and strictly more than the silence
    // this replaced. Only a run that never happened leaves `measured` null.
    if (ANCHOR_MEASURED === undefined) ANCHOR_MEASURED = null;
  }
  return ANCHOR_REPORT;
}

/** The `measured` block for the anchor read, or null when no read was attempted. */
export function anchorMeasured() { return ANCHOR_MEASURED === undefined ? null : ANCHOR_MEASURED; }

// ── measure ─────────────────────────────────────────────────────────────────────────────────────
// Parsed from each tool's own output rather than re-derived here. If a tool changes its wording this
// returns null for that metric, and null is treated as UNKNOWN — never as zero. A ratchet that reads
// a parse failure as "0 problems" would report improvement every time it broke.
function measure() {
  const m = {};
  // READ THE ARTIFACT, NOT THE PROSE. These two came off stdout with a regex until 2026-08-03, when
  // reconcile-findings stopped emitting "N anchor(s) whose co-located defects disagree" — it learned
  // to tell a real severity conflict from two DISTINCT defects that merely share a line, so the old
  // sentence had no referent any more and its replacement reads "within-entry unresolved conflicts
  // ...... 0". The regex matched nothing, the metric went UNKNOWN, and the conflicts ratchet stopped
  // watching anything at the exact moment the number it watches reached zero.
  //
  // The fail-closed rule below is right and is kept: a metric that cannot be read is UNKNOWN, never
  // 0. What was wrong is the COUPLING — reconcile already writes every one of these numbers into
  // queue.json, so grepping its console output made a gate depend on another tool's phrasing. Same
  // defect class the panel had, reading CodeQL totals out of a progress log while the structured
  // artifact sat unread beside it.
  const rec = run([join(REPO, 'bin', 'reconcile-findings.mjs')]);
  let q = null;
  // fix: read CW_RATCHET_QUEUE_PATH (same knob as ratchet-corroborate.mjs) - path was welded to one dated audit.
  const queuePath = process.env.CW_RATCHET_QUEUE_PATH || join(auditDirFor(REPO), 'queue.json');
  try { q = JSON.parse(readFileSync(resolve(REPO, queuePath), 'utf8')); } catch { q = null; }
  const c = q && q.conflicts;
  // Each is an ARRAY of offending records; its length is the count. A key that is absent or not an
  // array means the schema moved under us — null, so the gate says UNKNOWN rather than inventing 0.
  const count = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : null);
  m.conflicts = c ? count(c.withinEntryConflicts) : null;
  m.unreviewed = c ? count(c.unreviewedEntries) : null;
  // reconcile still has to RUN for the artifact to be current; a crash leaves both unknown.
  if (rec.code !== 0 && rec.code !== 1) { m.conflicts = null; m.unreviewed = null; }

  // ...AND SO DOES THIS ONE, NOW. `drifted` was the surviving half of the same defect: it regexed
  // /(\d+) OPEN entr(y|ies) no longer match/ out of anchor-staleness's prose while the structured
  // document sat unread — and `driftedSet()` below already parsed that document, in this same file,
  // 120 lines down. Two parsers over one tool, one of them keyed to a sentence.
  //
  // fact: that regex was fail-closed only by COINCIDENCE — the fallback read `anc.code === 0 ? 0 : null` and anchor-staleness sets exitCode 1 iff driftedOpen.length, so drift and non-zero exit happened to agree / bin/anchor-staleness.mjs honours `--no-gate`, and the day anyone adds it here exit 0 with drift > 0 reads as a genuine ZERO (expiry: never, prev: broken)
  // fact: reading the COUNT structurally removes that coincidence / a safety borrowed from an accident expires without notice — armed, not sprung (expiry: never, prev: broken)
  //
  // One invocation now serves both readers (the tool re-walks every open finding against a git ref;
  // running it twice per firing inside a 300s hook timeout was pure duplicate cost).
  const anc = anchorReport();
  // `driftedOpen` is a number the producer computed. Absent, non-numeric, or an unreadable report
  // ⇒ null ⇒ UNKNOWN. Never 0: that is the whole rule this function exists to keep.
  m.drifted = typeof anc?.driftedOpen === 'number' ? anc.driftedOpen : null;
  return m;
}

const METRICS = [
  ['conflicts', 'severity conflicts'],
  ['unreviewed', 'entries with no second reader'],
  ['drifted', 'open findings whose anchor drifted'],
];

// Split ENOENT (genuine first run → null) from corrupt (→ {_error:true}) — the same shape as
// gate-tests. The old catch collapsed both to null, and null means ARM: a corrupt baseline was
// silently replaced by a fresh floor, laundering whatever the corruption hid — corrupt read as
// absent, taxonomy C11, found by the canary harness's R-CORRUPT scenario before it first ran.
const readBaseline = () => {
  try { return JSON.parse(readFileSync(baselinePath(), 'utf8')); }
  catch (e) { return e && e.code === 'ENOENT' ? null : { _error: true, message: e?.message || 'unreadable' }; }
};
function writeBaseline(m) {
  const p = baselinePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ ...m, at: new Date().toISOString() }, null, 2)}\n`);
  renameSync(tmp, p);   // atomic, per the house rule
}

// Hook output. `systemMessage` surfaces in the UI; the exit code is what actually gates.
const emit = (systemMessage, extra = {}) =>
  process.stdout.write(`${JSON.stringify({ systemMessage, suppressOutput: false, ...extra })}\n`);

const argv = process.argv.slice(2);
const now = measure();

if (argv.includes('--baseline')) {
  writeBaseline(now);
  // Clear the say-once fingerprint too. Accepting a baseline is precisely the moment the operator
  // wants to hear the gate confirm the new floor; leaving the old fingerprint in place would keep
  // it mute through the one turn where its answer has changed and matters.
  forget(GATE, 'baseline-accepted');
  const headline = `gate baseline set — ${METRICS.map(([k, l]) => `${now[k] ?? '?'} ${l}`).join(' · ')}`;
  const jn = record({ verdict: 'baseline-set', exit: 0, metrics: now, headline });
  emit(`${headline}${jn}`);
  process.exit(0);
}

const base = readBaseline();
// CORRUPT BASELINE: say so, touch nothing, exit without banking a new floor. Only --baseline (an
// explicit operator act) may overwrite a corrupt file. Mirrors gate-tests' baseline-unreadable.
if (base && base._error) {
  const headline = `commitwork gate: baseline file is corrupt or unreadable (${base.message}). It remains untouched — a corrupt floor is never replaced by a silent re-arm. Fix it, or rewrite it deliberately with \`node bin/gate-ratchet.mjs --baseline\`.`;
  const jn = record({ verdict: 'baseline-unreadable', exit: 0, message: base.message, headline });
  emit(`${headline}${jn}`);
  process.exit(0);   // speak, do not rewake on a corrupted baseline; a human decides
}
if (!base) {
  // FIRST RUN IS NEVER A FAILURE. With no baseline there is no "worse" to detect, and refusing here
  // would make the very first turn after installing the hook look like a regression.
  writeBaseline(now);
  const headline = `gate ratchet armed (first run) — baseline: ${METRICS.map(([k, l]) => `${now[k] ?? '?'} ${l}`).join(' · ')}. Future turns fail only if one of these INCREASES.`;
  const jn = record({ verdict: 'armed', exit: 0, metrics: now, headline });
  emit(`${headline}${jn}`);
  process.exit(0);
}

const worse = [];
const better = [];
const unknown = [];
for (const [k, label] of METRICS) {
  const b = base[k]; const n = now[k];
  if (n === null || n === undefined) { unknown.push(label); continue; }
  if (b === null || b === undefined) continue;
  if (n > b) worse.push(`${label}: ${b} → ${n} (+${n - b})`);
  else if (n < b) better.push(`${label}: ${b} → ${n}`);
}

if (argv.includes('--show')) {
  process.stdout.write(`baseline ${base.at}\n`);
  for (const [k, label] of METRICS) process.stdout.write(`  ${String(base[k] ?? '?').padStart(4)} → ${String(now[k] ?? '?').padStart(4)}  ${label}\n`);
  process.exit(0);
}

// ── WHO ADDED IT ────────────────────────────────────────────────────────────────────────────────
// Added after this hook's FIRST real firing, which reported "+1 drifted" and took three tool
// invocations to attribute — to a concurrent session, not to the turn being gated.
//
// This repository has more than one writer. A ratchet that says "debt went up" without saying whose
// is an alarm whose first action is always a manual investigation, and an alarm with a chore
// attached is one people learn to dismiss. So the message names the commits that touched a
// currently-drifted file since the baseline was taken, and who authored them.
//
// It reports rather than decides: attribution by file-overlap is a strong hint, not proof, and
// silently forgiving an increase because it *looked* like someone else's would be the same
// credulity this codebase keeps refusing elsewhere.
// Which UNCOMMITTED files carry a drifted anchor. The commit scan above answers "who changed it in
// history"; on a tree with a concurrent writer the answer is often "nobody yet" — the edit is still
// in the working copy. Naming it turns "look around" into "look here".
function dirtyDrifted(drifted) {
  let porcelain = '';
  try { porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', timeout: 15_000 }); }
  catch { return ''; }
  const dirty = porcelain.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  const hits = dirty.filter((f) => drifted.has(f));
  return hits.length
    ? ` Uncommitted files that carry a drifted anchor: ${hits.join(', ')}.`
    : ' No uncommitted file carries a drifted anchor either — re-run the tools; a metric may have moved for another reason.';
}

// Files currently carrying a drifted OPEN anchor, from the structured artifact. Null on any read
// failure — unreadable is never an empty set, or a broken anchor tool would read as "nothing
// drifted" (the C1 class this gate exists to refuse).
function driftedSet() {
  // Shares the one report `measure()` already read — the ledger seam says WHO touched a file, this
  // says which files carry drifted anchors, and only with both can a canary state a world whose
  // correct claim is known before the gate runs.
  const anc = anchorReport();
  if (!anc || !Array.isArray(anc.results)) return null;   // unreadable is never an empty set
  const drifted = new Set();
  for (const r of anc.results) {
    // 'open' and 'moved' are both live (see reconcile-findings' moved ledger); a moved finding is
    // checked at its destination, not excused.
    if ((r?.disposition === 'open' || r?.disposition === 'moved') && ['anchor-changed', 'anchor-gone', 'file-deleted'].includes(r.state) && r.file) drifted.add(r.file);
  }
  return drifted;
}

// The SCOREABLE half of attribution: dirty files carrying a drifted anchor, split mine/theirs/
// unknown through the touch ledger (same unit-tested core as gate-tests). This is what lands on
// the journal record; the commit-scan prose below stays a reading aid. Degrades to unknown —
// never to a guess — when the ledger, the session id, or git itself is unavailable.
function whoTouched(drifted) {
  // A5 · each empty return says WHICH empty it is. They were one shared object, so a git outage was
  // byte-identical to a clean tree — see emptyAttribution() in the core for why that matters.
  if (!drifted || !drifted.size) return emptyAttribution('no-drift');
  let porcelain = '';
  try { porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', timeout: 15_000 }); }
  catch { return emptyAttribution('git-unavailable', drifted); }
  const dirtyHits = porcelain.split('\n').map((l) => l.slice(3).trim()).filter(Boolean).filter((f) => drifted.has(f));
  if (!dirtyHits.length) return emptyAttribution('no-dirty-match');
  // Both halves: touch-ledger.mjs rotates to `.1` at 2MB, and a reader that opens only the live
  // file loses every touch older than the last rotation — attribution would silently empty itself
  // on a timer. Oldest first so the newest touch per (file, session) still wins.
  // CW_TOUCH_LEDGER read at CALL time (house rule), so a fixture can supply a ledger whose truth is
  // known by construction — the seam the claim-accuracy measurement needs and did not have.
  const readLedger = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return null; } };
  const ledgerFile = touchLedger();
  // Every generation, oldest first — see bin/lib/ledger-rotate.mjs.
  const rotated = generations(ledgerFile).filter((f) => f !== ledgerFile).flatMap((f) => readLedger(f) ?? []);
  const currentLines = readLedger(ledgerFile);
  if (currentLines === null && !rotated.length) return { ...none, unknown: dirtyHits };
  const lines = [...rotated, ...(currentLines ?? [])];
  const who = attributeFiles(dirtyHits, MY_SESSION, {
    // Same store, same shared checkouts — this gate misattributes on a foreign row exactly as
    // gate-tests would.
    myTree: treeId(),
    ledgerLines: lines,
    committedAt: (f) => {
      try { return execFileSync('git', ['log', '-1', '--format=%cI', '--', f], { cwd: REPO, encoding: 'utf8', timeout: 15_000 }).trim(); }
      catch { return ''; }
    },
  });
  // `shared` and `undetermined` are carried onto the record, not dropped. A field the core computes
  // and no caller reads is an exit code with no subscriber, and these two are the ones that change
  // what an operator should DO: shared means your hunks and theirs are in one file, undetermined
  // means the dirt is real but git cannot say whose. Both are subsets (shared ⊆ theirs,
  // undetermined ⊆ unknown), so nothing here double-counts.
  // R-4 (FourEyes, 2026-08-30) · `unevidenced` and the tree-row counts were dropped here too, one
  // line under the comment forbidding exactly that. All four independent walkers found it. The
  // consequence was not cosmetic: `attributionClaim` -> `ownsIt('mine')` -> ACCEPT_INSTRUCTION
  // ("accept it with --baseline") was reachable from a file set where NOTHING proved this session
  // wrote any of it — the laundering path R-C was written to close, still open in the second of its
  // two consumers. The same "one consumer verified, the result generalised to all of them" error
  // this subsystem has now made twice.
  // WP1 (b) + (c): WHICH SOURCE each file's claim rests on — a spine claim first, then ledger
  // evidence — and the union with git: commits that changed a dirty-drifted file and that no ledger
  // row recorded (P13). Both are measured here, at the one place the gate already holds the ledger,
  // and carried onto the record beside the buckets above.
  let basisDetail = null;
  try {
    basisDetail = basisFor(dirtyHits, {
      ledgerLines: lines, myTree: treeId(),
      declared: declaredIndex(readDeclaredClaims()),
      commitsFor: (f) => {
        try { return execFileSync('git', ['log', '-5', '--format=%H', '--', f], { cwd: REPO, encoding: 'utf8', timeout: 15_000 }).split('\n').filter(Boolean); }
        catch { return []; }
      },
    });
  } catch { basisDetail = null; }   // the buckets above stand; the basis line says "not computed"
  return {
    mine: who.mine, theirs: who.theirs, unknown: who.unknown, others: [...who.others],
    shared: who.shared, undetermined: who.undetermined, torn: who.torn,
    unevidenced: who.unevidenced || [],
    treeMineRows: who.treeMineRows || 0,
    treeUnknownRows: who.treeUnknownRows || 0,
    foreignTreeRows: who.foreignTreeRows || 0,
    liveSessions: who.liveSessions || {},
    basisDetail,
  };
}

function attribute(baseAt, drifted) {
  if (!baseAt || !drifted) return '';
  let log = '';
  try {
    log = execFileSync('git', ['log', `--since=${baseAt}`, '--format=%h\t%an\t%s', '--name-only'],
      { cwd: REPO, encoding: 'utf8', timeout: 15_000 });
  } catch { return ''; }

  const hits = [];
  for (const block of log.split(/\n(?=[0-9a-f]{7,}\t)/)) {
    const [head, ...files] = block.split('\n');
    const [sha, author, ...subj] = head.split('\t');
    if (!sha) continue;
    const touched = files.map((f) => f.trim()).filter((f) => f && drifted.has(f));
    if (touched.length) hits.push(`${sha} (${author}) touched ${touched.join(', ')} — ${subj.join(' ').slice(0, 60)}`);
  }
  // A commit by another author touching a currently-drifted file is the STRONGEST reason not to
  // accept, not a reason to. This sentence used to read "If none of these are yours, this increase
  // came from a concurrent session and accepting the baseline is the right move" — the gate
  // instructing the launder in so many words, on the evidence that most clearly says the debt
  // belongs to someone still working on it.
  return hits.length
    ? `\n\nCommits since the baseline that touched a currently-drifted file:\n${hits.map((h) => `  - ${h}`).join('\n')}\n\nIf none of these are yours, the increase came from a concurrent session — which means accepting the baseline would bank THEIR debt as your floor. Leave it; they are still working on it.`
    : `\n\nNo COMMIT since the baseline touched a currently-drifted file, so the change is uncommitted.${dirtyDrifted(drifted)}`;
}

if (worse.length) {
  // Do NOT move the baseline on a regression — that would launder the new debt into the floor and
  // the next turn would report clean. The baseline only ever advances on an improvement.
  //
  // SAY IT ONCE. This block re-fires at the end of every turn, so an unchanged regression repeated
  // itself verbatim for twenty-plus consecutive turns (measured 2026-08-07/08 on `56 → 61 anchors
  // drifted`, a condition that predated the session's first edit). Suppressing the REPEAT is not
  // suppressing the finding: the gate still runs, still measures, and speaks the instant the
  // numbers move. What it no longer does is bury the turn it finally has something new to say.
  //
  // ATTRIBUTE BEFORE ACCUSING. The headline used to open "this turn ADDED debt" on every worse
  // reading — a turn-scoped claim from a baseline-scoped comparison, scored correct 0/12 by
  // retrospective adjudication. The claim is now derived (standing / mine / theirs / mixed /
  // unknown) and journaled as its own field, so the attribution-accuracy metric has an explicit
  // statement to score instead of a wording to infer.
  const drifted = driftedSet();
  const who = whoTouched(drifted);
  const since = standingSince((() => { try { return readJournal(GATE).records; } catch { return []; } })(), now, base, METRICS.map(([k]) => k));
  const claim = attributionClaim(who, since);
  const attribution = {
    claim,
    mine: who.mine.slice(0, 50), theirs: who.theirs.slice(0, 50), unknown: who.unknown.slice(0, 50),
    others: who.others.slice(0, 20),
    // Journaled so the attribution-accuracy metric can be scored against what was actually known.
    // `shared` is the case the old shape could not express at all — it reported a co-owned file as
    // exclusively mine — and `undetermined` separates "the dirt is real but unattributable" from
    // "no ledger entry", which used to be one bucket under the second name.
    ...(who.emptyReason ? { emptyReason: who.emptyReason } : {}),
    shared: (who.shared || []).slice(0, 50),
    unevidenced: (who.unevidenced || []).slice(0, 50),
    basis: {
      ...attributionBasis(who),
      // Per-basis counts and the git union, so the accuracy metric can split by what each claim
      // rested on — declared, write, commit, touch, unknown — rather than by who it named.
      ...(who.basisDetail ? {
        byBasis: who.basisDetail.counts,
        declaredMeasured: who.basisDetail.declaredMeasured,
        unrecordedCommitFiles: who.basisDetail.unrecordedCommitFiles.slice(0, 50),
        perFile: who.basisDetail.perFile.slice(0, 50).map((p) => ({ file: p.file, basis: p.basis, declaredBy: p.declaredBy, unrecordedCommits: p.unrecordedCommits.map((s) => s.slice(0, 7)) })),
      } : { byBasis: null }),
    },
    undetermined: (who.undetermined || []).slice(0, 50),
    ...(who.torn ? { ledgerTorn: who.torn } : {}),
    ...(since ? { standingSince: since } : {}),
  };
  const headline = worseHeadline(claim, worse, { since, theirs: who.theirs, emptyReason: who.emptyReason || null });
  const seen = shouldEmit(GATE, headline);
  const rec = { verdict: 'worse', metrics: now, baseline: base, worse, attribution, ...(unknown.length ? { unknownMetrics: unknown } : {}), headline };
  if (!seen.changed) {
    // Suppressed is still a DECISION — journal it, or the journal inherits the false-clean
    // channel it exists to close. The one thing that may speak on a suppressed turn is a journal
    // FAILURE (distinct text, so say-once is not defeated).
    const jn = record({ ...rec, exit: 0, suppressed: true, silenced: seen.silenced });
    if (jn) emit(`commitwork gate-ratchet${jn}`);
    process.exit(0);   // already said, unchanged since — stay quiet, do not re-block
  }
  const jn = record({ ...rec, exit: 2, suppressed: false, silenced: seen.silenced });
  // fix: when the drift metric is the one that worsened, say how many QUESTIONS the drift is, not
  // just how many findings. A rise from 60 to 74 reads as 14 separate judgements; the commits that
  // rewrote those lines usually rewrote several at once, so the real cost is the verdict count.
  // Only runs when `drifted` actually worsened (~5s), and only reports what it measured: a failed
  // or timed-out run says so rather than resolving to silence, which would read as "no grouping".
  let triageLine = '';
  if (worse.some((w) => /anchor drifted/.test(w))) {
    try {
      const t = execFileSync('node', [join(REPO, 'bin', 'anchor-triage.mjs'), '--summary'],
        { cwd: REPO, encoding: 'utf8', timeout: 60_000 }).trim();
      if (t) triageLine = `\n\nGrouped by the commits that rewrote them (\`node bin/anchor-triage.mjs\`):\n  ${t}`;
    } catch (e) {
      triageLine = `\n\nGrouping UNAVAILABLE this run (\`node bin/anchor-triage.mjs --summary\` ${e.killed ? 'timed out' : `exited ${e.status ?? '?'}`}) — the drift count above stands, ungrouped.`;
    }
  }
  const opening = claim === 'standing'
    ? `The commitwork ratchet is above its baseline on a STANDING condition (since ${since}) — the numbers did not move this turn:`
    : claim === 'mine'
      ? 'The commitwork ratchet detected NEW debt introduced during this turn:'
      : `The commitwork ratchet detected debt above baseline (attribution: ${claim}):`;
  emit(`${headline}${silenceNote(seen.silenced)}${jn}`,
    // The advice tail comes from gate-ratchet-core's `advice()`, which states the co-author guard
    // UNCONDITIONALLY and unlocks the accept-instruction only on positive ownership (mine/standing).
    // This block previously did the reverse — accept-instruction unconditional, guard behind
    // `claim === 'theirs' ? … : ''` — so the three branches concurrency actually produces
    // (`unknown`, `mixed`, `standing`) told an agent to bank a floor it had no evidence it owned.
    { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `${opening}\n${worse.map((w) => `  - ${w}`).join('\n')}${triageLine}\n\nInvestigate with \`node bin/anchor-staleness.mjs\` and \`node bin/reconcile-findings.mjs\`.${attribute(base.at, drifted)}\n\nAttribution ${basisLine(who.basisDetail)}\n\n${advice(claim)}` } });
  process.exit(2);
}

if (better.length) writeBaseline(now);   // ratchet tightens, never loosens
const parts = [];
if (better.length) parts.push(`improved — ${better.join('; ')}`);
if (unknown.length) parts.push(`UNKNOWN (tool output changed shape): ${unknown.join(', ')}`);
if (!parts.length) parts.push(`steady — ${METRICS.map(([k, l]) => `${now[k] ?? '?'} ${l}`).join(' · ')}`);
const ok = `commitwork gate: ${parts.join(' · ')}`;
// The verdict string is honest about measurement, not just direction: a run where nothing could
// be read must never journal as `steady` — that is unsupported finding at the verdict level. So
// unknown-with-no-movement is its own verdict, `degraded` (C8).
const verdict = better.length ? 'improved' : unknown.length ? 'degraded' : 'steady';
const okRec = { verdict, metrics: now, baseline: base, ...(better.length ? { better } : {}), ...(unknown.length ? { unknownMetrics: unknown } : {}), headline: ok };
// The clean path repeats hardest — `steady — N anchors drifted` is identical every turn by
// construction — so it gets the same treatment. An unchanged all-clear is the least informative
// line a gate can print.
const seenOk = shouldEmit(GATE, ok);
if (!seenOk.changed) {
  const jn = record({ ...okRec, exit: 0, suppressed: true, silenced: seenOk.silenced });
  if (jn) emit(`commitwork gate-ratchet${jn}`);
  process.exit(0);
}
const jn = record({ ...okRec, exit: 0, suppressed: false, silenced: seenOk.silenced });
emit(`${ok}${silenceNote(seenOk.silenced)}${jn}`);
process.exit(0);
