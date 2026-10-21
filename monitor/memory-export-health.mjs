// commitwork monitor — the memory-layer export's own health, from the receipts it writes.
//
// WHY THIS EXISTS. monitor/export-overwatch.mjs is best-effort by design and exits 0 on every
// outcome, so its only durable evidence is the memory-layer-receipts.json it drops beside the
// rollup. Measured 2026-10-03 across the 34 rollups on this box: 34 of 34 carried a receipts file
// and 42 of the 390 receipts in them were `failed` (36 HTTP 500, 6 redaction-gate refusals), with
// 269 more `accepted-unverified`. Both readers of that evidence reported it as healthy — the sweep
// verdict recorded no field for the export at all, and the panel's survey rendered every site as
// `N receipts` in an ok pill. PRESENCE OF A RECEIPT FILE IS NOT THE HEALTH OF THE EXPORT, and
// that was the whole gap: the lane that cannot fail loudly was read by two surfaces that could
// only report whether it had spoken.
//
// ONE CLASSIFIER, TWO READERS. monitor/sweep.mjs and admin/lib/memory-view.mjs both call in here.
// The precedent for that is pidErrorMeans() in sweep-health.mjs, which lived in two places long
// enough for the same errno to mean "alive" in one and "unknown" in the other.
//
// COUNTS ARE RECOUNTED, NEVER READ OFF THE PAYLOAD. The receipts file carries the producer's own
// `tally`; trusting it would make this a readback of a claim rather than a measurement. tally() is
// re-run over the rows here and a disagreement is reported as `tallyDivergence` — the same
// function, run by the reader instead of the writer, which is the cheapest second witness there is.
//
// Env and clock are read at CALL time. `readFile` is injected so tests need no reports tree.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tally, VERIFIED, ACCEPTED_UNVERIFIED, FAILED, NOT_ATTEMPTED,
  STORED_PREVIEW, STORED_DIVERGENT,
} from '../lib/memory-layer-client.mjs';

export const RECEIPTS_FILE = 'memory-layer-receipts.json';

// Every state this module can emit, pre-seedable: a state that cannot occur must count 0 rather
// than be absent, because an absent key reads as "no data" and not as "cannot happen".
export const EXPORT_STATES = Object.freeze([
  'verified', 'not-attempted', 'skipped', 'degraded', 'stale', 'absent', 'failed', 'unreadable',
]);

// Rank orders severity; `kind` says what to do about it. One number cannot carry both, which is
// the same split admin/routes/fleet-overview.mjs keeps between RANK and HEALTH_KIND.
export const EXPORT_RANK = Object.freeze({
  verified: 0, 'not-attempted': 0, skipped: 0, degraded: 1, stale: 2, absent: 2, failed: 3, unreadable: 3,
});

export const EXPORT_KIND = Object.freeze({
  verified: 'ok', 'not-attempted': 'ok', skipped: 'ok',
  degraded: 'behind', stale: 'behind', absent: 'behind',
  failed: 'broken', unreadable: 'broken',
});

export const rankOf = (state) => (EXPORT_RANK[state] ?? 3);
// An undeclared state grades BROKEN rather than clean by omission — the miss path of a closed set
// may only return the declared fallback.
export const kindOf = (state) => (Object.prototype.hasOwnProperty.call(EXPORT_KIND, state)
  ? EXPORT_KIND[state]
  : 'broken');

export const EXPORT_MEANING = Object.freeze({
  verified: 'every record was read back and the hashes matched',
  'not-attempted': 'a dry run — nothing was written and nothing was lost',
  skipped: 'the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend',
  degraded: 'the export ran and some records were not confirmed, or what the backend holds is not a durable copy',
  stale: 'the receipts here predate this slice, so this run of the export left no evidence of its own',
  absent: 'no receipt was written beside this rollup — the lane exits 0 on every outcome, so absence of a receipt is silence, not a pass',
  failed: 'at least one record was NOT written, or what is stored is not what was sent',
  unreadable: 'the receipts could not be read — a fault, and the export\'s outcome is UNKNOWN',
});

/** The reasons behind `failed` and `accepted-unverified`, grouped so one upstream defect reads as one row. */
export function groupReasons(receipts, { states = [FAILED], cap = 6 } = {}) {
  const want = new Set(states);
  const byReason = new Map();
  for (const r of receipts) {
    if (!r || !want.has(r.state)) continue;
    // Hex ids and byte offsets differ per record and would split one defect into N rows.
    const key = String(r.reason || 'no reason recorded — the contract requires one, and its absence is itself the finding')
      .replace(/[0-9a-f]{8,}/gi, '<hex>').replace(/\d+/g, '<n>').slice(0, 160);
    byReason.set(key, (byReason.get(key) || 0) + 1);
  }
  return [...byReason].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, cap).map(([reason, count]) => ({ reason, count }));
}

