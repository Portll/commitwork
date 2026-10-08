#!/usr/bin/env node
// cra/vex.mjs — VEX export from the monitor's provenance-gated lifecycle, in all three formats.
//
// One neutral statement set (collectStatements) is projected into CycloneDX VEX, CSAF 2.0 and
// OpenVEX. The projections are the ONLY place a format vocabulary appears; the lifecycle mapping
// is decided once, here, so the three documents can never contradict each other about a CVE:
//
//   lifecycle                                       state          cdx / csaf / openvex
//   open finding (born|persisting)                → exploitable  · exploitable / known_affected / affected
//   unknown-not-scanned / carried                 → in_triage    · in_triage / under_investigation / under_investigation
//   ledger resolved-fixed, evidence strong|medium → resolved     · resolved / fixed / fixed
//   annotation false-positive (as-of now)         → false_positive · false_positive / known_not_affected / not_affected
//   annotation accept | wont-fix (as-of now)      → accepted     · exploitable+will_not_fix / known_affected+no_fix_planned / affected
//
// `accepted` is AFFECTED, never not_affected: a recorded decision not to remediate is not a
// statement that the product is unaffected, and rendering it as one is an unsupported pass in a document
// a downstream consumer trusts. It outranks in_triage and false_positive in the worst-state-wins
// merge for the same reason (a wont-fix used to be maskable by a false-positive statement).
//
// No justification is ever synthesised: not_affected carries the operator's RECORDED reason as an
// impact statement, because the five spec justifications are claims about code we have not checked.
//
// Outputs, one per product per format:
//   reports/cra/vex/<productId>.vex.cdx.json · .vex.csaf.json · .openvex.json
// Deterministic: same inputs ⇒ byte-identical output (timestamp from CW_CRA_NOW when set).
//
//   node cra/vex.mjs [--product <id>] [--format cdx|csaf|openvex|all]
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import {
  loadJSON, writeJSONAtomic, resolvePaths, loadProducts, openFindings,
  nowISO, contentUUID, stableStringify, craRoot,
} from './lib.mjs';
import { buildCsaf, buildCsaf21, buildOpenVex } from './vex-formats.mjs';
import { assertCsafValid } from './csaf-validate.mjs';
import { project, fidelitySummary, FORMATS as PROJECTION_FORMATS } from './determination-projection.mjs';
import { determinationFromAnnotation } from './determination.mjs';
import { getSetting } from '../monitor/settings.mjs'; // reportFormats — which projections get written

// worst-state-wins ordering for the same CVE seen twice. Higher = more affected.
export const STATE_RANK = { exploitable: 5, accepted: 4, in_triage: 3, false_positive: 2, resolved: 1 };

// csaf21 is a SIBLING of csaf, never a replacement: 2.1 is a Committee Specification DRAFT (CSD02,
// 25 February 2026) and 2.0 remains the OASIS Standard and the interoperable target. The two are
// mutually invalid — 2.1 renames scores→metrics, cwe→cwes, release_date→disclosure_date — so a
// consumer must be handed the version it asked for, and both are emitted.
export const FORMATS = Object.freeze(['cdx', 'csaf', 'csaf21', 'openvex']);
export const EXT = Object.freeze({
  cdx: 'vex.cdx.json', csaf: 'vex.csaf.json', csaf21: 'vex.csaf-2.1.json', openvex: 'openvex.json',
});

function annotationState(ann) {
  if (ann.action === 'false-positive') return 'false_positive';
  if (ann.action === 'accept' || ann.action === 'wont-fix') return 'accepted';
  return null;
}

function matches(ann, f) {
  // annotations.json semantics: match fields are AND-ed; omitted = wildcard
  if (ann.id && ann.id !== f.id) return false;
  if (ann.package && ann.package !== f.package) return false;
  if (ann.repo && ann.repo !== f.repo) return false;
  return true;
}

function activeAnnotations(annDoc, atIso) {
  const at = new Date(atIso).getTime();
  return (annDoc.annotations || []).filter((a) => {
    if (a.at && new Date(a.at).getTime() > at) return false;
    if (a.expires && new Date(a.expires).getTime() <= at) return false;
    return true;
  });
}

