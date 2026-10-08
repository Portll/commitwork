#!/usr/bin/env node
// commitwork spine gate — a session that edited the tree must have filed the work somewhere.
//
// The rationale, the control-loop argument and the decision table all live in bin/gate-spine-core.mjs.
// This file is the I/O half: read the sensors, call assess(), journal the verdict, set the exit code.
//
// exit 0  nothing to require, or satisfied, or a sensor is blind (and says so)
// exit 2  substantive edits with nothing filed  ->  Claude Code treats this as blocking
//
// SENSOR NOTES:
//   · EVERY rotation generation is read, via generations() — whatever `.jsonl.<n>` exist, never a
//     fixed window. This said "BOTH ledger files ... rotates to `.jsonl.1`" until 2026-09-02, which
//     described the hard-coded pair ledger-rotate.mjs replaced. The live store holds `.2/.3/.4` and
//     no `.1` at all, so the sentence implied this gate was blind to most of the ledger. It is not.
//     The identical stale claim in verifyLedgerChain's docstring cost a diagnosis the same day.
//   · Rows carry `p` (the writing session's CLAUDE_PID) since 2026-09-02, and it is ABSENT when
//     unknown. `s` alone is not an identity in either direction — `--resume` forks a sessionId so
//     two sessions share one, and `/clear` replaces it mid-process so one session holds two.
//   · Session ids are matched by PREFIX in either direction (touch stores 8 chars, spine the full
//     UUID); stored values are never truncated, only display.
//   · SUBSTRATE_TASKS_DB resolved at call time, as overwatch-layer's spine/db.mjs does.
//   · The task store is opened READ-ONLY.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spineStorePath } from '../lib/spine-store-path.mjs';
import { assess, render, overwatchReachability } from './gate-spine-core.mjs';
import { sameSession, shortId } from './session-id.mjs';
import { shouldEmit, silenceNote } from './hook-once.mjs';
import { journal, readJournal } from './lib/verdict-journal-core.mjs';
import { headSha } from './head-sha.mjs';
import { measuredFromArtifact } from './measured.mjs';
import * as storePaths from './lib/store-paths.mjs';
import { generations } from './lib/ledger-rotate.mjs';
import { isWriteEvidence } from './lib/touch-ledger-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'gate-spine';
// Every seam read at CALL time (house rule).
const touchLedger = () => storePaths.touchLedger();
const spineLedger = () => storePaths.spineLedger();
const tasksDb = spineStorePath;
// Deterministic clock (CW_NOW) and an env-overridable outage window, so the outage arm is testable
// on fixtures without waiting a real day. Both read at CALL time, per the house rule.
const nowMs = () => new Date(process.env.CW_NOW || Date.now()).getTime();
const outageMs = () => Number(process.env.CW_SPINE_OUTAGE_MS) || 24 * 60 * 60 * 1000;

/** tasks.db mtime: number = known, null = ENOENT (legitimately absent), undefined = UNREADABLE. */
// The three are distinct on purpose: only ENOENT is evidence, and an unreadable store must not be
// allowed to look like an absent one — that is the difference between "no store" and "cannot see",
// and only the first may contribute to an outage finding.
const tasksDbMtime = () => {
  try { return statSync(tasksDb()).mtimeMs; }
  catch (e) { return e && e.code === 'ENOENT' ? null : undefined; }
};

const minEdits = () => {
  const n = Number(process.env.CW_SPINE_MIN_EDITS);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 5;
};

// shortId/sameSession come from bin/session-id.mjs — the single source of truth, never re-copied here.

function readStdinSession() {
  try {
    const raw = readFileSync(0, 'utf8');
    return JSON.parse(raw || '{}')?.session_id || null;
  } catch { return null; }
}

/** Rows from a JSONL ledger and its rotated sibling, oldest first. `null` = could not read at all. */
// Distinct from null (absent) so the caller can tell a broken recorder from a missing one.
const CORRUPT = Symbol('ledger-corrupt');

