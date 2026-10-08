#!/usr/bin/env node
// monitor/store-consistency.mjs — referential integrity ACROSS commitwork's own stores.
//
// THE TECHNIQUE, AND WHERE IT COMES FROM. Amnesty International's Pegasus forensic methodology
// (2021) did not confirm infections by recognising malware. It confirmed them by noticing that two
// stores maintained by one writer had stopped agreeing: Pegasus deleted the malicious process
// names from iOS's `ZPROCESS` table and left the corresponding rows in `ZLIVEUSAGE`. Nothing about
// the leftover rows was suspicious in itself. They were suspicious because the thing that should
// have referred to them was gone.
//
// That generalises off the phone completely. commitwork keeps several stores whose contents are
// derived from, or point at, each other — an index and its slices, a key map and the records it
// keys, an append-only event log and the state it derives. Every one of those pairs has an
// invariant that no legitimate writer breaks and no partial edit preserves. Checking them costs a
// few hundred milliseconds and needs no signature, no threat intelligence and no network.
//
// fact: a WIDOW is the class a naive integrity check misses / walking pointers forward can only ever find orphans, and a writer covering its tracks removes the reference, not the data (the zLiveUsage case) (expiry: never, prev: missing)
//   orphan    a referrer names a referent that is not there — usually a prune that did not update its index
//   widow     a referent exists and nothing refers to it
//   mismatch  both ends present, digests disagree — the referent was edited in place
//
// Collapsing them into "inconsistent" would throw away the direction, and the direction is the
// whole diagnostic: an orphan says a deletion was incomplete, a widow says a deletion was
// selective, and a mismatch says there was no deletion at all.
//
// WHAT THIS MODULE IS NOT. It is not a tamper verdict. Every class here has innocent causes —
// an interrupted compaction, a hand-edited fixture, a half-applied migration — and those are the
// overwhelming majority of what it will find. It reports a broken invariant and names the pair;
// deciding what broke it stays a human act. Nothing here writes a finding into the issue store.
//
// FAIL CLOSED. An unreadable store yields `unknown`, never zero anomalies — a consistency checker
// that reports "all consistent" because it could not open the file is worse than no checker, since
// it converts a permission error into a clean bill of health. Only ENOENT is absence, and an
// absent store makes the pairs that depend on it unknown rather than clean.
//
// usage: node monitor/store-consistency.mjs [--json] [--area <slug>] [--out <path>]
//   env: CW_ISSUES          issue store path        (default monitor/private/issues.json;
//                           CW_ISSUE_STORE still honoured)
//        CW_MONITOR_OUT     area out dir            (as everywhere else in monitor/)
//        CW_CONSISTENCY_OUT written artifact path   (default <out>/store-consistency.json)
//        CW_CONSISTENCY_CAP per-class key cap       (default 50; the remainder is COUNTED, never
//                                                    silently dropped)
//        CW_NOW             pins `generated`

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { unknown, isUnknown } from './unknown.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

const DEFAULT_CAP = 50;

/** The closed class vocabulary. Adding a fourth means finding a fourth WAY a pair can break, not a
 *  fourth word for these three. */
export const CLASS = Object.freeze({
  ORPHAN: 'orphan',
  WIDOW: 'widow',
  MISMATCH: 'mismatch',
});

// ── store readers ───────────────────────────────────────────────────────────────────────────────
// Each returns { ok:true, value } or an unknown(). NEVER a bare {} or [] on failure: an empty
// store and an unopenable one are the same shape downstream, and that equivalence is the defect
// this whole module exists to detect elsewhere.

/** Read + parse JSON, distinguishing absent (ENOENT) from unreadable from unparseable. */
export function readJsonStore(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return unknown('absent', path);
    return unknown('not-permitted', `${path}: ${e.code || e.message}`);
  }
  if (!raw.trim()) return unknown('empty', path);
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return unknown('unparseable', `${path}: ${e.message}`);
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ── the pair table ──────────────────────────────────────────────────────────────────────────────
// A pair states: what refers, what is referred to, and which of the three classes it can express.
// Declaring `classes` matters — some pairs cannot express a widow (a wildcard annotation matching
// nothing is normal, not a leftover), and running a check a pair cannot support manufactures
// findings. A pair that omits a class is stating that the class has no meaning there, and the test
// beside this file asserts no pair reports a class it did not declare.

