#!/usr/bin/env node
// remediation-plan.mjs — the wiring: a rollup slice in, a PREPARED (never opened) PR plan out.
//
//   slice --advisoriesFromSlice--> advisories --probeUpstreamHead--> headStates --planBatch--> plan
//
// Declaration split from authority end to end: this forks nothing, pushes nothing, opens nothing.
// It emits branches + PR bodies + the exact commands a human runs. Every external act (cloning the
// upstream default branch, calling govulncheck, resolving a slug, the OSV snapshot) is an injected
// seam, so the pipeline is deterministic and runs offline in tests. The probe only runs for an
// advisory whose upstream checkout the CALLER has already provided — this module never clones.

import { writeAtomic } from './lockfile.mjs';
import { readFileSync } from 'node:fs';
import { advisoriesFromSlice, osvFixedFromSnapshot } from './remediation-source.mjs';
import { probeUpstreamHead } from './upstream-probe.mjs';
import { planBatch } from './remediation-pr.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const env = (k) => process.env[k];

/**
 * @param {object} slice  a rollup history slice
 * @param {{
 *   osvFixed:(id,pkg)=>string,
 *   slugFor:(repo)=>string|null,
 *   checkoutDirFor:(slug)=>string|null,   // where the caller has checked out upstream HEAD, or null
 *   probe?:Function                        // defaults to probeUpstreamHead; injected in tests
 * }} seams
 * @returns {{ plan, advisories, coverage, headStates }}
 */
export function planFromSlice(slice, { osvFixed, slugFor, checkoutDirFor, probe = probeUpstreamHead }) {
  const { advisories, coverage } = advisoriesFromSlice(slice, { osvFixed, slugFor });

  const headStates = {};
  for (const adv of advisories) {
    const dir = checkoutDirFor(adv.upstream.repo);
    // No checkout provided -> we cannot confirm the advisory is still live upstream, so the head
    // state is unknown and the engine will route it to 'undetermined' (fail closed, no PR on a guess).
    headStates[adv.id] = dir ? probe(adv, { checkoutDir: dir }) : { fixed: null, reason: 'no-upstream-checkout' };
  }

  const plan = planBatch(advisories, headStates);
  return { plan, advisories, coverage, headStates };
}

// ── CLI. Declare-only. Reads a slice; without checkouts it produces an all-undetermined plan (the
//    honest state: reachable advisories found, upstream liveness not yet confirmed). A checkout map
//    (CW_CHECKOUTS: { "<slug>": "<dir>" }) turns those into propose/skip as the probe resolves them.
function main(argv) {
  const slicePath = env('CW_SLICE') || argv.find((a) => !a.startsWith('--'));
  if (!slicePath) { process.stderr.write('usage: remediation-plan.mjs <slice.json> [--write]\n'); process.exit(2); }
  let slice;
  try { slice = JSON.parse(readFileSync(slicePath, 'utf8')); }
  catch (e) { process.stderr.write(`cannot read ${slicePath}: ${e.message}\n`); process.exit(2); }

  const readMap = (v) => { if (!v) return {}; try { return JSON.parse(readFileSync(v, 'utf8')); } catch { return {}; } };
  const slugMap = readMap(env('CW_SLUG_MAP'));
  const checkouts = readMap(env('CW_CHECKOUTS'));
  const seams = {
    osvFixed: osvFixedFromSnapshot(),
    slugFor: (repo) => slugMap[repo] || null,
    checkoutDirFor: (slug) => checkouts[slug] || null,
  };

  const out = planFromSlice(slice, seams);
  const doc = JSON.stringify({
    plan: out.plan, coverage: out.coverage,
    note: 'PREPARED, NOT APPLIED. commitwork declares; a human submits.',
  }, null, 2);

  if (argv.includes('--write')) {
    const dest = env('CW_REMEDIATION_OUT') || 'reports/remediation-pr-plan.json';
    writeAtomic(dest, doc + '\n', { mkdir: true });
    process.stderr.write(`wrote ${dest}\n`);
  } else {
    process.stdout.write(doc + '\n');
  }
  const c = out.plan.counts;
  process.stderr.write(`propose=${c.proposed} skip=${c.skipped} undetermined=${c.undetermined} | goRows=${out.coverage.goRows} notCovered=${out.coverage.ecosystemsNotCovered.join(',') || 'none'}\n`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