function readLedger(path, rawSink) {
  const files = generations(path);   // every generation, oldest first — never a fixed window
  if (!files.length) return null;
  const rows = [];
  for (const f of files) {
    let raw;
    // A file that exists but cannot be read is UNKNOWN (fail closed) — only genuine absence is empty.
    try { raw = readFileSync(f, 'utf8'); } catch { return null; }
    // Raw bytes feed the record's `measured.digest`, captured here at the one read (a second read
    // would race the writers).
    if (rawSink) rawSink.push(`${f}\n${raw}`);
    // A torn trailing line is tolerated (a partial append); a file where EVERY line is unparseable
    // is CORRUPT (fails open), not an empty ledger that would read as "session filed nothing".
    let lines = 0;
    let parsed = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      lines++;
      try { rows.push(JSON.parse(line)); parsed++; } catch { /* a torn line is not a reason to fail */ }
    }
    // A genuinely empty file (no non-blank lines) is a healthy state, not caught here.
    if (lines > 0 && parsed === 0) return CORRUPT;
  }
  return rows;
}

// node:sqlite is core from node 22; imported once behind a top-level try so an older runtime
// degrades rather than taking the gate down.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* node < 22: store unreadable, reported as such */ }

/** Status for the given task ids. `null` means the store could not be read — never an empty list. */
function readTaskStatuses(ids) {
  if (!ids.length) return [];
  const path = tasksDb();
  if (!existsSync(path) || !DatabaseSync) return null;
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const q = db.prepare(`select id, status from tasks where id in (${ids.map(() => '?').join(',')})`);
    const rows = q.all(...ids);
    db.close();
    return rows;
  } catch { return null; }        // busy/locked/schema moved — UNKNOWN, never "no tasks"
}

const emit = (systemMessage, extra = {}) =>
  process.stdout.write(`${JSON.stringify({ systemMessage, ...extra })}\n`);

// ── measure ─────────────────────────────────────────────────────────────────────────────────────
const session = readStdinSession();
// Raw bytes of every ledger file read, fixed order — their digest is the record's measurement
// provenance (a run that read nothing carries ok:false + null digest, never "measured clean").
const LEDGER_RAW = [];
const touches = readLedger(touchLedger(), LEDGER_RAW);
// An absent spine ledger is a broken sensor, not an empty one — absent ⇒ grey and open;
// present-but-no-rows-for-me ⇒ a real, clearable block. (A `|| []` here makes the gate unsatisfiable.)
const spineRows = readLedger(spineLedger(), LEDGER_RAW);
const spineLedgerCorrupt = spineRows === CORRUPT;
const spineLedgerPresent = spineRows !== null && !spineLedgerCorrupt;
// CORRUPT is a truthy Symbol, so guard the array cast rather than `|| []`.
const spine = Array.isArray(spineRows) ? spineRows : [];

