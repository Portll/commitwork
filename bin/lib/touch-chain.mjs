// Hash chain for the touch ledger — the attribution log verdict-journal already refuses to be:
// tamper-mutable. Same prev discipline as bin/verdict-journal.mjs ('genesis' | <hash of previous
// line> | 'rotation:<hash>'), with one addition the hook's contract forces: 'unlinked', written
// when the lock cannot be had in time. The hook must never stall an edit, and losing an
// attribution record is worse than an unchained one — so contention degrades to a marked,
// unchained append, never to a dropped record and never to a fake link.
//
// The chain catches interior edits and deletions. Tail truncation of the whole file is out of its
// reach by construction (an append-only chain cannot vouch for its own end) — that bound is the
// off-tree anchor machinery in verdict-journal.mjs, not this module.
//
// Env: CW_TOUCH_LEDGER (read at call time) — same override the hook honours.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, renameSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../../monitor/lockfile.mjs';
import { fitRecord, ledgerChainPaths } from './touch-ledger-core.mjs';
import { shiftArchives, archiveGenerations, ledgerLockPath } from './ledger-rotate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const touchLedgerPath = () => process.env.CW_TOUCH_LEDGER || join(REPO, '.claude', 'store', 'touches.jsonl');

// Same hash form as verdict-journal: line without newline, sha256, first 32 hex.
export const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

// Short-fused: ~200ms worst case, then the unlinked fallback. The hook fires on every edit of ~28
// sessions; verdict-journal's 2s budget is a gate's, not a hook's.
const LOCK_ATTEMPTS = 40;
const LOCK_SPIN_MS = 5;
const LOCK_STALE_MS = 60_000;
const MAX_BYTES = 2_000_000;

// Records are bounded (MAX_RECORD_BYTES 4096), so the last line always starts inside this window
// unless a foreign writer produced a wider one — then the whole file is read.
const TAIL_WINDOW = 8192;

/** Last non-empty line of the file, or null (ENOENT/empty). Reads the tail window, not the file. */
export function readTailLine(path, window = TAIL_WINDOW) {
  let fd;
  try { fd = openSync(path, 'r'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const size = fstatSync(fd).size;
    if (!size) return null;
    const start = Math.max(0, size - window);
    let buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    let segs = text.split('\n');
    let last = segs.length - 1;
    while (last >= 0 && !segs[last]) last--;
    // A window that opens mid-line cannot vouch for its first segment; widen to the whole file.
    if (start > 0 && last === 0) {
      buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, 0);
      text = buf.toString('utf8');
      segs = text.split('\n');
      last = segs.length - 1;
      while (last >= 0 && !segs[last]) last--;
    }
    return last >= 0 ? segs[last] : null;
  } finally { closeSync(fd); }
}

/**
 * Append one record with a chain link. Never throws; never drops.
 * Returns { ok, mode: 'chained' | 'unlinked', rotated?, rotfail?, exceeds?, error? }.
 * `rotfail` is `'<shift|rename>:<errno>'` and is present ONLY when a rotation was in flight —
 * ordinary lock contention carries none, so the marker keeps meaning something.
 * Rotation shifts every existing generation before renaming the live file. It happens only under
 * the lock, so the rotation boundary is written by exactly one process and no archive is replaced.
 *
 * MEASURED, not argued — the sibling claim in ledger-rotate.mjs was reasoning presented as a result
 * until somebody ran it, so this one arrives with its numbers. Six concurrent writers, 120 appends
 * each, 4 KB threshold, PRODUCTION lock settings: 0 broken, 0 gaps, `ok`, three trials out of three.
 * The property that holds it is that the size stat is INSIDE the lock, so a second rotator entering
 * after the first has finished sees the new small live file and declines to rotate.
 *
 * It is reachable only by breaking the lock as stale. At lockStaleMs=40ms the same run gives 2-3
 * broken links — and 361-404 of 720 appends land `unlinked`, which is the tell that the
 * configuration is pathological rather than the code unsound. Real staleness is 60s and a rotation
 * takes milliseconds. Recorded because an earlier reading of mine called this a live defect on the
 * strength of the 40ms run alone, and a refuted finding is worth keeping so nobody repairs it twice.
 */
