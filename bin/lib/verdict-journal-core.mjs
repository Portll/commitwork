// commitwork — verdict journal: durable per-run record of what each gate decided, suppressed
// turns included. appendRecord never throws; reads fail closed (only ENOENT is absence).
//
// Env, read at call time (a const at import defeats test overrides):
//   CW_VERDICT_DIR        journal directory (default .claude/verdicts)
//   CW_VERDICT_MAX_BYTES  rotation threshold (default 2MB)
//   CW_NOW                pins `at` for deterministic tests
//
import { nowISO } from '../../lib/clock.mjs';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identityFor } from '../../monitor/detail-schema.mjs';
// One mutex for the tree: use monitor/lockfile.mjs, never hand-roll another.
import { acquireLock } from '../../monitor/lockfile.mjs';
import { gateBaseline, testsBaseline } from './store-paths.mjs';
import { verifyLedgerChain } from './touch-chain.mjs';
import { archiveGenerations, shiftArchives } from './ledger-rotate.mjs';
import { readTailLine } from './touch-chain.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const dirFor = () => process.env.CW_VERDICT_DIR || join(REPO, '.claude', 'verdicts');
/** The journal directory, for readers that must name the input they read (bin/digest.mjs). */
export { dirFor as verdictDir };
const maxBytesFor = () => Number(process.env.CW_VERDICT_MAX_BYTES) || 2_000_000;

// ── TAMPER EVIDENCE ─────────────────────────────────────────────────────────────────────────────
// Each record's `prev` hashes the previous line ('genesis' fresh file, 'rotation:<hash>' across a
// rotation). The chain catches interior edits; tail truncation is journalHealth's
// baseline-moved cross-check. CW_VERDICT_PIN=1 disables rotation entirely.
const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/** Rotated generations, `.1` first (newest); higher index is older. Enumerated from disk so a gap
 *  does not silently truncate the history. */
// Rotation lives in lib/ledger-rotate.mjs — the touch and spine ledgers rotated with a bare rename
// that destroyed a generation while this file did it correctly, privately. One implementation now.
// Re-exported because consumers already import archiveGenerations from here.
export { archiveGenerations };

// Sized for a short critical section: ~2s max wait; a lock a minute old is a corpse.
const LEDGER_LOCK_ATTEMPTS = 400;
const LEDGER_LOCK_SPIN_MS = 5;
const LEDGER_LOCK_STALE_MS = 60_000;

export function appendRecord(filePath, envelope, { maxBytes } = {}) {
  // Tail read + append must be one locked operation: two unlocked writers name the same `prev`,
  // and a benign race reads downstream as tampering.
  // Fail closed: lock busy → error, never an unlocked append. A genuine fs failure from
  // acquireLock is returned as its code — "ledger busy" is reserved for real contention.
  let lock;
  try {
    lock = acquireLock(`${filePath}.lock`, {
      label: 'verdict-journal append',
      attempts: LEDGER_LOCK_ATTEMPTS,
      spinMs: LEDGER_LOCK_SPIN_MS,
      staleMs: LEDGER_LOCK_STALE_MS,
    });
  } catch (e) {
    return { ok: false, error: e.code || String(e.message || e) };
  }
  if (!lock.ok) {
    return { ok: false, error: `ledger busy: ${filePath}.lock held for ${lock.heldFor === null ? 'an unreadable time' : `${Math.round(lock.heldFor)}ms`} by ${lock.holder?.label || 'an unknown writer'} (pid ${lock.holder?.pid ?? '?'})` };
  }
  try {
    return appendLocked(filePath, envelope, { maxBytes });
  } finally {
    lock.release();
  }
}

/** The critical section. Only ever reached with the ledger lock held — see appendRecord. */
function appendLocked(filePath, envelope, { maxBytes } = {}) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const max = maxBytes ?? maxBytesFor();
    const pinned = process.env.CW_VERDICT_PIN === '1';
    let rotatedTail = null;
    try {
      if (!pinned && statSync(filePath).size > max) {
        try { rotatedTail = readTailLine(filePath); } catch { rotatedTail = null; }
        // Rotation archives, never overwrites: shift older generations down before live takes `.1`.
        shiftArchives(filePath);
        renameSync(filePath, `${filePath}.1`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // absent file, or a racer rotated first — both fine
    }
    let prev = rotatedTail ? `rotation:${lineHash(rotatedTail)}` : 'genesis';
    // Tail only: the anchor store below never rotates, so a whole-file read here grows with it.
    const tail = readTailLine(filePath);
    if (tail) prev = lineHash(tail);
    const line = `${JSON.stringify({ ...envelope, prev })}\n`;
    appendFileSync(filePath, line);
    // Primary write lands first, so an archive failure can never cost the record itself.
    const archived = archiveJudgement(filePath, envelope, prev);
    return archived.skipped
      ? { ok: true, path: filePath }
      : { ok: true, path: filePath, archive: archived.path, ...(archived.error ? { archiveError: archived.error } : {}) };
  } catch (e) {
    return { ok: false, error: e.code || String(e.message || e) };
  }
}

// ── IMMEDIATE ARCHIVE OF JUDGEMENTS ─────────────────────────────────────────────────────────────
// Ground-truth judgements are copied to an append-only, month-segmented archive at bank time;
// nothing ever rotates, renames or truncates it. Gate verdicts are excluded — regenerated every
// run, and archiving them would bury the irreplaceable records.
// 'adjudication-abstention' is a rater declining: durable, but never in an agreement denominator.
export const JUDGEMENT_KINDS = Object.freeze([
  'adjudication', 'adjudication-retraction', 'adjudication-abstention', 'finding-adjudication',
]);

/** `<verdict dir>/judgements/<YYYY-MM>.jsonl` — segmented by month so no single file grows without
 *  bound, and never rotated, so no segment is ever the one that gets overwritten. */
export function judgementArchivePath(filePath, at) {
  const month = String(at || '').slice(0, 7) || 'undated';
  return join(dirname(filePath), 'judgements', `${month}.jsonl`);
}

// The archive chains on ITS OWN tail. Until 2026-09-12 it copied the live line verbatim, so its
// `prev` was the live ledger's link: every live rotation, every live row of a kind the archive
// never receives (suppression-label), every month boundary and every re-link of a live row read
// as a break here — 62 of 63 on the real store, none of them an edit of the archive. Two sessions
// investigated those as tampering. The live link is kept as `livePrev` so a row still resolves to
// the live line it copies (same bytes with prev := livePrev and livePrev dropped).
// Reached only with the live ledger's lock held (appendLocked), which serialises the tail read.
function archiveJudgement(filePath, envelope, livePrev) {
  if (!envelope || !JUDGEMENT_KINDS.includes(envelope.kind)) return { skipped: true };
  const path = judgementArchivePath(filePath, envelope.at);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tail = readTailLine(path);
    const prev = tail === null ? 'genesis' : lineHash(tail);
    appendFileSync(path, `${JSON.stringify({ ...envelope, prev, livePrev })}\n`);
    return { path };
  } catch (e) {
    // Reported, never swallowed: the ledger write succeeded; only durability failed.
    return { path, error: e.code || String(e.message || e) };
  }
}

/** The archive's chain, with pre-2026-09-12 rows explained rather than counted broken.
 *  Every break is resolved against the live generations: a `rotation:` prev is a live rotation;
 *  a prev naming a live row of a non-judgement kind is a row the archive never receives; a prev
 *  equal to some live row's `resealed.was` is a live re-link; `genesis` mid-file is a live
 *  restart; line 1 pointing anywhere is the month boundary. Anything else stays `broken`. */