/**
 * P1 — history/index.json rows against the slice files they name.
 *
 * fact: two shapes of missing file are legitimate and neither is an orphan — `pruned` (a v0 row; retention drops old slices deliberately and monitor/timeline.mjs already treats an ENOENT v0 slice as absent) and `legacy` (a v1 row with NO sliceSha256, predating digest recording, so its absence proves nothing — 2 of 39 rows on reports/clientA-monorepo, 2026-08-26) (expiry: when every v1 row carries a digest, prev: wrong)
 * fact: only a row that RECORDED a digest — one that asserted the bytes were worth pinning — makes a missing file an orphan (expiry: never, prev: wrong)
 * fact: both benign counts are still PUBLISHED / a denominator that quietly excludes them flatters the pair (expiry: never, prev: unknown)
 *
 * THE LIMIT THIS LEAVES, STATED RATHER THAN PAPERED OVER. Deriving the class from a field IN the
 * index means an edit that strips `sliceSha256` from a row downgrades that row out of the orphan
 * class, and there is nothing here to notice it: reports/ is gitignored, so no prior copy of the
 * index exists to diff against. The index is the one store in this pair with no integrity anchor
 * of its own. Anchoring it is the obvious next move and has not been made.
 */
export function checkHistoryIndex(historyDir) {
  const indexPath = join(historyDir, 'index.json');
  const idx = readJsonStore(indexPath);
  if (isUnknown(idx)) return { pair: 'history-index→slice', ...idx, referrer: indexPath };

  const rows = Array.isArray(idx.value) ? idx.value : (idx.value.rows || idx.value.slices || []);
  if (!Array.isArray(rows)) {
    return { pair: 'history-index→slice', ...unknown('unstated', `${indexPath}: no row array`), referrer: indexPath };
  }

  const anomalies = [];
  const named = new Set();
  let prunedLegitimately = 0;
  let legacyUndigested = 0;

  for (const row of rows) {
    if (!row || typeof row.file !== 'string') continue;
    named.add(row.file);
    const slicePath = join(historyDir, row.file);
    const version = Number(row.sliceVersion || 0);
    const digested = typeof row.sliceSha256 === 'string' && row.sliceSha256.length > 0;

    if (!existsSync(slicePath)) {
      // Both benign shapes are counted, never silently skipped — see the header.
      if (version < 1) { prunedLegitimately += 1; continue; }
      if (!digested) { legacyUndigested += 1; continue; }
      anomalies.push({
        class: CLASS.ORPHAN, key: row.file, sliceId: row.sliceId ?? null,
        detail: `index row pinned sliceSha256 ${row.sliceSha256.slice(0, 12)}… and the slice file is not on disk`,
      });
      continue;
    }
    if (digested) {
      const actual = sha256(readFileSync(slicePath));
      if (actual !== row.sliceSha256) {
        anomalies.push({
          class: CLASS.MISMATCH, key: row.file, sliceId: row.sliceId ?? null,
          detail: `sliceSha256 ${row.sliceSha256.slice(0, 12)}… but the file hashes ${actual.slice(0, 12)}…`,
        });
      }
    }
  }

  // The ZLIVEUSAGE direction: payload on disk that the index no longer admits to.
  let onDisk;
  try {
    onDisk = readdirSync(historyDir).filter((f) => /^\d{14}\.json$/.test(f));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    onDisk = [];
  }
  for (const f of onDisk.sort()) {
    if (named.has(f)) continue;
    anomalies.push({
      class: CLASS.WIDOW, key: f, sliceId: null,
      detail: 'slice file on disk that no index row names — an index trimmed without its payload',
    });
  }

  return {
    pair: 'history-index→slice', ok: true, referrer: indexPath,
    referrers: rows.length, referents: onDisk.length, prunedLegitimately, legacyUndigested, anomalies,
  };
}