export function chainedAppend(ledgerPath, rec, {
  maxBytes = MAX_BYTES, lockAttempts = LOCK_ATTEMPTS, lockSpinMs = LOCK_SPIN_MS, lockStaleMs = LOCK_STALE_MS,
} = {}) {
  try { mkdirSync(dirname(ledgerPath), { recursive: true }); } catch { /* the append below reports it */ }

  let lock = null;
  try {
    lock = acquireLock(ledgerLockPath(ledgerPath), {
      label: 'touch-ledger append', attempts: lockAttempts, spinMs: lockSpinMs, staleMs: lockStaleMs,
    });
  } catch { lock = null; }

  if (lock && lock.ok) {
    try { return chainedAppendHeld(ledgerPath, rec, { maxBytes }); }
    finally { try { lock.release(); } catch { /* released is released */ } }
  }
  return appendUnlinked(ledgerPath, rec);
}

/**
 * chainedAppend's critical section, for a caller that already holds ledgerLockPath(ledgerPath) and
 * must keep it across more than the append — bin/agent-tag.mjs reads the roster to mint the next
 * number, and taking the lock twice would deadlock it into an `unlinked` row on every allocation.
 */
export function chainedAppendHeld(ledgerPath, rec, { maxBytes = MAX_BYTES } = {}) {
  // OUTSIDE the try, deliberately: the catch is the only place this is read, and a `let` inside
  // the try block is not in scope there. The first version declared it inside and threw
  // ReferenceError on the exact path it existed to describe — a diagnostic that failed only when
  // something needed diagnosing.
  let stage = null;                   // which half of the rotation was in flight when it threw
  try {
    let prev;
    let rotated = false;
    let size = 0;
    try { size = statSync(ledgerPath).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (size > maxBytes) {
      const tail = readTailLine(ledgerPath);
      // R-3 · WHICH STEP FAILED IS THE WHOLE DIAGNOSIS. shiftArchives and the rename are two
      // operations and only the pair is a rotation: a shift that succeeds with a failed rename
      // leaves the archives moved down one and NO `.1` — which is a generation hole that looks,
      // months later, exactly like a deletion nobody can explain. Both failures used to land in
      // the same silent `unlinked` bucket as ordinary lock contention, so the store recorded that
      // something went wrong and not what.
      stage = 'shift';
      shiftArchives(ledgerPath);
      stage = 'rename';
      renameSync(ledgerPath, `${ledgerPath}.1`);
      stage = null;
      prev = tail === null ? 'genesis' : `rotation:${lineHash(tail)}`;
      rotated = true;
    } else {
      const tail = readTailLine(ledgerPath);
      prev = tail === null ? 'genesis' : lineHash(tail);
    }
    const { line, exceeds } = fitRecord({ ...rec, prev });
    appendFileSync(ledgerPath, `${line}\n`);
    return { ok: true, mode: 'chained', ...(rotated ? { rotated } : {}), ...(exceeds ? { exceeds } : {}) };
  } catch (e) {
    // The chain machinery failed with the lock held; the record still lands, marked — and marked
    // with WHICH step, so a half-completed rotation is legible in the ledger itself rather than
    // being reconstructed from generation numbering a fortnight later.
    return appendUnlinked(ledgerPath, rec, e, stage);
  }
}

function appendUnlinked(ledgerPath, rec, cause, stage) {
  try {
    // `rotfail` is ABSENT for ordinary contention and present only when a rotation was in flight.
    // The two were indistinguishable before, which is why the gap this store carries took a git
    // archaeology session to explain instead of a grep.
    const rotfail = stage ? `${stage}:${cause?.code || 'error'}` : null;
    const { line, exceeds } = fitRecord({ ...rec, prev: 'unlinked', ...(rotfail ? { rotfail } : {}) });
    appendFileSync(ledgerPath, `${line}\n`);
    return { ok: true, mode: 'unlinked', ...(rotfail ? { rotfail } : {}), ...(exceeds ? { exceeds } : {}) };
  } catch (e) {
    // Even here — the rotation failed AND the fallback append could not land — the stage is
    // reported. This is the one path where nothing is written to the ledger, so the return value
    // is the only witness there will ever be.
    const rotfail = stage ? `${stage}:${cause?.code || 'error'}` : null;
    return { ok: false, ...(rotfail ? { rotfail } : {}), error: (cause || e)?.code || String((cause || e)?.message || e) };
  }
}

// How far back a rotation boundary may match into the prior generation: an unlinked appender that
// opened the file in the instant of the rename lands its line AFTER the captured tail, displacing
// it by one. Bounded small — a wide window would let an edited archive still "match".
const BOUNDARY_SLACK = 3;

/**
 * Verify the ledger chain across EVERY rotation generation, oldest first — whatever
 * `<file>.<digits>` exist, enumerated by generations(), never a fixed window.
 *
 * This said "(`.1` then live)" until 2026-09-02, describing the hard-coded pair that
 * bin/lib/ledger-rotate.mjs replaced precisely because a third generation would have been
 * unreachable. The code moved; the sentence a reader checks first did not, and it cost a diagnosis:
 * the live store has no `.1` (it holds `.2/.3/.4`), so the docstring said the verifier could not
 * see two thirds of the ledger. It can.
 *
 * The claim that replaced it was wrong too, and is corrected here rather than deleted, because the
 * error is the instructive part. It said the one break was a boundary pointing at an ABSENT
 * generation — a gap in the store. It is not: the predecessor is present as `.4`, and git records
 * `store/{touches.jsonl.1 => touches.jsonl.4}` as a pure rename, 0 lines changed. Rotation
 * RENUMBERS generations, so a boundary written against `.1` still names that content at `.4`.
 * Matching only the adjacent generation turned an intact chain into `chain-broken` — a fabricated
 * critical on the one store whose entire claim is that nothing has been forged, which is the
 * explicit uncertainty half of the house rule, in the store that exists to serve it.
 * The live chain now reads: 0 broken, 1 renumbered, predecessor located in `.4`.
 *
 * ENOENT is absence; any other read error THROWS — an unreadable ledger is never a clean one.
 * Returns { files, totals: {verified, raced, unlinked, unchained, broken, torn, renumbered},
 * breaks, renumberings, gaps, state } where state is 'absent' | 'ok' | 'torn' | 'chain-broken'.
 */
/**
 * @param {string} livePath
 * @param {{collect?: boolean}} [opts] `collect` also returns every parsed record, oldest first.
 *
 * COLLECT EXISTS SO THE CHAIN IS READ ONCE. bin/verdict-journal.mjs needs both the records and the
 * verdict; without it the chain was read twice — once through readJournalFile for the records, once
 * through here for the verdict. That is ~8 gates x 2 full-chain read+SHA on every admin panel load,
 * and worse, it is NOT ATOMIC: a rotation landing between the two passes yields a verdict about a
 * different set of files than the records came from, and neither pass errors, because both degrade
 * ENOENT to `absent` independently.
 *
 * Default OFF, so every existing caller's return shape is unchanged.
 */
export function verifyLedgerChain(livePath = touchLedgerPath(), { collect = false } = {}) {
  const files = [];
  const records = collect ? [] : null;
  const totals = { verified: 0, raced: 0, unlinked: 0, unchained: 0, broken: 0, torn: 0, renumbered: 0 };
  const breaks = [];
  const renumberings = [];        // boundaries whose predecessor survives under a LATER number
  let priorTails = null;          // hashes of the last BOUNDARY_SLACK lines of the previous generation
  // …and of EVERY earlier generation, because rotation RENUMBERS them. A boundary written when its
  // predecessor was `.1` still names that same content after the file has been shifted to `.4`, and
  // matching only the adjacent generation calls that an edit. Measured 2026-09-02: git records this
  // store's `store/{touches.jsonl.1 => touches.jsonl.4}` as a pure rename, 0 lines changed, and the
  // live boundary hash matches `.4`'s last line exactly — an intact chain reported as chain-broken.
  // Maps hash -> the generation that carries it, so the report can say WHICH one it landed in.
  const priorTailsAll = new Map();
  let sawPriorGeneration = false;

  for (const path of ledgerChainPaths(livePath)) {
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') { files.push({ path, absent: true, lines: 0 }); continue; }
      throw e;
    }
    const tally = { verified: 0, raced: 0, unlinked: 0, unchained: 0, broken: 0, torn: 0, renumbered: 0 };
    const seen = new Set();
    const tailHashes = [];
    let prevHash = null;
    let lineNo = 0;
    for (const line of raw.split('\n')) {
      if (!line) continue;
      lineNo++;
      const h = lineHash(line);
      let rec = null;
      try { rec = JSON.parse(line); } catch { tally.torn++; }
      if (rec) {
        if (records) records.push(rec);
        const p = rec.prev;
        const broke = (why) => { tally.broken++; breaks.push({ path, line: lineNo, prev: p ?? null, why }); };
        if (p === undefined) tally.unchained++;
        else if (p === 'unlinked') tally.unlinked++;
        else if (p === 'genesis') {
          // Honest only at the very start of the oldest surviving generation. Anywhere else it is
          // the truncate-and-restart signature.
          if (prevHash === null && !sawPriorGeneration) tally.verified++;
          else broke(prevHash === null ? 'genesis after an earlier generation' : 'genesis mid-file');
        } else if (String(p).startsWith('rotation:')) {
          const want = String(p).slice('rotation:'.length);
          // No surviving prior generation: accepted on form — `.1` is replaced wholesale by each
          // rotation, so an aged-out boundary hash is the normal condition, not an edit.
          if (priorTails === null) tally.verified++;
          else if (priorTails.includes(want)) tally.verified++;
          // RENUMBERED, NOT BROKEN. The predecessor's CONTENT is still here, under a later number,
          // because every rotation shifts the archives down one. That is the chain holding, not
          // failing — and calling it `broken` is a fabricated critical on the one store whose whole
          // claim is that nothing has been forged. Counted separately so a real edit stays visible.
          else if (priorTailsAll.has(want)) {
            tally.renumbered++;
            renumberings.push({ path, line: lineNo, prev: p, foundIn: priorTailsAll.get(want) });
          } else broke('rotation boundary does not match the tail of ANY surviving generation');
        } else if (p === prevHash) tally.verified++;
        else if (seen.has(p)) tally.raced++;   // an overlap between writers, not an edit
        else broke('prev matches no line of this ledger');
      }
      seen.add(h);
      prevHash = h;
      tailHashes.push(h);
      if (tailHashes.length > BOUNDARY_SLACK) tailHashes.shift();
    }
    files.push({ path, absent: false, lines: lineNo, chain: tally });
    for (const k of Object.keys(totals)) totals[k] += tally[k];
    for (const h of tailHashes) if (!priorTailsAll.has(h)) priorTailsAll.set(h, path);
    priorTails = tailHashes.length ? tailHashes : priorTails;
    sawPriorGeneration = sawPriorGeneration || lineNo > 0;
  }

  const present = files.some((f) => !f.absent);
  const state = !present ? 'absent'
    : totals.broken ? 'chain-broken'
    : totals.torn ? 'torn'
    : 'ok';
  // A MISSING GENERATION IS ITS OWN FACT, not a generic boundary mismatch.
  //
  // Rotation numbers every archive `.1` (newest) upward, so the sequence beside a live ledger is
  // dense. A hole in it means a generation left without the shift that should have carried it, and
  // the live file's `rotation:<hash>` then points at a tail nobody holds any more. Measured
  // 2026-09-02 on this store: `.1` absent while `.2/.3/.4` exist, one break, and the orphaned
  // boundary hash matches the LAST line of `.4` — three generations further back than the
  // adjacent one. How the hole appeared is NOT diagnosed; both rotators shift-then-rename under a
  // lock, and nothing in the tree reproduces it.
  //
  // Reported rather than repaired, and separately from `breaks`, because the two need different
  // answers: a break inside a generation means a row was rewritten, and this means a FILE is gone.
  // Reading the second as the first sends the next person looking for a tamper that did not happen
  // — which is the hour this cost.
  const nums = archiveGenerations(livePath).map((g) => g.n).sort((a, b) => a - b);
  const gaps = nums.length
    ? Array.from({ length: nums[nums.length - 1] }, (_, i) => i + 1).filter((n) => !nums.includes(n))
    : [];
  // EXAMINED IS PART OF THE VERDICT, not a debug field.
  //
  // `breaks: 0` is produced by an intact chain AND by a chain nobody read, and those two printed
  // identically until 2026-09-06, when a session verifying six journals passed a path built from an
  // unexported shell variable, got `undefined/verdicts/liveness.jsonl` for every one, and reported
  // all six clean on the strength of `state`/`breaks` alone. `state: 'absent'` was sitting right
  // there in the same object and went unread, because the caller was asking the question it wanted
  // answered rather than the one that would have caught it.
  //
  // A caller that asserts `examined > 0` cannot make that mistake, and one that forgets to is no
  // worse off than before. This is the cheap half of the fix; the expensive half is that a zero
  // reading must never be the same shape as a clean one anywhere else in this repo either.
  totals.examined = totals.verified + totals.raced + totals.unlinked
    + totals.unchained + totals.broken + totals.torn + totals.renumbered;
  return { files, totals, breaks, renumberings, gaps, state, ...(records ? { records } : {}) };
}