// ── the neutral statement set — decided once, projected per format ──────────────────────────────
// A statement is format-free: a vuln id, a lifecycle state, the components it affects, and the
// provenance of the claim. Every projection below reads THIS and nothing else.
export function collectStatements(product, rollup, ledgerEntries, annDoc, atIso) {
  const repoSet = new Set(product.repos || []);
  const vulns = new Map(); // vulnId -> statement

  const put = (st) => {
    const prev = vulns.get(st.vulnId);
    if (!prev || STATE_RANK[st.state] > STATE_RANK[prev.state]) { vulns.set(st.vulnId, st); return; }
    if (STATE_RANK[st.state] === STATE_RANK[prev.state]) {
      for (const a of st.affects) if (!prev.affects.some((x) => x.ref === a.ref)) prev.affects.push(a);
    }
  };

  const anns = activeAnnotations(annDoc, atIso);

  // 1) open findings → exploitable / in_triage (unless annotated)
  for (const f of openFindings(rollup)) {
    if (!repoSet.has(f.repo) || !f.id) continue;
    const ann = anns.find((a) => matches(a, f) && annotationState(a));
    const state = ann ? annotationState(ann)
      : (f.state === 'unknown-not-scanned' || f.carried ? 'in_triage' : 'exploitable');
    put({
      vulnId: f.id.toUpperCase(),
      state,
      origin: 'finding',
      decision: ann ? ann.action : null,
      reason: ann ? (ann.reason || null) : null,
      advisory: f.advisory || null,
      cvss: typeof f.cvss === 'number' ? f.cvss : null,
      severity: f.severity || null,
      affects: [{ ref: `${f.repo}${f.package ? `/${f.package}${f.version ? `@${f.version}` : ''}` : ''}`, repo: f.repo, package: f.package || null, version: f.version || null }],
      detail: ann
        ? `annotation ${ann.action} by ${ann.who || 'unknown'} at ${ann.at || 'unknown'}: ${ann.reason || ''}`.trim()
        : `open in slice ${rollup.sliceId || rollup.generated} (state: ${f.state || 'persisting'}; KEV=${f.kev === true}; EPSS=${typeof f.epss === 'number' ? f.epss : 'unknown'})`,
      firstIssued: atIso,
      lastUpdated: atIso,
    });
  }

  // 2) verified fixes from the ledger → resolved (strong|medium evidence only)
  for (const e of ledgerEntries) {
    if (!repoSet.has(e.repo) || !e.vulnId) continue;
    if (!['strong', 'medium'].includes(e.evidence?.tier)) continue; // weak/unconfirmed NEVER claims resolved
    put({
      vulnId: e.vulnId.toUpperCase(),
      state: 'resolved',
      origin: 'ledger',
      decision: null,
      reason: null,
      advisory: null,
      cvss: null,
      severity: null,
      affects: [{ ref: `${e.repo}${e.package ? `/${e.package}${e.toVersion ? `@${e.toVersion}` : ''}` : ''}`, repo: e.repo, package: e.package || null, version: e.toVersion || null }],
      detail: `verified remediation (${e.evidence.tier}): ${e.package} ${e.fromVersion || '?'} → ${e.toVersion || '?'} — ${e.evidence.detail}` +
        (e.fixCommit ? ` (commit ${e.fixCommit})` : '') + ` [ledger ${e.bornSlice} → ${e.resolvedSlice}]`,
      firstIssued: e.at || atIso,
      lastUpdated: e.at || atIso,
    });
  }

  return [...vulns.values()].sort((a, b) => a.vulnId.localeCompare(b.vulnId));
}

// CycloneDX 1.5 has no plain "affected" state — `exploitable` IS affected, and the decision not to
// act rides in analysis.response.
export const CDX_STATE = { exploitable: 'exploitable', accepted: 'exploitable', in_triage: 'in_triage', false_positive: 'false_positive', resolved: 'resolved' };

export function buildVex(product, manufacturer, rollup, ledgerEntries, annDoc, atIso, fidelity = null) {
  const statements = collectStatements(product, rollup, ledgerEntries, annDoc, atIso);

  const vulnerabilities = statements.map((s) => ({
    id: s.vulnId,
    source: s.advisory ? { url: s.advisory } : undefined,
    ratings: s.cvss ? [{ score: s.cvss, severity: s.severity || 'unknown', method: 'CVSSv3' }] : undefined,
    affects: s.affects.map((a) => ({ ref: a.ref })),
    analysis: {
      state: CDX_STATE[s.state],
      response: s.state === 'accepted' ? ['will_not_fix'] : undefined,
      detail: s.detail,
      firstIssued: s.firstIssued,
      lastUpdated: s.lastUpdated,
    },
  }));

  const doc = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: atIso,
      component: { type: 'application', name: product.name, version: product.version, 'bom-ref': `product:${product.id}` },
      manufacture: manufacturer?.name ? { name: manufacturer.name, contact: [{ email: manufacturer.contact }] } : undefined,
      properties: [
        { name: 'commitwork:source-slice', value: String(rollup.sliceId || rollup.generated || 'unknown') },
        // PHASE 5 — generate-and-declare. What this document could NOT say travels with it, because
        // a lossy translation that stays silent is indistinguishable from a lossless one, and the
        // reader has no way to tell which they are holding.
        ...(fidelity ? [{ name: 'commitwork:fidelity', value: JSON.stringify(fidelity) }] : []),
        { name: 'commitwork:lifecycle-mapping', value: 'born/persisting→exploitable; unknown-not-scanned→in_triage; ledger strong|medium→resolved; annotation fp→false_positive; accept/wont-fix→exploitable+will_not_fix (AFFECTED, never not_affected)' },
      ],
    },
    vulnerabilities,
  };
  doc.serialNumber = contentUUID(stableStringify({ p: product.id, v: vulnerabilities }));
  return doc;
}