export function verifyJudgementArchive({ dir } = {}) {
  const d = dir || dirFor();
  const live = adjudicationsPath(d);
  const liveRows = new Map();          // line hash → { kind }
  const resealedFrom = new Set();      // every `resealed.was` a live row carries
  const gens = [live, ...archiveGenerations(live).map((g) => g.path)];
  for (const g of gens) {
    let raw;
    try { raw = readFileSync(g, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const l of raw.split('\n')) {
      if (!l) continue;
      let r = null;
      try { r = JSON.parse(l); } catch { continue; }
      liveRows.set(lineHash(l), { kind: r.kind, resealed: Boolean(r.resealed) });
      if (r.resealed && r.resealed.was) resealedFrom.add(r.resealed.was);
    }
  }
  const archiveDir = dirname(judgementArchivePath(live, '0000-00'));
  let months;
  try { months = readdirSync(archiveDir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch (e) {
    if (e.code === 'ENOENT') return { absent: true, months: [] };
    throw e;
  }
  const out = { absent: false, months: [] };
  for (const f of months) {
    const raw = readFileSync(join(archiveDir, f), 'utf8');
    const m = { month: f.slice(0, 7), records: 0, verified: 0, broken: 0, torn: 0, legacy: { rotation: 0, nonJudgement: 0, resealed: 0, restart: 0, monthBoundary: 0 }, brokenAt: [] };
    let prevHash = null;
    let lineNo = 0;
    const seen = new Set();
    for (const l of raw.split('\n')) {
      if (!l) continue;
      lineNo++;
      const h = lineHash(l);
      let r = null;
      try { r = JSON.parse(l); } catch { m.torn++; seen.add(h); prevHash = h; continue; }
      m.records++;
      const p = String(r.prev);
      let cls = null;
      if (prevHash === null) cls = p === 'genesis' ? 'verified' : 'monthBoundary';
      else if (r.prev === prevHash || seen.has(r.prev)) cls = 'verified';
      else if (p.startsWith('rotation:')) cls = 'rotation';
      else if (p === 'genesis') cls = 'restart';
      else if (resealedFrom.has(r.prev)) cls = 'resealed';                       // names the pre-relink hash
      else if (liveRows.has(r.prev)) {
        const t = liveRows.get(r.prev);
        // A re-linked live row was copied here BEFORE the relink, so the next copy names a hash
        // the archive's own copy no longer has.
        cls = t.resealed ? 'resealed' : JUDGEMENT_KINDS.includes(t.kind) ? 'broken' : 'nonJudgement';
      }
      else cls = 'broken';
      if (cls === 'verified') m.verified++;
      else if (cls === 'broken') { m.broken++; m.brokenAt.push(lineNo); }
      else m.legacy[cls]++;
      seen.add(h);
      prevHash = h;
    }
    out.months.push(m);
  }
  return out;
}

/** Journal one gate decision. `session` is caller-supplied; null is honest, never fabricated. */
export function journal(gate, record, { dir, session = null } = {}) {
  const envelope = { v: 1, gate, at: nowISO(), pid: process.pid, session, ...record };
  return appendRecord(join(dir || dirFor(), `${gate}.jsonl`), envelope);
}

/** Read any journal file. ENOENT → absent (its own state); anything else THROWS (fail closed). */
export function readJournalFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { absent: true, records: [], torn: 0 };
    throw e; // an unreadable journal is never an empty one
  }
  const records = [];
  let torn = 0;
  const chain = { verified: 0, broken: 0, raced: 0, unchained: 0 };
  const seen = new Set();
  let prevHash = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const h = lineHash(line);
    let rec = null;
    try { rec = JSON.parse(line); records.push(rec); } catch { torn++; }
    if (rec) {
      if (rec.prev === undefined) chain.unchained++;
      else if (prevHash === null) {
        // first line: only a fresh start or a rotation continuation is honest here
        if (rec.prev === 'genesis' || String(rec.prev).startsWith('rotation:')) chain.verified++;
        else chain.broken++;
      } else if (rec.prev === prevHash) chain.verified++;
      else if (seen.has(rec.prev)) chain.raced++;      // an overlap, not an edit
      else chain.broken++;                              // incl. a mid-file 'genesis' — truncate-and-restart
    }
    seen.add(h);
    prevHash = h;
  }
  return { absent: false, records, torn, chain };
}

/** Read a gate journal across every rotation generation, oldest first so records stay in time
 *  order; chains are summed and a `rotation:<hash>` boundary is not a break. */
export function readJournal(gate, { dir } = {}) {
  const live = join(dir || dirFor(), `${gate}.jsonl`);
  // ONE PASS, and it is the STRONG verifier. This summed readJournalFile's per-file tallies, which
  // has two consequences it could not see:
  //   · readJournalFile is entered with prevHash === null for EVERY generation, so `genesis` at the
  //     head of a NEWER generation counted as verified. That is the truncate-and-restart signature
  //     (bin/lib/touch-chain.mjs:228-232), and it was invisible here.
  //   · a `rotation:` boundary was accepted on FORM — `startsWith('rotation:')` — with the hash
  //     never checked against any surviving tail. Any string beginning `rotation:` read as verified,
  //     on the one store whose entire claim is that nothing has been forged.
  //
  // THE VERDICT DOES NOT MOVE; THE REASONS ARRIVE. Measured on the live store before landing:
  // liveness 47 broken, docs-doctor 2, gate-spine 1 — identical under both readers, and all three
  // already render chain-broken on the panel. What was missing was WHY. `breaks[]` now names each
  // one ("prev matches no line of this ledger" x47, at lines 686, 688, 689…), which is the
  // difference between an alarm and a diagnosis. A count with no reason is not actionable, and an
  // audit surface that can only say a number is how 47 unexplained breaks sat there unread.
  const v = verifyLedgerChain(live, { collect: true });
  const present = v.files.filter((f) => !f.absent);
  // `chain` keeps its name and its four original keys: journalHealth:256 reads `.broken`, and
  // admin/routes/oversight.mjs:61 forwards the whole object. Everything else is additive.
  const chain = {
    verified: v.totals.verified,
    broken: v.totals.broken,
    raced: v.totals.raced,
    unchained: v.totals.unchained,
    unlinked: v.totals.unlinked,
    renumbered: v.totals.renumbered,
    examined: v.totals.examined,
  };
  return {
    absent: !present.length,
    records: v.records,
    torn: v.totals.torn,
    chain,
    // Archives only — the live file is the last entry of ledgerChainPaths(), never a rotation.
    rotations: present.filter((f) => f.path !== live).length,
    breaks: v.breaks,
    renumberings: v.renumberings,
    gaps: v.gaps,
    state: v.state,
  };
}

/** Declared gate roster: the reader enumerates THIS, not the directory, so a gate that never
 *  journaled renders as ABSENT instead of simply not being listed. */
