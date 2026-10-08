#!/usr/bin/env node
// commitwork monitor — fleet build-health + quality-gates refresh (deadcode | toolchain |
// provenance | gates | all). Runs per ACTIVE repo (same scope gates as sweep.mjs), writes the
// reports INTO THE LATEST sweep batch, then re-rollups it in place. Deliberately NOT a new
// history slice — a health-only batch would mark every repo "not scanned" for deps.
// usage: node monitor/health-sweep.mjs [deadcode|toolchain|provenance|gates|all] [onlyProject]
//        (admin :7878 triggers this via POST /api/health/<check>)
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registryPath } from './registry.mjs';
import { healthScope } from './health-scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const SUBS = { deadcode: 'build-health-deadcode.json', toolchain: 'build-health-toolchain.json', provenance: 'build-health-provenance.json' };
// gate arg -> report filename rollup.mjs reads. 'boot-test-pass' is DELIBERATELY absent until
// executed boottest batches accrue — it runs via its manifest group `boot-pass`.
const GATES = { 'boot-test': 'quality-gates-boottest.json', 'contract-tests': 'quality-gates-contracts.json', openapi: 'quality-gates-openapi.json', ci: 'quality-gates-ci.json' };
const check = process.argv[2] || 'all';
const only = process.argv[3]; // optional project name filter (e.g. clientA)
if (!(check === 'all' || check === 'gates' || SUBS[check])) { console.error(`usage: health-sweep.mjs [${Object.keys(SUBS).join('|')}|gates|all] [onlyProject]`); process.exit(2); }
const bhSubs = check === 'all' ? Object.keys(SUBS) : SUBS[check] ? [check] : [];
const gateSubs = (check === 'all' || check === 'gates') ? Object.keys(GATES) : [];

const reg = JSON.parse(readFileSync(registryPath(), 'utf8'));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const EXCLUDE = new Set(reg.exclude || []);
const LIFECYCLE = reg.lifecycle || {};
const lcSuperseded = (n) => { const l = LIFECYCLE[n]; return !!(l && l.state === 'superseded' && !EXCLUDE.has(n) && l.effectiveFrom && stamp >= l.effectiveFrom && (!l.effectiveTo || stamp < l.effectiveTo)); };

// `only` ARRIVES AS EITHER A PROJECT NAME OR AN AREA SLUG, and matching only the former is how
// this produced "[health] 0 repos" against a real fleet. The admin panel triggers this with the
// AREA slug (POST /api/health/<check> sends e.g. `commitwork-admin`), while reg.projects are named
// `commitwork`, `commitwork-web`, … — so `p.name !== only` excluded every project and the run
// proceeded over an empty set rather than saying it had been asked for something it could not find.
// healthScope() resolves both through sweep.mjs's own resolver.
const { repos } = healthScope(reg, only, { selfRoot: CW, stamp, skip: lcSuperseded });

