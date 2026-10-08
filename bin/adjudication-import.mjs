#!/usr/bin/env node
// bin/adjudication-import.mjs — derive kind:'finding-adjudication' records from the human verdicts
// in monitor/annotations.json. Idempotent via importKey; dry-run by default; CW_ANNOTATIONS /
// CW_VERDICT_DIR override paths at call time.
//
// usage:
//   node bin/adjudication-import.mjs            # dry run — prints what would import, writes nothing
//   node bin/adjudication-import.mjs --write     # append new finding-adjudication records
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFindingAdjudication, findingKeyForScanner, findingKeyForDependency, readJournalFile, readAdjudications, adjudicationsPath } from './lib/verdict-journal-core.mjs';
import { identityFor } from '../monitor/detail-schema.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { annotationsPathFor } from '../monitor/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const annotationsPath = () => annotationsPathFor(REPO);

// Only 'false-positive' maps to a truth claim; accept/wont-fix/note/resolved are risk decisions,
// never a calibration signal.
export const ACTION_TRUTH = { 'false-positive': 'false-alarm' };

// Idempotency key: at/who/reason are in the hash, so an edited annotation is a new candidate.
export function idemKeyFor(identityParts, a) {
  const basis = { ...identityParts, action: a.action, reason: a.reason, who: a.who, at: a.at, expires: a.expires ?? null };
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex');
}

/** scannerAnnotations[] -> candidate finding-adjudication records + a list of skip reasons. */
export function deriveFromScannerAnnotations(doc) {
  const out = [];
  const skipped = [];
  for (const a of doc.scannerAnnotations || []) {
    const fields = identityFor(a.category);
    if (!fields) { skipped.push({ reason: `unknown category '${a.category}'` }); continue; }
    const repo = a.repo || (a.scope === 'fleet' ? 'fleet' : null);
    if (!repo) { skipped.push({ reason: `category '${a.category}': no repo and not scope:'fleet'` }); continue; }
    let findingKey;
    try { findingKey = findingKeyForScanner(a.category, repo, a); }
    catch (e) { skipped.push({ reason: e.message }); continue; }
    const identityParts = { category: a.category, repo, ...Object.fromEntries(fields.map((f) => [f, a[f]])) };
    out.push({
      findingKey, category: a.category, repo,
      machineVerdict: null, // human side only — scanner verdict honestly absent
      humanVerdict: a.action,
      truth: ACTION_TRUTH[a.action] ?? null,
      basis: a.reason, evidence: null,
      model: null, promptId: null, bornSlice: null,
      importKey: idemKeyFor(identityParts, a),
      place: `${a.category}:${a.file ?? repo}`,
      artifact: 'monitor/annotations.json#scannerAnnotations',
    });
  }
  return { out, skipped };
}

/** annotations[] (CVE-scoped) -> candidate finding-adjudication records + a list of skip reasons. */
export function deriveFromCveAnnotations(doc) {
  const out = [];
  const skipped = [];
  for (const a of doc.annotations || []) {
    if (!a.repo || !a.id || !a.package) {
      skipped.push({ reason: `${a.id ?? '(no id)'}/${a.package ?? '(no package)'}: missing repo/id/package — wildcard-by-omission cannot be pinned to one finding` });
      continue;
    }
    const findingKey = findingKeyForDependency(a.repo, a.id, a.package);
    const identityParts = { repo: a.repo, id: a.id, package: a.package };
    out.push({
      findingKey, category: 'dependency-cve', repo: a.repo,
      machineVerdict: null,
      humanVerdict: a.action,
      truth: ACTION_TRUTH[a.action] ?? null,
      basis: a.reason, evidence: null,
      model: null, promptId: null, bornSlice: null,
      importKey: idemKeyFor(identityParts, a),
      place: `dependency-cve:${a.id}:${a.package}`,
      artifact: 'monitor/annotations.json#annotations',
    });
  }
  return { out, skipped };
}

/** importKeys already present among kind:'finding-adjudication' records — never the native 36. */
export function alreadyImportedKeys({ dir } = {}) {
  const j = readAdjudications(dir);
  const keys = new Set();
  for (const r of j.records) {
    if (r && r.kind === 'finding-adjudication' && r.importKey) keys.add(r.importKey);
  }
  return keys;
}

export function loadAnnotations() {
  return JSON.parse(readFileSync(annotationsPath(), 'utf8'));
}

export function deriveAll(doc) {
  const scanner = deriveFromScannerAnnotations(doc);
  const cve = deriveFromCveAnnotations(doc);
  return {
    derived: [...scanner.out, ...cve.out],
    skipped: [...scanner.skipped, ...cve.skipped],
    counts: { scanner: scanner.out.length, cve: cve.out.length },
  };
}

function main() {
  const write = process.argv.slice(2).includes('--write');
  let doc;
  try {
    doc = loadAnnotations();
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('no annotations store — nothing to import (an absence, not a pass)');
      process.exit(0);
    }
    console.error(`annotations store unreadable (${annotationsPath()}): ${e.message}`);
    process.exit(1);
  }

  const { derived, skipped, counts } = deriveAll(doc);
  const existing = alreadyImportedKeys();
  const toWrite = derived.filter((r) => !existing.has(r.importKey));
  const alreadyPresent = derived.length - toWrite.length;

  console.log(`derived ${derived.length} candidate finding-adjudication record(s) (${counts.scanner} scanner, ${counts.cve} dependency-cve)`);
  console.log(`already imported: ${alreadyPresent} · new: ${toWrite.length} · unimportable: ${skipped.length}`);
  // Skip reasons are our own diagnostic strings — no source free-text reaches stdout.
  for (const s of skipped) console.log(`  skip: ${s.reason}`);

  if (!write) {
    console.log('(dry run — pass --write to append; nothing written)');
    process.exit(0);
  }

  let ok = 0;
  let fail = 0;
  for (const r of toWrite) {
    const { place, artifact, ...record } = r;
    const res = appendFindingAdjudication(record, { place, artifact });
    if (res.ok) ok++;
    else { fail++; console.error(`append FAILED (${res.error})`); }
  }
  console.log(`wrote ${ok} new finding-adjudication record(s)${fail ? `, ${fail} FAILED` : ''}`);
  process.exit(fail ? 1 : 0);
}

const isMain = isMainModule(import.meta.url);
if (isMain) main();