/**
 * Weave rows from a DIVERGENT copy of this ledger onto the live tip.
 *
 * The case the chain has no answer for on its own. Two boxes append to the same journal, git merges
 * the two files, and every row from the losing side now names a `prev` that is not its predecessor
 * here. A union merge does not fix that — it manufactures it. Measured 2026-09-06 on the sidecar's
 * store/touches.jsonl: sorting two sides together broke 171 links, in a file that verified `ok` on
 * both sides beforehand.
 *
 * THE RULE THAT SHAPES THIS FUNCTION: rewriting `prev` is precisely what a forger does. A weave
 * that silently relinked rows would be indistinguishable, line for line, from a tamper — and would
 * leave the ledger verifying `ok` afterwards, which is worse than a visible break because it ends
 * the enquiry. So a woven row carries `woven: { was, from, at }`: `was` is the link it arrived
 * with, `from` names the copy it came from, `at` is when. The row's payload is never touched. The
 * chain becomes checkable again WITHOUT the history of the weave being erased to get there, and a
 * reader can still ask what each row originally claimed.
 *
 * Idempotent, because this repo's stores are re-run without ceremony: a row whose payload is
 * already present is skipped rather than appended twice, and the count of skips is returned rather
 * than swallowed. Payload identity deliberately EXCLUDES `prev` and `woven` — the same record
 * arriving under a different link is the same record, and keying on the link would re-weave it on
 * every pass.
 *
 * Returns { ok, woven, skipped, mode, error? }. Never throws; the lock failing is a refusal to
 * write, never a partial weave.
 */
