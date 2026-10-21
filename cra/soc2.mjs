#!/usr/bin/env node
// cra/soc2.mjs — SOC 2 Type II evidence packets, keyed to the Trust Services Criteria.
//
// A SOC 2 auditor tests that a control OPERATED over the whole period, by sampling. The
// evidence they want is not "here's our latest scan" — it's population completeness ("is this
// ALL your repos?"), consistent cadence (no silent gaps), timestamps, and closure trails. The
// monitor already has every piece; this assembles it per criterion:
//
//   CC7.1  Detect config changes & vulnerabilities  → coverage (evidenced controls) + the
//          scanned-population from the latest slice (explicit uncertainty completeness)
//   CC7.2  Monitor for anomalies / security events   → cadence from the slice history index,
//          with GAP DETECTION (a run interval > threshold is a control-operation exception)
//   CC7.4  Respond to identified security incidents   → open Art. 14 cases + risk acceptances
//   CC7.5  Recover / remediate                        → verified-closed ledger + MTTR by severity
//   CC8.1  Change management                          → deps auto-update + SAST-in-CI coverage
//
// Emits reports/cra/soc2/<product>/ : packet.md, packet.json, population.csv, cadence.csv.
// This FEEDS a SOC 2 audit (and Vanta/Drata) — it is not an audit opinion. Advisory mapping.
//
//   node cra/soc2.mjs [--product <id>] [--period-days 365]
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import {
  loadJSON, writeJSONAtomic, writeTextAtomic, resolvePaths, loadProducts, openFindings,
  nowISO, daysBetween, sweepStampToISO, latestSweepDir,
} from './lib.mjs';
import { coverageFor, loadControls, ranChecksFromSweep } from './controls.mjs';

const MAX_GAP_DAYS = Number(process.env.SOC2_MAX_GAP_DAYS || 2); // a sweep gap wider than this is an exception

// Cadence from the slice history index: intervals between runs, and gaps that exceed the
// expected cadence (a broken control operation an auditor samples for).
export function cadence(historyRows, periodStartIso, atIso) {
  const rows = (historyRows || [])
    .map((r) => ({ generated: r.generated || sweepStampToISO(r.stamp), sliceId: r.sliceId || r.stamp, scannedRepos: r.scannedRepos ?? null }))
    .filter((r) => r.generated && new Date(r.generated) >= new Date(periodStartIso) && new Date(r.generated) <= new Date(atIso))
    .sort((a, b) => a.generated.localeCompare(b.generated));
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const d = daysBetween(rows[i - 1].generated, rows[i].generated);
    if (d > MAX_GAP_DAYS) gaps.push({ from: rows[i - 1].generated, to: rows[i].generated, days: +d.toFixed(1) });
  }
  const sinceLast = rows.length ? daysBetween(rows[rows.length - 1].generated, atIso) : null;
  if (sinceLast != null && sinceLast > MAX_GAP_DAYS) gaps.push({ from: rows[rows.length - 1].generated, to: atIso, days: +sinceLast.toFixed(1), openEnded: true });
  return { runs: rows.length, first: rows[0]?.generated || null, last: rows[rows.length - 1]?.generated || null, maxGapDays: MAX_GAP_DAYS, gaps, rows };
}

// MTTR by severity from the ledger's verified (strong/medium) closures.
function mttrBySeverity(ledgerEntries, repoSet) {
  const buckets = {};
  for (const e of ledgerEntries) {
    if (!repoSet.has(e.repo) || !['strong', 'medium'].includes(e.evidence?.tier)) continue;
    const born = sweepStampToISO(e.bornSlice), res = sweepStampToISO(e.resolvedSlice) || e.at;
    if (!born || !res) continue;
    const sev = (e.severity || 'unknown').toLowerCase();
    (buckets[sev] ||= []).push(daysBetween(born, res));
  }
  const out = {};
  for (const [sev, days] of Object.entries(buckets)) {
    const valid = days.filter((d) => d >= 0);
    out[sev] = { n: valid.length, meanDays: valid.length ? +(valid.reduce((s, d) => s + d, 0) / valid.length).toFixed(1) : null, maxDays: valid.length ? +Math.max(...valid).toFixed(1) : null };
  }
  return out;
}

