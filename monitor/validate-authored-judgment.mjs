#!/usr/bin/env node
// validate-authored-judgment.mjs — hand-rolled structural validator (no AJV) for
// schema/authored-judgment.schema.json, plus the lifecycle-record validator below. Load-bearing
// rule: the action and disposition vocabularies must not cross-contaminate.
//
// usage: node monitor/validate-authored-judgment.mjs   (3 private records + every reports/*/lifecycle.json)
// exit 0 = clean, 1 = violations (printed). Importable: `import { validateAll } from ...`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { annotationsPathFor, gateExemptionsPathFor, imageAcceptancePathFor } from './store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// These two enums are the canon; the schema documents the same sets. Keep in sync with
// schema/authored-judgment.schema.json definitions.action / .disposition.
export const ACTION_ENUM = ['accept', 'false-positive', 'wont-fix', 'note', 'resolved', 'exempt'];
export const DISPOSITION_ENUM = ['remediate', 'urg-remediate', 'ignore', 'accept', 'backlog'];
// `accept` is intentionally in BOTH — the anti-contamination rule is field-scoped, not value-scoped
const DISPOSITION_ONLY = DISPOSITION_ENUM.filter((d) => !ACTION_ENUM.includes(d));
const ACTION_ONLY = ACTION_ENUM.filter((a) => !DISPOSITION_ENUM.includes(a));

const isISO = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

// Per-file: array key + required match fields. `reasonField` names the surface's rationale key
// (image-acceptance uses `reachability`, not `reason`).
// The three records are private (monitor/store-paths.mjs); `pathFor` resolves each at call time.
const SURFACES = [
  { file: 'annotations.json', pathFor: annotationsPathFor, arr: 'annotations', match: [], actionRequired: true, reasonField: 'reason' },
  // `area` is REQUIRED in the match tuple — without it an exemption for one area's service
  // silently exempted identically named services in every other area
  { file: 'gate-exemptions.json', pathFor: gateExemptionsPathFor, arr: 'exemptions', match: ['gate', 'service', 'area'], actionRequired: true, reasonField: 'reason' },
  { file: 'image-acceptance.json', pathFor: imageAcceptancePathFor, arr: 'accepted', match: ['image', 'cve'], actionRequired: false, reasonField: 'reachability' },
];

function validateRecord(rec, surface, i, bad) {
  const at = `${surface.file}[${i}]`;
  // 1. provenance — rationale lives in the surface's reasonField (reason | reachability)
  const rationale = rec[surface.reasonField];
  if (!rationale || !String(rationale).trim()) bad(`${at}: missing ${surface.reasonField} (rationale)`);
  if (!rec.who || !String(rec.who).trim()) bad(`${at}: missing who`);
  if (!isISO(rec.at)) bad(`${at}: missing/invalid ISO 'at' (${rec.at})`);
  if (rec.expires !== undefined && !isISO(rec.expires)) bad(`${at}: invalid ISO 'expires' (${rec.expires})`);
  // 2 + 3. vocabulary anti-contamination (the load-bearing rule)
  if (rec.action !== undefined) {
    if (!ACTION_ENUM.includes(rec.action)) bad(`${at}: action '${rec.action}' not in ACTION enum`);
    if (DISPOSITION_ONLY.includes(rec.action)) bad(`${at}: disposition value '${rec.action}' planted in ACTION field (as-of replay corruption)`);
  } else if (surface.actionRequired) {
    bad(`${at}: missing required 'action'`);
  }
  if (rec.disposition !== undefined) {
    if (!DISPOSITION_ENUM.includes(rec.disposition)) bad(`${at}: disposition '${rec.disposition}' not in DISPOSITION enum`);
    if (ACTION_ONLY.includes(rec.disposition)) bad(`${at}: action value '${rec.disposition}' planted in DISPOSITION field`);
  }
  // 4. per-surface required match fields
  for (const k of surface.match) if (rec[k] === undefined || rec[k] === '') bad(`${at}: missing match field '${k}'`);
}