export function weaveLedgerRows(ledgerPath, rows, {
  source = 'unknown', at = null,
  lockAttempts = LOCK_ATTEMPTS, lockSpinMs = LOCK_SPIN_MS, lockStaleMs = LOCK_STALE_MS,
} = {}) {
  if (!Array.isArray(rows)) return { ok: false, woven: 0, skipped: 0, mode: 'refused', error: 'rows must be an array' };
  if (!rows.length) return { ok: true, woven: 0, skipped: 0, mode: 'noop' };

  // Read at CALL time so a test can pin it; never at module load.
  const stamp = at || process.env.CW_NOW || new Date().toISOString();

  // CANONICAL, AND RECURSIVELY SO. The first version keyed on
  // `JSON.stringify(payload, Object.keys(payload).sort())` — a replacer ARRAY, which filters keys at
  // EVERY level, not just the top. Any nested key whose name did not also appear at the top level
  // was dropped from the identity, so two rows differing only inside `measured`/`states`/`pulse`
  // hashed the same and the second was skipped as a duplicate. Measured on the sidecar's
  // verdicts/liveness.jsonl: 155 rows woven where an independent payload comparison said 203 were
  // missing. A silent filter, in the one function whose whole job is not losing rows.
  const canon = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(canon);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  };
  const identity = (rec) => {
    const { prev: _p, woven: _w, ...payload } = rec;
    return lineHash(JSON.stringify(canon(payload)));
  };

  let lock = null;
  try {
    lock = acquireLock(ledgerLockPath(ledgerPath), {
      label: 'touch-ledger weave', attempts: lockAttempts, spinMs: lockSpinMs, staleMs: lockStaleMs,
    });
  } catch { lock = null; }
  if (!lock || !lock.ok) return { ok: false, woven: 0, skipped: 0, mode: 'refused', error: 'lock unavailable' };

  try {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    // The whole live generation, because idempotence is decided over the file and not its tail.
    // Archives are NOT read: a row that has aged into `.1` is not a duplicate of one being woven in
    // now, it is the same record at a different point in the store's life, and re-weaving it would
    // be the honest outcome if it were ever handed back.
    let present = new Set();
    try {
      for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
        if (!line) continue;
        try { present.add(identity(JSON.parse(line))); } catch { /* a torn line is not an identity */ }
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }

    let woven = 0, skipped = 0;
    for (const rec of rows) {
      if (!rec || typeof rec !== 'object') { skipped++; continue; }
      const id = identity(rec);
      if (present.has(id)) { skipped++; continue; }
      const tail = readTailLine(ledgerPath);
      const prev = tail === null ? 'genesis' : lineHash(tail);
      const { prev: was = null, woven: _prior, ...payload } = rec;
      const { line } = fitRecord({ ...payload, woven: { was, from: source, at: stamp }, prev });
      appendFileSync(ledgerPath, `${line}\n`);
      present.add(id);
      woven++;
    }
    return { ok: true, woven, skipped, mode: 'woven' };
  } catch (e) {
    return { ok: false, woven: 0, skipped: 0, mode: 'failed', error: String(e && e.message || e) };
  } finally {
    try { lock.release(); } catch { /* released is released */ }
  }
}

