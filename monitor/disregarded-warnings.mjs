// disregarded-warnings.mjs — the register of warnings an operator saw and set aside (roadmap W2).
//
// A set-aside is kept, never deleted, so that when the same warning comes back it reads as the
// RETURN of something already judged — with the judgment beside it — rather than as a fresh
// warning nobody has looked at, or as nothing at all.
//
// Identity is place, never position or wording: {source, code, subject}. `line` is never part of
// it (CLAUDE.md, "never key an identity on a line number"), and neither is the message, whose text
// carries dates and counts that change on every run. The key mirrors the suppression-label target
// shape (`category:tuple`, monitor/annotate-lib.mjs) so a set-aside lands in the fatigue ledger
// under the same string the register matches on.
//
// The store is a private record (it names the operator's repositories): monitor/private/
// disregarded-warnings.json, CW_DISREGARDED_WARNINGS overrides. Append-only. ENOENT is "nothing set
// aside yet"; anything else unreadable is a failure, never an empty register. Beside the set-asides
// (`disregarded[]`) it keeps `returned[]`: one event per set-aside the first time its warning is seen
// after it, written by bin/digest.mjs --write, so a return is on record even if nobody reads the digest.

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { writeAtomic, acquireLockOrReason } from './lockfile.mjs';

// `set-aside`: seen at or before the set-aside in force — the occurrence that was judged, not a return.
export const DISPOSITIONS = ['fresh', 'returned', 'set-aside', 'unidentified'];

const TOKEN = /^[A-Za-z0-9._-]+$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const isTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// `file.mjs:123` and `file.mjs:123:7` name the same warning as `file.mjs`. Only a suffix after a
// letter-led extension is stripped, so `127.0.0.1:7878` keeps its port.
export function normaliseSubject(subject) {
  if (typeof subject !== 'string') return null;
  const s = subject.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return s.replace(/(\.[A-Za-z][A-Za-z0-9]*):\d+(?::\d+)?$/, '$1') || null;
}

/** `source:code|subject`, or null when any part is missing or malformed. */
export function warningKey(w) {
  if (!w || typeof w !== 'object') return null;
  const subject = normaliseSubject(w.subject);
  if (!TOKEN.test(w.source || '') || !TOKEN.test(w.code || '') || !subject) return null;
  return `${w.source}:${w.code}|${subject}`;
}

// The identities bin/digest.mjs and the Settings sweep table give the warnings they check. Declared
// once, so two readers cannot key one warning two ways.
export const floorBreachWarning = (gate, subject) => ({ source: gate, code: 'floor-breached', subject });
export const sweepFailureWarning = (code, area, place) => ({
  source: 'sweep', code, subject: [area, place].filter((p) => p != null && p !== '').join('/'),
});
export const sweepHungWarning = (area) => ({ source: 'sweep-health', code: 'sweep-hung', subject: area });
export const scheduledJobWarning = (job, step) => ({ source: 'scheduled-job', code: 'step-failed', subject: `${job}/${step}` });

/** Errors for one register record; [] when valid. A record that fails is reported, never applied. */
export function validateDisregard(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['record is not an object'];
  const errs = [];
  if (!TOKEN.test(r.source || '')) errs.push('source must be a token ([A-Za-z0-9._-]+) naming the tool that warned');
  if (!TOKEN.test(r.code || '')) errs.push('code must be a token ([A-Za-z0-9._-]+) naming the kind of warning');
  if (!normaliseSubject(r.subject)) errs.push('subject is required (the place: a repo, area, file or check)');
  if (!nonEmpty(r.why)) errs.push('why is required — a set-aside with no reason cannot be re-judged when it returns');
  if (!nonEmpty(r.who)) errs.push('who is required (free text)');
  if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) errs.push('at must be an ISO timestamp');
  if (r.line !== undefined) errs.push('line is not part of a warning\'s identity — put the place in subject');
  return errs;
}

