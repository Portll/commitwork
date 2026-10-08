#!/usr/bin/env node
// commitwork reconcile-findings — turn two raw audit passes into ONE countable queue.
//
// Re-audits nothing, invents no severities: normalises paths, merges same-defect records,
// resolves severity by the stated rule, and gives each entry a disposition.
//
// Severity rule: verified (confirmed|adjusted|refuted) outranks unreviewed; among verified,
// adjusted wins; a residual disagreement keeps the HIGHER severity and records the conflict.
// missed[] records rank as unreviewed but are never dropped.
//
// Deterministic: nothing reads the clock; provenance is the sha256 of each input.
//
// usage: node bin/reconcile-findings.mjs [--in <dir>] [--out <dir>] [--root <repo>] [--no-gate]
// exit:  0 clean · 1 unresolved conflicts remain (gate) · 2 bad usage / unreadable input
import { summaryTokens, jaccard } from '../lib/text-similarity.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { acquireLock, writeAtomic } from '../monitor/lockfile.mjs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { auditDirFor } from '../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const REPO_NAME = 'commitwork';

// ── severity vocabulary ──────────────────────────────────────────────────────
// 'none' is real in the raw data. An unknown severity ranks ABOVE info — a data defect belongs
// where someone will see it.
export const SEVERITY_RANK = { none: 0, info: 1, low: 2, medium: 3, high: 4, critical: 5 };
const UNKNOWN_SEVERITY_RANK = 1.5;
export const severityRank = (s) =>
  Object.prototype.hasOwnProperty.call(SEVERITY_RANK, s) ? SEVERITY_RANK[s] : UNKNOWN_SEVERITY_RANK;

// A verdict is "verified" when a second reader actually ruled on the record. 'unreviewed' and the
// absent verdict on `missed[]` records are the two shapes that were never ruled on.
const VERIFIED_VERDICTS = new Set(['confirmed', 'adjusted', 'refuted']);
export const isVerified = (v) => VERIFIED_VERDICTS.has(v);

// Queue order. Disposition dominates severity on purpose: a `fixed` critical is not work, and
// putting it above an open high would put the wrong thing at the top of someone's morning.
const DISPOSITION_ORDER = { open: 0, moved: 1, unreviewed: 2, fixed: 3, refuted: 4 };

