#!/usr/bin/env node
// monitor/remediation-outcome.mjs — did a remediation claim hold? Checks remediation-ledger and
// scanner-annotation `claim:'remediated'` assertions against the latest slice and appends
// finding-adjudication outcome records. Dry-run by default; --write appends.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { annotationsPathFor } from './store-paths.mjs';
import { fileURLToPath } from 'node:url';
import { appendFindingAdjudication, findingKeyForScanner, findingKeyForDependency, readJournalFile, readAdjudications, adjudicationsPath } from '../bin/lib/verdict-journal-core.mjs';
import { identityFor } from './detail-schema.mjs';
import { scannerPlaceKey } from './scanner-delta.mjs';
import { scannerAnnotationTarget } from './annotate-lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const OUTCOMES = ['verified-fixed', 'refuted-still-present'];

// sha256 of the (claimRef, findingKey, sliceId) triple — idempotency key; field order fixed so equal triples hash equally
export function idemKeyFor({ claimRef, findingKey, sliceId }) {
  return createHash('sha256').update(JSON.stringify({ claimRef, findingKey, sliceId })).digest('hex');
}

/**
 * Latest slice for an area's OUT_DIR — reads history/<stamp>.json, not rollup.json (which omits
 * the dependency-lane findings/carried arrays). Only ENOENT is absence; other failures throw.
 */