/**
 * Re-link a ledger whose CONTENT was rewritten in place, against a witness copy that still holds
 * the pre-rewrite lines.
 *
 * The case: a PII scrub rewrote `/Users/<a>/` to `/Users/<b>/` inside a chained ledger on
 * 2026-09-02. Line count was compared before and after and matched perfectly — a content rewrite
 * preserves it — so the scrub's own success criterion was structurally incapable of noticing that
 * every rewritten line's hash had changed and orphaned its successor. 47 breaks in
 * verdicts/liveness.jsonl, and nothing reported the cause; the panel published "records were edited
 * or removed" at top severity, which is true of a scrub and reads as forgery.
 *
 * WHY A WITNESS IS MANDATORY. Re-linking is indistinguishable from forging unless you can show the
 * break was caused by something other than an edit you are now concealing. So every break must be
 * PROVEN scrub-caused first: its orphaned `prev` has to match a real line of the witness. A break
 * whose predecessor is in NO witness line is exactly the case this must not touch — it could be the
 * tamper the chain exists to catch — so a single unproven break REFUSES THE WHOLE RESEAL rather
 * than repairing what it can. Partial credit on a tamper-evidence store is worse than none: it
 * leaves a file that verifies with the interesting row quietly skipped.
 *
 * THE CASCADE IS THE POINT, not an implementation detail. Rewriting one row's `prev` changes that
 * row's hash, which orphans ITS successor, all the way to EOF. So every row from the first break
 * onward is re-linked and EVERY re-linked row is marked `resealed:{was,from,at,reason}` — including
 * rows that were never broken themselves and are only downstream. A downstream row's link WAS
 * rewritten; saying so is the difference between a repair and a laundering. `was` keeps the link the
 * row carried before, so the pre-reseal chain is still reconstructible from the file itself.
 *
 * Rows are never re-ordered and payloads are never touched: this restores the LINKS, and the scrub's
 * redaction stands. Recovering the pre-scrub CONTENT would undo the redaction, which is why the
 * witness is read and never copied back.
 *
 * Returns { ok, resealed, proven, refused, firstLine, error? }. Never throws.
 */