// A HEALTHCHECK IS AN OVERLAY ON SOMEBODY'S BATCH, NOT A PROJECT RECORD OF ITS OWN. It writes its
// reports INTO an existing batch dir, so the batch it picks decides whose record the results join.
// Three things were wrong with picking `sweeps[last]`, and they compounded into one incident on
// 2026-08-29:
//
//   1. SCOPE-BLIND. The project argument never reached selection. `health-sweep all commitwork-admin`
//      selected sweep-20260828170002 — a batch whose own manifest reads `"only": "clientA"` with a
//      client service repo scope — and mkdirSync'd commitwork's repos inside it. Health output for one project
//      landed in another project's record, which is the conflation this comment exists to refuse.
//   2. THE REGEX EXCLUDED EVERY SCOPED BATCH. /^sweep-\d{14}$/ is anchored with no slug suffix, so
//      `sweep-<ts>-<slug>` batches — which is what every scoped sweep writes — could never match.
//      It was structurally incapable of finding the right answer, not merely unlucky.
//   3. NO COMPLETENESS TEST. The batch it picked was the ENOSPC corpse: killed mid-write. A dead
//      batch's name never changes, so it wins a lexical sort forever.
//
// THE COMPLETENESS DISCRIMINATOR IS `area`, AND IT WAS MEASURED RATHER THAN ASSUMED. The obvious
// choice is a finishedAt stamp; there is none — NO batch manifest on this machine carries one, so
// testing for it would have refused every batch and bricked the tool for scoped and global runs
// alike. What a completed batch does carry is `area` + `areaOut`; the corpse carries neither, which
// is exactly what rollup.mjs refused it for ("declares no area, so there is nothing to say which
// project's record it belongs in"). So one field answers both questions: whether the batch finished
// enough to be adoptable, and whose record it belongs to.
//
// Scoped run: only batches belonging to this project/area are eligible, and NONE is a refusal
// rather than a fallback to somebody else's. Global run (no project arg): unscoped fleet batches,
// as before.
const root = resolve(CW, reg.reportsRoot || 'reports');
const batchManifest = (d) => {
  try { return JSON.parse(readFileSync(join(root, d, 'batch-manifest.json'), 'utf8')); }
  catch { return null; }                       // unreadable manifest ⇒ cannot claim it belongs here
};
// A batch that never recorded its own scope cannot be overlaid: rollup will refuse it, so adopting
// it guarantees the failure rather than risking it.
const declaresScope = (m) => !!(m && m.area);
const belongsHere = (d, m) => {
  if (!only) return /^sweep-\d{14}$/.test(d);  // global: the unscoped fleet batches, unchanged
  const named = d.match(/^sweep-\d{14}-(.+)$/);
  return (named && named[1] === only) || (m && m.area === only);
};
const sweeps = readdirSync(root)
  .filter((d) => /^sweep-\d{14}/.test(d) && statSync(join(root, d)).isDirectory())
  .filter((d) => { const m = batchManifest(d); return belongsHere(d, m) && (!only || declaresScope(m)); })
  .sort();
if (!sweeps.length) {
  console.error(only
    ? `health-sweep: no COMPLETED batch belongs to '${only}' — refusing to overlay health results onto another project's batch. `
      + 'Run a sweep for it first; a healthcheck annotates a scan, it does not stand in for one.'
    : 'health-sweep: no sweep-* batch to refresh — run a full sweep first');
  process.exit(2);
}
if (!repos.length) {
  console.error(`health-sweep: '${only}' resolved ZERO repos — refusing to run. `
    + 'An empty scope writes nothing and would re-rollup the batch as though it had been checked.');
  process.exit(2);
}
const batchDir = join(root, sweeps[sweeps.length - 1]);
console.log(`[health] ${repos.length} repos · checks=${[...bhSubs, ...(gateSubs.length ? ['gates'] : [])].join(',')} · -> ${batchDir}`);

// (binScript, arg, reportFile) triples — build-health and quality-gates share the same
// contract: JSON on stdout with a top-level status, report filename read by rollup.mjs
const runs = [
  ...bhSubs.map((s) => ['bin/build-health.mjs', s, SUBS[s]]),
  ...gateSubs.map((g) => ['bin/quality-gates.mjs', g, GATES[g]]),
];
let i = 0;
for (const r of repos) {
  console.log(`[health] (${++i}/${repos.length}) scan ${r.name}`);
  const outDir = join(batchDir, r.name); mkdirSync(outDir, { recursive: true });
  for (const [bin, sub, file] of runs) {
    try {
      const out = execFileSync('node', [join(CW, bin), sub, r.path], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
      const j = out.slice(out.indexOf('{'));
      JSON.parse(j); // refuse to write unparseable output over a good report
      writeFileSync(join(outDir, file), j);
    } catch (e) { console.log(`  ${r.name}/${sub}: FAILED (${(e.message || '').split('\n')[0]}) — prior report left in place`); }
  }
}

console.log('[sweep] rollup'); // same phase marker the admin console parses
// rollup REFUSES deliberately and says why in prose. Unguarded, that refusal came back to the
// operator as a Node stack trace with the reason buried above it — the panel showed
// "healthcheck exited (1)" over an error object. A refusal is a result; report it as one and keep
// the exit code, because the run genuinely did not complete.
try {
  execFileSync('node', [join(HERE, 'rollup.mjs'), batchDir], { stdio: 'inherit' });
} catch (e) {
  console.error(`[health] rollup REFUSED ${batchDir} (exit ${e.status ?? '?'}) — the health reports were `
    + 'written, but the batch was not re-rolled up, so the panel still shows the previous run\'s columns.');
  process.exit(e.status || 1);
}
console.log('[sweep] done');