// `absent` collects the records that do not exist (ENOENT): nothing authored, so nothing to lint.
// That is reported by the caller, never counted as a pass or as a violation. Any other read error
// is a violation.
export function validateAll(root = CW, { absent = [] } = {}) {
  const violations = [];
  const bad = (m) => violations.push(m);
  for (const surface of SURFACES) {
    let doc;
    const path = surface.pathFor(root);
    try { doc = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) {
      if (e && e.code === 'ENOENT') { absent.push(path); continue; }
      bad(`${surface.file}: unreadable (${e.message})`); continue;
    }
    const arr = doc[surface.arr];
    if (!Array.isArray(arr)) { bad(`${surface.file}: '${surface.arr}' is not an array`); continue; }
    arr.forEach((rec, i) => validateRecord(rec, surface, i, bad));
  }
  return violations;
}

// ═════════════════ lifecycle-record contract (schema/lifecycle-record.schema.json) ═════════════════
// Checks are DRIVEN FROM THE SCHEMA FILE (required list, enums, patterns read from the JSON, not
// re-typed). Deliberately partial: presence/vocabulary/pattern + one cross-field invariant — not a
// general JSON-Schema engine.

let _schemaCache = null;
export function lifecycleSchema(baseDir = HERE) {
  if (!_schemaCache) _schemaCache = JSON.parse(readFileSync(join(baseDir, 'schema', 'lifecycle-record.schema.json'), 'utf8'));
  return _schemaCache;
}

const enumOf = (schema, prop) => (schema.properties[prop] && schema.properties[prop].enum) || null;
// ReDoS provenance: `schema` is always the bundled monitor/schema/lifecycle-record.schema.json
// (memoized, resolved against HERE) — `records` is only ever the VALUE tested against these
// patterns, never their source. Accepted as provenance-trusted, not a code fix.
const itemPattern = (schema, prop) => {
  const p = schema.properties[prop];
  return p && p.items && p.items.pattern ? new RegExp(p.items.pattern) : null; // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern is from the bundled lifecycle-record schema only; see comment above
};

/**
 * @param {object[]} records  assembled lifecycle records
 * @param {object}   opts     { source } — label used in violation messages
 * @returns {string[]} violations (empty = conforms)
 */