export function resealChain(ledgerPath, {
  witness, from = 'unknown', reason = 'predecessor content rewritten in place', at = null,
  lockAttempts = LOCK_ATTEMPTS, lockSpinMs = LOCK_SPIN_MS, lockStaleMs = LOCK_STALE_MS,
} = {}) {
  if (!witness) return { ok: false, resealed: 0, proven: 0, refused: 'no witness supplied — a reseal without one cannot be told from a forgery' };
  const stamp = at || process.env.CW_NOW || new Date().toISOString();

  let witnessHashes;
  try {
    witnessHashes = new Set(readFileSync(witness, 'utf8').split('\n').filter(Boolean).map(lineHash));
  } catch (e) { return { ok: false, resealed: 0, proven: 0, refused: `witness unreadable: ${e.code || e.message}` }; }
  if (!witnessHashes.size) return { ok: false, resealed: 0, proven: 0, refused: 'witness is empty — it proves nothing' };

  let lock = null;
  try {
    lock = acquireLock(ledgerLockPath(ledgerPath), {
      label: 'ledger reseal', attempts: lockAttempts, spinMs: lockSpinMs, staleMs: lockStaleMs,
    });
  } catch { lock = null; }
  if (!lock || !lock.ok) return { ok: false, resealed: 0, proven: 0, refused: 'lock unavailable' };

  try {
    const lines = readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    if (!lines.length) return { ok: true, resealed: 0, proven: 0, firstLine: null };

    // PASS 1 — prove every break, changing nothing. A refusal must cost the file nothing.
    const breaks = [];
    let prevHash = null;
    for (let i = 0; i < lines.length; i++) {
      let rec = null;
      try { rec = JSON.parse(lines[i]); } catch { prevHash = lineHash(lines[i]); continue; }
      const p = rec.prev;
      const linked = p === undefined || p === 'genesis' || p === 'unlinked'
        || String(p).startsWith('rotation:') || p === prevHash;
      if (!linked) breaks.push({ index: i, prev: p });
      prevHash = lineHash(lines[i]);
    }
    if (!breaks.length) return { ok: true, resealed: 0, proven: 0, firstLine: null };

    const unproven = breaks.filter((b) => !witnessHashes.has(b.prev));
    if (unproven.length) {
      return {
        ok: false, resealed: 0, proven: breaks.length - unproven.length,
        refused: `${unproven.length} of ${breaks.length} break(s) name a predecessor absent from the witness `
          + `(first at line ${unproven[0].index + 1}) — not proven scrub-caused, so nothing was rewritten`,
      };
    }

    // PASS 2 — re-link from the first break to EOF, marking every row whose link is rewritten.
    const first = breaks[0].index;
    let resealed = 0;
    prevHash = first === 0 ? null : lineHash(lines[first - 1]);
    for (let i = first; i < lines.length; i++) {
      let rec = null;
      try { rec = JSON.parse(lines[i]); } catch { prevHash = lineHash(lines[i]); continue; }
      const want = prevHash === null ? 'genesis' : prevHash;
      if (rec.prev !== want) {
        const { prev: was = null, ...payload } = rec;
        const { line } = fitRecord({ ...payload, resealed: { was, from, at: stamp, reason }, prev: want });
        lines[i] = line;
        resealed++;
      }
      prevHash = lineHash(lines[i]);
    }

    const tmp = `${ledgerPath}.reseal.${process.pid}`;
    writeFileSync(tmp, lines.join('\n') + '\n');
    renameSync(tmp, ledgerPath);                 // atomic, per the house rule
    return { ok: true, resealed, proven: breaks.length, firstLine: first + 1 };
  } catch (e) {
    return { ok: false, resealed: 0, proven: 0, refused: `failed: ${String(e && e.message || e)}` };
  } finally {
    try { lock.release(); } catch { /* released is released */ }
  }
}