/** Errors for one recorded return; [] when valid. */
export function validateReturn(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['return is not an object'];
  const errs = [];
  const key = warningKey(e);
  if (!key) errs.push('source, code and subject must form a warning identity');
  else if (e.key !== key) errs.push(`key must be ${key}`);
  for (const f of ['setAsideAt', 'seenAt', 'recordedAt']) if (!isTime(e[f])) errs.push(`${f} must be an ISO timestamp`);
  if (!TOKEN.test(e.via || '')) errs.push('via must be a token naming the reader that saw the return');
  return errs;
}

/**
 * { ok:true, records, returns, absent, doc } or { ok:false, error }. Only ENOENT is absence; a parse
 * failure or a wrong shape is a failure, because an empty register would turn every return into a
 * fresh warning.
 */
export function readRegister(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, records: [], returns: [], absent: true };
    return { ok: false, error: `register unreadable (${e.code || e.message})` };
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return { ok: false, error: `register unparseable (${e.message})` }; }
  if (!doc || !Array.isArray(doc.disregarded)) return { ok: false, error: 'register has no disregarded[] array' };
  if (doc.returned !== undefined && !Array.isArray(doc.returned)) return { ok: false, error: 'register returned is not an array' };
  return { ok: true, records: doc.disregarded, returns: doc.returned || [], absent: false, doc };
}

// The lock would mkdir its parent, and a real monitor/private/ where the sidecar link belongs is the
// degraded state docs/TRAPS.md describes — so an absent directory refuses instead.
function withRegister(path, fn) {
  try { if (!statSync(dirname(path)).isDirectory()) return { ok: false, error: `${dirname(path)} is not a directory` }; } catch (e) {
    return { ok: false, error: `register directory ${dirname(path)} unavailable (${e.code || e.message}) — link the private store or set CW_DISREGARDED_WARNINGS` };
  }
  const got = acquireLockOrReason(join(dirname(path), `.${basename(path)}.lock`), { staleMs: 30_000, label: 'disregard', attempts: 50, spinMs: 20 });
  if (!got.ok) return { ok: false, error: got.reason === 'busy' ? 'register is locked by another writer — try again' : `register lock unavailable (${got.code || got.message})` };
  try {
    const cur = readRegister(path);
    if (!cur.ok) return { ok: false, error: `${cur.error} — refusing to overwrite it` };
    return fn(cur);
  } catch (e) {
    return { ok: false, error: `register write failed (${e.code || e.message})` };
  } finally { got.lock.release(); }
}

/**
 * Append one set-aside. Idempotent: an identical record (same key, why, who, at) is not appended
 * twice. Returns { ok, appended, key, total } or { ok:false, error }.
 */
export function appendDisregard(path, rec) {
  const errs = validateDisregard(rec);
  if (errs.length) return { ok: false, error: errs.join('; ') };
  const entry = {
    source: rec.source, code: rec.code, subject: normaliseSubject(rec.subject),
    why: rec.why, who: rec.who, at: new Date(rec.at).toISOString(),
    ...(nonEmpty(rec.message) ? { message: rec.message } : {}),
  };
  const key = warningKey(entry);
  return withRegister(path, (cur) => {
    const dup = cur.records.some((r) => warningKey(r) === key && r.why === entry.why && r.who === entry.who && r.at === entry.at);
    if (dup) return { ok: true, appended: false, key, total: cur.records.length };
    const doc = { ...(cur.doc || {}), disregarded: [...cur.records, entry] };
    writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
    return { ok: true, appended: true, key, total: doc.disregarded.length };
  });
}

/**
 * Record returns: `events` are {source, code, subject, setAsideAt, seenAt}. One event per (key,
 * set-aside) is kept — the first time the warning was seen after that set-aside — so re-running the
 * reader appends nothing, and setting the warning aside again re-arms it. Returns { ok, appended,
 * already } or { ok:false, error }; nothing to record touches nothing.
 */