/** tally() re-run by the reader, versus the tally the producer stored. Neither is trusted alone. */
export function tallyDivergence(recounted, stored) {
  if (!stored || typeof stored !== 'object') {
    return { state: 'no-stored-tally', fields: [], note: 'the receipts file carries no tally to check this recount against' };
  }
  const fields = [];
  for (const [k, v] of Object.entries(recounted)) {
    // A key the stored tally never had is a CONTRACT VERSION difference, not a disagreement: older
    // receipts predate storedFull/notAttempted/unknownState and reporting them as divergent would
    // raise a fault about every file written before the field existed.
    if (!(k in stored)) continue;
    if (Number(stored[k]) !== Number(v)) fields.push({ field: k, stored: Number(stored[k]), recounted: Number(v) });
  }
  return {
    state: fields.length ? 'diverged' : 'agrees',
    fields,
    note: fields.length
      ? 'the stored tally does not match a recount of the rows beside it — one of the two is wrong and neither may be quoted'
      : null,
  };
}

/**
 * One receipts payload -> the export's outcome.
 *
 * `since` is this slice's start. A receipts file sits at a FIXED path and is overwritten per run,
 * so an export that skipped (no credential, backend unreachable, rollup absent) leaves the PREVIOUS
 * run's file in place. Reading it without the gate reports last week's outcome as this one's — a
 * stale reading reads exactly like a live one.
 */
export function classifyReceipts(payload, { since = null } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return state('unreadable', { reason: 'the receipts file is not a JSON object, so no outcome can be read from it' });
  }
  const rows = payload.receipts;
  if (!Array.isArray(rows)) {
    return state('unreadable', { reason: 'the receipts file carries no `receipts` array — the export\'s outcome was not recorded in it' });
  }
  const counts = tally(rows);
  const divergence = tallyDivergence(counts, payload.tally);
  const generated = typeof payload.generated === 'string' ? payload.generated : null;
  const base = {
    counts,
    tallyDivergence: divergence,
    generated,
    area: typeof payload.area === 'string' ? payload.area : null,
    contractVersion: Number.isFinite(Number(payload.contractVersion)) ? Number(payload.contractVersion) : null,
    failedReasons: groupReasons(rows, { states: [FAILED] }),
    unverifiedReasons: groupReasons(rows, { states: [ACCEPTED_UNVERIFIED] }),
  };

  if (since && generated && generated < since) {
    return state('stale', { ...base, reason: `the newest receipt here is stamped ${generated}, before this slice began (${since}) — the export wrote nothing this run` });
  }
  // A stamp that cannot be compared is not a fresh one; it is one less witness, and it says so
  // rather than being graded as current.
  const undated = Boolean(since) && !generated;

  if (counts.total === 0) {
    return state('absent', { ...base, reason: 'the receipts file exists and records ZERO write attempts — the export produced no evidence, which is not a clean run' });
  }
  if (divergence.state === 'diverged') {
    return state('unreadable', { ...base, reason: divergence.note });
  }
  if (counts.failed > 0) {
    return state('failed', { ...base, undated, reason: `${counts.failed} of ${counts.total} record(s) were NOT written` });
  }
  if (counts.unknownState > 0) {
    return state('unreadable', { ...base, undated, reason: `${counts.unknownState} receipt(s) carry a state this contract does not declare — counted on their own axis, never binned into failed` });
  }
  if (counts.notAttempted === counts.total) {
    return state('not-attempted', { ...base, undated, reason: 'every record was a dry run — nothing was written and nothing was lost' });
  }
  const degradedBy = [];
  if (counts.acceptedUnverified > 0) degradedBy.push(`${counts.acceptedUnverified} accepted but never read back`);
  if (counts.storedDivergent > 0) degradedBy.push(`${counts.storedDivergent} stored text NOT derived from the source (corruption)`);
  if (counts.storedPreview > 0) degradedBy.push(`${counts.storedPreview} stored as a preview only — not a durable copy`);
  if (degradedBy.length) return state('degraded', { ...base, undated, reason: degradedBy.join('; ') });
  if (counts.verified === counts.total) {
    return state('verified', { ...base, undated, reason: `all ${counts.total} record(s) read back and the hashes matched` });
  }
  // Nothing above matched: the combination is undeclared, and it grades broken rather than clean.
  return state('unreadable', {
    ...base, undated,
    reason: `the receipt counts fit none of this module's declared outcomes (${JSON.stringify(counts)}) — unclassified, never assumed clean`,
  });
}