export const GATE_ROSTER = [
  // store/ is a directory this operator symlinks to a private sidecar repo, so a ratchet FLOOR has a
  // history. Directory, never a file symlink: an atomic tmp+rename onto a link replaces the link.
  // Resolved by lib/store-paths.mjs, the same call the gates make. These two literals were
  // RIGHT while the gates' own defaults were wrong, so the roster's staleness alarm watched a
  // file the gates never wrote — a correct declaration and a broken one, describing one store.
  // GETTERS: this is a module-load const, so calling the resolver here would freeze the path at
  // import and defeat every override set afterwards. ~20 consumers destructure the array shape.
  { gate: 'gate-tests', get baseline() { return testsBaseline(); } },
  { gate: 'gate-ratchet', get baseline() { return gateBaseline(); } },
  { gate: 'docs-doctor', baseline: null },
  // No baseline by construction: records steering events (bin/focus-journal.mjs), not artifact-vs-floor.
  { gate: 'gate-focus', baseline: null },
  // No baseline by construction; on the roster from birth so "never written" renders ABSENT.
  { gate: 'gate-spine', baseline: null },
  // Gates an act, not an artifact — no baseline. secrets-sweep deliberately does not journal;
  // this roster line is the secrets family's only representation here.
  { gate: 'pre-publish', baseline: null },
  // fact: judges a built candidate, not an artifact against a floor
  { gate: 'release-candidate', baseline: null },
  // No baseline by construction: journals its own worst-area verdict per run (monitor/liveness.mjs).
  { gate: 'liveness', baseline: null },
  // HUMAN OVERSIGHT, riding this chain rather than a second one. Records that a person read a
  // determination somebody else made and either stands behind it or disputes it (lib/oversight.mjs).
  // No baseline by construction: there is no floor an attestation can fall below. On the roster
  // from birth so an unwritten ledger renders ABSENT — an oversight step nobody has used and one
  // that is not wired are different facts, and a missing file renders them the same.
  { gate: 'oversight', baseline: null },
  // The LOCAL half of the off-box watcher (bin/offbox-watch-check.mjs): it reads the watcher's own
  // ledger and alarms when that ledger stops moving. No baseline by construction — it judges
  // freshness and a remote verdict, not an artifact against a floor. On the roster from birth so an
  // unwritten ledger renders ABSENT: measured 2026-09-24, every workflow in commitwork-remote had
  // failed at startup since 2026-09-19 and nothing on this box knew, because nothing here read it.
  { gate: 'offbox-watch', baseline: null },
  // The behavioural gate over a session transcript (bin/turn-gate.mjs). No baseline by
  // construction: it judges a session against declared thresholds, not an artifact against a
  // floor. On the roster from birth for the reason stated above — an unwritten ledger must
  // render ABSENT, because a gate nobody has run and a gate that is not wired are different
  // facts and a missing file renders them the same. Journalling is opt-in (--record), so
  // ABSENT is the expected state until somebody chooses to write.
  { gate: 'turn-gate', baseline: null },
  // Records which lanes the operator enabled and which binaries they approved this box to execute
  // (bin/lib/scan-config.mjs). No baseline by construction: consent has no floor to fall below.
  // On the roster from birth so an unwritten ledger renders ABSENT — a box nobody has configured
  // and a box whose approvals were never journalled are different facts.
  { gate: 'scan-config', baseline: null },
];

/** Health per roster gate. A baseline stamped after the journal's last record means a decision the
 *  journal never received. The moved-baseline alarm arms only once a journal exists. */
export function journalHealth({ roster = GATE_ROSTER, dir } = {}) {
  return roster.map(({ gate, baseline }) => {
    let j;
    try {
      j = readJournal(gate, { dir });
    } catch (e) {
      return { gate, state: 'unreadable', detail: e.code || 'error' };
    }
    let baseAt = null;
    if (baseline) {
      try {
        baseAt = JSON.parse(readFileSync(baseline, 'utf8')).at || null;
      } catch (e) {
        if (e.code !== 'ENOENT') return { gate, state: 'unreadable', detail: `baseline: ${e.code || 'unparseable'}` };
      }
    }
    const last = j.records.length ? j.records[j.records.length - 1] : null;
    if (!j.absent && baseAt && (!last || String(baseAt) > String(last.at))) {
      return { gate, state: 'stale-baseline-moved', baselineAt: baseAt, lastAt: last ? last.at : null, entries: j.records.length, torn: j.torn };
    }
    if (j.absent) return { gate, state: 'absent-not-running', baselineAt: baseAt, lastAt: null, entries: 0, torn: 0 };
    // A broken chain outranks torn: torn is a crash artifact, broken is an edit.
    const state = j.chain && j.chain.broken ? 'chain-broken' : j.torn ? 'torn' : 'ok';
    return {
      gate, state, lastAt: last ? last.at : null,
      lastVerdict: last ? last.verdict : null, entries: j.records.length, torn: j.torn,
      chain: j.chain,
      silenced: last && typeof last.silenced === 'number' ? last.silenced : undefined,
    };
  });
}

// ── SERVED PROJECTION ───────────────────────────────────────────────────────────────────────────
// The panel may show ONLY this allowlist: verdict enums, counts, timestamps. Counts of files,
// never their names. The panel imports THIS projector; it must never invent its own.
const SERVED_FIELDS = ['v', 'gate', 'verdict', 'exit', 'at', 'suppressed', 'silenced', 'fail', 'pass', 'floorRaised', 'unknownMetrics', 'readCount'];
const NUMERIC_SUB = { baseline: ['fail', 'pass', 'conflicts', 'unreviewed', 'drifted', 'at'], metrics: ['conflicts', 'unreviewed', 'drifted'], tallies: ['green', 'orange', 'grey', 'generated', 'archived', 'cycle'] };

// Read-time projector: narrows an on-disk record before it crosses the tunnel. redactLedgerFields
// (below) is the write-time sibling; neither substitutes for the other.
export function redactGateRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const out = {};
  for (const k of SERVED_FIELDS) if (r[k] !== undefined) out[k] = r[k];
  for (const [key, fields] of Object.entries(NUMERIC_SUB)) {
    if (r[key] && typeof r[key] === 'object') {
      out[key] = {};
      for (const f of fields) if (r[key][f] !== undefined) out[key][f] = r[key][f];
    }
  }
  if (r.attribution && typeof r.attribution === 'object') {
    // arrays become their lengths — the split is the signal, the filenames are not for the tunnel
    const n = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0);
    out.attribution = { mine: n(r.attribution.mine), theirs: n(r.attribution.theirs), unknown: n(r.attribution.unknown) };
  }
  return out;
}

// ── OFF-TREE ANCHORS ────────────────────────────────────────────────────────────────────────────
// Close the chain's tail-truncation bound: `--anchor` snapshots each journal's head state (record
// count + last-line hash) under the operator's HOME (CW_VERDICT_ANCHORS). The anchored prefix must
// survive: growth is normal; rewrite/truncation/deletion alarm. The anchor store chains too.
export const anchorsPath = () => process.env.CW_VERDICT_ANCHORS || join(homedir(), '.commitwork', 'verdict-anchors.jsonl');

export function anchorJournals({ dir } = {}) {
  const d = dir || dirFor();
  let files = [];
  try {
    files = readdirSync(d).filter((f) => f.endsWith('.jsonl'));
  } catch (e) {
    if (e.code === 'ENOENT') return { anchored: [], note: 'no verdict directory — nothing to anchor' };
    throw e;
  }
  const anchored = [];
  for (const f of files.sort()) {
    const lines = readFileSync(join(d, f), 'utf8').split('\n').filter(Boolean);
    if (!lines.length) continue;
    // Never rotated: verifyAnchors reads only the live store, so a rotation would silently
    // drop every older anchor from verification.
    const w = appendRecord(anchorsPath(), {
      v: 1, kind: 'verdict-anchor', at: nowISO(), file: f,
      records: lines.length, lastHash: lineHash(lines.at(-1)),
    }, { maxBytes: Infinity });
    anchored.push({ file: f, records: lines.length, ok: w.ok, ...(w.ok ? {} : { error: w.error }) });
  }
  return { anchored };
}

