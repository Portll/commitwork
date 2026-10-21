#!/usr/bin/env node
// cra/sbom.mjs — per-PRODUCT CycloneDX SBOM, merged from the fleet's per-repo SBOMs.
//
// CRA Annex I Part II (1) requires identifying and documenting the components of the
// PRODUCT — an SBOM kept current per release. The sweeps already produce per-repo
// SBOMs (sbom-syft.json / sbom.json in each repo's report dir); this merges the repos
// mapped to a product (the product registry, monitor/private/cra-products.json) into one product-level CycloneDX document:
//
//   reports/cra/sbom/<productId>-<version>.cdx.json
//   reports/cra/sbom/<productId>-<version>.spdx.json   (SPDX 2.3 of the same components, cra/spdx.mjs)
//
// Merge rules: components dedupe on purl (fallback name@version); each component is
// annotated with the repo(s) that carry it; components whose recorded source location
// sits under reference/ or reports/ are dropped (vendored fixtures / scan output are
// not product code — belt and braces on top of the scanner excludes).
//
//   node cra/sbom.mjs [--product <id>] [--sweep <dir>]
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join, basename } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import {
  loadJSON, writeJSONAtomic, resolvePaths, loadProducts, latestSweepDir,
  nowISO, contentUUID, stableStringify,
} from './lib.mjs';
import { cdxToSpdx } from './spdx.mjs';

const VENDORED = /(^|\/)(reference|reports)\//;

function componentKey(c) {
  return c.purl || `${c.group ? c.group + '/' : ''}${c.name}@${c.version || ''}`;
}

function componentPath(c) {
  // syft records source locations as properties: syft:location:0:path etc.
  for (const p of c.properties || []) {
    if (/location:\d+:path$/.test(p.name || '')) return p.value || '';
  }
  return '';
}

/**
 * Did the per-repo SBOM have its provenance put back?
 *
 * syft's CycloneDX writer drops metadata.resolved, so a git-pinned dependency publishes as a bare
 * registry purl such as `pkg:npm/<name>@0.0.0`, a version npm has never served. bin/sbom-enrich.mjs
 * corrects it at scan time and leaves this sidecar. Its ABSENCE means the SBOM was not corrected and
 * is reported as such: an SBOM shipped as CRA Annex I evidence must not silently assert a registry
 * identity nobody checked.
 *
 * Returns 'enriched' | 'nothing-to-correct' | 'unenriched'. Never throws — a missing sidecar is the
 * common case for a batch swept without the enricher.
 */
function repoProvenanceState(sweepDir, repo) {
  const r = loadJSON(join(sweepDir, repo, 'sbom-syft-provenance.json'), null);
  if (!r || r.ran !== true) return 'unenriched';
  return r.enriched > 0 ? 'enriched' : 'nothing-to-correct';
}

function repoSbomFile(sweepDir, repo) {
  for (const f of ['sbom-syft.json', 'sbom.json', 'sbom.cdx.json']) {
    const p = join(sweepDir, repo, f);
    if (existsSync(p)) return p;
  }
  return null;
}

