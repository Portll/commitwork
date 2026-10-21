// monitor/lifecycle.mjs (C26) — the single owning assembler for lifecycle records + lifecycle.json.
// rollup.mjs calls this once; renderers read lifecycle.json, never write it. Best-effort and
// side-effect-contained; a record whose source did not run stays unknown-not-scanned.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeDwell, buildSliceTimeIndex, dwellAggregates } from './dwell.mjs';
import { computeDefence } from './defence-vector.mjs';
import { applyReachabilityAxis } from './reachability-axis.mjs'; // call-graph proof -> defenceVector.reachability
import { reachabilityFor } from '../cra/reachability-evidence.mjs'; // the only minter of call_graph evidence
import { createRegistry, isFoundational, isPublicAdvisory, weaknessClassForRule } from './cwx-registry.mjs';
import { validateLifecycleRecords } from './validate-authored-judgment.mjs';

export const SLA_TIERS = { crit: 7, high: 30, med: 90, low: 180 };

// ─────────────────────────── weakness class from advisory data (F.5.2) ───────────────────────────
// npm audit's via[] carries the advisory's own cwe[] (string entries are dependency edges, walked
// and recorded as 'advisory-transitive'). osv.sarif has no structured CWE field, and prose is
// never regexed — OSV-only findings keep []. [] means "no class determined", not "no weakness".

const CWE_RE = /^CWE-[0-9]{1,5}$/;
// Dependency scanners: their finding `id` is an advisory id or package name, never a scanner ruleId.
const DEP_TOOLS = new Set(['osv', 'npm']);
// tool -> the checks-status.json check that produces its artifact (used only for the scan timestamp).
export const SCAN_CHECK_FOR_TOOL = { osv: 'deps-osv', npm: 'npm-audit' };

/** Keep only well-formed CWE ids, deduped and sorted (stable output => byte-identical re-rollups). */
function normCwes(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const s = String(c == null ? '' : c).trim().toUpperCase();
    if (CWE_RE.test(s) && !out.includes(s)) out.push(s);
  }
  return out.sort();
}

// Index one parsed npm-audit.json into its CWE ids -> {byPackage, byAdvisory}. Pure; a doc with
// no cwe anywhere yields two empty maps, never a fabricated one.
export function npmAuditCweIndex(auditDoc) {
  const vulns = (auditDoc && typeof auditDoc === 'object' && auditDoc.vulnerabilities) || {};
  const byAdvisory = Object.create(null);
  const direct = Object.create(null);   // pkg -> cwes off its own advisory objects
  const edges = Object.create(null);    // pkg -> [pkg] npm audit's "vulnerable because of" edges

  for (const [name, v] of Object.entries(vulns)) {
    const own = [];
    for (const a of (v && Array.isArray(v.via) ? v.via : [])) {
      if (typeof a === 'string') { (edges[name] ||= []).push(a); continue; }
      if (!a || typeof a !== 'object') continue;
      const cwes = normCwes(a.cwe);
      if (!cwes.length) continue;
      for (const c of cwes) if (!own.includes(c)) own.push(c);
      // same id derivation as rollup.mjs:parseNpm, so this key matches the finding's r.id
      const id = (a.url || '').split('/').pop() || String(a.source || name);
      if (id) byAdvisory[id] = normCwes([...(byAdvisory[id] || []), ...cwes]);
    }
    if (own.length) direct[name] = own.sort();
  }

  // Transitive closure by monotone fixed point — the via graph can be mutually recursive.
  const names = Object.keys(vulns);
  const acc = Object.create(null);
  for (const n of names) acc[n] = new Set(direct[n] || []);
  for (let pass = 0, changed = true; changed && pass <= names.length; pass++) {
    changed = false;
    for (const n of names) for (const m of edges[n] || []) {
      if (!acc[m]) continue;
      for (const c of acc[m]) if (!acc[n].has(c)) { acc[n].add(c); changed = true; }
    }
  }

  const byPackage = Object.create(null);
  for (const n of names) {
    const cwes = [...acc[n]].sort();
    if (!cwes.length) continue;   // no advisory CWE => absent from the index => the record keeps []
    byPackage[n] = { cwes, source: (direct[n] && direct[n].length) ? 'advisory' : 'advisory-transitive' };
  }
  return { byPackage, byAdvisory };
}

// Merge every repo's npm-audit.json into one lookup. Advisory ids merge fleet-wide; package names
// stay repo-scoped. A missing/unparseable artifact contributes nothing.
export function readAdvisoryCweIndex(reportsDir, repoNames) {
  const byAdvisory = Object.create(null);
  const byRepoPackage = Object.create(null);
  for (const repo of Array.isArray(repoNames) ? repoNames : []) {
    const p = join(reportsDir, repo, 'npm-audit.json');
    if (!existsSync(p)) continue;
    let doc; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    const idx = npmAuditCweIndex(doc);
    for (const [id, cwes] of Object.entries(idx.byAdvisory)) byAdvisory[id] = normCwes([...(byAdvisory[id] || []), ...cwes]);
    for (const [pkg, e] of Object.entries(idx.byPackage)) byRepoPackage[`${repo}|${pkg}`] = e;
  }
  return { byAdvisory, byRepoPackage };
}

