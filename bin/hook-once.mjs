// Say it ONCE. Shared suppression for the Stop-hook gates (gate-ratchet, gate-tests).
//
// A Stop hook re-runs every turn, so an unchanged gate repeats verbatim forever — noise that
// buries the turn where something actually changed. So: fingerprint what would be said and stay
// quiet while it holds; the gate still runs and measures honestly, and a changed message goes out
// immediately carrying how many turns were silenced.
//
// ONE FILE PER KEY is the storage design, not tidiness: a shared-map read-modify-write loses a
// concurrent gate's update (both fire on the same Stop event). Disjoint paths make that
// unrepresentable; same-key racers compute the same fingerprint and cannot delete a third party.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../monitor/lockfile.mjs';   // the tree's one mutex
import { appendRecord, adjudicationsPath, redactLedgerFields } from './lib/verdict-journal-core.mjs';
import { buildSuppressionLabel } from '../monitor/annotate-lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Read env at call time (a const at import defeats test overrides). A DIRECTORY — one file per key.
const stateDir = () => process.env.CW_HOOK_STATE || join(REPO, '.claude', 'hook-emit');

// Keys are hook names chosen in this repo, but a key is never trusted into a path.
const safeKey = (key) => String(key).replace(/[^A-Za-z0-9._-]/g, '_');
const keyPath = (key) => join(stateDir(), `${safeKey(key)}.json`);

// ── TRANSITION EVENTS ───────────────────────────────────────────────────────────────────────────
// `<key>.events.jsonl` records state changes only — `shown` (with how many turns were silenced)
// and `forgotten` (with its reason). Written through the shared append primitive; fail-open.
const eventsPath = (key) => join(stateDir(), `${safeKey(key)}.events.jsonl`);
const appendEvent = (key, event) =>
  appendRecord(eventsPath(key), { v: 1, key: safeKey(key), at: process.env.CW_NOW || new Date().toISOString(), ...event });

const fingerprint = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

// ── FATIGUE LABEL: a suppression STREAK earns one ledger record ─────────────────────────────────
// A long streak surfaces to verdict-journal's fatigueReport (--tally). CW_HOOK_STREAK_THRESHOLD
// read at call time so a fixture can pick a small N.
const DEFAULT_STREAK_THRESHOLD = 5;
const streakThreshold = () => {
  const n = Number(process.env.CW_HOOK_STREAK_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_STREAK_THRESHOLD;
};

function readRecord(key) {
  try { return JSON.parse(readFileSync(keyPath(key), 'utf8')); } catch { return null; }
}
function writeRecord(key, record) {
  mkdirSync(stateDir(), { recursive: true });
  const p = keyPath(key);
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, p);   // atomic, per the house rule
}

/**
 * Decide whether `message` is new for `key`. Returns { changed, silenced, at } — changed:false
 * means an identical message was already shown (caller exits quietly). Not time-based: a repeat is
 * worth showing when the FACTS moved, not the clock.
 */
export function shouldEmit(key, message) {
  // The read-modify-write on `silenced` is guarded per-key because Stop hooks fire concurrently.
  // Fail OPEN, unlike the ledger: a lock that cannot be taken returns changed:true (a message
  // shown twice is noise; one wrongly suppressed is a signal that never arrives). Best-effort —
  // state here is an optimisation and must never fail a gate.
  let lock = null;
  try {
    mkdirSync(stateDir(), { recursive: true });
    lock = acquireLock(`${keyPath(key)}.lock`, {
      label: 'hook-once', attempts: 40, spinMs: 5, staleMs: 30_000,
    });
  } catch { lock = null; }
  if (lock && !lock.ok) return { changed: true, silenced: 0, at: process.env.CW_NOW || new Date().toISOString() };
  try {
    return decideEmit(key, message);
  } finally {
    try { lock?.release?.(); } catch { /* the lock went stale under us; nothing to undo */ }
  }
}

/** The read-modify-write itself. Only reached with the per-key lock held — see shouldEmit. */
function decideEmit(key, message) {
  const prev = readRecord(key);
  const fp = fingerprint(message);
  if (prev && prev.fp === fp) {
    const record = { ...prev, silenced: (prev.silenced || 0) + 1 };
    // Label the streak once, the turn it first crosses the threshold; `streakLabeled` is the
    // one-shot guard, reset naturally when a CHANGED message starts a fresh record.
    if (record.silenced === streakThreshold() && !record.streakLabeled) {
      record.streakLabeled = true;
      try {
        appendRecord(adjudicationsPath(), redactLedgerFields(buildSuppressionLabel({
          target: safeKey(key), action: 'silence', count: record.silenced, who: 'hook-once',
          at: process.env.CW_NOW || new Date().toISOString(),
        })));
      } catch { /* fatigue ledger is an optimisation; never fail a gate over it */ }
    }
    try { writeRecord(key, record); } catch { /* state is an optimisation; never fail a gate over it */ }
    return { changed: false, silenced: record.silenced, at: prev.at };
  }
  const silenced = prev ? (prev.silenced || 0) : 0;
  // `message` makes the record self-describing; `at` doubles as first-shown-at (suppressed turns
  // preserve it, a changed message resets it), so there is no separate firstShownAt field.
  const record = { fp, at: process.env.CW_NOW || new Date().toISOString(), silenced: 0, message: String(message) };
  try { writeRecord(key, record); } catch { /* as above */ }
  appendEvent(key, { event: 'shown', fp, silencedBefore: silenced });
  return { changed: true, silenced, at: record.at };
}

/** Reset one key (or all), so the next run speaks again. Used by --baseline paths and tests. */
export function forget(key, reason) {
  if (!key) {
    // Keyless reset removes the RECORDS only — the event journals are durable history.
    try {
      for (const f of readdirSync(stateDir())) {
        if (!f.endsWith('.events.jsonl')) rmSync(join(stateDir(), f), { force: true });
      }
    } catch { /* absent dir means nothing to reset */ }
    return;
  }
  // rm FIRST, event after: the reverse could record `forgotten` while the fingerprint survives
  // and keeps silencing — a journal that contradicts behaviour, worse than a gap.
  try { rmSync(keyPath(key), { force: true }); } catch { /* ignore */ }
  appendEvent(key, { event: 'forgotten', ...(reason ? { reason } : {}) });
}

/** A short "…and it stayed that way for N turns" suffix, or '' when this is the first showing. */
export const silenceNote = (n) =>
  (n > 0 ? ` (previous state held for ${n} more turn${n === 1 ? '' : 's'} without being repeated)` : '');