// ── path normalisation ───────────────────────────────────────────────────────
// The raw data mixes absolute and relative paths; normalise against the LAST occurrence of the
// repo directory name so a clone at any path still reconciles.
export function normaliseFile(raw, repoRoot = REPO_ROOT) {
  let s = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
  if (!s) return '';
  const rootSlash = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  if (s.startsWith(rootSlash)) return s.slice(rootSlash.length);
  if (s.startsWith('/')) {
    // The corpus was recorded in a checkout named for the repository; a worktree's folder is not,
    // and matching on the folder alone made the output depend on where it was run.
    for (const name of new Set([basename(repoRoot), REPO_NAME])) {
      const marker = '/' + name + '/';
      const at = s.lastIndexOf(marker);
      if (at !== -1) return s.slice(at + marker.length);
    }
  }
  return s.replace(/^\.\//, '').replace(/^\/+/, '');
}

// A null line is real (whole-file findings); collapse to 0 to keep the anchor stable.
const normaliseLine = (l) => (Number.isFinite(Number(l)) ? Number(l) : 0);

// ── summary normalisation and same-defect matching ───────────────────────────
// Same defect = same anchor AND same meaning: a normalised token bag, with near-duplicates
// settled by Jaccard overlap WITHIN an anchor only.
export const summaryKey = (s) => [...summaryTokens(s)].sort().join(' ').slice(0, 400);
// Calibrated on this corpus: the one genuine restatement scores 0.366, the closest
// genuinely-distinct pair 0.274; 0.35 sits in the gap. Lower eats real findings, and a swallowed
// finding is visible nowhere.
export const MERGE_SIMILARITY = 0.35;

// ── loading ──────────────────────────────────────────────────────────────────
// Both passes: an array of areas { area, summary, perProject, findings[], missed[] }. missed[] is
// verifier-found and carries no verdict.
export function loadPass(text, passId) {
  const areas = JSON.parse(text);
  if (!Array.isArray(areas)) throw new Error(`${passId}: expected an array of areas`);
  const out = [];
  for (const area of areas) {
    for (const f of area.findings || []) out.push({ ...f, pass: passId, area: area.area, source: 'findings' });
    for (const m of area.missed || []) out.push({ ...m, pass: passId, area: area.area, source: 'missed' });
  }
  return out;
}

// ── the ledgers ──────────────────────────────────────────────────────────────
// Rulings on queue entries, read from ledgers.json beside the passes they rule on. They name the
// audited files and quote the audit's summaries, so they are private like the passes: a public
// clone has neither, and reconcile stops at the missing passes before it reaches this file.
//
// The fixed ledger: rows mark queue entries `fixed`. Each row must bind to exactly one live entry —
// zero or several is ledger drift and fails the gate. `match` is a narrow regex over the entry
// summary, because several anchors carry two unrelated findings. `item` is a label, never a key:
// its four-digit numbers ('anchor re-read 0050') are the POSITIONAL queue ids of the day each row
// was written, so a label resolves through its row's (file, match), and queue.json's fixedLedger[]
// lists the bound entry's stable id beside it.
//
// The moved ledger: a defect still live but no longer in the file it was anchored to (operator
// ruling 2026-10-04). `fixed` would close a defect that is still there, and a re-pin cannot express
// it: `file` is rebuilt from the pass record on every reconcile. The move is DECLARED, keyed
// (file, match) on the ORIGINAL anchor, and applied after ids are assigned — the id is
// sha256(file + summary), so rewriting the file first would rename the finding that commit messages
// and ledger rows already cite. `to` is the destination path:line; `at` is the sha that line was
// read at, a literal so the queue stays byte-identical across runs. `moved` is LIVE work and sorts
// beside `open`, never beside `fixed`.
//
// Shape: { schema: 1, fixed: [{ about, rows }], moved: [{ about, rows }] }, `about` being the note
// a group of rows was written under, and `match` stored as { source, flags }.
export const LEDGERS_FILE = 'ledgers.json';

/** ledgers.json text -> { fixed, moved }, each a flat list of rows with `match` revived. Throws on
 *  any malformed row: a ledger read partly would close some findings and silently drop others. */
export function loadLedgers(text) {
  const doc = JSON.parse(text);
  if (!doc || doc.schema !== 1) throw new Error(`${LEDGERS_FILE}: schema must be 1`);
  const flat = (kind, extra) => {
    if (!Array.isArray(doc[kind])) throw new Error(`${LEDGERS_FILE}: ${kind} must be an array of { about, rows }`);
    const rows = [];
    const keys = new Map();
    for (const g of doc[kind]) {
      if (!g || !Array.isArray(g.rows)) throw new Error(`${LEDGERS_FILE}: every ${kind} group needs rows[]`);
      for (const r of g.rows) {
        const where = `${LEDGERS_FILE} ${kind} row ${r && r.item}`;
        if (!r || typeof r.item !== 'string' || typeof r.file !== 'string' || typeof r.note !== 'string') throw new Error(`${where}: item, file and note must be strings`);
        // A line in the key is the defect this ledger exists without: code moves, the finding does not.
        if ('line' in r) throw new Error(`${where}: carries a line; identity is (file, match), never a coordinate`);
        for (const k of extra) if (typeof r[k] !== 'string' || !r[k]) throw new Error(`${where}: ${k} must be a non-empty string`);
        if (!r.match || typeof r.match.source !== 'string' || typeof r.match.flags !== 'string') throw new Error(`${where}: match must be { source, flags }`);
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- recompiles the {source, flags} of a ledger row the operator authored; the row shape is validated just above and a bad source throws
        const match = new RegExp(r.match.source, r.match.flags);
        const key = `${r.file}||${match}`;
        if (keys.has(key)) throw new Error(`${where}: shares (file, match) with ${keys.get(key)}; narrow one regex or merge the rows`);
        keys.set(key, r.item);
        rows.push({ ...r, match });
      }
    }
    return rows;
  };
  return { fixed: flat('fixed', []), moved: flat('moved', ['to', 'at']) };
}

// ── reconciliation ───────────────────────────────────────────────────────────
// Groups build in first-seen order over a pre-sorted record list — deterministic.
export function reconcile(passes, {
  repoRoot = REPO_ROOT, fixedLedger = [], movedLedger = [],
} = {}) {
  const records = [];
  for (const { id, records: raw } of passes) {
    for (const r of raw) {
      records.push({
        pass: id,
        area: r.area,
        source: r.source,
        file: normaliseFile(r.file, repoRoot),
        line: normaliseLine(r.line),
        kind: r.kind ?? null,
        severity: r.severity ?? null,
        summary: String(r.summary ?? ''),
        evidence: r.evidence ?? null,
        remediation: r.remediation ?? null,
        intentional: typeof r.intentional === 'boolean' ? r.intentional : null,
        verdict: r.verdict ?? null,
        note: r.note ?? '',
      });
    }
  }
  // Stable pre-sort: identical input in any file order produces identical grouping.
  records.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line
    || a.pass.localeCompare(b.pass) || a.source.localeCompare(b.source)
    || a.summary.localeCompare(b.summary));

  // Group by anchor first: same-defect matching only ever within one file:line.
  const byAnchor = new Map();
  for (const r of records) {
    const anchor = `${r.file}:${r.line}`;
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
    byAnchor.get(anchor).push(r);
  }

  const entries = [];
  // Every source summary that fed an entry, kept beside the queue — the fixed ledger must match
  // against ALL of them.
  const summariesByKey = new Map();
  for (const [anchor, group] of byAnchor) {
    const buckets = [];
    for (const r of group) {
      const tokens = summaryTokens(r.summary);
      const key = summaryKey(r.summary);
      // Exact normalised equality first, then near-duplicate rescue (the passes reworded).
      const hit = buckets.find((b) => b.key === key)
        || buckets.find((b) => jaccard(b.tokens, tokens) >= MERGE_SIMILARITY);
      if (hit) hit.records.push(r);
      else buckets.push({ key, tokens, records: [r] });
    }
    for (const b of buckets) {
      const entry = buildEntry(anchor, b, fixedLedger);
      summariesByKey.set(entry.key, b.records.map((r) => r.summary));
      entries.push(entry);
    }
  }

  entries.sort((a, b) =>
    (DISPOSITION_ORDER[a.disposition] - DISPOSITION_ORDER[b.disposition])
    || (severityRank(b.severity) - severityRank(a.severity))
    || a.file.localeCompare(b.file) || a.line - b.line || a.key.localeCompare(b.key));
  assignIds(entries);
  // AFTER assignIds, so a moved entry keeps the id its citations already use.
  const movedBindings = applyMoved(entries, movedLedger, summariesByKey);

  return {
    records,
    entries,
    ledgerBindings: bindLedger(entries, fixedLedger, summariesByKey),
    movedBindings,
  };
}

