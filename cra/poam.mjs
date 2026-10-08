#!/usr/bin/env node
// cra/poam.mjs — Plan of Action & Milestones (FedRAMP ConMon), code-side scope.
//
// FedRAMP regulates ASSETS in an authorization boundary and mandates the official POA&M
// template; this exporter produces the CODE-SIDE evidence that feeds a ConMon POA&M — every
// scanner finding the monitor tracks (operator ruling D23, 2026-09-30): dependency advisories from
// the rollup, one row per advisory, and every other lane's findings from the issue store, one row
// per issue. Each row is mapped to NIST 800-53 controls,
// with the SLA clock that actually matters: remediation is due from the DISCOVERY DATE
// (Critical/High 30 days, Moderate 90, Low 180), not from when a row was entered. That
// discovery-date-anchored clock, and the raw-scan → row traceability (each row cites the slice
// + tool that found it), are exactly the two things ConMon audits most often fail on.
//
// Emits reports/cra/poam/<product>.json + <product>-open.csv + <product>-closed.csv. The
// companion poam-to-xlsx.py renders the official-style workbook from the JSON. Deliberately
// NOT the government xlsx itself (proprietary formats can't be submitted) — this is the
// working artifact teams reconcile into their official template, structured to match it.
//
//   node cra/poam.mjs [--product <id>]
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import {
  loadJSON, writeJSONAtomic, writeTextAtomic, resolvePaths, loadProducts, openFindings,
  nowISO, addDays, isOverdue, sweepStampToISO, sha256, kevSet, epssFor,
} from './lib.mjs';
import { loadControls, controlsForTool } from './controls.mjs';
import { loadIssues } from '../monitor/issue-store.mjs';
import { SCANNER_SPECS } from '../monitor/extractors.mjs';

// FedRAMP remediation SLA in days, by severity, from discovery date.
const SLA_DAYS = { critical: 30, crit: 30, high: 30, moderate: 90, medium: 90, med: 90, low: 180, info: 180 };
const SEV_LABEL = { critical: 'Critical', crit: 'Critical', high: 'High', moderate: 'Moderate', medium: 'Moderate', med: 'Moderate', low: 'Low', info: 'Low' };

function annMatches(a, f) {
  if (a.id && a.id !== f.id) return false;
  if (a.package && a.package !== f.package) return false;
  if (a.repo && a.repo !== f.repo) return false;
  return true;
}
// FedRAMP deviation kind from an annotation action.
function deviationOf(a) {
  if (a.action === 'false-positive') return { kind: 'FP', label: 'False Positive' };
  if (a.action === 'accept') return { kind: 'OR', label: 'Operational Requirement' };
  if (a.action === 'wont-fix') return { kind: 'OR', label: 'Operational Requirement' };
  return null;
}
function activeAnnotations(annDoc, atIso) {
  const at = new Date(atIso).getTime();
  return (annDoc?.annotations || []).filter((a) => {
    if (a.at && new Date(a.at).getTime() > at) return false;
    if (a.expires && new Date(a.expires).getTime() <= at) return false;
    return true;
  });
}

// A severity the scanner did not state is its own state: no SLA clock starts on a guess.
const UNDETERMINED = 'Undetermined';
const checkForCategory = () => new Map(SCANNER_SPECS.map(([category, checkId]) => [category, checkId]));

/** Every scanner-row issue in the product's repos: open rows on the discovery-date SLA, and closed
 *  rows for issues closed as fixed. Vulnerability issues are left to the rollup, which carries them
 *  one advisory per row with the fixed version. */
function scannerRows(repoSet, issuesDoc, controls, at, contact) {
  const checkFor = checkForCategory();
  const open = [], closed = [];
  for (const i of Object.values(issuesDoc?.issues || {})) {
    if (i.source?.kind !== 'scanner-row' || !repoSet.has(i.repo)) continue;
    const checkId = checkFor.get(i.source.tool) || i.source.tool || 'scanner';
    const sevKey = String(i.severity || '').toLowerCase();
    const severity = SEV_LABEL[sevKey] || UNDETERMINED;
    const base = {
      poamId: poamId(i.id),
      controls: controlsForTool(checkId, controls),
      weaknessName: i.title || i.id,
      weaknessSource: checkId,
      sourceIdentifier: i.source.rule || i.id,
      issueId: i.id,
      asset: [i.repo, i.anchor?.file].filter(Boolean).join(' / '),
      severity,
      discoveryDate: i.createdAt || null,
      origin: 'scanner',
    };
    if (i.state === 'closed') {
      if (i.closedAs !== 'fixed') continue;
      const last = (i.evidence || []).at(-1);
      closed.push({ ...base, remediationDate: i.updatedAt || null, change: `closed as fixed`,
        evidence: last ? `${last.tier}: ${last.detail || ''}`.trim() : 'closed as fixed', status: 'Closed' });
      continue;
    }
    const slaDays = severity === UNDETERMINED ? null : SLA_DAYS[sevKey];
    const scheduled = base.discoveryDate && slaDays ? addDays(base.discoveryDate, slaDays) : null;
    const overdue = !!scheduled && isOverdue(scheduled, at);
    open.push({
      ...base,
      pointOfContact: contact,
      cvss: null, kev: false, epss: null,
      slaDays,
      scheduledCompletionDate: scheduled,
      overdue,
      status: severity === UNDETERMINED ? 'Open — severity undetermined, no SLA until graded' : (overdue ? 'Open — PAST DUE' : 'Open'),
      deviation: null,
      milestone: i.remediation || `Remediate the ${checkId} finding${i.source.rule ? ` (${i.source.rule})` : ''}`,
      advisory: null,
      slice: null,
      ...(i.suspect ? { suspect: true } : {}),
    });
  }
  return { open, closed };
}