export function verifyAnchors({ dir } = {}) {
  const d = dir || dirFor();
  let aj;
  try {
    aj = readJournalFile(anchorsPath());
  } catch (e) {
    return { state: 'anchors-unreadable', detail: e.code || 'error', results: [] }; // fail closed
  }
  if (aj.absent || !aj.records.length) return { state: 'no-anchors', results: [] };
  const latest = new Map();
  for (const r of aj.records) if (r.kind === 'verdict-anchor' && r.file) latest.set(r.file, r);
  const results = [];
  for (const [f, a] of [...latest.entries()].sort()) {
    let raw;
    try {
      raw = readFileSync(join(d, f), 'utf8');
    } catch (e) {
      results.push({ file: f, state: e.code === 'ENOENT' ? 'JOURNAL-GONE' : 'unreadable', anchoredRecords: a.records });
      continue;
    }
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length < a.records) {
      results.push({ file: f, state: 'TRUNCATED', anchoredRecords: a.records, records: lines.length });
    } else if (lineHash(lines[a.records - 1]) !== a.lastHash) {
      results.push({ file: f, state: 'REWRITTEN', anchoredRecords: a.records, records: lines.length });
    } else {
      results.push({ file: f, state: lines.length === a.records ? 'intact' : 'intact-extended', anchoredRecords: a.records, records: lines.length });
    }
  }
  const alarm = results.some((r) => ['TRUNCATED', 'REWRITTEN', 'JOURNAL-GONE', 'unreadable'].includes(r.state));
  return { state: alarm ? 'ALARM' : 'ok', results, anchorChain: aj.chain };
}

// ── DATA-STORE ANCHORS ──────────────────────────────────────────────────────────────────────────
// Same off-tree machinery for the data stores, in a second store (CW_DATA_ANCHORS, default
// ~/.commitwork/data-anchors.jsonl). Callers declare the store class — it cannot be inferred:
//   'append-only' — TRUNCATED/REWRITTEN/GONE alarms; whole-file hash, so growth+mismatch reads REWRITTEN
//   'rewritten'   — rollup/issues/annotations, legitimately rewritten in full: drift REPORT, never an alarm
//   'index'       — append-only by row identity (sliceId, source): removed row alarms, upsert drift-reports
export const dataAnchorsPath = () => process.env.CW_DATA_ANCHORS || join(homedir(), '.commitwork', 'data-anchors.jsonl');

const rowIdentity = (row) => `${row?.sliceId ?? ''}\0${row?.source ?? ''}`;
const rowHash = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 32);

/** Snapshot one data store into dataAnchorsPath(). 'index' class also records a per-row identity+hash list. */
export function anchorDataStore(filePath, storeClass, { path: anchorsFile = dataAnchorsPath() } = {}) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, file: filePath, storeClass, error: e.code || String(e.message || e) };
  }
  const rec = {
    v: 1, kind: 'data-anchor', at: nowISO(), file: filePath, storeClass,
    bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex'),
  };
  if (storeClass === 'index') {
    let rows = null;
    try { rows = JSON.parse(raw); } catch { rows = null; }
    if (Array.isArray(rows)) rec.rows = rows.map((r) => ({ identity: rowIdentity(r), hash: rowHash(r) }));
  }
  const w = appendRecord(anchorsFile, rec);
  return { ok: w.ok, file: filePath, storeClass, bytes: rec.bytes, rows: rec.rows ? rec.rows.length : undefined, ...(w.ok ? {} : { error: w.error }) };
}

// contract: retires only a store that is gone (ENOENT), was anchored, and is not already retired;
// the reason is required and verification keeps reporting the path as `retired`
export function retireDataAnchor(filePath, reason, { path: anchorsFile = dataAnchorsPath() } = {}) {
  const why = String(reason ?? '').trim();
  if (!why) return { ok: false, file: filePath, error: 'a retirement needs a reason' };
  try {
    statSync(filePath);
    return { ok: false, file: filePath, error: 'the store still exists — retire only a store that is gone' };
  } catch (e) {
    if (e.code !== 'ENOENT') return { ok: false, file: filePath, error: `cannot tell whether the store is gone (${e.code || e.message})` };
  }
  let aj;
  try {
    aj = readJournalFile(anchorsFile);
  } catch (e) {
    return { ok: false, file: filePath, error: `anchor store unreadable (${e.code || 'error'})` };
  }
  const last = aj.records.filter((r) => r.file === filePath && (r.kind === 'data-anchor' || r.kind === 'data-anchor-retired')).at(-1);
  if (!last) return { ok: false, file: filePath, error: 'never anchored — nothing to retire' };
  if (last.kind === 'data-anchor-retired') return { ok: false, file: filePath, error: 'already retired' };
  const w = appendRecord(anchorsFile, { v: 1, kind: 'data-anchor-retired', at: nowISO(), file: filePath, storeClass: last.storeClass, reason: why });
  return { ok: w.ok, file: filePath, storeClass: last.storeClass, ...(w.ok ? {} : { error: w.error }) };
}

export function verifyDataAnchors({ path: anchorsFile = dataAnchorsPath() } = {}) {
  let aj;
  try {
    aj = readJournalFile(anchorsFile);
  } catch (e) {
    return { state: 'anchors-unreadable', detail: e.code || 'error', results: [] }; // fail closed, matches verifyAnchors' posture
  }
  if (aj.absent || !aj.records.length) return { state: 'no-anchors', results: [] };
  const latest = new Map();
  for (const r of aj.records) if ((r.kind === 'data-anchor' || r.kind === 'data-anchor-retired') && r.file) latest.set(r.file, r);
  const results = [];
  for (const [f, a] of [...latest.entries()].sort()) {
    if (a.kind === 'data-anchor-retired') {
      results.push({ file: f, storeClass: a.storeClass, state: 'retired', reason: a.reason, at: a.at });
      continue;
    }
    let raw;
    try {
      raw = readFileSync(f, 'utf8');
    } catch (e) {
      // Total loss of the store alarms regardless of class.
      results.push({ file: f, storeClass: a.storeClass, state: e.code === 'ENOENT' ? 'JOURNAL-GONE' : 'unreadable', anchoredBytes: a.bytes });
      continue;
    }
    const bytes = Buffer.byteLength(raw);
    const sha256 = createHash('sha256').update(raw).digest('hex');

    if (a.storeClass === 'index') {
      let rows = null;
      let parseFailed = false;
      try { rows = JSON.parse(raw); } catch { parseFailed = true; }
      if (parseFailed || !Array.isArray(rows)) {
        if (bytes < a.bytes) results.push({ file: f, storeClass: a.storeClass, state: 'TRUNCATED', anchoredBytes: a.bytes, bytes });
        else results.push({ file: f, storeClass: a.storeClass, state: 'unreadable', detail: parseFailed ? 'unparseable JSON' : 'not a JSON array' });
        continue;
      }
      const nowByIdentity = new Map(rows.map((r) => [rowIdentity(r), rowHash(r)]));
      const anchoredRows = a.rows || [];
      let removed = 0;
      let changed = 0;
      for (const { identity, hash } of anchoredRows) {
        if (!nowByIdentity.has(identity)) removed++;
        else if (nowByIdentity.get(identity) !== hash) changed++; // same identity, different content — an upsert
      }
      if (removed > 0) results.push({ file: f, storeClass: a.storeClass, state: 'ROW-REMOVED', removed, anchoredRows: anchoredRows.length, rows: rows.length });
      else if (changed > 0) results.push({ file: f, storeClass: a.storeClass, state: 'drift-report', changed, anchoredRows: anchoredRows.length, rows: rows.length });
      else if (rows.length > anchoredRows.length) results.push({ file: f, storeClass: a.storeClass, state: 'intact-extended', anchoredRows: anchoredRows.length, rows: rows.length });
      else results.push({ file: f, storeClass: a.storeClass, state: 'intact', anchoredRows: anchoredRows.length, rows: rows.length });
      continue;
    }

    if (a.storeClass === 'rewritten') {
      // Drift report only — this class legitimately shrinks.
      results.push(sha256 === a.sha256
        ? { file: f, storeClass: a.storeClass, state: 'intact', bytes }
        : { file: f, storeClass: a.storeClass, state: 'drift-report', anchoredBytes: a.bytes, bytes });
      continue;
    }

    // 'append-only': verifyAnchors' vocabulary, coarsened to whole-file bytes/hash.
    if (sha256 === a.sha256) results.push({ file: f, storeClass: a.storeClass, state: 'intact', bytes });
    else if (bytes < a.bytes) results.push({ file: f, storeClass: a.storeClass, state: 'TRUNCATED', anchoredBytes: a.bytes, bytes });
    else results.push({ file: f, storeClass: a.storeClass, state: 'REWRITTEN', anchoredBytes: a.bytes, bytes });
  }
  const alarm = results.some((r) => ['TRUNCATED', 'REWRITTEN', 'JOURNAL-GONE', 'unreadable', 'ROW-REMOVED'].includes(r.state));
  return { state: alarm ? 'ALARM' : 'ok', results };
}