/** Advisory-backed weakness class for one finding, or null when the advisory data has none. */
function advisoryCweFor(r, advisoryCwe) {
  if (!advisoryCwe || !r) return null;
  const byAdv = advisoryCwe.byAdvisory || {};
  // most specific first: the finding IS an advisory (id = GHSA-.../CVE-...)
  if (r.id && Array.isArray(byAdv[r.id]) && byAdv[r.id].length) return { cwes: byAdv[r.id], source: 'advisory' };
  const e = (advisoryCwe.byRepoPackage || {})[`${r.repo}|${r.package}`];
  if (e && Array.isArray(e.cwes) && e.cwes.length) return { cwes: e.cwes, source: e.source };
  return null;
}

// Per-finding scan provenance (F.5.3). `ran` is artifact presence (rollup's own definition).
// Returns null when we cannot tell — unknown and false are different states, and a future scanner
// must not be silently stamped ran:false.
export function scanProvenanceFor(repo, tool, toolRuns) {
  const tr = toolRuns && toolRuns[repo];
  if (!tr || !tr.artifacts || !Object.prototype.hasOwnProperty.call(tr.artifacts, tool)) return null;
  const p = { ran: !!tr.artifacts[tool], scanner: tool };
  const wanted = SCAN_CHECK_FOR_TOOL[tool];
  const row = wanted && (Array.isArray(tr.checks) ? tr.checks : []).find((c) => c && c.check === wanted);
  if (row && typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at))) p.at = row.at;
  return p;
}

/**
 * Enrich an array of finding records (recOf shape from rollup) with lifecycle fields, in place.
 * @param {object[]} recs         records (mutated: lifecycle fields added)
 * @param {object}   ctx          { historyRows, ledgerEntries, ownerMap, ruleCweTable, advisoryCwe,
 *                                 toolRuns, cwxState, nowIso, area }
 * @returns {{records:object[], aggregates:object, cwxState:object, schemaViolations:string[]}}
 */