/**
 * P2 — the issue store's byKey map against the issues it keys, in both directions.
 *
 * An issue whose `source.key` is null is unkeyable by construction (manually minted, group
 * members, non-scanner sources) and is excluded from the widow sweep rather than counted as one.
 *
 * fact: a superseded duplicate legitimately shares its key, so a losing issue that POINTS AT the winner byKey holds is `resolvedDuplicates`, never a widow / calling it a widow makes this check permanently noisy on the live store, and a detector that fires every run is ignored by the third (expiry: never, prev: wrong)
 * fact: one that points somewhere else, or nowhere, IS still a widow (expiry: never, prev: unknown)
 * fact: ISS-PERSONAL-S-000042/-000043 and ISS-000001 exist only because their shared key ends `|566` — the line-keyed-identity bug of 2026-08-03 / real history, correctly resolved, and not something to re-report (expiry: if those rows are ever re-keyed, prev: wrong)
 */
export function checkIssueKeyMap(store) {
  const issues = store.issues || {};
  const byKey = store.byKey || {};
  const anomalies = [];

  for (const [key, id] of Object.entries(byKey)) {
    if (!Object.prototype.hasOwnProperty.call(issues, id)) {
      anomalies.push({ class: CLASS.ORPHAN, key, issueId: id, detail: 'byKey names an issue id that is not in issues{}' });
    }
  }
  let unkeyable = 0;
  let resolvedDuplicates = 0;
  for (const [id, iss] of Object.entries(issues)) {
    const k = iss && iss.source && iss.source.key;
    if (!k) { unkeyable += 1; continue; }
    if (byKey[k] === id) continue;

    const winner = byKey[k];
    const deps = (iss && iss.deps) || {};
    // The losing side of a resolved collision: it defers, explicitly, to the id that holds the key.
    if (winner !== undefined && (deps.duplicateOf === winner || deps.supersededBy === winner)) {
      resolvedDuplicates += 1;
      continue;
    }
    anomalies.push({
      class: CLASS.WIDOW, key: k, issueId: id,
      detail: winner === undefined
        ? 'issue carries a source key that byKey does not map'
        : `byKey maps this key to ${winner}, and this issue does not defer to it`,
    });
  }
  return {
    pair: 'issues.byKey→issues', ok: true, referrer: 'byKey',
    referrers: Object.keys(byKey).length, referents: Object.keys(issues).length,
    unkeyable, resolvedDuplicates, anomalies,
  };
}

/**
 * P3 — the append-only event log against the state derived from it. The closest analogue in this
 * repository to the ZPROCESS/ZLIVEUSAGE pair, and the only check here that would notice a
 * hand-edited issues{} at all: the hash chain over events[] proves the LOG was not edited, and
 * proves nothing whatsoever about the state beside it.
 *
 *   orphan  an event names an issue that no longer exists in issues{}
 *   widow   an issue exists with no opening event — state present, history absent
 */
export function checkIssueEvents(store) {
  const issues = store.issues || {};
  const events = Array.isArray(store.events) ? store.events : null;
  if (!events) {
    return { pair: 'issues.events→issues', ...unknown('not-recorded', 'no events[] array in the issue store') };
  }

  const anomalies = [];
  const opened = new Set();
  const mentioned = new Set();
  for (const ev of events) {
    if (!ev || typeof ev.issueId !== 'string') continue;
    mentioned.add(ev.issueId);
    if (ev.type === 'issue-opened') opened.add(ev.issueId);
  }
  for (const id of [...mentioned].sort()) {
    if (!Object.prototype.hasOwnProperty.call(issues, id)) {
      anomalies.push({ class: CLASS.ORPHAN, key: id, detail: 'the event log records this issue; issues{} does not contain it' });
    }
  }
  for (const id of Object.keys(issues).sort()) {
    if (!opened.has(id)) {
      anomalies.push({
        class: CLASS.WIDOW, key: id,
        detail: 'issue present in derived state with no issue-opened event — state without history',
      });
    }
  }
  return {
    pair: 'issues.events→issues', ok: true, referrer: 'events[]',
    referrers: events.length, referents: Object.keys(issues).length, anomalies,
  };
}