const assetId = (f) => [f.repo, f.package && `${f.package}${f.version ? `@${f.version}` : ''}`, f.path].filter(Boolean).join(' / ');
const poamId = (key) => `V-${sha256(key || '').slice(0, 8).toUpperCase()}`;

export function poamData(product, { rollup, ledger, annDoc, controls, kev, epss, poc, issues }, at = nowISO()) {
  const repoSet = new Set(product.repos || []);
  const anns = activeAnnotations(annDoc, at);
  const kevS = kevSet(kev || {});
  const contact = poc || 'TODO — assign a point of contact';

  const open = [];
  for (const f of openFindings(rollup)) {
    if (!repoSet.has(f.repo) || !f.id) continue;
    const sevKey = (f.severity || 'medium').toLowerCase();
    const discovery = sweepStampToISO(f.bornSlice);
    const slaDays = SLA_DAYS[sevKey] ?? 90;
    const scheduled = discovery ? addDays(discovery, slaDays) : null;
    const ann = anns.find((a) => annMatches(a, f) && deviationOf(a));
    const dev = ann ? deviationOf(ann) : null;
    const overdue = scheduled && !dev && isOverdue(scheduled, at);
    open.push({
      poamId: poamId(f.key || `${f.repo}|${f.id}|${f.package || ''}`),
      controls: controlsForTool(f.tool, controls),
      weaknessName: f.title || f.id,
      weaknessSource: f.tool || 'scanner',
      sourceIdentifier: f.id,
      asset: assetId(f),
      pointOfContact: contact,
      severity: SEV_LABEL[sevKey] || 'Moderate',
      cvss: f.cvss ?? null,
      kev: f.kev === true || kevS.has(f.id),
      epss: typeof f.epss === 'number' ? f.epss : epssFor(epss || {}, f.id),
      discoveryDate: discovery,
      slaDays,
      scheduledCompletionDate: scheduled,
      overdue: !!overdue,
      status: dev ? 'Open (deviation requested)' : (overdue ? 'Open — PAST DUE' : 'Open'),
      deviation: dev ? { kind: dev.kind, label: dev.label, reason: ann.reason || '', by: ann.who || 'unknown', at: ann.at || null, needsAO: dev.kind !== 'VD' } : null,
      milestone: f.fixed ? `Upgrade ${f.package || ''} to ${f.fixed}` : `Remediate per advisory ${f.advisory || f.id}`,
      advisory: f.advisory || null,
      slice: rollup.sliceId || null,
      origin: 'dependency',
    });
  }
  const scanner = scannerRows(repoSet, issues, controls, at, contact);
  open.push(...scanner.open);
  open.sort((a, b) => (b.kev - a.kev) || (severityRank(b.severity) - severityRank(a.severity)) || String(a.scheduledCompletionDate).localeCompare(String(b.scheduledCompletionDate)));

  // Closed items: verified fixes (strong/medium) for this product's repos.
  const closed = [];
  for (const e of (ledger?.entries || [])) {
    if (!repoSet.has(e.repo) || !e.vulnId) continue;
    if (!['strong', 'medium'].includes(e.evidence?.tier)) continue;
    const disc = sweepStampToISO(e.bornSlice);
    closed.push({
      poamId: poamId(e.key || `${e.repo}|${e.vulnId}|${e.package || ''}`),
      controls: controlsForTool(e.tool || 'osv', controls),
      weaknessName: e.vulnId, sourceIdentifier: e.vulnId, asset: assetId(e),
      severity: SEV_LABEL[(e.severity || 'medium').toLowerCase()] || 'Moderate',
      discoveryDate: disc, remediationDate: sweepStampToISO(e.resolvedSlice) || e.at || null,
      change: `${e.package || ''} ${e.fromVersion || '?'} → ${e.toVersion || '?'}`,
      evidence: `${e.evidence.tier}: ${e.evidence.detail}${e.fixCommit ? ` (commit ${e.fixCommit})` : ''}`,
      status: 'Closed',
      origin: 'dependency',
    });
  }
  closed.push(...scanner.closed);
  closed.sort((a, b) => String(b.remediationDate).localeCompare(String(a.remediationDate)));

  const deviations = open.filter((r) => r.deviation).map((r) => ({
    poamId: r.poamId, sourceIdentifier: r.sourceIdentifier, asset: r.asset,
    kind: r.deviation.kind, label: r.deviation.label, reason: r.deviation.reason,
    requestedBy: r.deviation.by, at: r.deviation.at, needsAOApproval: r.deviation.needsAO,
  }));

  const overdue = open.filter((r) => r.overdue).length;
  const noDiscovery = open.filter((r) => !r.discoveryDate).length;
  return {
    product: { id: product.id, name: product.name, version: product.version },
    generatedAt: at, slice: rollup.sliceId || null,
    summary: {
      open: open.length, closed: closed.length, overdue, deviations: deviations.length, noDiscoveryDate: noDiscovery,
      undeterminedSeverity: open.filter((r) => r.severity === UNDETERMINED).length,
      bySource: {
        dependency: { open: open.filter((r) => r.origin === 'dependency').length, closed: closed.filter((r) => r.origin === 'dependency').length },
        scanner: { open: scanner.open.length, closed: scanner.closed.length, ...(issues ? {} : { note: 'no issue store was given' }) },
      },
    },
    open, closed, deviations,
  };
}
function severityRank(s) { return { Critical: 4, High: 3, Moderate: 2, Low: 1 }[s] || 0; }