// ── GROUND TRUTH: adjudications + metrics ───────────────────────────────────────────────────────
// One appended record per judged decision, in `<dir>/adjudications.jsonl`:
//   { kind:'adjudication', gate, recordAt: <the judged record's `at`>,
//     truth: 'true-alarm'|'false-alarm'|'true-clean'|'false-clean',
//     basis: <one sentence of evidence>, adjudicatedBy: <who>,
//     attributionCorrect?: boolean, canary?: <id> }
// computeMetrics counts adjudicated records only; the unadjudicated count prints beside every rate.
export const TRUTHS = ['true-alarm', 'false-alarm', 'true-clean', 'false-clean'];
export const adjudicationsPath = (dir) => join(dir || dirFor(), 'adjudications.jsonl');

/** The adjudications ledger across rotations. Use this, never readJournalFile(adjudicationsPath()). */
export const readAdjudications = (dir) => readJournal('adjudications', { dir });

// ── COHORTS: split by WHO SUPPLIED THE TRUTH ────────────────────────────────────────────────────
// fact: cohorts are canary (the harness planted the defect — never in the headline), retrospective (recordAt < the gate's earliest record, structural, never inferred from prose) and live, the last two in the headline / pooling the harness's constructed answers with live judgements is not a measurement (expiry: never, prev: wrong)
// fact: `dangling` — a recordAt at/after journal start matching nothing — is the ONLY excluded outcome (expiry: never, prev: unknown)
// fact: an absent `recordAtIndex` ({ [gate]: Set<at> }) means NOT CHECKED — `dangling: null`, never zero / an EMPTY Set means the journal is legitimately absent, so everything is pre-journal (expiry: never, prev: wrong)
//
// ── INSTRUMENT EPOCHS ───────────────────────────────────────────────────────────────────────────
// fact: a rate may not pool two instruments — records judging a since-replaced attribution claim are counted and printed apart, never pooled or dropped / scoped to attribution only, because detection logic did not change (expiry: if detection logic changes, prev: wrong)
export const ATTRIBUTION_EPOCHS = {
  // The last commit to change what claim the gate emits.
  'gate-ratchet': '2026-08-11T15:45:02.000Z',
};

const isCanary = (a) => typeof a.canary === 'string' && a.canary.length > 0;
const emptyCohort = () => ({ adjudicated: 0, 'true-alarm': 0, 'false-alarm': 0, 'true-clean': 0, 'false-clean': 0, attributionScored: 0, attributionCorrect: 0, attributionPreEpoch: 0, attributionOnly: 0 });
// ── RATES DIVIDE BY THE STRATUM THAT COULD EXHIBIT THEM ─────────────────────────────────────────
// false-clean over clean-said records, false-alarm over alarms; the truth value carries the
// stratum. `catchObservable` marks a catch rate that is structurally 1.0 (no clean adjudications).
// *Observable flags and *N denominators ride beside the numbers — null and 0 are both falsy, so
// only they distinguish "measured zero" from "no estimate exists".
const rates = (c) => {
  const caught = c['true-alarm'];
  const missed = c['false-clean'];
  const cleanN = c['true-clean'] + missed;      // records where the gate said CLEAN
  const alarmN = caught + c['false-alarm'];     // records where the gate ALARMED
  return {
    ...c,
    catchRate: caught + missed > 0 ? caught / (caught + missed) : null,
    catchObservable: cleanN > 0,
    falseCleanRate: cleanN > 0 ? missed / cleanN : null,
    falseCleanN: cleanN,
    falseAlarmRate: alarmN > 0 ? c['false-alarm'] / alarmN : null,
    falseAlarmN: alarmN,
    attributionAccuracy: c.attributionScored > 0 ? c.attributionCorrect / c.attributionScored : null,
  };
};
// countAttribution:false = pre-epoch: still counts toward detection, tallied separately.
// A record needs a truth OR a boolean attributionCorrect to count; an attribution-only record
// moves no detection rate and does not touch `adjudicated`.
const tallyInto = (c, a, { countAttribution = true } = {}) => {
  if (TRUTHS.includes(a.truth)) {
    c.adjudicated++;
    c[a.truth]++;
  } else {
    // Counted so an attribution-only corpus does not look empty.
    c.attributionOnly++;
  }
  if (typeof a.attributionCorrect === 'boolean') {
    if (!countAttribution) { c.attributionPreEpoch++; return; }
    c.attributionScored++;
    if (a.attributionCorrect) c.attributionCorrect++;
  }
};

// ── RETRACTION ──────────────────────────────────────────────────────────────────────────────────
//   { kind:'adjudication-retraction', gate, recordAt, method?, reason, at, retractedBy }
// Withdraws the JUDGEMENT, never the journalled decision, as its own appended record. `method`
// scopes it to one method's output without touching independent judgements of the same decision.
const retractionKey = (r) => `${r.gate}@${r.recordAt}@${r.method || '*'}`;
export function retractionsFrom(adjudications) {
  const exact = new Set();
  const anyMethod = new Set();
  for (const r of adjudications) {
    if (!r || r.kind !== 'adjudication-retraction' || !r.gate || !r.recordAt) continue;
    if (r.method) exact.add(retractionKey(r)); else anyMethod.add(`${r.gate}@${r.recordAt}`);
  }
  return {
    has: (a) => anyMethod.has(`${a.gate}@${a.recordAt}`) || exact.has(retractionKey(a)),
    count: exact.size + anyMethod.size,
  };
}

// One rater, one decision, one judgement — latest wins (a re-judgement is a revision). Keyed on
// the rater as well as the decision: two raters on one decision is interrater evidence, not a
// duplicate. Collapse only on a fully present key — an unidentifiable record is always kept.
const raterOf = (a) => a.method || a.adjudicatedBy || a.canary || null;
export function dedupeJudgements(adjudications, { ambiguous = new Set() } = {}) {
  const latest = new Map();
  const order = [];
  let seen = 0;
  for (const a of adjudications) {
    if (!a || a.kind !== 'adjudication') { order.push(a); continue; }
    seen++;
    const rater = raterOf(a);
    // An ambiguous recordAt names two decisions; collapsing would merge judgements of different records.
    if (ambiguous.has(`${a.gate}@${a.recordAt}`)) { order.push(a); continue; }
    if (!a.recordAt || !a.gate || !rater) { order.push(a); continue; }   // unidentifiable: keep
    const k = `${a.gate}@${a.recordAt}@${rater}`;
    if (!latest.has(k)) order.push({ __key: k });
    latest.set(k, a);   // later record wins — a re-judgement is a revision of the earlier one
  }
  const kept = order.filter((x) => x && x.__key).length;
  const identified = seen - order.filter((x) => x?.kind === 'adjudication').length;
  return { records: order.map((x) => (x && x.__key ? latest.get(x.__key) : x)), collapsed: identified - kept };
}