// Same guard for the touch ledger — CORRUPT must not reach a .filter as a Symbol.
const touchRows = Array.isArray(touches) ? touches : [];
// R-3 · SESSION IS NOT ENOUGH; THE TREE HAS TO AGREE.
// One store is shared by several checkouts, so `bin/x.mjs` written elsewhere is indistinguishable
// from `bin/x.mjs` written here on `s` alone. bin/gate-tests-core.mjs has discriminated on `r`
// since the field existed (authorOf, line 258) and this gate never did — so the fixture rows two
// test files were leaking (mine.txt, f, s.sh, new.sh, new.txt: 1,523 rows, 33% of the live ledger
// on 2026-09-02) arrived here wearing a matching `s` and were reported to sessions as their own
// edits. The leak is closed at the writer now; these rows are hash-chained and cannot be excised,
// so the reader has to stop believing them.
//
// 'other' is dropped; 'unknown' is KEPT. Rows predating `r` are unrecoverable, and treating them
// as foreign would silently shrink the count this gate's threshold depends on — the fail-open
// property is deliberate and is not mine to trade away here.
const myTree = storePaths.treeId();
const mine = touchRows.filter((r) => sameSession(session, r.s) && storePaths.treeClaim(r, myTree) !== 'other');
const editedFiles = new Set(mine.map((r) => r.f).filter(Boolean));
// R-4 (FourEyes, 2026-08-30) · STATE THE BASIS, DO NOT FILTER THE COUNT.
// `edits` keeps its exact meaning and every branch is unchanged, so this cannot regress the
// fail-open property the threshold depends on. What changes is that the reader is told what the
// number rests on.
//
// Measured the day this landed: one live session was counted at 13 edited files of which 3 carried
// write evidence — the other 10 were `fs-delta`/`undetermined` rows from a shared-tree mtime race.
// Its real count was 3, BELOW the threshold of 5, and it was blocked 26 times. Filtering was
// rejected: it would silence the gate for Bash-first sessions, whose writes the ledger is worst at
// seeing, which is an unsupported pass in the highest-risk lane.
const evidencedFiles = new Set(mine.filter(isWriteEvidence).map((r) => r.f).filter(Boolean));
const mySpine = spine.filter((r) => sameSession(session, r.s));

// readJournal returns { absent, records, torn, chain }; read `.records`, and a read failure is [].
let history = [];
try { history = readJournal(GATE)?.records ?? []; } catch { history = []; }

// Fleet-wide, deliberately: `spine` is every session's rows, not `mySpine`. Scoping this to the
// judged session would let any session earn its own exemption simply by filing nothing, which is
// the exact behaviour the gate exists to catch.
const reachable = overwatchReachability({
  spineRows: spine, dbMtimeMs: tasksDbMtime(), now: nowMs(), outageMs: outageMs(),
});

const v = assess({
  edits: editedFiles.size,
  editsEvidenced: evidencedFiles.size,
  spineRecords: mySpine,
  tasks: readTaskStatuses([...new Set(mySpine.map((r) => r.task).filter(Boolean))]),
  history,
  minEdits: minEdits(),
  // Array.isArray, not `touches !== null` — a corrupt touch ledger must not read as present-and-empty.
  ledgerPresent: Array.isArray(touches) && session !== null,
  spineLedgerPresent,
  spineLedgerCorrupt,
  overwatchReachable: reachable,
});

// ── journal FIRST, so the loop closes even on the silent paths ──────────────────────────────────
// assess()'s feedback arm reads this back. A journal failure costs evidence, never the verdict.
let journalNote = '';
try {
  const r = journal(GATE, {
    headSha: headSha(),
    // Measurement provenance: digest of the raw ledger bytes; separator is the record-separator
    // char so two files cannot concatenate into one pair's bytes.
    measured: measuredFromArtifact(`${touchLedger()}+${spineLedger()}`,
      LEDGER_RAW.length ? LEDGER_RAW.join('\x1e') : null),
    // `verdict` aliases `reason` so this gate names its outcome like every other; `block`/`reason`
    // still work for existing readers.
    verdict: v.reason,
    // Journalled as a definite boolean. assess() computes it and nothing downstream could see it,
    // so 110 grey records were classified off `block:false` alone and scored CLEAN. Records
    // written before 2026-08-29 have no `grey` at all — absent is UNKNOWN, not false.
    grey: v.grey === true,
    overwatchReachable: reachable,
    block: v.block, reason: v.reason, edits: editedFiles.size, editsEvidenced: evidencedFiles.size,
    spineRecords: mySpine.length, taskIds: v.taskIds || null,
  }, { session });
  if (r && r.ok === false) journalNote = ` (verdict journal write failed: ${r.error})`;
} catch (e) { journalNote = ` (verdict journal write failed: ${e.message})`; }

