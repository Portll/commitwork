// monitor/inbox.mjs — what changed for one area since its last sweep, as inbox items, plus the
// per-operator read/snooze state. Derived at request time from records that already exist: the
// rollup's own scannerDelta (place-keyed, never line), the in-flight marker and the issue store's
// last ingest. Nothing here is a verdict on a finding. A signal that could not be measured is listed
// under `notMeasured` with its reason, never dropped and never shown as an empty tab.
//
// env, read at call time: CW_INBOX_STATE (the state file, default monitor/private/inbox-state.json)

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDir } from './store-paths.mjs';
import { acquireLock, writeAtomic } from './lockfile.mjs';
import { identityFor } from './detail-schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const INBOX_STATE_SCHEMA = 'commitwork.inbox-state/1';
export const INBOX_KINDS = Object.freeze(['sweep-failed', 'new-kev', 'new-critical', 'lane-undetermined', 'ingest-behind']);
export const PRIORITY_KINDS = Object.freeze(['sweep-failed', 'new-kev', 'new-critical']);
export const SNOOZE_DAYS_DEFAULT = 7;
export const STATE_CAP = 5000;
const DAY_MS = 86_400_000;

/** One item; the id is stable across reads of the same record and never carries a line number. */
const item = (kind, project, subject, fields) => ({
  id: [kind, project, subject].join('|'), kind, project, priority: PRIORITY_KINDS.includes(kind), ...fields,
});

function rowPlaceKey(cat, row, idFields) {
  return [String(row.repo ?? ''), cat, ...idFields.map((f) => String(row[f] ?? ''))].join('|');
}

/**
 * @param {object} a
 * @param {string} a.project
 * @param {object} a.rollup          the area's rollup.json
 * @param {object} a.inflight        liveness readInflight() result for the area's report dir
 * @param {object|null} a.lastIngest the issue store's lastIngest entry for the area, null if never
 * @param {string|null} a.ingestError the issue store could not be read
 * @returns {{items: object[], notMeasured: {signal, reason}[], sliceId, prevSliceId}}
 */
export function deriveInbox({ project, rollup, inflight, lastIngest = null, ingestError = null }) {
  const items = [];
  const notMeasured = [];
  const sliceId = rollup.sliceId || null;
  const generated = rollup.generated || null;

  if (inflight.verdict === 'hung') {
    items.push(item('sweep-failed', project, `slice:${inflight.sliceId || '?'}`, {
      title: `Sweep did not finish: started ${inflight.ageMin} min ago, ${inflight.pidState === 'dead' ? `pid ${inflight.pid} is dead` : 'its process could not be probed'}; nothing was published`,
      at: inflight.startedAt || null, detail: { sliceId: inflight.sliceId, pid: inflight.pid, pidState: inflight.pidState || null } }));
  } else if (inflight.verdict === 'unreadable') {
    items.push(item('sweep-failed', project, `marker-unreadable:${inflight.detail}`, {
      title: `Sweep state cannot be read: the in-flight marker is ${inflight.detail}; treated as failed`, at: null, detail: { marker: inflight.detail } }));
  }

  const delta = rollup.scannerDelta;
  if (!delta || typeof delta !== 'object' || !delta.byCategory) {
    notMeasured.push({ signal: 'new-since-last-sweep', reason: 'this rollup carries no scannerDelta' });
  } else {
    if (!delta.comparable) notMeasured.push({ signal: 'new-since-last-sweep', reason: `no lane was comparable with the previous slice (${delta.prevSliceId || 'none'})` });
    const sf = rollup.scannerFindings || {};
    for (const [cat, d] of Object.entries(delta.byCategory).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!d || d.status !== 'compared') continue;
      const listed = Array.isArray(d.newPlaces) ? d.newPlaces : [];
      const beyond = (d.truncated && d.truncated.newPlaces) || 0;
      const crit = (d.newBySev && d.newBySev.crit) || 0;
      if (crit > 0) {
        items.push(item('new-critical', project, `${cat}|${sliceId}`, {
          title: `${crit} new critical place(s) in ${cat}`, at: generated,
          detail: { lane: cat, count: crit, places: listed.filter((p) => p.sev === 'crit'), beyondCap: beyond } }));
      }
      // KEV is a row property and newPlaces does not carry it, so it is read off the current rows
      // of the LISTED places; places past the display cap were not checked, and the item says so.
      const idFields = identityFor(cat);
      if (!idFields || !listed.length) continue;
      const newKeys = new Set(listed.map((p) => [p.repo, cat, ...idFields.map((f) => String(p[f] ?? ''))].join('|')));
      const kevPlaces = new Map();
      for (const row of Array.isArray(sf[cat]) ? sf[cat] : []) {
        if (!row || row.kev !== true) continue;
        const k = rowPlaceKey(cat, row, idFields);
        if (newKeys.has(k) && !kevPlaces.has(k)) kevPlaces.set(k, { repo: row.repo, ...Object.fromEntries(idFields.map((f) => [f, row[f] ?? null])), sev: row.sev || null });
      }
      if (kevPlaces.size || beyond) {
        if (kevPlaces.size) {
          items.push(item('new-kev', project, `${cat}|${sliceId}`, {
            title: `${kevPlaces.size} new place(s) in ${cat} carry a known-exploited advisory`, at: generated,
            detail: { lane: cat, count: kevPlaces.size, places: [...kevPlaces.values()], beyondCap: beyond } }));
        }
        if (beyond) notMeasured.push({ signal: `new-kev:${cat}`, reason: `${beyond} new place(s) past the delta's display cap were not checked for KEV` });
      }
    }
  }

  for (const [cat, sc] of Object.entries(rollup.scanners || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!sc || sc.coverage !== 'unknown') continue;
    const reason = String(sc.coverageReason || 'no reason recorded').slice(0, 300);
    items.push(item('lane-undetermined', project, `${cat}|${reason}`, {
      title: `${cat}: coverage is undetermined in this sweep`, at: generated,
      detail: { lane: cat, reason, coverageChecks: sc.coverageChecks || null } }));
  }

  if (ingestError) notMeasured.push({ signal: 'ingest-behind', reason: `issue store unreadable: ${ingestError}` });
  else if (!generated) notMeasured.push({ signal: 'ingest-behind', reason: 'the rollup has no generated time to compare against' });
  else if (!lastIngest || String(generated) > String(lastIngest.generated || '')) {
    items.push(item('ingest-behind', project, `slice:${sliceId}`, {
      title: lastIngest ? `Work items are behind: last ingested ${lastIngest.generated}, rollup ${generated}` : 'Work items were never ingested for this area',
      at: generated, detail: { rollupSliceId: sliceId, rollupGenerated: generated, ingestedGenerated: lastIngest ? lastIngest.generated || null : null } }));
  }

  notMeasured.push({ signal: 'sla-due-soon', reason: 'SLA days per severity are not configured yet (worklist task 7)' });
  return { items, notMeasured, sliceId, prevSliceId: (delta && delta.prevSliceId) || null };
}