// fact: `at` is NOT an identity — concurrent Stop hooks journal in the same millisecond / an adjudication naming that instant judges an unidentified decision, so it is counted and named, never resolved by guess (expiry: never, prev: wrong)
// ── RATER RELIABILITY ───────────────────────────────────────────────────────────────────────────
// fact: overlap first, agreement second, UNMEASURED where there is none, with truth and attribution agreement counted apart / GOLD is constructed truth (the canary harness) and agreement between ordinary raters is only consistency (expiry: never, prev: unscored)
/**
 * Declines, collapsed per (decision, rater). Returns rater -> Set(gate@recordAt), plus the set of
 * raters that recorded ANY decline — "declined nothing" and "cannot say" must never render alike.
 */
export function abstentionsByRater(adjudications) {
  const declined = new Map();
  const recording = new Set();
  for (const a of adjudications) {
    if (!a || a.kind !== 'adjudication-abstention' || !a.gate || !a.recordAt) continue;
    const rater = a.method || a.adjudicatedBy || a.canary || null;
    if (!rater) continue;                 // an unattributable decline belongs to no rater's coverage
    recording.add(rater);
    if (!declined.has(rater)) declined.set(rater, new Set());
    declined.get(rater).add(`${a.gate}@${a.recordAt}`);   // a Set collapses re-ingested duplicates
  }
  return { declined, recording };
}

// Cohort id pins the asked-set: a hash of the sorted decision ids a rater was GIVEN (never of the
// ids it answered). Writers stamp `cohort` and `cohortSize` on verdicts and abstentions alike.
export function cohortId(ids) {
  const list = [...new Set((ids || []).map(String))].sort();
  if (!list.length) return null;         // no asked-set, no cohort — null, never a hash of nothing
  return createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
}

export function raterReliability(adjudications, { gold = ['canary-harness'] } = {}) {
  const byDecision = new Map();          // gate@recordAt -> Map(rater -> record)
  const volume = {};
  // rater -> Map(cohort -> {size, sizeConflict, verdictSet, declineSet}). Sets, never counters —
  // a re-ingested duplicate must not inflate coverage.
  const cohortsByRater = new Map();
  const inCohort = (a, rater, field) => {
    if (!a.cohort) return;
    if (!cohortsByRater.has(rater)) cohortsByRater.set(rater, new Map());
    const m = cohortsByRater.get(rater);
    if (!m.has(a.cohort)) m.set(a.cohort, { size: null, sizeConflict: false, verdictSet: new Set(), declineSet: new Set() });
    const c = m.get(a.cohort);
    if (Number.isInteger(a.cohortSize)) {
      // One cohort id, one size; a contradiction is never resolved by picking one.
      if (c.size == null) c.size = a.cohortSize;
      else if (c.size !== a.cohortSize) c.sizeConflict = true;
    }
    c[field].add(`${a.gate}@${a.recordAt}`);
  };
  for (const a of adjudications) {
    if (!a || !a.gate || !a.recordAt) continue;
    const rater = a.method || a.adjudicatedBy || a.canary || null;
    if (!rater) continue;
    if (a.kind === 'adjudication-abstention') { inCohort(a, rater, 'declineSet'); continue; }
    if (a.kind !== 'adjudication') continue;
    inCohort(a, rater, 'verdictSet');
    volume[rater] = (volume[rater] || 0) + 1;
    const k = `${a.gate}@${a.recordAt}`;
    if (!byDecision.has(k)) byDecision.set(k, new Map());
    byDecision.get(k).set(rater, a);     // one judgement per rater per decision; a later one revises
  }
  // Coverage, because agreement without it is a rate over a cohort the rater selected.
  const { declined, recording } = abstentionsByRater(adjudications);

  const pairs = {};                      // "A|B" -> {shared, truthAgree, attrShared, attrAgree, crossCohort, cohortUnknown}
  for (const raters of byDecision.values()) {
    const names = [...raters.keys()].sort();
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const p = (pairs[`${names[i]}|${names[j]}`] ??= { shared: 0, truthAgree: 0, attrShared: 0, attrAgree: 0, crossCohort: false, cohortUnknown: false });
        const A = raters.get(names[i]);
        const B = raters.get(names[j]);
        p.shared++;
        // Asked-sets compared, tri-state: differing cohorts warn; a missing cohort is UNKNOWN —
        // neither sameness nor a measured difference.
        if (A.cohort && B.cohort) { if (A.cohort !== B.cohort) p.crossCohort = true; }
        else p.cohortUnknown = true;
        if (A.truth && B.truth && A.truth === B.truth) p.truthAgree++;
        if (typeof A.attributionCorrect === 'boolean' && typeof B.attributionCorrect === 'boolean') {
          p.attrShared++;
          if (A.attributionCorrect === B.attributionCorrect) p.attrAgree++;
        }
      }
    }
  }

  const goldSet = new Set(gold);
  const out = {};
  // The rater universe is verdicts ∪ declines: a rater that declined everything must still appear.
  for (const rater of new Set([...Object.keys(volume), ...declined.keys()])) {
    const judged = volume[rater] || 0;
    const withOthers = Object.entries(pairs)
      .filter(([k]) => k.split('|').includes(rater))
      .map(([k, p]) => {
        const other = k.split('|').find((x) => x !== rater);
        return {
          other,
          shared: p.shared,
          // null, never 0 — a pair that shares nothing has no agreement RATE, it has no measurement.
          agreement: p.shared > 0 ? p.truthAgree / p.shared : null,
          attributionAgreement: p.attrShared > 0 ? p.attrAgree / p.attrShared : null,
          againstGold: goldSet.has(other),
          // The asked-set caveat travels with the agreement figure it qualifies.
          crossCohort: p.crossCohort,
          cohortUnknown: p.cohortUnknown,
        };
      })
      .sort((a, b) => b.shared - a.shared);
    // `overlap` counts pairwise comparisons; `overlapDecisions` counts decisions — they diverge
    // once a decision has more than two raters.
    const overlap = withOthers.reduce((n, x) => n + x.shared, 0);
    const overlapDecisions = [...byDecision.values()]
      .filter((m) => m.has(rater) && m.size > 1).length;
    // A decline bears on coverage only if somebody else judged that decision.
    const mine = declined.get(rater) || new Set();
    const declinedOverlap = [...mine].filter((k) => (byDecision.get(k)?.size || 0) >= 1).length;
    const saw = overlapDecisions + declinedOverlap;
    // Tri-state: no abstention records ≠ declined nothing — explicit uncertainty.
    const abstentionsRecorded = recording.has(rater) ? 'yes' : 'unknown';
    out[rater] = {
      judged,
      isGold: goldSet.has(rater),
      overlap,
      overlapDecisions,
      declinedOverlap,
      abstentionsRecorded,
      // null, never 1.0, when we cannot know — and null, never 0, when the rater saw nothing.
      coverage: abstentionsRecorded === 'yes' && saw > 0 ? overlapDecisions / saw : null,
      // Declining everything is not the same state as never overlapping.
      declinedAll: saw > 0 && overlapDecisions === 0,
      // With no shared decision there is nothing to compute, and saying so IS the result.
      reliability: overlap > 0 ? withOthers.reduce((n, x) => n + x.agreement * x.shared, 0) / overlap : null,
      unmeasured: overlap === 0,
      pairs: withOthers,
      // Per asked-set: verdicts over ASKED. Coverage is null when the denominator is unrecorded
      // or contradicted.
      cohorts: Object.fromEntries([...(cohortsByRater.get(rater) || new Map())].map(([id, c]) => [id, {
        size: c.sizeConflict ? null : c.size,
        verdicts: c.verdictSet.size,
        declines: c.declineSet.size,
        coverage: !c.sizeConflict && Number.isInteger(c.size) && c.size > 0 ? c.verdictSet.size / c.size : null,
        ...(c.sizeConflict ? { sizeConflict: true } : {}),
      }])),
    };
  }
  return out;
}