if (!v.block) {
  // Say-once: a steady line repeated every turn is the wallpaper this gate exists to escape.
  const msg = render(v, { minEdits: minEdits() });
  const seen = shouldEmit(GATE, msg);
  if (!seen.changed) process.exit(0);
  emit(`${msg}${silenceNote(seen.silenced)}${journalNote}`);
  process.exit(0);
}

// ── "filed 0" CAN BE AN ARTEFACT OF WHEN THE RECORDER STARTED ────────────────────────────────
// Hooks load at SESSION START, so a session already running when spine-ledger.mjs was wired has
// none of its earlier MCP calls recorded. The first real firing (2026-08-13) blocked a session with
// "filed 0 overwatch-layer records" that had in fact filed a plan and six tasks — factually wrong, and it
// sent the reader hunting for work they had already done. Self-healing, since the next filing IS
// recorded, but a gate that states a false zero teaches its reader to discount the true ones.
//
// The evidence is on disk: if this session's earliest TOUCH predates the spine ledger's earliest
// row of any kind, the recorder was not running for that span and the count is a floor, not a
// total. Says WHEN rather than hedging generally — an unbounded "may be incomplete" is the kind of
// caveat readers learn to skip.
const recorderNote = (() => {
  if (mySpine.length) return '';                       // it recorded something; the count is real
  const firstSpineEver = spine.reduce((min, r) => (r.at && (!min || r.at < min) ? r.at : min), null);
  const myFirstTouch = mine.reduce((min, r) => (r.at && (!min || r.at < min) ? r.at : min), null);
  if (!firstSpineEver || !myFirstTouch || myFirstTouch >= firstSpineEver) return '';
  const hhmm = (iso) => { try { return new Date(iso).toISOString().slice(11, 16); } catch { return iso; } };
  return `\n\nNOTE: this session was editing from ${hhmm(myFirstTouch)}Z, before the spine recorder's `
    + `earliest row at ${hhmm(firstSpineEver)}Z. Hooks load at session start, so anything filed `
    + 'before then is NOT VISIBLE here — 0 is the count the recorder can see, not necessarily the '
    + 'count you filed. Check with mcp__spine__list_tasks before re-filing work you may already have.';
})();

const headline = render(v, { minEdits: minEdits() });
const seen = shouldEmit(GATE, headline);
if (!seen.changed) process.exit(0);   // already said — do not re-block on the same fact
emit(`${headline}${silenceNote(seen.silenced)}${journalNote}`, {
  hookSpecificOutput: {
    hookEventName: 'Stop',
    additionalContext: `Session ${shortId(session)} edited ${editedFiles.size} file(s)`
      + (evidencedFiles.size < editedFiles.size
        ? ` — of which ${evidencedFiles.size} carry WRITE EVIDENCE and ${editedFiles.size - evidencedFiles.size} do not.\n`
          + `  A file without write evidence means the ledger saw the path but nothing proves this session wrote it.\n`
          + `  The count above is NOT filtered on that; it is stated so you can tell whether this gate is right about you.\n`
        : '')
      + ` and filed `
      + `${mySpine.length} overwatch-layer record(s).${recorderNote}\n\n`
      + `${[...editedFiles].slice(0, 12).map((f) => `  ${f}`).join('\n')}`
      + `${editedFiles.size > 12 ? `\n  … +${editedFiles.size - 12} more` : ''}\n\n`
      + 'WHY THIS BLOCKS RATHER THAN REMINDS: the advisory version of this instruction fired ~55 '
      + 'times across two sessions and was actioned zero times, while the blocking gates beside it '
      + 'were engaged with every time. The difference is the subscriber, not the wording.\n\n'
      + 'Reuse a plan rather than creating a new one where possible:\n'
      + '  mcp__spine__list_plans  →  mcp__spine__create_task { planId, goal }\n\n'
      + 'If this session genuinely has nothing to track (a read-only investigation, a doc typo), '
      + `raise the threshold for it: CW_SPINE_MIN_EDITS=${editedFiles.size + 1}.`,
  },
});
process.exit(2);