/** Every format for one product, keyed by format id. */
// ── PHASE 5 — the fidelity ledger ───────────────────────────────────────────────────────────────
// A lifecycle state is not a determination. An open finding with no human judgment establishes only
// that the component is present; it says NOTHING about reachability or exploitability, and inventing
// either here would be the confabulation the whole evidence gate exists to stop. So the mapping
// below is deliberately thin, and the axes it leaves out stay unknown.
//
// `false_positive` yields NO determination: it disputes the FINDING, not the product's exposure.
export function determinationForStatement(s, reach = null) {
  const base = { presence: 'component_present_code_present' };
  if (s.state === 'false_positive') return null;
  if (s.state === 'resolved') return { ...base, remediation: 'fixed_verified' };
  if (s.state === 'accepted') return { ...base, remediation: 'will_not_fix_by_choice' };
  if (s.state === 'in_triage') return { ...base, remediation: 'under_investigation' };
  // exploitable: present, and whatever a call-graph analyser was able to prove about it.
  return reach && reach.reachability ? { ...base, reachability: reach.reachability } : base;
}

/**
 * Per-format fidelity for a statement set. `opts.reachabilityFor(statement)` may supply a joined
 * reachability determination; without it the axis is simply absent, which is honest.
 */
export function fidelityFor(statements, opts = {}) {
  const projections = [];
  for (const s of statements) {
    const reach = opts.reachabilityFor ? opts.reachabilityFor(s) : null;
    const d = determinationForStatement(s, reach);
    if (!d) continue;
    projections.push({ vulnId: s.vulnId, projection: project(d, { ledgerTier: s.ledgerTier, kev: s.kev, epss: s.epss }) });
  }
  const out = {};
  for (const f of PROJECTION_FORMATS) {
    const sum = fidelitySummary(projections, f);
    out[f] = {
      ...sum,
      statements: projections.length,
      // Stated rather than inferred from a zero — a document that lost nothing SAYS so.
      lossless: sum.prose_only === 0 && sum.unrepresentable === 0,
      note: 'Generated and declared: this document reports what its format could not express rather '
        + 'than omitting it silently. `lost` names each statement and the reason.',
    };
  }
  return out;
}

