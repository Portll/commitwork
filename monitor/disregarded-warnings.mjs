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
// aside yet"; anything else unreadable is a failure, never an empty register.

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { writeAtomic, acquireLockOrReason } from './lockfile.mjs';

export const DISPOSITIONS = ['fresh', 'returned', 'unidentified'];

const TOKEN = /^[A-Za-z0-9._-]+$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

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

/**
 * { ok:true, records, absent } or { ok:false, error }. Only ENOENT is absence; a parse failure or a
 * wrong shape is a failure, because an empty register would turn every return into a fresh warning.
 */
export function readRegister(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, records: [], absent: true };
    return { ok: false, error: `register unreadable (${e.code || e.message})` };
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return { ok: false, error: `register unparseable (${e.message})` }; }
  if (!doc || !Array.isArray(doc.disregarded)) return { ok: false, error: 'register has no disregarded[] array' };
  return { ok: true, records: doc.disregarded, absent: false };
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
  // The lock would mkdir its parent, and a real monitor/private/ where the sidecar link belongs is
  // the degraded state docs/TRAPS.md describes — so an absent directory refuses instead.
  try { if (!statSync(dirname(path)).isDirectory()) return { ok: false, error: `${dirname(path)} is not a directory` }; } catch (e) {
    return { ok: false, error: `register directory ${dirname(path)} unavailable (${e.code || e.message}) — link the private store or set CW_DISREGARDED_WARNINGS` };
  }
  const got = acquireLockOrReason(join(dirname(path), `.${basename(path)}.lock`), { staleMs: 30_000, label: 'disregard', attempts: 50, spinMs: 20 });
  if (!got.ok) return { ok: false, error: got.reason === 'busy' ? 'register is locked by another writer — try again' : `register lock unavailable (${got.code || got.message})` };
  const { lock } = got;
  try {
    const cur = readRegister(path);
    if (!cur.ok) return { ok: false, error: `${cur.error} — refusing to overwrite it` };
    const dup = cur.records.some((r) => warningKey(r) === key && r.why === entry.why && r.who === entry.who && r.at === entry.at);
    if (dup) return { ok: true, appended: false, key, total: cur.records.length };
    const doc = { disregarded: [...cur.records, entry] };
    writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
    return { ok: true, appended: true, key, total: doc.disregarded.length };
  } finally { lock.release(); }
}

/**
 * Pure. Tags each warning `fresh`, `returned` (set aside at or before `now`) or `unidentified`
 * (no usable identity, so it could not be checked — never silently `fresh`). Also names the
 * set-asides not seen in this batch (`quiet`) and the records that failed validation (`invalid`).
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
    if (!key) return { ...w, key: null, disposition: 'unidentified' };
    seen.add(key);
    const hit = byKey.get(key);
    if (!hit) return { ...w, key, disposition: 'fresh' };
    const { why, who, at } = hit.latest;
    return { ...w, key, disposition: 'returned', disregarded: { why, who, at, firstAt: hit.first.at, setAsides: hit.setAsides } };
  });
  const counts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  for (const r of rows) counts[r.disposition] += 1;
  const quiet = [...byKey.keys()].filter((k) => !seen.has(k)).sort()
    .map((key) => { const { why, who, at } = byKey.get(key).latest; return { key, why, who, at }; });
  return { rows, counts, quiet, invalid };
}
