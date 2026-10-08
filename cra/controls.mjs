#!/usr/bin/env node
// cra/controls.mjs — control-coverage: which framework controls does commitwork's evidence
// actually cover for a product, and can we PROVE it?
//
// Joins the check→framework crosswalk (controls.json) with the live slice's per-repo run
// provenance (repo.scanners.<category>.ran) and the remediation ledger. For each control it
// reports one of:
//   evidenced      — ≥1 mapping check whose category provably ran on ≥1 product repo (or a
//                    ledger/annotation evidence source is present)
//   mapped         — the catalogue addresses this control, but this slice does not PROVE a
//                    mapping check ran for the product (explicit uncertainty — never counted as covered)
//
// This is the primitive the SOC 2 evidence packets (CC7.x) and FedRAMP POA&M rows
// (finding→NIST) build on. Advisory crosswalk — review with your assessor.
//
//   node cra/controls.mjs coverage [--product <id>] [--framework cra|soc2|nist80053] [--json]
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  loadJSON, writeJSONAtomic, writeTextAtomic, resolvePaths, loadProducts, nowISO, latestSweepDir,
} from './lib.mjs';

const FRAMEWORKS = ['cra', 'soc2', 'nist80053'];

export function loadControls(path) {
  const doc = loadJSON(path);
  if (!doc.checks || !doc.frameworks) throw new Error(`${path}: not a controls crosswalk`);
  return doc;
}

// A rollup finding's NIST 800-53 controls, via tool → check → controls. Falls back to
// RA-5 (Vulnerability Monitoring and Scanning) for any vuln-shaped finding whose tool is
// unmapped — never returns empty for a real finding.
export function controlsForTool(tool, controls, framework = 'nist80053') {
  const checkId = controls.toolAliases?.[tool] || (controls.checks[tool] ? tool : null);
  const ids = checkId ? (controls.checks[checkId]?.[framework] || []) : [];
  return ids.length ? [...ids] : (framework === 'nist80053' ? ['RA-5'] : []);
}

// Which of a product's repos provably ran each scanner category, from the slice.
//
// `ran: true` ALONE IS NOT PROOF. The rollup's extractors set it whenever an artifact was found at
// the expected path, and then qualify it: `unparseable` (the file is corrupt) or `nosrc` (it was
// empty, or the scanner's own artifact says it did not run — Socket's {ok:false} husk, a
// tls-headers scan with no target, a cspm self-gate, a schemathesis run whose spec never loaded).
// Every one of those means WE COULD NOT READ A RESULT, and a control cannot be evidenced by a file
// nobody could read. Measured across the fleet before this gate was tightened: 446 per-repo entries
// evidenced from a readable artifact and 15 from a degraded one — maliciousPackages 6, apiFuzz 5,
// supplyChainHeuristic 2, cspm 2.
//
// The runner already agrees: bin/commitwork.mjs records `noscan` for exactly these cases, and every
// empty SARIF on disk carries `noscan (ran — no source matched)` in its checks-status row, never
// `pass`. So this was the rollup and the runner disagreeing about the same artifact, with the
// compliance lane trusting the more generous of the two.
//
// The flags stay ON the entry — the panel uses them to tell "corrupt" from "absent", which is a
// distinction worth keeping. Only the evidence claim is withdrawn.
function ranCategoriesByRepo(rollup, repoSet) {
  const out = new Map(); // repo -> Set(category)
  for (const repo of rollup?.repos || []) {
    if (!repoSet.has(repo.name)) continue;
    const cats = new Set();
    for (const [cat, v] of Object.entries(repo.scanners || {})) {
      // neverran/toolfailed (sarif-read.mjs states) are also could-not-read-a-result. norules is
      // the OTHER direction: the artifact is readable and the scan executed — with ZERO rules
      // loaded, so it could not have found anything by construction. A vacuous run is not a
      // degraded read, but it proves exactly as little, and a control evidenced by a scanner
      // incapable of failing is the vacuous-check class wearing a compliance claim (BACKLOG P;
      // the fleet-aggregate half of that item is pinned separately in pipeline-canary hop 2).
      if (v && v.ran === true && !v.unparseable && !v.nosrc && !v.neverran && !v.toolfailed && !v.norules) cats.add(cat);
    }
    out.set(repo.name, cats);
  }
  return out;
}