export function computeMetrics(adjudications, journalCounts = {}, { recordAtIndex, ambiguousRecordAts, attributionEpochs = ATTRIBUTION_EPOCHS } = {}) {
  const retracted = retractionsFrom(adjudications);
  const ambiguous = ambiguousRecordAts instanceof Set ? ambiguousRecordAts : new Set();
  const deduped = dedupeJudgements(adjudications, { ambiguous });
  adjudications = deduped.records;
  // Earliest `at` per gate: the pre-journal boundary.
  const earliest = {};
  if (recordAtIndex) {
    for (const [gate, set] of Object.entries(recordAtIndex)) {
      let min = null;
      for (const at of set) if (min === null || String(at) < min) min = String(at);
      earliest[gate] = min;   // null for an absent/empty journal → everything is pre-journal
    }
  }
  const byGate = {};
  for (const a of adjudications) {
    if (!a || a.kind !== 'adjudication') continue;
    // Either channel qualifies a record. Neither present means it judges nothing.
    if (!TRUTHS.includes(a.truth) && typeof a.attributionCorrect !== 'boolean') continue;
    // A withdrawn judgement is not evidence; the record stays on disk but moves no rate.
    if (retracted.has(a)) continue;
    // Ambiguous instant: judges an unidentified record — counted, moves no rate.
    if (ambiguous.has(`${a.gate}@${a.recordAt}`)) {
      (byGate[a.gate] ??= {
        headline: emptyCohort(), live: emptyCohort(), retrospective: emptyCohort(),
        canary: emptyCohort(), combined: emptyCohort(), danglingCount: 0, ambiguousCount: 0, checked: false,
      }).ambiguousCount++;
      continue;
    }
    const g = (byGate[a.gate] ??= {
      headline: emptyCohort(), live: emptyCohort(), retrospective: emptyCohort(),
      canary: emptyCohort(), combined: emptyCohort(), danglingCount: 0, ambiguousCount: 0, checked: false,
    });
    // No declared epoch means the claim logic was never replaced, so every record counts.
    const epoch = attributionEpochs ? attributionEpochs[a.gate] : undefined;
    const opts = { countAttribution: !epoch || String(a.recordAt ?? '') >= epoch };

    tallyInto(g.combined, a, opts);
    if (isCanary(a)) { tallyInto(g.canary, a, opts); continue; }

    const index = recordAtIndex ? recordAtIndex[a.gate] : undefined;
    if (!index) { tallyInto(g.live, a, opts); tallyInto(g.headline, a, opts); continue; }   // not checked
    g.checked = true;
    if (index.has(a.recordAt)) { tallyInto(g.live, a, opts); tallyInto(g.headline, a, opts); continue; }
    // Unresolvable. Pre-journal incidents stay in the headline; a dangling reference does not.
    const start = earliest[a.gate];
    if (start === null || start === undefined || String(a.recordAt ?? '') < start) {
      tallyInto(g.retrospective, a, opts);
      tallyInto(g.headline, a, opts);
    } else {
      g.danglingCount++;
    }
  }
  const out = {};
  for (const [gate, g] of Object.entries(byGate)) {
    out[gate] = {
      // Headline cohort spread at top level so m[gate].catchRate keeps working.
      ...rates(g.headline),
      records: journalCounts[gate] ?? null,
      // Backlog is against journalled decisions, so only the live cohort counts down against it.
      unadjudicated: journalCounts[gate] != null ? Math.max(0, journalCounts[gate] - g.live.adjudicated) : null,
      live: rates(g.live),
      retrospective: rates(g.retrospective),
      canary: rates(g.canary),
      combined: rates(g.combined),
      dangling: g.checked ? g.danglingCount : null,
      ambiguous: g.ambiguousCount || 0,
      attributionEpoch: (attributionEpochs && attributionEpochs[gate]) || null,
    };
  }
  return out;
}

// ── FINDING-LEVEL GROUND TRUTH: kind 'finding-adjudication' ─────────────────────────────────────
// Judges one scanner finding or dependency CVE, in the SAME chained file as kind:'adjudication':
//   { v:1, kind:'finding-adjudication', at,
//     findingKey, category, repo, machineVerdict, humanVerdict, truth, basis, evidence,
//     model, promptId, bornSlice }
//
// fact: findingKey is place-keyed, never line-keyed (house rule) / a line-keyed identity turns an unrelated edit above the finding into a state change (expiry: never, prev: wrong)
// fact: bornSlice is stable first-seen provenance, never the transient per-slice `state === 'born'` flag (expiry: never, prev: wrong)
// fact: TRUTHS judges the MACHINE's call while the panel's DISPOSITIONS is a human risk decision, and only 'false-positive' maps across (to 'false-alarm', in adjudication-import.mjs) / conflating them scores a risk acceptance as a detector error (expiry: never, prev: unknown)

// Forbidden identity components, checked BY NAME at assembly — never by scanning the key for
// digits, which would reject intentional components like the supplyChain lane's `undici|5.28.4`.
export const FORBIDDEN_IDENTITY_COMPONENTS = new Set(['line', 'startLine', 'endLine', 'lineNumber', 'lineNo']);

/** Assemble a place-keyed findingKey from ordered [name, value] components. Throws on a forbidden
 *  component — silently dropping one would merge two findings under one key. */
export function buildFindingKey(components) {
  for (const [name] of components) {
    if (FORBIDDEN_IDENTITY_COMPONENTS.has(name)) {
      throw new Error(`buildFindingKey: forbidden identity component '${name}' — line-keyed identity `
        + 'un-suppresses itself on the next unrelated edit above it (house rule); use a place-stable field instead');
    }
  }
  return components.map(([, v]) => String(v ?? '')).join('|');
}

/** Scanner-lane findingKey: category + repo + identityFor(category)'s tuple (detail-schema.mjs). */
export function findingKeyForScanner(category, repo, row) {
  const fields = identityFor(category);
  if (!fields) throw new Error(`findingKeyForScanner: unknown category '${category}'`);
  return buildFindingKey([['category', category], ['repo', repo], ...fields.map((f) => [f, row[f]])]);
}

/** Dependency-CVE findingKey: repo|id|package — the shape annotations.json's CVE half already uses. */
export function findingKeyForDependency(repo, id, pkg) {
  return buildFindingKey([['repo', repo], ['id', id], ['package', pkg]]);
}

// ── LEDGER WRITE-TIME REDACTION ─────────────────────────────────────────────────────────────────
// Write-time gate (contrast read-time redactGateRecord above): free-text fields never reach disk
// as matched content — what survives is place, artifact ref, and a sha256 of the redacted text.
// An omitted kind redacts nothing, which means "nobody decided yet", not "safe": add new
// free-text-carrying kinds here first.
const LEDGER_FREE_TEXT_FIELDS = {
  'finding-adjudication': ['evidence', 'basis'],
};

export function redactLedgerFields(record, { place = null, artifact = null } = {}) {
  if (!record || typeof record !== 'object') return record;
  const fields = LEDGER_FREE_TEXT_FIELDS[record.kind] || [];
  const out = { ...record };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === 'string' && v.length) {
      out[f] = { place, artifact, sha256: createHash('sha256').update(v).digest('hex') };
    }
  }
  return out;
}

/** Append one finding-adjudication. Redacts inside this path so no producer can reach
 *  appendRecord with unredacted evidence/basis. */