// ── displayed ids ────────────────────────────────────────────────────────────
// Keyed on place (file + summary), never on queue position: a positional id changed meaning
// whenever a row above it moved, and every new fixed-ledger row moves its entry. Twins — same
// file, same summary — are ordered by content and only the later ones carry a suffix.
export const ID_RULE = 'q-<first 8 hex of sha256(file + "\\n" + whitespace-collapsed summary)>; entries sharing '
  + 'that prefix take -2, -3 … in (summary, evidence, remediation, key) order. Never positional.';
const idBase = (e) => `q-${createHash('sha256')
  .update(`${e.file}\n${String(e.summary ?? '').replace(/\s+/g, ' ').trim()}`).digest('hex').slice(0, 8)}`;

export function assignIds(entries) {
  const groups = new Map();
  for (const e of entries) {
    const b = idBase(e);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(e);
  }
  const txt = (v) => String(v ?? '');
  for (const [base, group] of groups) {
    group.sort((a, b) => txt(a.summary).localeCompare(txt(b.summary)) || txt(a.evidence).localeCompare(txt(b.evidence))
      || txt(a.remediation).localeCompare(txt(b.remediation)) || a.key.localeCompare(b.key));
    group.forEach((e, i) => { e.id = i ? `${base}-${i + 1}` : base; });
  }
  return entries;
}

// Resolve one merged group into a queue entry. Every decision is written on the entry:
// `severityBasis` says which rule fired, `conflicts` what could not be settled.
function buildEntry(anchor, bucket, fixedLedger) {
  const recs = bucket.records;
  const verified = recs.filter((r) => isVerified(r.verdict));
  const adjusted = verified.filter((r) => r.verdict === 'adjusted');
  const confirmed = verified.filter((r) => r.verdict === 'confirmed');
  const refuted = verified.filter((r) => r.verdict === 'refuted');

  // Tier selection, in the stated order: adjusted > confirmed > refuted > unreviewed/missed.
  let tier = recs, basis = 'unreviewed-only';
  if (adjusted.length) { tier = adjusted; basis = 'adjusted'; }
  else if (confirmed.length) { tier = confirmed; basis = 'confirmed'; }
  else if (refuted.length) { tier = refuted; basis = 'refuted'; }

  const highest = tier.reduce((a, b) => (severityRank(b.severity) > severityRank(a.severity) ? b : a));
  const tierSeverities = [...new Set(tier.map((r) => r.severity))];
  const allSeverities = [...new Set(recs.map((r) => r.severity))].sort(
    (a, b) => severityRank(b) - severityRank(a),
  );

  const conflicts = [];
  if (tierSeverities.length > 1) {
    conflicts.push({
      type: 'severity-within-tier',
      tier: basis,
      severities: tierSeverities.sort((a, b) => severityRank(b) - severityRank(a)),
      resolution: `kept the higher (${highest.severity}); two ${basis} records disagree and a human must rule`,
      unresolved: true,
    });
  }
  // A refutation plus a confirmation is two readers disagreeing about existence — never averaged.
  if (refuted.length && (adjusted.length || confirmed.length)) {
    conflicts.push({
      type: 'verdict-split',
      verdicts: [...new Set(verified.map((r) => r.verdict))].sort(),
      resolution: 'left open; a refutation and a confirmation of one defect need a human ruling',
      unresolved: true,
    });
  }
  // 'adjusted' overriding 'confirmed' is NOT a conflict — that is the second pass doing its job.
  const confirmedSeverities = [...new Set(confirmed.map((r) => r.severity))];
  if (adjusted.length && confirmed.length
      && !confirmedSeverities.every((s) => adjusted.some((r) => r.severity === s))) {
    conflicts.push({
      type: 'adjusted-supersedes-confirmed',
      from: confirmedSeverities.sort((a, b) => severityRank(b) - severityRank(a)),
      to: highest.severity,
      resolution: 'the second pass deliberately re-rated this; the adjusted severity stands',
      unresolved: false,
    });
  }

  // Prefer the richest record for display: missed[] has no kind/evidence/remediation.
  const display = pickDisplay(recs);
  const anyUnreviewed = recs.some((r) => !isVerified(r.verdict));
  const key = `${anchor}|${bucket.key.slice(0, 120)}`;

  // Disposition precedence: fixed > refuted > unreviewed > open.
  // Identity is (file, match) — NEVER the line (house rule): a genuinely fixed finding whose
  // anchor moved must still bind. Two rows sharing (file, match) would be ambiguous;
  // loadLedgers() refuses that.
  const fixedRow = fixedLedger.find((f) => f.file === display.file
    && recs.some((r) => f.match.test(r.summary)));
  let disposition, dispositionReason;
  if (fixedRow) {
    disposition = 'fixed';
    dispositionReason = `${fixedRow.item} — ${fixedRow.note}`;
  } else if (refuted.length && !adjusted.length && !confirmed.length) {
    disposition = 'refuted';
    dispositionReason = refuted.find((r) => r.note)?.note || 'refuted by the verifying pass';
  } else if (!verified.length) {
    disposition = 'unreviewed';
    dispositionReason = 'no second reader ruled on this record; severity is the author’s own and untested';
  } else {
    disposition = 'open';
    dispositionReason = 'verified and not claimed fixed anywhere in Parts E / E.2';
  }

  return {
    id: '',
    key,
    anchor,
    file: display.file,
    line: display.line,
    severity: highest.severity,
    severityBasis: basis,
    severitiesSeen: allSeverities,
    kind: display.kind,
    summary: display.summary,
    evidence: display.evidence,
    remediation: display.remediation,
    intentional: display.intentional,
    disposition,
    dispositionReason,
    provenance: {
      passes: [...new Set(recs.map((r) => r.pass))].sort(),
      sources: [...new Set(recs.map((r) => r.source))].sort(),
      verdicts: [...new Set(recs.map((r) => r.verdict ?? 'absent'))].sort(),
      areas: [...new Set(recs.map((r) => r.area))].sort(),
      recordCount: recs.length,
      unreviewed: anyUnreviewed && !verified.length,
      hasUnreviewedRecord: anyUnreviewed,
      fromMissed: recs.some((r) => r.source === 'missed'),
      records: recs.map((r) => ({
        pass: r.pass,
        area: r.area,
        source: r.source,
        severity: r.severity,
        verdict: r.verdict ?? 'absent',
        // The LENGTH of the note, not the note: emptiness must be visible at a glance.
        noteChars: String(r.note || '').length,
      })),
    },
    conflicts,
  };
}