export function mergeProductSbom(product, manufacturer, repoSboms, atIso) {
  const merged = new Map(); // key -> component (+ commitwork:repo properties)
  let dropped = 0;
  const unenriched = repoSboms.filter((r) => r.provenance && r.provenance === 'unenriched').map((r) => r.repo);
  for (const { repo, doc } of repoSboms) {
    for (const comp of doc?.components || []) {
      if (VENDORED.test(componentPath(comp))) { dropped++; continue; }
      const key = componentKey(comp);
      if (!merged.has(key)) {
        const clean = { ...comp };
        clean.properties = (comp.properties || []).filter((p) => !/^syft:location/.test(p.name || ''));
        clean.properties.push({ name: 'commitwork:repo', value: repo });
        merged.set(key, clean);
      } else {
        const props = merged.get(key).properties;
        if (!props.some((p) => p.name === 'commitwork:repo' && p.value === repo)) {
          props.push({ name: 'commitwork:repo', value: repo });
        }
      }
    }
  }
  const components = [...merged.values()].sort((a, b) => componentKey(a).localeCompare(componentKey(b)));
  const doc = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: atIso,
      component: {
        type: 'application', name: product.name, version: product.version, 'bom-ref': `product:${product.id}`,
        supplier: manufacturer?.name ? { name: manufacturer.name } : undefined,
      },
      properties: [
        { name: 'commitwork:repos', value: (product.repos || []).join(',') },
        { name: 'commitwork:vendored-components-dropped', value: String(dropped) },
        { name: 'commitwork:sources', value: repoSboms.map((r) => r.repo).join(',') || '(none)' },
        // PROVENANCE OF THE PROVENANCE. syft's CycloneDX writer discards metadata.resolved, so a
        // git-pinned dependency publishes under a bare registry purl — an identity the registry
        // has never served, and (because componentKey IS the purl) also the merge key, so two
        // unrelated artifacts sharing name@version collapse into one row. bin/sbom-enrich.mjs
        // corrects that at scan time. A source SBOM that did not go through it is named here
        // rather than left to look identical to one that did: this document is CRA Annex I Part
        // II (1) evidence, and an unchecked claim inside it must be visible as unchecked.
        ...(unenriched.length ? [{ name: 'commitwork:provenance-unenriched',
          value: unenriched.join(',') }, { name: 'commitwork:provenance-caveat',
          value: `${unenriched.length} of ${repoSboms.length} source SBOM(s) were not provenance-corrected. Any component in them that resolves from git, a local path or a bare archive still carries a package-registry purl, which asserts an identity it may not have. Re-sweep those repositories to correct it. This is unverified, not verified-clean.` }] : []),
      ],
    },
    components,
  };
  doc.serialNumber = contentUUID(stableStringify({ p: product.id, v: product.version, c: components.map(componentKey) }));
  return { doc, dropped };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const only = flag('--product');
  const paths = resolvePaths();
  // An explicit override (--sweep / CW_SWEEP_DIR) is the operator's choice and applies to every
  // product. With no override, `globalSweep` is ONLY the last-resort fallback (see the per-product
  // resolution below), and it decides the "nothing to work with at all" gate.
  const override = flag('--sweep') || process.env.CW_SWEEP_DIR || null;
  const globalSweep = override || latestSweepDir(paths.reportsRoot);
  if (!globalSweep || !existsSync(globalSweep)) {
    console.error('no sweep batch found — run a sweep first (node monitor/sweep.mjs all) or pass --sweep <dir>');
    process.exit(2);
  }
  const at = nowISO();
  const { products, manufacturer } = loadProducts(paths.products);
  for (const product of products) {
    if (only && product.id !== only) continue;
    // Resolve the sweep batch PER PRODUCT: with no --sweep/CW_SWEEP_DIR, the newest batch on disk
    // can be a single-repo run for an unrelated project, and reading it for every product would
    // report "no per-repo SBOMs" for all the others. Falls back to `globalSweep` only when no batch
    // declares any of this product's repos in scope.
    const sweepDir = (!override && latestSweepDir(paths.reportsRoot, { repos: product.repos || [] })) || globalSweep;
    const available = new Set(readdirSync(sweepDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    const repoSboms = [];
    const missing = [];
    for (const repo of product.repos || []) {
      const f = available.has(repo) && repoSbomFile(sweepDir, repo);
      if (f) repoSboms.push({ repo, doc: loadJSON(f, null), provenance: repoProvenanceState(sweepDir, repo) });
      else missing.push(repo);
    }
    if (!repoSboms.length) {
      console.error(`  ✗ ${product.id}: no per-repo SBOMs in ${sweepDir} (repos: ${(product.repos || []).join(', ')})`);
      continue;
    }
    const { doc, dropped } = mergeProductSbom(product, manufacturer, repoSboms, at);
    const out = join(paths.out, 'sbom', `${product.id}-${product.version}.cdx.json`);
    writeJSONAtomic(out, doc);
    const spdxOut = join(paths.out, 'sbom', `${product.id}-${product.version}.spdx.json`);
    writeJSONAtomic(spdxOut, cdxToSpdx(doc));
    console.log(`  ✓ ${product.id}: ${doc.components.length} components from ${repoSboms.length} repo(s) (sweep ${basename(sweepDir)})` +
      (dropped ? ` (${dropped} vendored dropped)` : '') +
      (missing.length ? ` — MISSING SBOMs: ${missing.join(', ')} (coverage gap, not silence)` : '') +
      (() => { const u = repoSboms.filter((r) => r.provenance === 'unenriched').map((r) => r.repo);
        return u.length ? ` — PROVENANCE UNCORRECTED for ${u.join(', ')}: git-sourced components still carry a registry purl (re-sweep to fix)` : ''; })() +
      ` → ${out} (+ ${basename(spdxOut)})`);
  }
}