export function assembleLifecycle(recs, ctx = {}) {
  const { historyRows = [], ledgerEntries = [], ownerMap = {}, ruleCweTable = {},
          advisoryCwe = null, toolRuns = null, cwxState = null, nowIso, area = null,
          reachIndex = null, aliasIndex = null } = ctx;
  const now = nowIso || null;
  // Counted, not assumed. A seam that joins nothing looks exactly like one that works, and this
  // join was measured at 0.31% before the alias index existed — so the rate rides out in the
  // return value where a caller (and a test) can see it.
  const reachJoin = { set: 0, refused: 0, skipped: 0 };
  const sliceIdx = buildSliceTimeIndex(historyRows);
  const ledgerByKey = new Map();
  for (const e of ledgerEntries || []) if (e?.key) ledgerByKey.set(e.key, e);
  const reg = createRegistry(cwxState);
  // The owner map joins on the bare repo name; a scoped map for a different area does not apply —
  // applying it wrongly publishes an ownership claim nobody made.
  const mapArea = ownerMap.$scope?.area || null;
  const scopeMismatch = !!(mapArea && area && mapArea !== area);
  const repos = scopeMismatch ? {} : (ownerMap.repos || {});
  const defaultVisibleTo = ownerMap.$defaults?.visibleTo || 'internal';

  for (const r of recs || []) {
    // Weakness class, most→least specific: cweIds on the finding, advisory cwe[], transitive
    // advisory, ruleId->CWE table, [] = no class determined (never "no weakness").
    if (!(Array.isArray(r.cweIds) && r.cweIds.length)) {
      const adv = advisoryCweFor(r, advisoryCwe);
      // .slice(): index entries are shared; never hand out the live array.
      if (adv) { r.cweIds = adv.cwes.slice(); r.weaknessClassSource = adv.source; }
    } else if (!r.weaknessClassSource) r.weaknessClassSource = 'advisory';

    let weaknessClass = Array.isArray(r.cweIds) && r.cweIds.length ? r.cweIds : [];
    if (!weaknessClass.length) {
      // Fuzzy heuristics read a scanner rule id — switched off for dep tools so a package NAMED
      // `xss` is never handed a CWE; exact table hits stay allowed.
      weaknessClass = weaknessClassForRule(r.id || r.tool, ruleCweTable, { allowHeuristic: !DEP_TOOLS.has(r.tool) }).slice();
      if (weaknessClass.length) r.weaknessClassSource = 'rule-map';
    }
    if (!weaknessClass.length) r.weaknessClassSource = null;   // explicit: nothing determined it
    r.weaknessClass = weaknessClass.slice();

    // --- identity: public advisory id if the finding has one, else a minted CWX ---
    const publicId = (r.id && isPublicAdvisory(r.id)) ? r.id : null;
    let primaryId = publicId, cwxRef = null;
    if (!primaryId) {
      // self-found (no public advisory match): mint/lookup a stable CWX on the finding key.
      // Minted with the class resolved ABOVE, so the registry entry and the record agree.
      primaryId = reg.mint(r.key || `${r.repo}|${r.tool}|${r.id}|${r.package}|${r.path || ''}`, now, weaknessClass);
      cwxRef = primaryId;
    }
    r.primaryId = primaryId;
    r.cwxRef = cwxRef;
    r.bugIsFoundational = isFoundational(primaryId);          // DERIVED, not stored-editable

    // --- taxonomy from the owner/technology map ---
    const meta = repos[r.repo] || {};
    r.bugBelongsTo = meta.team || null;
    r.repoTechnology = meta.technology || humanize(r.repo);   // headline shown under the repo name
    // $defaults.visibleTo, never a second hardcoded 'internal'.
    r.bugVisibleTo = r.bugVisibleTo || meta.visibleTo || defaultVisibleTo;

    // --- time anchors (seed from ledger where present; leave introduced null unless explicit) ---
    const led = ledgerByKey.get(r.key);
    if (led) {
      r.resolvedSlice = r.resolvedSlice || led.resolvedSlice || null;
      r.fromVersion = led.fromVersion; r.toVersion = led.toVersion; r.fixCommit = led.fixCommit;
      r.at = led.at;
      if (led.resolvedSlice && !r.bugSquashedOn) r.bugSquashedOn = null; // C04 derives (detection-bounded) below
      r.evidence = led.evidence;
    }
    // bugInitialReport: immutable, min(explicit, discovery). Discovery = bornSlice's generated ISO.
    // (OSV.published binding is C-item follow-up; here we floor at discovery, never hand-lowered.)

    // --- dwell (pure) ---
    r.dwell = computeDwell(r, sliceIdx, now);

    // --- reachability axis, from the call-graph proof that already ran ---
    // BEFORE computeDefence, because the verdict is recomputed from the vector and a reading that
    // arrives afterwards changes nothing. Absent indexes leave the axis untouched: no reading is
    // `undetermined`, which is the honest state, not a defect to paper over.
    if (reachIndex) {
      reachJoin[applyReachabilityAxis(r, reachabilityFor(reachIndex, r.repo, r.id, r.package, aliasIndex))]++;
    }

    // --- defence vector + verdict (pure, recomputed) ---
    const def = computeDefence(r);
    r.defenceVector = def.defenceVector;
    r.residualVerdict = def.residualVerdict;
    r._defenceViolations = def.violations;   // surfaced to the self-scanner, not rendered

    // --- SLA / escalation (detect only) ---
    // An unscored finding takes the MEDIAN tier, not the laxest (and not the strictest — that
    // buries real criticals). slaTierBasis records why the tier was chosen.
    // `escalated` is a literal here because this runs inside rollup.mjs, UPSTREAM of the issue
    // store (sweep.mjs ingests rollup.json into issues.json after this returns), and the store
    // imports SLA_TIERS from this file, so reading it back would be a circular import over a
    // document that does not yet reflect this slice. The ACTUATOR is monitor/issue-escalate.mjs;
    // the authoritative projection is the issue record's `escalated`/`escalatedAt`, derived from
    // its chain-covered `paged` event. Nothing reads this field as truth; renderers that want
    // "was a human paged" must ask the issue store.
    const scored = SLA_TIERS[r.severity];
    const tier = scored ?? SLA_TIERS.med;
    const k = r.dwell?.knowableExposureDays;
    const breached = typeof k === 'number' && k > tier && r.state !== 'resolved-fixed';
    r.escalation = Object.assign({
      slaTier: tier,
      slaTierBasis: scored != null ? 'severity' : `unscored (${r.severity ?? 'absent'}) — median tier, not lenient`,
      slaBreached: breached,
      escalated: false,   // not known here — see above; monitor/issue-escalate.mjs owns the action
    }, r.escalation || {});

    // --- scan provenance (F.5.3): an explicit record-level value wins; we only fill the gap ---
    if (!r.scanProvenance) {
      const prov = scanProvenanceFor(r.repo, r.tool, toolRuns);
      if (prov) r.scanProvenance = prov;   // null => left ABSENT, and the validator reports it
    }

    // --- provenance-honest lifecycleStatus floor ---
    if (r.scanProvenance && r.scanProvenance.ran === false) r.lifecycleStatus = 'unknown-not-scanned';
    else r.lifecycleStatus = r.lifecycleStatus || r.state; // born/persisting carried from rollup
  }

  // --- schema enforcement (F.5.3): every sweep checks the contract it publishes; violations ride
  // out so the caller can surface them ---
  let schemaViolations = [];
  try { schemaViolations = validateLifecycleRecords(recs || []); }
  catch (e) { schemaViolations = [`lifecycle schema validation unavailable: ${e && e.message}`]; }

  return { records: recs, aggregates: dwellAggregates(recs), cwxState: reg.state, schemaViolations, reachJoin };
}

function humanize(repo) {
  if (!repo) return '';
  return String(repo).replace(/^(sqx|gs)-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