// Richest-record preference: findings[] over missed[], then the one with the most evidence text.
function pickDisplay(recs) {
  const ranked = [...recs].sort((a, b) => {
    const sa = a.source === 'findings' ? 0 : 1;
    const sb = b.source === 'findings' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ea = String(a.evidence || '').length + String(a.remediation || '').length;
    const eb = String(b.evidence || '').length + String(b.remediation || '').length;
    if (ea !== eb) return eb - ea;
    return a.summary.localeCompare(b.summary);
  });
  return ranked[0];
}

// Every "fixed" claim must find exactly one home; zero or too-many is reported and fails the gate.
function bindLedger(entries, fixedLedger, summariesByKey) {
  // Same identity as buildEntry — (file, match), never the line.
  return fixedLedger.map((row) => {
    const bound = entries.filter((e) => e.file === row.file
      && (summariesByKey.get(e.key) || [e.summary]).some((s) => row.match.test(s)));
    return {
      item: row.item,
      // The anchor is where the finding was LAST SEEN — reported from the bound entries.
      anchor: bound.length ? `${row.file}:${bound.map((e) => e.line).join(',')}` : row.file,
      bound: bound.length,
      ids: bound.map((e) => e.id),
    };
  });
}

/**
 * Re-anchor every entry a moved-ledger row claims, and report what each row bound.
 *
 * Identity is (file, match) on the ORIGINAL anchor — the same rule as the fixed ledger, and for
 * the same reason: the line is not part of it. A row must bind exactly one entry; zero or several
 * is ledger drift and fails the gate, because a move nobody can locate is worse than no move.
 *
 * A `fixed` or `refuted` entry is left alone. Closing and relocating are different claims, and
 * the closing one wins: re-anchoring something already judged gone would resurrect it.
 */
export function applyMoved(entries, movedLedger = [], summariesByKey = new Map()) {
  return movedLedger.map((row) => {
    const bound = entries.filter((e) => (e.movedFrom?.file ?? e.file) === row.file
      && (summariesByKey.get(e.key) || [e.summary]).some((sum) => row.match.test(sum)));
    const applied = [];
    for (const e of bound) {
      if (e.disposition === 'fixed' || e.disposition === 'refuted') continue;
      const [toFile, toLine] = String(row.to).split(':');
      if (!toFile || !Number.isFinite(Number(toLine))) continue;
      e.movedFrom = { file: e.file, line: e.line, anchor: e.anchor };
      e.disposition = 'moved';
      e.dispositionReason = `${row.item} — still live, and no longer in ${e.movedFrom.file}: ${row.note}`;
      e.file = toFile;
      e.line = Number(toLine);
      e.anchor = `${toFile}:${toLine}`;
      // Both halves move together, or the line names the destination while the comparison reads
      // the ref the ORIGINAL anchor was verified against.
      e.verifiedAtHead = row.at;
      applied.push(e.id);
    }
    return { item: row.item, from: row.file, to: row.to, bound: bound.length, applied };
  });
}

// ── conflict report ──────────────────────────────────────────────────────────
/**
 * Carry re-pin annotations (reanchor/reverified + line/anchor/verifiedAtHead) forward from the
 * previous queue. A regen that drops them silently un-verifies committed work. Keyed on place
 * (file+key), never position; carries only when the place is unique on BOTH sides.
 */
export function carryForwardPins(prevQueue, entries) {
  const place = (e) => `${e.file}\0${e.key}`;
  const count = (list) => { const m = new Map(); for (const e of list || []) m.set(place(e), (m.get(place(e)) || 0) + 1); return m; };
  const prevList = (prevQueue && prevQueue.queue) || [];
  const prevN = count(prevList);
  const curN = count(entries);
  const prevBy = new Map(prevList.map((e) => [place(e), e]));
  let carried = 0;
  const pinnedPrev = new Set(prevList.filter((e) => e.reanchor || e.reverified).map(place));
  const droppedPlaces = new Set();   // places, not entries — a duplicated place drops once
  for (const e of entries) {
    const k = place(e);
    if (prevN.get(k) !== 1 || curN.get(k) !== 1) { if (pinnedPrev.has(k)) droppedPlaces.add(k); continue; }
    const p = prevBy.get(k);
    if (!p || (!p.reanchor && !p.reverified)) continue;
    if (p.reanchor) e.reanchor = p.reanchor;
    if (p.reverified) e.reverified = p.reverified;
    e.line = p.line;
    e.anchor = p.anchor;
    e.verifiedAtHead = p.verifiedAtHead;
    if (p.anchorFile) e.anchorFile = p.anchorFile;
    carried += 1;
  }
  // A pinned place that vanished from the new queue is a drop too — counted, never inferred.
  for (const k of pinnedPrev) if (!curN.has(k)) droppedPlaces.add(k);
  return { carried, dropped: droppedPlaces.size };
}