export function validateLifecycleRecords(records, opts = {}) {
  const schema = lifecycleSchema(opts.baseDir || HERE);
  const src = opts.source || 'lifecycle';
  const violations = [];
  const bad = (m) => violations.push(m);
  if (!Array.isArray(records)) { bad(`${src}: records is not an array`); return violations; }

  const required = schema.required || [];
  const sevEnum = enumOf(schema, 'severity');
  const verdictEnum = enumOf(schema, 'residualVerdict');
  const visibleEnum = enumOf(schema, 'bugVisibleTo');
  const sourceEnum = enumOf(schema, 'weaknessClassSource');
  const cwePat = itemPattern(schema, 'weaknessClass');
  // Same provenance as itemPattern() above — the pattern comes from the bundled schema only
  const cwxPat = schema.properties.cwxRef && schema.properties.cwxRef.pattern ? new RegExp(schema.properties.cwxRef.pattern) : null; // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern is from the bundled lifecycle-record schema only; see comment above

  records.forEach((rec, i) => {
    const at = `${src}[${i}]${rec && rec.key ? ` ${rec.key}` : ''}`;
    if (!rec || typeof rec !== 'object') { bad(`${at}: not an object`); return; }
    // 1. required presence. Absent is absent — an empty string is not a value either.
    for (const k of required) {
      const v = rec[k];
      if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) bad(`${at}: missing required '${k}'`);
    }
    // 2. vocabulary
    if (rec.severity !== undefined && sevEnum && !sevEnum.includes(rec.severity)) bad(`${at}: severity '${rec.severity}' not in enum`);
    if (rec.residualVerdict !== undefined && verdictEnum && !verdictEnum.includes(rec.residualVerdict)) bad(`${at}: residualVerdict '${rec.residualVerdict}' not in enum`);
    if (rec.bugVisibleTo !== undefined && visibleEnum && !visibleEnum.includes(rec.bugVisibleTo)) bad(`${at}: bugVisibleTo '${rec.bugVisibleTo}' not in enum`);
    if (rec.weaknessClassSource !== undefined && sourceEnum && !sourceEnum.includes(rec.weaknessClassSource)) bad(`${at}: weaknessClassSource '${rec.weaknessClassSource}' not in enum`);
    // 3. shapes — a malformed CWE id is a fabricated class, not a typo
    for (const field of ['weaknessClass', 'cweIds']) {
      if (rec[field] === undefined) continue;
      if (!Array.isArray(rec[field])) { bad(`${at}: ${field} is not an array`); continue; }
      if (cwePat) for (const c of rec[field]) if (!cwePat.test(String(c))) bad(`${at}: ${field} entry '${c}' is not a CWE id`);
    }
    // weaknessClass must not out-claim its stated provenance
    if (Array.isArray(rec.weaknessClass) && rec.weaknessClass.length && rec.weaknessClassSource === null) {
      bad(`${at}: weaknessClass is populated but weaknessClassSource is null (a class with no stated provenance)`);
    }
    if (rec.cwxRef !== undefined && rec.cwxRef !== null && cwxPat && !cwxPat.test(String(rec.cwxRef))) bad(`${at}: cwxRef '${rec.cwxRef}' malformed`);
    // 4. scanProvenance shape + THE never-imply-clean invariant (x-required-invariants)
    if (rec.scanProvenance !== undefined && rec.scanProvenance !== null) {
      const sp = rec.scanProvenance;
      if (typeof sp !== 'object') bad(`${at}: scanProvenance is not an object`);
      else {
        if (typeof sp.ran !== 'boolean') bad(`${at}: scanProvenance.ran missing/not boolean`);
        if (sp.at !== undefined && Number.isNaN(Date.parse(sp.at))) bad(`${at}: scanProvenance.at '${sp.at}' is not ISO`);
        if (sp.ran === false && rec.lifecycleStatus !== 'unknown-not-scanned') {
          bad(`${at}: scanProvenance.ran=false but lifecycleStatus='${rec.lifecycleStatus}' (must be unknown-not-scanned — never imply clean)`);
        }
      }
    }
  });
  return violations;
}

/** Validate every reports/<project>/lifecycle.json that exists. Missing artifacts are not failures. */
export function validateLifecycleFiles(reportsRoot = join(HERE, '..', 'reports')) {
  const violations = [];
  if (!existsSync(reportsRoot)) return violations;
  let dirs = [];
  try { dirs = readdirSync(reportsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return violations; }
  for (const d of dirs) {
    const p = join(reportsRoot, d, 'lifecycle.json');
    if (!existsSync(p)) continue;
    let doc;
    try { doc = JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { violations.push(`${d}/lifecycle.json: unreadable (${e.message})`); continue; }
    violations.push(...validateLifecycleRecords(doc.records || [], { source: `${d}/lifecycle.json` }));
  }
  return violations;
}

// CLI
if (isMainModule(import.meta.url)) {
  const absent = [];
  const v = validateAll(CW, { absent });
  const lv = validateLifecycleFiles();
  for (const m of v) console.error(`FAIL ${m}`);
  for (const m of lv) console.error(`FAIL ${m}`);
  for (const p of absent) console.log(`authored-judgment: SKIPPED ${p} — absent (ENOENT), no judgments recorded there to check`);
  if (!v.length && absent.length === SURFACES.length) console.log('authored-judgment: no record present, so nothing was checked');
  else if (!v.length) console.log(`authored-judgment: ${SURFACES.length - absent.length} of ${SURFACES.length} records present, and each conforms (action/disposition uncontaminated)`);
  if (!lv.length) console.log('lifecycle-record: every reports/*/lifecycle.json conforms to schema/lifecycle-record.schema.json');
  const n = v.length + lv.length;
  if (n) { console.error(`\n${n} violation(s)`); process.exit(1); }
}