// ── CSV ──────────────────────────────────────────────────────────────────────
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvRow = (cells) => cells.map(csvCell).join(',');
function openCsv(data) {
  const head = ['POA&M ID', 'Controls', 'Weakness', 'Source', 'Source ID', 'Asset', 'POC', 'Severity', 'CVSS', 'KEV', 'EPSS', 'Discovery Date', 'SLA Days', 'Scheduled Completion', 'Status', 'Deviation', 'Milestone', 'Slice', 'Origin'];
  const scheduledCell = (r) => r.scheduledCompletionDate || (r.severity === UNDETERMINED ? 'n/a (severity undetermined)' : 'n/a (no discovery date)');
  const rows = data.open.map((r) => csvRow([r.poamId, r.controls.join(' '), r.weaknessName, r.weaknessSource, r.sourceIdentifier, r.asset, r.pointOfContact, r.severity, r.cvss, r.kev ? 'YES' : '', r.epss ?? '', r.discoveryDate || 'UNKNOWN', r.slaDays ?? '', scheduledCell(r), r.status, r.deviation ? `${r.deviation.kind}: ${r.deviation.reason}` : '', r.milestone, r.slice, r.origin]));
  return [csvRow(head), ...rows].join('\n') + '\n';
}
function closedCsv(data) {
  const head = ['POA&M ID', 'Controls', 'Weakness', 'Source ID', 'Asset', 'Severity', 'Discovery Date', 'Remediation Date', 'Change', 'Evidence', 'Status', 'Origin'];
  const rows = data.closed.map((r) => csvRow([r.poamId, r.controls.join(' '), r.weaknessName, r.sourceIdentifier, r.asset, r.severity, r.discoveryDate || 'UNKNOWN', r.remediationDate || '', r.change, r.evidence, r.status, r.origin]));
  return [csvRow(head), ...rows].join('\n') + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--product') ? argv[argv.indexOf('--product') + 1] : null;
  const paths = resolvePaths();
  const at = nowISO();
  const controls = loadControls(paths.controls);
  const { products } = loadProducts(paths.products);
  const rollup = loadJSON(paths.rollup, { repos: [] });
  const ledger = loadJSON(paths.ledger, { entries: [] });
  const annDoc = loadJSON(paths.annotations, { annotations: [] });
  const kev = loadJSON(paths.kev, {});
  const epss = loadJSON(paths.epss, {});
  const issues = loadIssues();
  for (const product of products) {
    if (only && product.id !== only) continue;
    const data = poamData(product, { rollup, ledger, annDoc, controls, kev, epss, issues }, at);
    const base = join(paths.out, 'poam', product.id);
    writeJSONAtomic(`${base}.json`, data);
    writeTextAtomic(`${base}-open.csv`, openCsv(data));
    writeTextAtomic(`${base}-closed.csv`, closedCsv(data));
    const s = data.summary;
    console.log(`  ✓ ${product.id}: ${s.open} open (${s.bySource.dependency.open} dependency, ${s.bySource.scanner.open} scanner; ${s.overdue} past due, ${s.deviations} deviations${s.undeterminedSeverity ? `, ${s.undeterminedSeverity} severity undetermined` : ''}), ${s.closed} closed${s.noDiscoveryDate ? `, ${s.noDiscoveryDate} missing discovery date` : ''} → ${base}.json (+ csv)`);
  }
  console.log('  render the workbook: python3 cra/poam-to-xlsx.py');
}