export function appendFindingAdjudication(record, { dir, place, artifact } = {}) {
  if (!record || typeof record !== 'object') return { ok: false, error: 'record is not an object' };
  for (const req of ['findingKey', 'category', 'repo']) {
    if (!record[req]) return { ok: false, error: `missing ${req}` };
  }
  const envelope = redactLedgerFields(
    { v: 1, kind: 'finding-adjudication', at: nowISO(), ...record },
    { place, artifact },
  );
  return appendRecord(adjudicationsPath(dir), envelope);
}

// ── GROUND TRUTH CALIBRATION (--calibrate) ──────────────────────────────────────────────────────
// Per-check × per-model false rates over finding-adjudication records, split into STANDING (born
// before the window) and DELTA (born within it) — only delta alarms. Window boundary = the banked
// baseline's `at`; no baseline → everything standing.
// bornSlice stamps are '<kind>-<YYYYMMDDHHMMSS>' or bare 14 digits; unparseable = cohort-unknown,
// counted standing — absent provenance must never inflate the alarming cohort.
const BORN_SLICE_STAMP = /(\d{14})$/;
export function bornSliceAt(bornSlice) {
  if (!bornSlice || typeof bornSlice !== 'string') return null;
  const m = BORN_SLICE_STAMP.exec(bornSlice);
  if (!m) return null;
  const s = m[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

// model:null is human-authored today (adjudication-import.mjs derives from human-reviewed
// annotations); a future LLM-judge harness must set `model` explicitly.
export const UNMODELED_LABEL = 'human';

const emptyCalibBucket = () => ({ seen: 0, adjudicated: 0, 'true-alarm': 0, 'false-alarm': 0, 'true-clean': 0, 'false-clean': 0 });
const mergeCalibBuckets = (a, b) => {
  const o = emptyCalibBucket();
  for (const k of Object.keys(o)) o[k] = a[k] + b[k];
  return o;
};
// `denominator` duplicates `adjudicated` (every rate divides by it); `unadjudicated` keeps the
// denominator gap a printed fact.
const finishCalibBucket = (b) => ({
  denominator: b.adjudicated,
  adjudicated: b.adjudicated,
  unadjudicated: b.seen - b.adjudicated,
  falseAlarmRate: b.adjudicated > 0 ? b['false-alarm'] / b.adjudicated : null,
  falseCleanRate: b.adjudicated > 0 ? b['false-clean'] / b.adjudicated : null,
});

/**
 * Pure aggregation over finding-adjudication records: {generated, checks:{check:{model:{...}}}}.
 * windowStart (ISO string, or null) is the calibration window boundary — null puts every record in
 * the standing cohort, which is the correct behaviour on a bootstrap run with no banked baseline.
 */
export function computeFindingCalibration(records, { windowStart = null } = {}) {
  const tree = {}; // check -> model -> { standing, delta, cohortUnknown }
  for (const r of records || []) {
    if (!r || r.kind !== 'finding-adjudication' || !r.category) continue;
    const check = r.category;
    const model = r.model == null || r.model === '' ? UNMODELED_LABEL : String(r.model);
    const at = bornSliceAt(r.bornSlice);
    const unknown = at === null;
    // Epoch-millis compare: bornSliceAt emits second-ISO, the baseline `at` has millis — a string
    // '>=' misorders an equal instant across that format gap.
    const atMs = unknown ? NaN : Date.parse(at);
    const winMs = windowStart ? Date.parse(windowStart) : NaN;
    const cohort = !unknown && !Number.isNaN(winMs) && atMs >= winMs ? 'delta' : 'standing';
    const node = (tree[check] ??= {});
    const m = (node[model] ??= { standing: emptyCalibBucket(), delta: emptyCalibBucket(), cohortUnknown: 0 });
    if (unknown) m.cohortUnknown++;
    const bucket = m[cohort];
    bucket.seen++;
    if (TRUTHS.includes(r.truth)) {
      bucket.adjudicated++;
      bucket[r.truth]++;
    }
  }
  const checks = {};
  for (const [check, models] of Object.entries(tree)) {
    checks[check] = {};
    for (const [model, m] of Object.entries(models)) {
      const total = mergeCalibBuckets(m.standing, m.delta);
      checks[check][model] = {
        ...finishCalibBucket(total),
        cohortUnknown: m.cohortUnknown,
        cohorts: { standing: finishCalibBucket(m.standing), delta: finishCalibBucket(m.delta) },
      };
    }
  }
  return { generated: nowISO(), checks };
}

/** {check:{model:{falseAlarmRate, falseCleanRate}}} banked from a calibration's AGGREGATE rates. */
export function bankedRatesFrom(calibration) {
  const checks = {};
  for (const [check, models] of Object.entries(calibration.checks)) {
    checks[check] = {};
    for (const [model, m] of Object.entries(models)) {
      checks[check][model] = { falseAlarmRate: m.falseAlarmRate, falseCleanRate: m.falseCleanRate };
    }
  }
  return checks;
}

/** Regression = a rate rose above the banked baseline (null never regresses). Delta-cohort
 *  regressions alarm; standing drift is reported, never paged. */
export function compareCalibrationToBaseline(calibration, baseline) {
  const deltaRegressions = [];
  const standingRegressions = [];
  if (!baseline || !baseline.checks) return { deltaRegressions, standingRegressions };
  for (const [check, models] of Object.entries(calibration.checks)) {
    for (const [model, m] of Object.entries(models)) {
      const base = baseline.checks[check]?.[model];
      if (!base) continue;
      for (const rateKey of ['falseAlarmRate', 'falseCleanRate']) {
        const baseRate = base[rateKey];
        if (baseRate == null) continue;
        const deltaRate = m.cohorts.delta[rateKey];
        const standingRate = m.cohorts.standing[rateKey];
        if (deltaRate != null && deltaRate > baseRate) deltaRegressions.push({ check, model, rateKey, from: baseRate, to: deltaRate });
        if (standingRate != null && standingRate > baseRate) standingRegressions.push({ check, model, rateKey, from: baseRate, to: standingRate });
      }
    }
  }
  return { deltaRegressions, standingRegressions };
}

// Per-machine ratchet floor under gitignored .claude/; tmp+rename write.
export const calibrateBaselinePath = () => process.env.CW_CALIBRATE_BASELINE || join(REPO, '.claude', 'store', 'calibrate-baseline.json');

export function readCalibrateBaseline(path = calibrateBaselinePath()) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null; // legitimate absence: bootstrap, not corruption
    return { _error: true, message: e.message };
  }
}

export function writeCalibrateBaseline(baseline, path = calibrateBaselinePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(baseline, null, 2)}\n`);
  renameSync(tmp, path);
}

// ── FATIGUE (--tally section, render only) ──────────────────────────────────────────────────────
// Reads {kind:'suppression-label', target, action, count, who, at[, expires]} records from the
// same adjudications file. Read-only, proposal-only: names suppressed-but-never-adjudicated
// targets; never writes, auto-adjudicates or auto-retunes.
export function fatigueReport(records, { limit = 10 } = {}) {
  const adjudicatedKeys = new Set();
  const bySuppression = new Map();
  for (const r of records || []) {
    if (!r) continue;
    if (r.kind === 'finding-adjudication' && r.findingKey) {
      adjudicatedKeys.add(r.findingKey);
    } else if (r.kind === 'suppression-label' && r.target) {
      const cur = bySuppression.get(r.target) || { target: r.target, count: 0, labels: 0, everExpiring: false };
      cur.count += Number.isFinite(r.count) ? r.count : 0;
      cur.labels += 1;
      if (r.expires) cur.everExpiring = true;
      bySuppression.set(r.target, cur);
    }
  }
  const targets = [...bySuppression.values()]
    .filter((t) => !adjudicatedKeys.has(t.target))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((t) => ({ ...t, sentence: `${t.target}: suppressed ${t.count} times, never adjudicated — adjudicate or retune` }));
  return { targets, empty: targets.length === 0 };
}