export function loadLatestSlice(outDir) {
  const histDir = join(outDir, 'history');
  let idx;
  try {
    idx = JSON.parse(readFileSync(join(histDir, 'index.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`remediation-outcome: history/index.json at ${histDir} is unreadable — ${e.message}`);
  }
  if (!Array.isArray(idx) || !idx.length) return null;
  const row = idx[idx.length - 1];
  if (!row || !row.file) return null;
  try {
    return JSON.parse(readFileSync(join(histDir, row.file), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null; // index points at a file that is gone — absent, not broken
    throw new Error(`remediation-outcome: latest slice ${row.file} at ${histDir} is unreadable — ${e.message}`);
  }
}

/** scannerAnnotations[] with claim === 'remediated' -> candidate outcome records + skip reasons. */
export function deriveScannerClaimOutcomes(scannerAnnotations, slice) {
  const out = [];
  const skipped = [];
  const sliceId = (slice && (slice.sliceId || slice.stamp)) || null;
  const scannerDelta = slice && slice.scannerDelta;
  const haveComparableData = !!(slice && slice.scannerFindings && scannerDelta);
  const notComparedCats = new Set((((scannerDelta && scannerDelta.notCompared) || [])).map((s) => s.split(':')[0]));

  for (const a of scannerAnnotations || []) {
    if (!a || a.claim !== 'remediated') continue; // structured field ONLY — never parsed from prose
    const fields = identityFor(a.category);
    if (!fields) { skipped.push({ reason: `unknown category '${a.category}'` }); continue; }
    if (!haveComparableData) {
      skipped.push({ reason: `category '${a.category}': no slice, or slice carries no scannerFindings/scannerDelta — comparability unknown` });
      continue;
    }
    if (notComparedCats.has(a.category)) {
      const why = (scannerDelta.notCompared || []).find((s) => s.startsWith(`${a.category}:`)) || a.category;
      skipped.push({ reason: `category '${a.category}' not comparable this slice (${why}) — a category not rescanned can prove nothing` });
      continue;
    }
    const repo = a.repo || (a.scope === 'fleet' ? 'fleet' : null);
    if (!repo) { skipped.push({ reason: `category '${a.category}': no repo and not scope:'fleet'` }); continue; }
    let findingKey;
    try { findingKey = findingKeyForScanner(a.category, repo, a); }
    catch (e) { skipped.push({ reason: e.message }); continue; }

    const rows = slice.scannerFindings[a.category] || [];
    let stillPresent;
    let matchedRepos = [];
    if (a.scope === 'fleet') {
      // A fleet claim is refuted if the identity tuple appears ANYWHERE in the category's rows
      const idSuffix = fields.map((f) => String(a[f] ?? '')).join('|');
      const hits = rows.filter((r) => fields.map((f) => String(r[f] ?? '')).join('|') === idSuffix);
      stillPresent = hits.length > 0;
      matchedRepos = [...new Set(hits.map((r) => String(r.repo ?? '')))].sort();
    } else {
      const claimPlace = scannerPlaceKey(a.category, a); // `a` already carries repo + identity fields
      stillPresent = rows.some((r) => scannerPlaceKey(a.category, r) === claimPlace);
      if (stillPresent) matchedRepos = [repo];
    }
    const claimRef = `${scannerAnnotationTarget(a, fields)}@${a.at}`;
    out.push({
      findingKey, category: a.category, repo,
      outcome: stillPresent ? 'refuted-still-present' : 'verified-fixed',
      claimSource: 'scanner-annotation', claimRef, sliceId,
      stillPresentIn: matchedRepos.length ? matchedRepos : undefined,
      bornSlice: null, // scanner rows carry no bornSlice concept — honestly absent, never guessed
      place: `${a.category}:${repo}`, artifact: 'monitor/annotations.json#scannerAnnotations',
    });
  }
  out.sort((x, y) => (x.findingKey < y.findingKey ? -1 : x.findingKey > y.findingKey ? 1 : 0));
  return { out, skipped };
}

/**
 * remediation-ledger.json `entries[]` -> candidate outcome records + skip reasons. `weak`-tier
 * entries are unconfirmed by construction (monitor/ledger.mjs) and are never a remediation claim.
 */
export function deriveLedgerClaimOutcomes(ledgerEntries, slice) {
  const out = [];
  const skipped = [];
  const sliceId = (slice && (slice.sliceId || slice.stamp)) || null;
  // Array.isArray, not truthy: a summary shape passed by mistake reads "cannot verify", never verified-fixed
  const haveFindingsData = !!(slice && Array.isArray(slice.findings) && Array.isArray(slice.carried));
  const findingsByKey = haveFindingsData ? new Set(slice.findings.map((f) => f.key)) : null;
  const carriedByKey = haveFindingsData ? new Set(slice.carried.map((f) => f.key)) : null;

  for (const entry of ledgerEntries || []) {
    if (!entry || !entry.key) { skipped.push({ reason: 'ledger entry missing key' }); continue; }
    if (entry.evidence && entry.evidence.tier === 'weak') {
      skipped.push({ reason: `${entry.key}: weak tier is unconfirmed — never a remediation claim` });
      continue;
    }
    if (!entry.repo || !entry.vulnId || !entry.package) {
      skipped.push({ reason: `${entry.key}: missing repo/vulnId/package — cannot key an outcome` });
      continue;
    }
    if (!haveFindingsData) {
      skipped.push({ reason: `${entry.key}: slice carries no findings/carried arrays — comparability unknown` });
      continue;
    }
    const stillPresent = findingsByKey.has(entry.key);
    if (!stillPresent && carriedByKey.has(entry.key)) {
      skipped.push({ reason: `${entry.key}: not rescanned this slice (carried) — proves nothing` });
      continue;
    }
    const findingKey = findingKeyForDependency(entry.repo, entry.vulnId, entry.package);
    const claimRef = `ledger:${entry.key}@${entry.resolvedSlice}`;
    out.push({
      findingKey, category: 'dependency-cve', repo: entry.repo,
      outcome: stillPresent ? 'refuted-still-present' : 'verified-fixed',
      claimSource: 'remediation-ledger', claimRef, sliceId,
      bornSlice: entry.bornSlice ?? null,
      place: `dependency-cve:${entry.repo}`, artifact: 'monitor/remediation-ledger.json#entries',
    });
  }
  out.sort((x, y) => (x.findingKey < y.findingKey ? -1 : x.findingKey > y.findingKey ? 1 : 0));
  return { out, skipped };
}

/** Both claim lanes, combined — the one function a caller needs. */
export function deriveOutcomes(slice, { scannerAnnotations = [], ledgerEntries = [] } = {}) {
  const scanner = deriveScannerClaimOutcomes(scannerAnnotations, slice);
  const ledger = deriveLedgerClaimOutcomes(ledgerEntries, slice);
  return {
    outcomes: [...scanner.out, ...ledger.out],
    skipped: [...scanner.skipped, ...ledger.skipped],
    counts: { scannerAnnotation: scanner.out.length, remediationLedger: ledger.out.length },
  };
}

/** outcomeKeys already present among kind:'finding-adjudication' records in the adjudications journal. */
export function alreadyOutcomedKeys({ dir } = {}) {
  const j = readAdjudications(dir);
  const keys = new Set();
  for (const r of j.records) {
    if (r && r.kind === 'finding-adjudication' && r.outcomeKey) keys.add(r.outcomeKey);
  }
  return keys;
}

/**
 * Full orchestration: load slice + annotations + ledger, derive candidates, drop already-recorded
 * triples, and (when `write`) append. ENOENT reads as "nothing claimed"; other failures -> `errors`.
 */
export function runRemediationOutcome({
  outDir, annotationsPath: annPath, ledgerPath, write = false, dir,
} = {}) {
  const errors = [];
  const readJSON = (p, fallback) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) {
      if (e.code === 'ENOENT') return fallback;
      errors.push(`${p}: unreadable (${e.message})`);
      return fallback;
    }
  };

  let slice = null;
  try { slice = loadLatestSlice(outDir); }
  catch (e) { errors.push(e.message); }

  if (!slice) {
    return { ok: errors.length === 0, sliceId: null, note: 'no slice yet', verifiedFixed: 0, refutedStillPresent: 0, skipped: 0, alreadyRecorded: 0, loudLines: [], errors };
  }

  const annDoc = readJSON(annPath, { scannerAnnotations: [] });
  const ledgerDoc = readJSON(ledgerPath, { entries: [] });
  const { outcomes, skipped } = deriveOutcomes(slice, {
    scannerAnnotations: annDoc.scannerAnnotations || [],
    ledgerEntries: ledgerDoc.entries || [],
  });

  const existing = alreadyOutcomedKeys({ dir });
  const toWrite = [];
  let alreadyRecorded = 0;
  for (const o of outcomes) {
    const outcomeKey = idemKeyFor({ claimRef: o.claimRef, findingKey: o.findingKey, sliceId: o.sliceId });
    if (existing.has(outcomeKey)) { alreadyRecorded++; continue; }
    toWrite.push({ ...o, outcomeKey });
  }

  const loudLines = toWrite
    .filter((o) => o.outcome === 'refuted-still-present')
    .map((o) => `REFUTED: ${o.category} ${o.findingKey} — claimed remediated (${o.claimSource}: ${o.claimRef}) but still present in ${o.repo}${o.stillPresentIn ? ` [${o.stillPresentIn.join(', ')}]` : ''}`);

  if (write) {
    for (const o of toWrite) {
      const { place, artifact, outcomeKey, findingKey, category, repo, outcome, claimSource, claimRef, sliceId, bornSlice, stillPresentIn } = o;
      const res = appendFindingAdjudication({
        findingKey, category, repo,
        machineVerdict: null, humanVerdict: 'remediated', truth: null,
        outcome, claimSource, claimRef, sliceId, outcomeKey, bornSlice,
        ...(stillPresentIn ? { stillPresentIn } : {}),
        basis: outcome === 'verified-fixed'
          ? 'remediation-outcome: place absent from the latest slice'
          : 'remediation-outcome: place still present in the latest slice',
        evidence: null, model: null, promptId: null,
      }, { dir, place, artifact });
      if (!res.ok) errors.push(`append FAILED for ${findingKey}: ${res.error}`);
    }
  }

  return {
    ok: errors.length === 0,
    sliceId: slice.sliceId || slice.stamp || null,
    verifiedFixed: toWrite.filter((o) => o.outcome === 'verified-fixed').length,
    refutedStillPresent: toWrite.filter((o) => o.outcome === 'refuted-still-present').length,
    skipped: skipped.length,
    alreadyRecorded,
    loudLines,
    errors,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
// usage: node monitor/remediation-outcome.mjs <outDir> [--write]
//   <outDir> is an area's OUT_DIR (the directory rollup.mjs writes rollup.json + history/ into) —
//   CW_MONITOR_OUT if omitted, matching every other per-area tool in this repo.
function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const outDir = args.find((a) => !a.startsWith('--')) || process.env.CW_MONITOR_OUT;
  if (!outDir) {
    console.error('usage: node monitor/remediation-outcome.mjs <outDir> [--write]  (or set CW_MONITOR_OUT)');
    process.exit(2);
  }
  const annotationsPath = annotationsPathFor(REPO);
  const ledgerPath = join(outDir, 'remediation-ledger.json');
  const res = runRemediationOutcome({ outDir, annotationsPath, ledgerPath, write });

  if (res.note) { console.log(`remediation-outcome: ${res.note} (${outDir})`); process.exit(res.ok ? 0 : 1); }
  console.log(`remediation-outcome @ ${res.sliceId}: ${res.verifiedFixed} verified-fixed · ${res.refutedStillPresent} refuted · `
    + `${res.skipped} not comparable · ${res.alreadyRecorded} already recorded`);
  for (const line of res.loudLines) console.error(`  ${line}`);
  for (const e of res.errors) console.error(`  error: ${e}`);
  if (!write) console.log('(dry run — pass --write to append; nothing written)');
  process.exit(res.errors.length || res.refutedStillPresent ? 1 : 0);
}

const isMain = isMainModule(import.meta.url);
if (isMain) main();