export function soc2Packet(product, { controls, rollup, ledger, annDoc, cases, history, ranChecks }, opts = {}) {
  const at = opts.at || nowISO();
  const periodDays = opts.periodDays || 365;
  const periodStart = new Date(new Date(at).getTime() - periodDays * 86_400_000).toISOString();
  const repoSet = new Set(product.repos || []);

  const cov = coverageFor(product, controls, rollup, ledger.entries || [], annDoc, ranChecks || null);
  const soc2 = cov.frameworks.soc2;

  // CC7.1 — population completeness: which of the product's repos the latest slice observed.
  const scanned = new Set((rollup.repos || []).map((r) => r.name));
  const population = (product.repos || []).map((r) => ({ repo: r, inLatestSlice: scanned.has(r) }));
  const notScanned = population.filter((p) => !p.inLatestSlice).map((p) => p.repo);

  const cad = cadence(history, periodStart, at);

  const openCases = Object.values(cases?.cases || {}).filter((k) => k.productId === product.id && k.status !== 'closed');
  const acceptances = (annDoc?.annotations || []).filter((a) => (!a.repo || repoSet.has(a.repo)) && ['accept', 'wont-fix', 'false-positive'].includes(a.action));
  const closed = (ledger.entries || []).filter((e) => repoSet.has(e.repo) && ['strong', 'medium'].includes(e.evidence?.tier));
  const mttr = mttrBySeverity(ledger.entries || [], repoSet);
  const responseRecords = openCases.length + acceptances.length;

  const criteria = {
    'CC7.1': {
      title: 'Detect configuration changes and vulnerabilities',
      evidenced: soc2.rows.filter((r) => r.control === 'CC7.1' && r.status === 'evidenced').length > 0,
      evidence: `Continuous scanning across ${population.length} repo(s); ${soc2.evidenced}/${soc2.total} SOC 2-mapped controls evidenced in the latest slice (${rollup.sliceId || 'n/a'}). Population + coverage attached.`,
      exceptions: notScanned.length ? [`${notScanned.length} product repo(s) not in the latest slice: ${notScanned.join(', ')} (completeness gap — explicit uncertainty)`] : [],
    },
    'CC7.2': {
      title: 'Monitor for anomalies and security events',
      evidenced: cad.runs > 0 && cad.gaps.filter((g) => !g.openEnded).length === 0,
      evidence: `${cad.runs} monitoring run(s) over the ${periodDays}-day period (${cad.first || 'n/a'} → ${cad.last || 'n/a'}); expected cadence ≤ ${cad.maxGapDays}d.`,
      exceptions: cad.gaps.map((g) => `cadence gap ${g.days}d (${g.from} → ${g.to})${g.openEnded ? ' — OPEN (no run since)' : ''}`),
    },
    'CC7.4': {
      title: 'Respond to identified security incidents',
      evidenced: responseRecords > 0,
      evidence: responseRecords
        ? `${openCases.length} open Art. 14 case(s) with tracked response clocks; ${acceptances.length} recorded risk decision(s) (accept/false-positive/wont-fix) with owner + timestamp.`
        : 'No open Art. 14 case and no recorded risk decision for this product: the monitor holds no record that the response process operated.',
      exceptions: openCases.filter((k) => (k.clocks && new Date(k.clocks.earlyWarningDue) < new Date(at))).map((k) => `case ${k.caseId} past its early-warning clock`),
    },
    'CC7.5': {
      title: 'Remediate / recover',
      evidenced: closed.length > 0,
      evidence: `${closed.length} verified remediation(s) (strong/medium evidence) in the ledger. MTTR by severity: ${Object.entries(mttr).map(([s, m]) => `${s} ${m.meanDays ?? '?'}d (n=${m.n})`).join('; ') || 'none yet'}.`,
      exceptions: [],
    },
    'CC8.1': {
      title: 'Change management',
      evidenced: soc2.rows.some((r) => r.control === 'CC8.1' && r.status === 'evidenced'),
      evidence: `SAST-in-CI and dependency auto-update checks map to CC8.1; ${soc2.rows.find((r) => r.control === 'CC8.1')?.status || 'n/a'} in the latest slice. NOTE: PR-approval / segregation-of-duties evidence lives in the git host, not commitwork — [HUMAN] supply it.`,
      exceptions: [],
    },
  };

  const totalExceptions = Object.values(criteria).reduce((n, c) => n + c.exceptions.length, 0);
  return {
    product: { id: product.id, name: product.name, version: product.version },
    generatedAt: at, period: { days: periodDays, start: periodStart, end: at }, slice: rollup.sliceId || null,
    criteria, population, cadence: cad, mttr,
    summary: { criteria: Object.keys(criteria).length, evidenced: Object.values(criteria).filter((c) => c.evidenced).length, exceptions: totalExceptions, monitoringRuns: cad.runs, verifiedRemediations: closed.length },
  };
}