// ── THE REWRITE GUARD ───────────────────────────────────────────────────────────────────────────
//
// The rule these two functions exist to enforce: ANY pass that rewrites the CONTENT of a chained
// ledger must verify the chain afterwards, and must be gated on THAT — never on line count.
//
// Written from the 2026-09-02 PII scrub, which rewrote /Users/<a>/ to /Users/<b>/ inside
// verdicts/liveness.jsonl. Its stated success criterion was that the line count matched before and
// after. A content rewrite preserves line count EXACTLY, so the guard was structurally incapable of
// moving: it reported success while orphaning 47 successors, and the damage was found eight days
// later by page accounting on an unrelated question.
//
// That is the fourth instance of one defect this estate has measured in a week — a check that
// verifies a property ADJACENT to the one that matters. The others: an MCP config present, valid,
// and in a file nothing reads for that key; gate-spine asking whether the store opens rather than
// whether it still holds what was filed; and a chain verifier handed a path built from an
// unexported shell variable, reporting `breaks: 0` for six journals it never opened. In every case
// the proxy was true and the property was false.
//
// A snapshot is per-PATH and records the break count, not just the state, because a store that was
// already broken must not launder a NEW break behind an unchanged verdict. `chain-broken` before
// and `chain-broken` after is not a pass when the count went 1 -> 12.