export function buildAll(product, manufacturer, rollup, ledgerEntries, annDoc, atIso, opts = {}) {
  const statements = collectStatements(product, rollup, ledgerEntries, annDoc, atIso);
  // PHASE 5 — each document declares what its own format could not express. The ledger is computed
  // PER FORMAT because the loss differs: CycloneDX keeps a configuration-scoped unreachability that
  // OpenVEX must drop to prose, and CSAF alone can carry the exploit_status enrichment.
  const fidelity = fidelityFor(statements, opts);
  return {
    cdx: buildVex(product, manufacturer, rollup, ledgerEntries, annDoc, atIso, fidelity.cyclonedx),
    // KEV enrichment goes to BOTH formats: threats/remediations/references are the same
    // constructs in 2.0 and 2.1, so the newer document must not quietly know more than the older.
    csaf: buildCsaf(product, manufacturer, statements, rollup, atIso, fidelity.csaf,
      opts.kev ? { kev: opts.kev, cweCatalogue: opts.cweCatalogue } : null),
    // Same fidelity ledger as csaf: 2.1's RENAMES do not change what the profile can express, so
    // claiming a different loss profile for those would be a fabricated difference. 2.1 does gain
    // one thing this fleet can actually feed — metrics.content.epss — and `opts.epssDetail` carries
    // it. first_known_exploitation_dates stays unfed on purpose; see the reasoning in vex-formats.
    csaf21: buildCsaf21(product, manufacturer, statements, rollup, atIso, fidelity.csaf,
      (opts.epssDetail || opts.kev)
        ? { epss: opts.epssDetail, kev: opts.kev, cweCatalogue: opts.cweCatalogue } : null),
    openvex: buildOpenVex(product, manufacturer, statements, atIso, fidelity.openvex),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--product') ? argv[argv.indexOf('--product') + 1] : null;
  const fmtArg = argv.includes('--format') ? argv[argv.indexOf('--format') + 1] : 'all';
  // `all` means the operator's DECLARED set, not every format this file can emit. The declaration
  // lives in monitor/settings.mjs (reportFormats) so the panel and this CLI cannot disagree about
  // what gets published; an explicit --format still overrides it, because a person naming a format
  // has said something more specific than a default. Unset ⇒ every format except csaf21, which is
  // a Committee Specification DRAFT an operator opts into rather than receives.
  const declared = (() => {
    // Fail OPEN to the default set, never closed to nothing: an unreadable settings store must not
    // silently publish zero documents, which would look exactly like an export that found nothing.
    try { return getSetting('reportFormats').value; } catch { return null; }
  })();
  const DEFAULT_FORMATS = FORMATS.filter((f) => f !== 'csaf21');
  const formats = fmtArg === 'all'
    ? (Array.isArray(declared) && declared.length ? declared.filter((f) => FORMATS.includes(f)) : DEFAULT_FORMATS)
    : [fmtArg];
  const bad = formats.filter((f) => !FORMATS.includes(f));
  if (bad.length) {
    console.error(`unknown --format ${bad.join(', ')} — expected one of ${FORMATS.join('|')} or all`);
    process.exit(2);
  }
  const paths = resolvePaths();
  // The vendored schemas, loaded once. cdx and openvex have no vendored schema here, so they are
  // NOT validated and are absent from this map rather than mapped to a permissive stand-in.
  const CSAF_SCHEMA = {
    csaf: loadJSON(join(craRoot(), 'schema', 'upstream', 'csaf_json_schema.json'), null),
    csaf21: loadJSON(join(craRoot(), 'schema', 'upstream', 'csaf-2.1-csd02.schema.json'), null),
  };
  const at = nowISO();
  const { products, manufacturer } = loadProducts(paths.products);
  const rollup = loadJSON(paths.rollup);
  const ledger = loadJSON(paths.ledger, { entries: [] });
  const annDoc = loadJSON(paths.annotations, { annotations: [] });
  // Absent is legitimately absent: the sidecar backfills as monitor/rollup.mjs fetches, so an empty
  // store means "no triple recorded yet", and every 2.1 document simply omits the metric. It never
  // becomes a zero probability, which would read as "measured, and negligible".
  const epssDetail = loadJSON(paths.epssDetail, {});
  // KEV ships as {vulnerabilities:[{cveID,...}]}; index it by CVE once rather than scanning 1,676
  // records per statement. An unreadable catalogue yields an empty index, so every document simply
  // carries no KEV arm — never a confident "not exploited", which is the tri-state rollup.mjs
  // already refuses one layer down.
  // Absent catalogue means every weakness id is withheld WITH ITS REASON, never silently dropped —
  // cwesFromIds returns the drop list and the emitter writes it into a note.
  const cweCatalogue = loadJSON(paths.cweCatalogue, null);
  const kevDoc = loadJSON(paths.kev, null);
  const kev = Object.create(null);
  for (const r of (kevDoc?.vulnerabilities || [])) if (/^CVE-\d{4}-\d{4,}$/.test(r?.cveID || '')) kev[r.cveID] = r;
  for (const product of products) {
    if (only && product.id !== only) continue;
    const docs = buildAll(product, manufacturer, rollup, ledger.entries || [], annDoc, at, { epssDetail, kev, cweCatalogue });
    const n = docs.cdx.vulnerabilities.length;
    for (const f of formats) {
      const out = join(paths.out, 'vex', `${product.id}.${EXT[f]}`);
      // THE ENFORCER, IN THE WRITE PATH RATHER THAN IN A TEST. A CSAF document that breaks its own
      // schema must not reach disk, because on disk it becomes evidence somebody cites. Throwing
      // here fails the whole run loudly; writing a quietly invalid document would not.
      // `unchecked` is reported and never fatal — it is this validator admitting its own limits
      // (remote CVSS/SSVC refs, oneOf), not a defect in the document, and a reader who ignores it
      // has been told.
      const sch = CSAF_SCHEMA[f];
      if (sch) {
        const { checked, unchecked } = assertCsafValid(docs[f], sch, `${product.id} ${f}`);
        if (unchecked.length) {
          console.log(`    (${f}: ${checked} values validated; ${unchecked.length} construct(s) this validator cannot read)`);
        }
      }
      writeJSONAtomic(out, docs[f]);
      console.log(`  ✓ ${product.id}: ${n} statement(s) → ${out}`);
    }
  }
}