// ── per-operator state ───────────────────────────────────────────────────────────────────────────
export const inboxStatePath = () => process.env.CW_INBOX_STATE || join(privateDir(ROOT), 'inbox-state.json');
const emptyState = () => ({ schema: INBOX_STATE_SCHEMA, entries: {} });

/** ENOENT is an empty state; anything else throws — an unreadable state is not "nothing read". */
export function readInboxState(path = inboxStatePath()) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return emptyState(); throw new Error(`inbox state unreadable at ${path}: ${e.code || e.message}`); }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Error(`inbox state at ${path} is not JSON: ${e.message}`); }
  if (!doc || doc.schema !== INBOX_STATE_SCHEMA || !doc.entries || typeof doc.entries !== 'object' || Array.isArray(doc.entries)) throw new Error(`inbox state at ${path} is not ${INBOX_STATE_SCHEMA}`);
  return doc;
}

const entryKey = (who, id) => `${who}\u0000${id}`;

/** Items with `read` and `snoozedUntil` joined in for `who`; a lapsed snooze reads as unsnoozed. */
export function withState(items, state, who, nowIso) {
  return items.map((it) => {
    const e = state.entries[entryKey(who, it.id)] || {};
    const snoozed = e.snoozedUntil && String(e.snoozedUntil) > String(nowIso) ? e.snoozedUntil : null;
    return { ...it, read: !!e.readAt, readAt: e.readAt || null, snoozedUntil: snoozed };
  });
}

export const MARK_ACTIONS = Object.freeze(['read', 'unread', 'snooze', 'unsnooze']);

/**
 * Apply one action to several ids for `who`, under a lock, atomically. Bounded: past STATE_CAP the
 * oldest entries by `at` are dropped, so the store cannot grow without limit.
 * @returns {{ok:true, applied:number} | {ok:false, code:number, error:string}}
 */
export function markInbox({ ids, action, who, nowIso, days = SNOOZE_DAYS_DEFAULT, path = inboxStatePath() }) {
  if (!MARK_ACTIONS.includes(action)) return { ok: false, code: 400, error: `action must be one of ${MARK_ACTIONS.join(', ')}` };
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((x) => typeof x === 'string' && x.length && x.length <= 1000)) return { ok: false, code: 400, error: 'ids must be 1–500 non-empty strings' };
  if (!who) return { ok: false, code: 401, error: 'no operator identity to record the state against' };
  const d = Number(days);
  if (action === 'snooze' && !(Number.isInteger(d) && d >= 1 && d <= 365)) return { ok: false, code: 400, error: 'days must be an integer from 1 to 365' };
  const lock = acquireLock(`${path}.lock`, { staleMs: 30_000, label: 'inbox-state', attempts: 50, spinMs: 20 });
  if (!lock.ok) return { ok: false, code: 409, error: `the inbox state is locked by another process (${lock.path}); try again` };
  try {
    let state;
    try { state = readInboxState(path); } catch (e) { return { ok: false, code: 503, error: `refusing to write: ${e.message}` }; }
    for (const id of ids) {
      const k = entryKey(who, id);
      const e = { ...(state.entries[k] || {}) };
      if (action === 'read') e.readAt = nowIso;
      if (action === 'unread') delete e.readAt;
      if (action === 'snooze') e.snoozedUntil = new Date(Date.parse(nowIso) + d * DAY_MS).toISOString();
      if (action === 'unsnooze') delete e.snoozedUntil;
      e.at = nowIso;
      if (e.readAt || e.snoozedUntil) state.entries[k] = e; else delete state.entries[k];
    }
    const keys = Object.keys(state.entries);
    if (keys.length > STATE_CAP) {
      keys.sort((a, b) => String(state.entries[a].at).localeCompare(String(state.entries[b].at)) || (a < b ? -1 : 1));
      for (const k of keys.slice(0, keys.length - STATE_CAP)) delete state.entries[k];
    }
    const ordered = Object.fromEntries(Object.keys(state.entries).sort().map((k) => [k, state.entries[k]]));
    writeAtomic(path, JSON.stringify({ schema: INBOX_STATE_SCHEMA, entries: ordered }, null, 1) + '\n', { mkdir: true });
    return { ok: true, applied: ids.length };
  } finally { lock.release(); }
}