/** State + break count per path, before a rewrite. Absent and unreadable are their own states. */
export function chainSnapshot(paths) {
  const out = {};
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    try {
      const r = verifyLedgerChain(p);
      out[p] = { state: r.state, broken: r.totals.broken, torn: r.totals.torn, examined: r.totals.examined };
    } catch (e) {
      // Fail closed. An unreadable ledger is never a clean one, and must not become the baseline
      // that excuses whatever the rewrite does to it next.
      out[p] = { state: 'unreadable', broken: null, torn: null, examined: 0, error: e.code || String(e.message || e) };
    }
  }
  return out;
}

/**
 * Compare a post-rewrite snapshot against its baseline and name every path that got WORSE.
 * Returns { ok, degraded: [{path, was, now, why}] }. `ok` is false if anything degraded.
 *
 * DEGRADED means any of: more broken links, more torn lines, a readable ledger becoming unreadable,
 * or examined dropping to zero where it was not zero — that last one because a rewrite that empties
 * or truncates a store leaves nothing to break, and "0 breaks in 0 rows" is the shape of a clean
 * result. It is the same unwitnessed zero `totals.examined` was added to catch.
 */
export function chainDegradation(before, after) {
  const degraded = [];
  for (const path of Object.keys(after || {})) {
    const was = (before || {})[path];
    const now = after[path];
    if (!was) continue;                                  // a path that did not exist before is not a regression
    const why = [];
    if (now.state === 'unreadable' && was.state !== 'unreadable') why.push('became unreadable');
    if (Number.isFinite(now.broken) && Number.isFinite(was.broken) && now.broken > was.broken) {
      why.push(`broken ${was.broken} -> ${now.broken}`);
    }
    if (Number.isFinite(now.torn) && Number.isFinite(was.torn) && now.torn > was.torn) {
      why.push(`torn ${was.torn} -> ${now.torn}`);
    }
    if (was.examined > 0 && now.examined === 0) why.push(`examined ${was.examined} -> 0 (nothing left to verify)`);
    if (why.length) degraded.push({ path, was, now, why: why.join('; ') });
  }
  return { ok: degraded.length === 0, degraded };
}