// Precise per-CHECK run provenance from the runner's checks-status.json (the S2 contract):
// a check "ran" iff its status is pass|fail (skip = requirements unmet, e.g. a runtime
// scanner with no live URL → NOT evidence). This is what lets runtime controls (access
// enforcement / transport encryption via authz-test, dast-authz-bola, tls-headers) become
// evidenced when their scanners actually run against a live target — explicit uncertainty.
export function ranChecksFromSweep(sweepDir, repos) {
  const out = new Map(); // repo -> Set(checkId that ran)
  if (!sweepDir) return out;
  for (const repo of repos || []) {
    const f = join(sweepDir, repo, 'checks-status.json');
    if (!existsSync(f)) continue;
    let arr; try { arr = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const ran = new Set();
    for (const c of arr) if (c && (c.status === 'pass' || c.status === 'fail') && c.check) ran.add(c.check);
    if (ran.size) out.set(repo, ran);
  }
  return out;
}

function controlTitle(controls, framework, id) {
  const fw = controls.frameworks[framework];
  return (framework === 'cra' ? fw.items : fw.controls)?.[id] || id;
}

// Build coverage for one product across all frameworks.
// ranChecks (optional): Map<repo, Set<checkId>> of precise per-check run provenance from
// checks-status.json (see ranChecksFromSweep). When supplied it unions with the coarse
// category signal — this is what evidences runtime controls once their scanners run.
export function coverageFor(product, controls, rollup, ledgerEntries, annDoc, ranChecks = null) {
  const repoSet = new Set(product.repos || []);
  const ranByRepo = ranCategoriesByRepo(rollup, repoSet);

  // Which checks are proven to have run on ≥1 product repo, by EITHER signal (category from
  // the slice's scanner rollup, or precise check id from checks-status.json), and where.
  const provenChecks = new Map(); // checkId -> [repos]
  for (const [checkId, def] of Object.entries(controls.checks)) {
    const repos = new Set();
    if (def.category) for (const [r, cats] of ranByRepo) if (cats.has(def.category)) repos.add(r);
    if (ranChecks) for (const [r, checks] of ranChecks) if (repoSet.has(r) && checks.has(checkId)) repos.add(r);
    if (repos.size) provenChecks.set(checkId, [...repos]);
  }

  // Evidence sources beyond checks.
  const ledgerForProduct = (ledgerEntries || []).filter((e) => repoSet.has(e.repo) && ['strong', 'medium'].includes(e.evidence?.tier));
  const annForProduct = (annDoc?.annotations || []).filter((a) => !a.repo || repoSet.has(a.repo));
  const sliceCoversProduct = (rollup?.repos || []).some((r) => repoSet.has(r.name));
  const hasAuditRecords = !!ranChecks && [...ranChecks.values()].some((s) => s && s.size > 0);
  // Enrichment of findings on repos the slice never scanned for this product assesses nothing about it.
  const hasEnrichment = sliceCoversProduct && !!(rollup.enrichment
    || (rollup.repos || []).some((r) => repoSet.has(r.name) && (r.findings || []).some((f) => f.kev !== undefined || typeof f.epss === 'number')));
  const activeSources = {
    'remediation-ledger': ledgerForProduct.length > 0,
    'annotations': annForProduct.length > 0,
    'monitoring-program': sliceCoversProduct,   // a slice covering the product = the monitoring control operated
    'audit-records': hasAuditRecords,            // checks-status.json = timestamped audit records
    'kev-epss': hasEnrichment,                   // exploitation-ranked risk assessment present
  };

  const result = {};
  for (const fw of FRAMEWORKS) {
    const controlIds = new Set();
    // gather every control referenced by any mapped check or evidence source for this framework
    for (const def of Object.values(controls.checks)) for (const id of def[fw] || []) controlIds.add(id);
    for (const [, src] of Object.entries(controls.evidenceSources)) for (const id of src[fw] || []) controlIds.add(id);

    const rows = [];
    for (const id of [...controlIds].sort()) {
      const mappingChecks = Object.entries(controls.checks).filter(([, d]) => (d[fw] || []).includes(id)).map(([c]) => c);
      const evidencingChecks = mappingChecks.filter((c) => provenChecks.has(c));
      const evidencingSources = Object.entries(controls.evidenceSources)
        .filter(([name, src]) => (src[fw] || []).includes(id) && activeSources[name]).map(([name]) => name);
      const evidenced = evidencingChecks.length > 0 || evidencingSources.length > 0;
      const repos = [...new Set(evidencingChecks.flatMap((c) => provenChecks.get(c)))];
      rows.push({
        control: id, title: controlTitle(controls, fw, id),
        status: evidenced ? 'evidenced' : 'mapped',
        mappingChecks, evidencingChecks, evidencingSources, repos,
      });
    }
    const evidenced = rows.filter((r) => r.status === 'evidenced').length;
    const meta = controls.frameworks[fw];
    // Scope honesty: `total`/`mapped` is what commitwork MAPS (the technical subset), NOT the
    // framework's control count. `catalog` is the full framework size so "11/13" can never be
    // misread as "85% of NIST 800-53".
    const catalog = meta.catalog ?? meta.commonCriteria ?? null;
    result[fw] = {
      name: meta.name, total: rows.length, mapped: rows.length, evidenced, rows,
      scope: meta.scope || null, catalog, baselineModerate: meta.baselineModerate ?? null,
    };
  }
  return { product: { id: product.id, name: product.name, version: product.version }, generatedAt: nowISO(), frameworks: result };
}

function renderMd(cov, onlyFw) {
  const L = [`# Control coverage — ${cov.product.name} ${cov.product.version}`, '',
    `_Generated ${cov.generatedAt}. **Advisory crosswalk** (cra/controls.json) — a defensible starting point, not a substitute for your assessor's control mapping. \`evidenced\` = a mapping check provably ran on a product repo in the latest slice (or a ledger/annotation/monitoring source is present); \`mapped\` = addressed by the catalogue but not proven to have run for this product (explicit uncertainty). **Denominators are the controls commitwork MAPS — the technical subset — not the full framework.**_`, ''];
  for (const fw of FRAMEWORKS) {
    if (onlyFw && fw !== onlyFw) continue;
    const f = cov.frameworks[fw];
    const denom = f.catalog ? ` · commitwork maps ${f.mapped} of ~${f.catalog}${f.baselineModerate ? ` (~${f.baselineModerate} in a FedRAMP Moderate baseline)` : ''} ${fw === 'cra' ? '' : 'technical '}controls` : '';
    L.push(`## ${f.name} — ${f.evidenced}/${f.mapped} mapped controls evidenced${denom}`, '');
    if (f.scope) L.push(`_Scope: ${f.scope}_`, '');
    L.push('| Control | Title | Status | Evidenced by |', '|---|---|---|---|');
    for (const r of f.rows) {
      const by = r.status === 'evidenced'
        ? [...r.evidencingChecks, ...r.evidencingSources.map((s) => `(${s})`)].join(', ') + (r.repos.length ? ` — ${r.repos.length} repo(s)` : '')
        : `mapped: ${r.mappingChecks.join(', ') || '—'}`;
      L.push(`| ${r.control} | ${r.title} | ${r.status === 'evidenced' ? '🟢 evidenced' : '⬜ mapped'} | ${by} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'coverage';
  if (cmd !== 'coverage') { console.error('usage: node cra/controls.mjs coverage [--product <id>] [--framework cra|soc2|nist80053] [--json]'); process.exit(2); }
  const onlyFw = flag('--framework');
  if (onlyFw && !FRAMEWORKS.includes(onlyFw)) { console.error(`--framework must be one of ${FRAMEWORKS.join('|')}`); process.exit(2); }
  const paths = resolvePaths();
  const controls = loadControls(paths.controls);
  const products = loadProducts(paths.products);
  const rollup = loadJSON(paths.rollup, { repos: [] });
  const ledger = loadJSON(paths.ledger, { entries: [] });
  const annDoc = loadJSON(paths.annotations, { annotations: [] });
  const sweep = flag('--sweep') || latestSweepDir(paths.reportsRoot);
  const only = flag('--product');
  for (const product of products.products) {
    if (only && product.id !== only) continue;
    const ranChecks = ranChecksFromSweep(sweep, product.repos);
    const cov = coverageFor(product, controls, rollup, ledger.entries || [], annDoc, ranChecks);
    if (argv.includes('--json')) { console.log(JSON.stringify(cov, null, 2)); continue; }
    const md = renderMd(cov, onlyFw);
    const out = join(paths.out, 'coverage', `${product.id}.md`);
    writeTextAtomic(out, md);
    writeJSONAtomic(join(paths.out, 'coverage', `${product.id}.json`), cov);
    const totals = FRAMEWORKS.map((f) => `${f}:${cov.frameworks[f].evidenced}/${cov.frameworks[f].total}`).join('  ');
    console.log(`  ✓ ${product.id}: ${totals} → ${out}`);
  }
}