/**
 * P4 — issue-to-issue links. `duplicateOf`, `supersededBy` and `blockedBy` all name issue ids, and
 * a link to an id that is not there is a pointer into a hole. Only orphans are expressible: an
 * issue nothing links to is the normal case, not a leftover.
 */
export function checkIssueLinks(store) {
  const issues = store.issues || {};
  const anomalies = [];
  let links = 0;
  for (const [id, iss] of Object.entries(issues).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const deps = (iss && iss.deps) || {};
    const targets = [
      ['duplicateOf', deps.duplicateOf], ['supersededBy', deps.supersededBy],
      ...(Array.isArray(deps.blockedBy) ? deps.blockedBy.map((t) => ['blockedBy', t]) : []),
    ];
    for (const [field, target] of targets) {
      if (!target) continue;
      links += 1;
      if (!Object.prototype.hasOwnProperty.call(issues, target)) {
        anomalies.push({ class: CLASS.ORPHAN, key: `${id}.${field}`, issueId: id, detail: `${field} names ${target}, which is not in issues{}` });
      }
    }
  }
  return { pair: 'issues.deps→issues', ok: true, referrer: 'deps', referrers: links, referents: Object.keys(issues).length, anomalies };
}

/** Which classes each pair is permitted to report. A pair reporting a class it did not declare is
 *  a bug in the pair, not a finding, and monitor/test/store-consistency.test.mjs asserts it. */
export const PAIR_CLASSES = Object.freeze({
  'history-index→slice': [CLASS.ORPHAN, CLASS.WIDOW, CLASS.MISMATCH],
  'issues.byKey→issues': [CLASS.ORPHAN, CLASS.WIDOW],
  'issues.events→issues': [CLASS.ORPHAN, CLASS.WIDOW],
  'issues.deps→issues': [CLASS.ORPHAN],
});

// ── the sweep ───────────────────────────────────────────────────────────────────────────────────

/**
 * Run every pair that its inputs support. `historyDirs` may be empty and `issueStorePath` may be
 * absent; each produces an unknown for its own pairs and leaves the others alone. The result's
 * `unknownPairs` is what stops a partially-readable run from being read as a clean one.
 */
export function runConsistency({ issueStorePath, historyDirs = [], cap = DEFAULT_CAP } = {}) {
  const results = [];

  for (const dir of historyDirs) results.push(checkHistoryIndex(dir));

  if (issueStorePath) {
    const store = readJsonStore(issueStorePath);
    if (isUnknown(store)) {
      for (const pair of ['issues.byKey→issues', 'issues.events→issues', 'issues.deps→issues']) {
        results.push({ pair, ...store, referrer: issueStorePath });
      }
    } else {
      results.push(checkIssueKeyMap(store.value));
      results.push(checkIssueEvents(store.value));
      results.push(checkIssueLinks(store.value));
    }
  }

  const checked = results.filter((r) => r.ok);
  const unknownPairs = results.filter((r) => isUnknown(r))
    .map((r) => ({ pair: r.pair, unknownReason: r.unknownReason, unknownDetail: r.unknownDetail ?? null }));

  // Cap enumerated anomalies per pair, and COUNT what the cap dropped. A silent truncation here
  // would read as "that pair is nearly clean", which is the failure mode the cap exists to avoid.
  const pairs = checked.map((r) => {
    const all = (r.anomalies || []).slice().sort(byAnomaly);
    return {
      pair: r.pair, referrer: r.referrer ?? null,
      referrers: r.referrers ?? null, referents: r.referents ?? null,
      ...(r.prunedLegitimately !== undefined ? { prunedLegitimately: r.prunedLegitimately } : {}),
      ...(r.legacyUndigested !== undefined ? { legacyUndigested: r.legacyUndigested } : {}),
      ...(r.unkeyable !== undefined ? { unkeyable: r.unkeyable } : {}),
      ...(r.resolvedDuplicates !== undefined ? { resolvedDuplicates: r.resolvedDuplicates } : {}),
      counts: countByClass(all),
      anomalies: all.slice(0, cap),
      truncated: Math.max(0, all.length - cap),
    };
  });

  const totals = countByClass([]);
  for (const p of pairs) for (const [k, v] of Object.entries(p.counts)) totals[k] = (totals[k] || 0) + v;

  return {
    generated: process.env.CW_NOW || new Date().toISOString(),
    pairsChecked: pairs.length,
    pairsUnknown: unknownPairs.length,
    // The honest headline: a total of 0 means something only when pairsUnknown is also 0.
    totals,
    complete: unknownPairs.length === 0,
    unknownPairs,
    pairs: pairs.sort((a, b) => (a.pair < b.pair ? -1 : 1)),
  };
}