function state(name, extra = {}) {
  return {
    state: name, rank: rankOf(name), kind: kindOf(name),
    meaning: EXPORT_MEANING[name] || 'a state this module does not declare',
    counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null,
    failedReasons: [], unverifiedReasons: [], undated: false,
    ...extra,
  };
}

/**
 * The export's outcome for one report directory.
 *
 * FAIL CLOSED: only ENOENT is absence. EACCES, a torn write, a directory where a file belongs —
 * each is `unreadable` and keeps its code, because a permission error read as an empty result is
 * how a lane reports a clean run it was never allowed to observe.
 */
export function readExportHealth({ dir, since = null, readFile = readFileSync } = {}) {
  if (!dir) return { ...state('unreadable', { reason: 'no report directory was given, so no receipts path could be built' }), path: null };
  const path = join(dir, RECEIPTS_FILE);
  let raw;
  try { raw = readFile(path, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { ...state('absent', { reason: EXPORT_MEANING.absent }), path };
    return { ...state('unreadable', { reason: `the receipts file could not be read (${(e && e.code) || (e && e.message) || 'error'}) — a fault, not an absence` }), path };
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { return { ...state('unreadable', { reason: `the receipts file is unparseable: ${e.message}` }), path }; }
  return { ...classifyReceipts(payload, { since }), path };
}

/**
 * A deliberate opt-out. Its own state, because the stale receipts file from the previous run is
 * still sitting at the path and reading it would report that run's outcome as this one's — and
 * because "switched off" is neither a fault nor a pass.
 */
export function skippedExport(reason) {
  return { ...state('skipped', { reason: reason || EXPORT_MEANING.skipped }), path: null };
}

/** One line for a log or a verdict. Names the state, the counts and the loudest reason. */
export function exportHealthLine(h) {
  const c = h.counts;
  const tallied = c
    ? `${c.total} record(s): ${c.verified} verified, ${c.acceptedUnverified} accepted-unverified, ${c.failed} failed`
      + (c.notAttempted ? `, ${c.notAttempted} dry-run` : '')
      + (c.unknownState ? `, ${c.unknownState} undeclared-state` : '')
    : 'no counts';
  const worst = h.failedReasons[0] ? ` · loudest: ${h.failedReasons[0].reason} (x${h.failedReasons[0].count})` : '';
  return `memory export ${h.state.toUpperCase()} — ${tallied}${h.reason ? ` · ${h.reason}` : ''}${worst}`;
}

/**
 * The verdict field. Structured, served over a tunnel, and deliberately WITHOUT the reasons' free
 * text beyond a capped group — a receipt reason can name a field, never a value.
 */
export function exportVerdict(h) {
  return {
    state: h.state, rank: h.rank, kind: h.kind,
    reason: h.reason || null,
    counts: h.counts,
    tallyDivergence: h.tallyDivergence ? h.tallyDivergence.state : null,
    receiptsAt: h.generated,
    undated: !!h.undated,
    failedReasons: h.failedReasons,
  };
}

/** Fleet roll-up over per-area outcomes: worst first, every total carrying its denominator. */
export function summariseExports(perArea) {
  const rows = Array.isArray(perArea) ? perArea.filter(Boolean) : [];
  const byState = Object.fromEntries(EXPORT_STATES.map((s) => [s, 0]));
  const groups = { ok: [], behind: [], broken: [] };
  let failedReceipts = 0;
  let unverifiedReceipts = 0;
  let receipts = 0;
  for (const r of rows) {
    byState[r.state] = (byState[r.state] || 0) + 1;
    (groups[kindOf(r.state)] || groups.broken).push(r.area || r.out || null);
    if (r.counts) {
      receipts += r.counts.total;
      failedReceipts += r.counts.failed;
      unverifiedReceipts += r.counts.acceptedUnverified;
    }
  }
  return {
    areasCounted: rows.length,
    byState, groups,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    receipts, failedReceipts, unverifiedReceipts,
    worstRank: rows.reduce((n, r) => Math.max(n, rankOf(r.state)), 0),
    needsAttention: groups.broken.length + groups.behind.length,
    alarming: rows.filter((r) => rankOf(r.state) >= 1)
      .sort((a, b) => rankOf(b.state) - rankOf(a.state) || String(a.area).localeCompare(String(b.area)))
      .map((r) => ({ area: r.area || r.out || null, state: r.state, rank: rankOf(r.state), kind: kindOf(r.state), reason: r.reason || null })),
  };
}

export { VERIFIED, ACCEPTED_UNVERIFIED, FAILED, NOT_ATTEMPTED, STORED_PREVIEW, STORED_DIVERGENT };