export function analyse(entries, records) {
  const anchorEntries = new Map();
  for (const e of entries) {
    if (!anchorEntries.has(e.anchor)) anchorEntries.set(e.anchor, []);
    anchorEntries.get(e.anchor).push(e);
  }
  const anchorRecords = new Map();
  for (const r of records) {
    const a = `${r.file}:${r.line}`;
    anchorRecords.set(a, (anchorRecords.get(a) || 0) + 1);
  }

  // Class B: one file:line, several DISTINCT entries. Entries exist separately because the merge
  // judged them distinct, so an anchor collision is not a disagreement. What gates is a NEAR-MISS:
  // similar enough that the split may be wrong AND the severities differ. AMBIGUOUS_FLOOR sits
  // above the proven-distinct value (0.274) and below the merge threshold.
  const AMBIGUOUS_FLOOR = MERGE_SIMILARITY - 0.05;   // 0.30 — above 0.274, below 0.35
  const maxPairSimilarity = (v) => {
    let best = 0;
    for (let i = 0; i < v.length; i++) {
      for (let j = i + 1; j < v.length; j++) {
        best = Math.max(best, jaccard(summaryTokens(v[i].summary), summaryTokens(v[j].summary)));
      }
    }
    return Math.round(best * 1000) / 1000;
  };
  const multiEntryAnchors = [...anchorEntries.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([anchor, v]) => ({
      anchor,
      entries: v.length,
      records: anchorRecords.get(anchor) || v.length,
      severities: [...new Set(v.map((e) => e.severity))].sort((a, b) => severityRank(b) - severityRank(a)),
      // Carried so a reader can check the ruling instead of trusting it.
      similarity: maxPairSimilarity(v),
      ids: v.map((e) => e.id),
    }))
    .sort((a, b) => a.anchor.localeCompare(b.anchor));

  // Distinct defects sharing a line: reported, never gated.
  const coLocatedAnchors = multiEntryAnchors.filter((a) => a.similarity < AMBIGUOUS_FLOOR);

  // The real class B conflict: the split is questionable AND the severity differs.
  const crossEntryDisagreements = multiEntryAnchors.filter(
    (a) => a.severities.length > 1 && a.similarity >= AMBIGUOUS_FLOOR,
  );

  // Class A: ONE entry (one defect) whose own source records disagree. This is the real conflict.
  const withinEntryConflicts = entries
    .filter((e) => e.conflicts.some((c) => c.unresolved))
    .map((e) => ({ id: e.id, anchor: e.anchor, severity: e.severity, conflicts: e.conflicts.filter((c) => c.unresolved) }));

  const unreviewedEntries = entries.filter((e) => e.disposition === 'unreviewed');
  const unreviewedRecords = records.filter((r) => r.verdict === 'unreviewed');
  const emptyNoteUnreviewed = unreviewedRecords.filter((r) => !String(r.note || '').trim());

  const tally = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    multiRecordAnchors: [...anchorRecords.values()].filter((n) => n > 1).length,
    multiEntryAnchors,
    coLocatedAnchors,
    crossEntryDisagreements,
    withinEntryConflicts,
    unreviewedEntries: unreviewedEntries.length,
    unreviewedRecords: unreviewedRecords.length,
    unreviewedWithEmptyNote: emptyNoteUnreviewed.length,
    bySeverity: tally(entries, (e) => e.severity),
    byDisposition: tally(entries, (e) => e.disposition),
    recordsBySeverity: tally(records, (r) => r.severity),
    recordsBySource: tally(records, (r) => r.source),
  };
}

// ── rendering ────────────────────────────────────────────────────────────────
const sortedTally = (t) => Object.entries(t)
  .sort((a, b) => severityRank(b[0]) - severityRank(a[0]) || a[0].localeCompare(b[0]));