const byAnomaly = (a, b) => (a.class < b.class ? -1 : a.class > b.class ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function countByClass(list) {
  const out = { orphan: 0, widow: 0, mismatch: 0 };
  for (const a of list) out[a.class] = (out[a.class] || 0) + 1;
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

async function resolveHistoryDirs(areaSlug) {
  const { outDirFor, reportsRootDir } = await import('./area.mjs');
  if (process.env.CW_MONITOR_OUT) return [join(resolve(process.env.CW_MONITOR_OUT), 'history')].filter(existsSync);
  if (areaSlug) return [join(outDirFor(areaSlug), 'history')].filter(existsSync);
  const root = reportsRootDir();
  let names = [];
  try { names = readdirSync(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return names.sort().map((n) => join(root, n, 'history')).filter(existsSync);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const asJson = argv.includes('--json');
  const cap = Number(process.env.CW_CONSISTENCY_CAP) || DEFAULT_CAP;

  const { issuesPathFor } = await import('./store-paths.mjs');
  const issueStorePath = issuesPathFor(REPO);
  const historyDirs = await resolveHistoryDirs(flag('--area'));

  const report = runConsistency({ issueStorePath, historyDirs, cap });

  const outPath = flag('--out') || process.env.CW_CONSISTENCY_OUT
    || join(historyDirs.length === 1 ? dirname(historyDirs[0]) : REPO, 'store-consistency.json');
  writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  const { orphan, widow, mismatch } = report.totals;
  console.log(`store-consistency: ${report.pairsChecked} pair(s) checked over ${historyDirs.length} history dir(s)`);
  for (const p of report.pairs) {
    const c = p.counts;
    if (!c.orphan && !c.widow && !c.mismatch) continue;
    console.log(`  ${p.pair}  orphan ${c.orphan}  widow ${c.widow}  mismatch ${c.mismatch}`
      + `${p.truncated ? `  (+${p.truncated} beyond the cap)` : ''}`);
    for (const a of p.anomalies.slice(0, 8)) console.log(`      ${a.class.toUpperCase().padEnd(8)} ${a.key} — ${a.detail}`);
  }
  for (const u of report.unknownPairs) {
    console.log(`  UNKNOWN  ${u.pair} — ${u.unknownReason}${u.unknownDetail ? `: ${u.unknownDetail}` : ''}`);
  }
  if (!report.complete) {
    console.log('store-consistency: INCOMPLETE — the totals below are a floor, not a count. '
      + 'A pair that could not be read has not been found consistent.');
  }
  console.log(`store-consistency: ${orphan} orphan, ${widow} widow, ${mismatch} mismatch — ${outPath}`);

  // Exit 1 on any anomaly, 2 when nothing could be checked at all: "checked nothing" must never
  // share an exit code with "checked everything and found nothing".
  if (orphan + widow + mismatch > 0) process.exitCode = 1;
  else if (report.pairsChecked === 0) process.exitCode = 2;
}

if (isMain) {
  main().catch((e) => { console.error(`store-consistency: ${(e && e.stack) || e}`); process.exitCode = 2; });
}