function renderMd(pk) {
  const L = [`# SOC 2 evidence packet — ${pk.product.name} ${pk.product.version}`, '',
    `_Generated ${pk.generatedAt} · period ${pk.period.days}d (${pk.period.start.slice(0, 10)} → ${pk.period.end.slice(0, 10)}) · slice ${pk.slice || 'n/a'}._`,
    '', `_Advisory. This **feeds** a SOC 2 Type II audit (and tools like Vanta/Drata) with control-operation evidence keyed to the Trust Services Criteria; it is not an audit opinion, and criterion→check mapping should be reviewed with your auditor. "Evidenced" reflects what the monitor can prove operated; **[HUMAN]** items need evidence commitwork does not hold (e.g. PR approvals)._`,
    '', `**${pk.summary.evidenced}/${pk.summary.criteria} criteria evidenced · ${pk.summary.exceptions} exception(s) · ${pk.summary.monitoringRuns} monitoring runs · ${pk.summary.verifiedRemediations} verified remediations**`, ''];
  for (const [id, c] of Object.entries(pk.criteria)) {
    L.push(`## ${id} — ${c.title}`, '', `- **Operating:** ${c.evidenced ? '🟢 evidence present' : '⬜ not evidenced'}`, `- **Evidence:** ${c.evidence}`);
    if (c.exceptions.length) { L.push('- **Exceptions:**'); for (const e of c.exceptions) L.push(`  - ⚠ ${e}`); }
    L.push('');
  }
  L.push('## Population (CC7.1 completeness)', '', '| Repo | In latest slice |', '|---|---|', ...pk.population.map((p) => `| ${p.repo} | ${p.inLatestSlice ? '🟢 yes' : '⬜ NO'} |`), '');
  L.push('## Cadence (CC7.2)', '', `${pk.cadence.runs} runs; ${pk.cadence.gaps.length} gap(s) > ${pk.cadence.maxGapDays}d.`, '');
  return L.join('\n');
}

const csv = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n') + '\n';

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const only = flag('--product');
  const periodDays = Number(flag('--period-days') || 365);
  const paths = resolvePaths();
  const at = nowISO();
  const controls = loadControls(paths.controls);
  const { products } = loadProducts(paths.products);
  const rollup = loadJSON(paths.rollup, { repos: [] });
  const ledger = loadJSON(paths.ledger, { entries: [] });
  const annDoc = loadJSON(paths.annotations, { annotations: [] });
  const cases = loadJSON(paths.cases, { cases: {} });
  const history = loadJSON(paths.historyIndex, []);
  const sweep = latestSweepDir(paths.reportsRoot);
  for (const product of products) {
    if (only && product.id !== only) continue;
    const pk = soc2Packet(product, { controls, rollup, ledger, annDoc, cases, history, ranChecks: ranChecksFromSweep(sweep, product.repos) }, { at, periodDays });
    const dir = join(paths.out, 'soc2', product.id);
    writeTextAtomic(join(dir, 'packet.md'), renderMd(pk));
    writeJSONAtomic(join(dir, 'packet.json'), pk);
    writeTextAtomic(join(dir, 'population.csv'), csv([['Repo', 'In latest slice'], ...pk.population.map((p) => [p.repo, p.inLatestSlice ? 'yes' : 'NO'])]));
    writeTextAtomic(join(dir, 'cadence.csv'), csv([['Slice', 'Generated', 'Scanned repos'], ...pk.cadence.rows.map((r) => [r.sliceId, r.generated, r.scannedRepos ?? ''])]));
    console.log(`  ✓ ${product.id}: ${pk.summary.evidenced}/${pk.summary.criteria} criteria evidenced, ${pk.summary.exceptions} exception(s) → ${dir}/packet.md`);
  }
}