export function renderMarkdown(doc) {
  const { inputs, totals, conflicts, queue } = doc;
  const L = [];
  L.push('# Reconciled audit queue — 2026-07-29');
  L.push('');
  L.push('Generated by `node bin/reconcile-findings.mjs` from the two raw audit passes stored beside');
  L.push('this file, PLUS the previous `queue.json` — whose re-pin annotations carry forward, so the');
  L.push('generator reads its own last output and a fresh directory will not reproduce this one byte for');
  L.push('byte. Re-running over the SAME queue is idempotent, so a diff here is still a real change and');
  L.push('never a re-run. Nothing below was re-audited — this is the same evidence, counted once.');
  L.push('');
  L.push('Ids are keyed on file + summary (`idRule` in queue.json), never on position, so an id names the');
  L.push('same finding across re-runs even as rows are fixed and re-sorted.');
  L.push('');
  L.push('## Inputs');
  L.push('');
  L.push('| pass | file | sha256 | records |');
  L.push('|---|---|---|---|');
  for (const i of inputs) L.push(`| ${i.pass} | \`${i.file}\` | \`${i.sha256.slice(0, 16)}…\` | ${i.records} |`);
  L.push('');
  L.push('## Cardinality');
  L.push('');
  L.push(`- **${totals.records} raw records** in (${totals.recordsBySource.findings || 0} \`findings[]\` + ${totals.recordsBySource.missed || 0} \`missed[]\`).`);
  L.push(`- **${totals.entries} distinct defects** out — the queue's true cardinality.`);
  L.push(`- ${conflicts.multiRecordAnchors} file:line anchors carry more than one record; ${conflicts.multiEntryAnchors.length} still carry more than one *distinct defect* after merging. ${conflicts.coLocatedAnchors.length} of those are simply two defects on one line (max pairwise similarity below ${(0.30).toFixed(2)}) and are NOT conflicts; ${conflicts.crossEntryDisagreements.length} are near-misses where the split itself is questionable.`);
  L.push(`- ${conflicts.unreviewedRecords} records carry \`verdict: "unreviewed"\` (${conflicts.unreviewedWithEmptyNote} of them with an empty note), producing **${conflicts.unreviewedEntries} entries no second reader ever ruled on**.`);
  L.push('');
  L.push('## Disposition');
  L.push('');
  L.push('| disposition | entries | meaning |');
  L.push('|---|---|---|');
  const MEANING = {
    open: 'verified by a second reader and not claimed fixed anywhere',
    unreviewed: 'severity is the author’s own and untested — do not schedule off this',
    fixed: 'applied this session; cites its Part E / E.2 / F item',
    refuted: 'disproven on verification; recorded so it cannot be re-promoted',
  };
  for (const [k, n] of Object.entries(totals.byDisposition).sort((a, b) => DISPOSITION_ORDER[a[0]] - DISPOSITION_ORDER[b[0]])) {
    L.push(`| \`${k}\` | ${n} | ${MEANING[k] || ''} |`);
  }
  L.push('');
  L.push('## Severity — entries, after conflict resolution');
  L.push('');
  L.push('| severity | entries | raw records |');
  L.push('|---|---|---|');
  for (const [sev, n] of sortedTally(totals.bySeverity)) {
    L.push(`| ${sev} | ${n} | ${totals.recordsBySeverity[sev] || 0} |`);
  }
  L.push('');
  L.push('## Anchors carrying more than one distinct defect');
  L.push('');
  L.push('These are the anchors that made the backlog look uncountable. They are not duplicates: each');
  L.push('row is several *different* defects that land on one line. Where the severities differ, a');
  L.push('human still has to rule whether it is one item or several — those rows gate.');
  L.push('');
  L.push('| anchor | entries | records | severities | ids |');
  L.push('|---|---|---|---|---|');
  for (const a of conflicts.multiEntryAnchors) {
    L.push(`| \`${a.anchor}\` | ${a.entries} | ${a.records} | ${a.severities.join(' vs ')}${a.severities.length > 1 ? ' **⚠**' : ''} | ${a.ids.join(', ')} |`);
  }
  L.push('');
  L.push('## Open queue — highest severity first');
  L.push('');
  L.push('| id | severity | anchor | disposition | provenance | summary |');
  L.push('|---|---|---|---|---|---|');
  for (const e of queue.filter((x) => x.disposition === 'open')) {
    const prov = `${e.provenance.passes.join('+')}/${e.provenance.sources.join('+')}/${e.provenance.verdicts.join('+')}`;
    L.push(`| ${e.id} | ${e.severity} | \`${e.anchor}\` | ${e.disposition} | ${prov} | ${e.summary.replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 180)} |`);
  }
  L.push('');
  L.push('## Already fixed — cited to Part E / E.2 / F');
  L.push('');
  L.push('| id | severity | anchor | item | what changed |');
  L.push('|---|---|---|---|---|');
  for (const e of queue.filter((x) => x.disposition === 'fixed')) {
    const [item, ...rest] = e.dispositionReason.split(' — ');
    L.push(`| ${e.id} | ${e.severity} | \`${e.anchor}\` | ${item} | ${rest.join(' — ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`);
  }
  L.push('');
  const movedEntries = queue.filter((x) => x.disposition === 'moved');
  if (movedEntries.length) {
    L.push(`## Moved — ${movedEntries.length} still live, at a different file than they were anchored to`);
    L.push('');
    L.push('Re-anchored to the destination, so these stay checkable. The identity key still names the');
    L.push('original anchor, which is why the id has not changed.');
    L.push('');
    L.push('| id | severity | was | is now | why |');
    L.push('|---|---|---|---|---|');
    for (const e of movedEntries) {
      L.push(`| ${e.id} | ${e.severity} | \`${e.movedFrom?.anchor ?? '?'}\` | \`${e.anchor}\` | ${String(e.dispositionReason).replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 240)} |`);
    }
    L.push('');
  }
  L.push('## Refuted — kept so they cannot be re-promoted');
  L.push('');
  L.push('| id | anchor | why it was refuted |');
  L.push('|---|---|---|');
  for (const e of queue.filter((x) => x.disposition === 'refuted')) {
    L.push(`| ${e.id} | \`${e.anchor}\` | ${e.dispositionReason.replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 220)} |`);
  }
  L.push('');
  L.push(`## Unreviewed — ${conflicts.unreviewedEntries} entries that must be re-read before anything is scheduled off them`);
  L.push('');
  L.push('Every row below carries a severity that ONE reader assigned and no second reader tested.');
  L.push('They are in the queue rather than beside it, because a record that sits in the same array as');
  L.push('verified ones while carrying an empty `note` is how an untested rating becomes a plan.');
  L.push('');
  L.push('| id | severity | anchor | summary |');
  L.push('|---|---|---|---|');
  for (const e of queue.filter((x) => x.disposition === 'unreviewed')) {
    L.push(`| ${e.id} | ${e.severity} | \`${e.anchor}\` | ${e.summary.replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 180)} |`);
  }
  L.push('');
  return L.join('\n');
}