export function recordReturns(path, events, { now, via }) {
  const entries = [];
  for (const ev of events || []) {
    const e = {
      key: warningKey(ev), source: ev.source, code: ev.code, subject: normaliseSubject(ev.subject),
      setAsideAt: isTime(ev.setAsideAt) ? new Date(ev.setAsideAt).toISOString() : ev.setAsideAt,
      seenAt: isTime(ev.seenAt) ? new Date(ev.seenAt).toISOString() : ev.seenAt,
      recordedAt: isTime(now) ? new Date(now).toISOString() : now, via,
    };
    const errs = validateReturn(e);
    if (errs.length) return { ok: false, error: `return ${e.key || '(no identity)'} refused: ${errs.join('; ')}` };
    entries.push(e);
  }
  if (!entries.length) return { ok: true, appended: 0, already: 0 };
  const id = (r) => `${r && r.key}\u0000${r && r.setAsideAt}`;
  // Every return already on record needs no lock, so a reader that only re-sees them never writes.
  const pre = readRegister(path);
  if (pre.ok && !pre.absent) {
    const held = new Set(pre.returns.map(id));
    if (entries.every((e) => held.has(id(e)))) return { ok: true, appended: 0, already: entries.length };
  }
  return withRegister(path, (cur) => {
    if (cur.absent) return { ok: false, error: 'no register to record a return in — a return needs the set-aside it returned from' };
    const held = new Set(cur.returns.map(id));
    const add = [];
    for (const e of entries) {
      if (held.has(id(e))) continue;
      held.add(id(e));
      add.push(e);
    }
    if (add.length) writeAtomic(path, `${JSON.stringify({ ...cur.doc, returned: [...cur.returns, ...add] }, null, 2)}\n`);
    return { ok: true, appended: add.length, already: entries.length - add.length };
  });
}

/**
 * Pure. Tags each warning `fresh`, `returned` (set aside at or before `now`), `set-aside` (its
 * `seenAt` is no later than that set-aside, so it is the occurrence that was judged) or
 * `unidentified` (no usable identity or an unparseable `seenAt`, so it could not be checked — never
 * silently `fresh`). A warning without `seenAt` is a standing state and reads `returned`. Also names
 * the set-asides not seen in this batch (`quiet`) and the records that failed validation (`invalid`).
 * Output order follows input order; quiet is sorted by key.
 */
export function classifyWarnings(warnings, records, { now }) {
  const invalid = [];
  const byKey = new Map();
  for (const r of records || []) {
    const errs = validateDisregard(r);
    if (errs.length) { invalid.push({ record: r, errors: errs }); continue; }
    if (r.at > now) continue; // not yet in force as-of now (CW_NOW replays)
    const k = warningKey(r);
    const cur = byKey.get(k) || { setAsides: 0, latest: null, first: null };
    cur.setAsides += 1;
    if (!cur.latest || r.at > cur.latest.at) cur.latest = r;
    if (!cur.first || r.at < cur.first.at) cur.first = r;
    byKey.set(k, cur);
  }
  const seen = new Set();
  const rows = (warnings || []).map((w) => {
    const key = warningKey(w);
    const timed = w && w.seenAt != null;
    if (!key || (timed && !isTime(w.seenAt))) return { ...w, key: key || null, disposition: 'unidentified' };
    seen.add(key);
    const hit = byKey.get(key);
    if (!hit) return { ...w, key, disposition: 'fresh' };
    const { why, who, at } = hit.latest;
    const judged = timed && Date.parse(w.seenAt) <= Date.parse(at);
    return { ...w, key, disposition: judged ? 'set-aside' : 'returned', disregarded: { why, who, at, firstAt: hit.first.at, setAsides: hit.setAsides } };
  });
  const counts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  for (const r of rows) counts[r.disposition] += 1;
  const quiet = [...byKey.keys()].filter((k) => !seen.has(k)).sort()
    .map((key) => { const { why, who, at } = byKey.get(key).latest; return { key, why, who, at }; });
  return { rows, counts, quiet, invalid };
}