function printConflictReport(analysis, ledgerBindings, out = process.stdout) {
  const w = (s = '') => out.write(s + '\n');
  w('CONFLICT REPORT — reconcile-findings');
  w('='.repeat(72));
  w('');
  w(`raw records in ......................... ${analysis.recordsBySource.findings || 0} findings[] + ${analysis.recordsBySource.missed || 0} missed[] = ${(analysis.recordsBySource.findings || 0) + (analysis.recordsBySource.missed || 0)}`);
  w(`distinct defects out ................... ${Object.values(analysis.byDisposition).reduce((a, b) => a + b, 0)}`);
  w(`file:line anchors with >1 RECORD ....... ${analysis.multiRecordAnchors}`);
  w(`file:line anchors with >1 ENTRY ........ ${analysis.multiEntryAnchors.length}   (after same-defect merging)`);
  w(`  ...co-located distinct defects ....... ${analysis.coLocatedAnchors.length}   (informational, not gated)`);
  w(`  ...near-miss splits that DO gate ..... ${analysis.crossEntryDisagreements.length}`);
  w(`within-entry unresolved conflicts ...... ${analysis.withinEntryConflicts.length}`);
  w(`records with verdict "unreviewed" ...... ${analysis.unreviewedRecords}   (${analysis.unreviewedWithEmptyNote} with an EMPTY note)`);
  w(`entries no second reader ruled on ...... ${analysis.unreviewedEntries}`);
  w('');
  w('entries by severity: ' + sortedTally(analysis.bySeverity).map(([k, v]) => `${k}=${v}`).join('  '));
  w('entries by disposition: ' + Object.entries(analysis.byDisposition)
    .sort((a, b) => DISPOSITION_ORDER[a[0]] - DISPOSITION_ORDER[b[0]]).map(([k, v]) => `${k}=${v}`).join('  '));
  w('');
  w('-- anchors carrying more than one distinct defect ' + '-'.repeat(22));
  for (const a of analysis.multiEntryAnchors) {
    // Two labels: a near-miss gates; co-location does not.
    const flag = a.severities.length > 1
      ? (a.similarity >= 0.30
        ? ` <<< NEAR-MISS SPLIT (similarity ${a.similarity}) — may be ONE defect; ruling needed`
        : ` — two distinct defects on one line (similarity ${a.similarity}), not a conflict`)
      : '';
    w(`  ${a.anchor}  entries=${a.entries} records=${a.records}  [${a.severities.join(' vs ')}]${flag}`);
  }
  w('');
  if (analysis.withinEntryConflicts.length) {
    w('-- unresolved conflicts INSIDE one defect ' + '-'.repeat(30));
    for (const c of analysis.withinEntryConflicts) {
      for (const x of c.conflicts) w(`  ${c.id} ${c.anchor}  ${x.type}: ${x.resolution}`);
    }
    w('');
  }
  // A claim binding NOTHING is drift and blocks. `bound > 1` is NOT drift: identity is
  // (file, match), and one remediation legitimately closes several findings.
  const drift = ledgerBindings.filter((b) => b.bound === 0);
  if (drift.length) {
    w('-- FIXED-LEDGER DRIFT (a "fixed" claim that binds to no entry at all) --');
    for (const b of drift) w(`  ${b.item} ${b.anchor}  bound=${b.bound}`);
    w('');
  }
  // Ambiguity: two DIFFERENT remediations claiming one finding — checked directly.
  const claims = new Map();
  for (const b of ledgerBindings) for (const id of b.ids) claims.set(id, [...(claims.get(id) || []), b.item]);
  const contested = [...claims].filter(([, items]) => new Set(items).size > 1);
  if (contested.length) {
    w('-- FIXED-LEDGER AMBIGUITY (one entry claimed by several remediations) --');
    for (const [id, items] of contested) w(`  ${id} claimed by ${[...new Set(items)].join(', ')}`);
    w('');
  }
  return [...drift, ...contested.map(([id, items]) => ({ item: items.join('+'), anchor: id, bound: -1 }))];
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = argv.slice(2);
  const flag = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : args[i + 1];
  };
  const inDir = resolve(flag('--in', auditDirFor(REPO_ROOT)));
  const outDir = resolve(flag('--out', inDir));
  const repoRoot = resolve(flag('--root', REPO_ROOT));
  const gate = !args.includes('--no-gate');

  // pass3 is the SECOND READING: verdicts on records the first two passes left unreviewed, never
  // new findings. The original passes are the evidence and are never rewritten to add a verdict —
  // their sha256 is the provenance of this queue — so a later ruling arrives as its own input.
  // Optional, because a checkout may hold only the evidence: an absent pass3 is PRINTED rather
  // than assumed, and omitted from inputs[] so the artifact never claims a reading that did not
  // happen.
  const inputs = [
    { pass: 'pass1', file: 'findings-pass1.json' },
    { pass: 'pass2', file: 'findings-pass2.json' },
    { pass: 'pass3', file: 'findings-pass3.json', optional: true },
  ];
  const passes = [];
  const present = [];
  for (const i of inputs) {
    const p = join(inDir, i.file);
    if (!existsSync(p)) {
      if (i.optional) {
        process.stdout.write(`reconcile-findings: no ${i.file} — ${i.pass} contributed no verdicts to this run\n`);
        continue;
      }
      process.stderr.write(`reconcile-findings: missing input ${p}\n`);
      return 2;
    }
    const text = readFileSync(p, 'utf8');
    i.sha256 = createHash('sha256').update(text).digest('hex');
    const records = loadPass(text, i.pass);
    i.records = records.length;
    passes.push({ id: i.pass, records });
    present.push(i);
  }

  // Optional like pass3: without it no ruling applies, and the run says so rather than assuming one.
  let ledgers = { fixed: [], moved: [] };
  const ledgerPath = join(inDir, LEDGERS_FILE);
  let ledgerText = null;
  try { ledgerText = readFileSync(ledgerPath, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') { process.stderr.write(`reconcile-findings: ${ledgerPath} could not be read (${e.code || e.message})\n`); return 2; }
    process.stdout.write(`reconcile-findings: no ${LEDGERS_FILE} — no fixed or moved ruling applied to this run\n`);
  }
  if (ledgerText !== null) {
    try { ledgers = loadLedgers(ledgerText); } catch (e) { process.stderr.write(`reconcile-findings: ${e.message}\n`); return 2; }
    present.push({ pass: 'ledgers', file: LEDGERS_FILE, sha256: createHash('sha256').update(ledgerText).digest('hex'),
      records: ledgers.fixed.length + ledgers.moved.length });
  }

  const { records, entries, ledgerBindings, movedBindings } = reconcile(passes, { repoRoot, fixedLedger: ledgers.fixed, movedLedger: ledgers.moved });
  const analysis = analyse(entries, records);

  const doc = {
    tool: 'reconcile-findings',
    schema: 1,
    // No timestamp, by design — see the determinism note at the top of this file.
    inputs: present,
    severityRule: 'verified (confirmed|adjusted|refuted) outranks unreviewed; among verified, '
      + 'adjusted supersedes confirmed; a residual disagreement keeps the HIGHER severity and is '
      + 'recorded as an unresolved conflict rather than hidden.',
    mergeRule: `same file:line AND (identical normalised summary OR Jaccard token overlap >= ${MERGE_SIMILARITY})`,
    idRule: ID_RULE,
    totals: {
      records: records.length,
      entries: entries.length,
      bySeverity: analysis.bySeverity,
      byDisposition: analysis.byDisposition,
      recordsBySeverity: analysis.recordsBySeverity,
      recordsBySource: analysis.recordsBySource,
    },
    conflicts: {
      multiRecordAnchors: analysis.multiRecordAnchors,
      multiEntryAnchors: analysis.multiEntryAnchors,
      // Both carry their similarity so a reader can check the ruling.
      coLocatedAnchors: analysis.coLocatedAnchors.map((a) => ({ anchor: a.anchor, severities: a.severities, similarity: a.similarity })),
      crossEntryDisagreements: analysis.crossEntryDisagreements.map((a) => ({ anchor: a.anchor, severities: a.severities, similarity: a.similarity })),
      withinEntryConflicts: analysis.withinEntryConflicts,
      unreviewedRecords: analysis.unreviewedRecords,
      unreviewedWithEmptyNote: analysis.unreviewedWithEmptyNote,
      unreviewedEntries: analysis.unreviewedEntries,
    },
    fixedLedger: ledgerBindings,
    movedLedger: movedBindings,
    queue: entries,
  };

  mkdirSync(outDir, { recursive: true });
  // The previous queue is an INPUT now, so this is a read-modify-write on a document
  // bin/anchor-staleness.mjs also writes — locked and atomic, like every other shared store here.
  const prevPath = join(outDir, 'queue.json');
  const lock = acquireLock(join(outDir, '.queue.lock'), { label: 'reconcile', attempts: 50, spinMs: 20 });
  if (!lock) {
    console.error('reconcile-findings: queue.json is locked by another writer; refusing rather than');
    console.error('  racing a re-pin run. Retry when it finishes.');
    return 2;
  }
  try {
    if (existsSync(prevPath)) {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));   // corrupt prev = loud death, never silence
      const { carried, dropped } = carryForwardPins(prev, doc.queue);
      // Both halves, always: a silent drop is the un-verification this exists to prevent.
      if (carried || dropped) process.stdout.write(`carried ${carried} re-pin annotation(s) forward; ${dropped} could not be carried (place no longer unique or entry gone)\n`);
    }
    writeAtomic(join(outDir, 'queue.json'), JSON.stringify(doc, null, 2) + '\n');
    writeAtomic(join(outDir, 'queue.md'), renderMarkdown(doc));
  } finally { lock.release(); }

  const drift = printConflictReport(analysis, ledgerBindings);
  process.stdout.write(`wrote ${join(outDir, 'queue.json')}\nwrote ${join(outDir, 'queue.md')}\n\n`);

  // The gate: exiting 0 with unresolved conflicts would be a confident green describing a
  // declaration rather than reality. --no-gate for artifact-only.
  const blockers = [];
  if (analysis.withinEntryConflicts.length) blockers.push(`${analysis.withinEntryConflicts.length} unresolved within-entry conflict(s)`);
  if (analysis.crossEntryDisagreements.length) blockers.push(`${analysis.crossEntryDisagreements.length} anchor(s) whose co-located defects disagree on severity`);
  if (analysis.unreviewedEntries) blockers.push(`${analysis.unreviewedEntries} entries never given a second pass`);
  if (drift.length) blockers.push(`${drift.length} fixed-ledger row(s) binding no entry, or entries claimed by two remediations`);
  // A move nobody can locate is worse than no move: the finding would read as relocated while
  // pointing nowhere, and the destination is what anchor-staleness verifies from here on.
  const movedDrift = (movedBindings || []).filter((b) => b.bound !== 1 || b.applied.length !== 1);
  if (movedDrift.length) {
    blockers.push(`${movedDrift.length} moved-ledger row(s) that did not bind exactly one live entry`);
    for (const b of movedDrift) {
      process.stdout.write(`  moved-ledger: ${b.item} (${b.from} -> ${b.to}) bound ${b.bound}, applied ${b.applied.length}\n`);
    }
  }
  if (!blockers.length) {
    process.stdout.write('GATE: clean — nothing unresolved.\n');
    return 0;
  }
  process.stdout.write('GATE: BLOCKED\n');
  for (const b of blockers) process.stdout.write(`  - ${b}\n`);
  process.stdout.write('This queue is not yet safe to size or sequence. Resolve the above, or re-run with --no-gate\n'
    + 'if you only need the artifact.\n');
  return gate ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv));
}
