#!/usr/bin/env node
// cra/preflight.mjs — "is the CRA module configured to actually work?"
//
// The commonest failure mode of this module is silent: products.json is still the seeded
// placeholder (market.eu=false everywhere, manufacturer=TODO), so the watch runs green: every
// case it opens runs on the bestpractice track and nothing reaches article14 — looking healthy
// while reporting to nobody. Preflight makes that loud, and
// cross-checks the mapping against reality (the live rollup) and the freshness of the inputs
// the evidence is built from.
//
//   node cra/preflight.mjs [--json]
//
// Exit: 0 = ready (advisories allowed) · 1 = hard config error · (advisories never fail).
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  loadJSON, resolvePaths, validateProducts, openFindings, kevSet, epssFor,
  nowISO, hoursSince, latestSweepDir, resolveEvidenceForRepos, kevFreshness, epssFreshness,
} from './lib.mjs';
import { resolveInto } from '../lib/secrets.mjs';

const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s);

export function preflight(paths, at = nowISO()) {
  const errors = [], advisories = [], info = [];

  if (!existsSync(paths.products)) {
    return { ready: false, errors: [`products.json not found at ${paths.products} — the CRA module is not configured; `
      + 'start from cra/products.example.json or the panel\'s CRA wizard'], advisories, info };
  }
  const productsDoc = loadJSON(paths.products, null);
  const v = validateProducts(productsDoc);
  errors.push(...v.errors);
  advisories.push(...v.advisories);
  if (v.errors.length) return { ready: false, errors, advisories, info };

  const products = productsDoc.products;
  info.push(`${products.length} product(s), ${products.filter((p) => p.market?.eu).length} on the EU market`);

  // R2: an EU-market product's overdue Art. 14 clock must be able to PAGE someone. If any product is
  // on the EU market but CRA_WEBHOOK_URL does not resolve, cra/escalate.mjs would exit 5 with no one
  // notified — a hard config gap, not an advisory (explicit uncertainty: a silent, un-pageable clock).
  const euProducts = products.filter((p) => p.market?.eu);
  if (euProducts.length && !resolveInto(['CRA_WEBHOOK_URL'], {}).env.CRA_WEBHOOK_URL) {
    errors.push(`${euProducts.length} product(s) on the EU market but CRA_WEBHOOK_URL is not resolvable — an overdue Art. 14 clock (cra/escalate.mjs) could page no one. Set it: node bin/secrets.mjs set CRA_WEBHOOK_URL`);
  }

  // R22 fix 1: a product's repos are not guaranteed to live in the SAME area as paths.rollup
  // (the single "ambient" default) — resolve every product's repos across whichever area(s)
  // they actually declare, and merge. A repo whose product lives elsewhere is no longer
  // reported as "never scanned" just because it is absent from the one directory this used to
  // look in exclusively. `hasRegistry` gates the per-area breakdown below on there being an
  // actual area model to route through — a bare `paths` object with no `.projects` (own-name
  // fallback for every repo) has nothing new to say beyond what the ambient rollup already says.
  const allRepos = [...new Set(products.flatMap((p) => p.repos || []))];
  const evidence = resolveEvidenceForRepos(allRepos, paths);
  const hasRegistry = !!(paths.projects && (Array.isArray(paths.projects.areas) || Array.isArray(paths.projects.projects)));

  // Cross-check the mapping against the live rollup: unknown repos (mapped but never scanned)
  // and orphan repos (scanned but mapped to no product) are both coverage holes.
  const rollup = loadJSON(paths.rollup, null);
  if (!rollup) {
    advisories.push(`no rollup at ${paths.rollup} — run a sweep so the watch has findings to join`);
  } else {
    const scanned = new Set((rollup.repos || []).map((r) => r.name));
    // found via a NON-ambient area's own rollup — still evidenced, just not in this directory.
    const scannedAnywhere = new Set([...scanned, ...evidence.rollup.repos.map((r) => r.name)]);
    const mapped = new Set();
    for (const p of products) for (const r of p.repos || []) {
      mapped.add(r);
      if (!scannedAnywhere.has(r)) advisories.push(`product '${p.id}': repo '${r}' is not in the latest rollup (never scanned, or renamed)`);
    }
    const orphans = [...scanned].filter((r) => !mapped.has(r));
    if (orphans.length) advisories.push(`${orphans.length} scanned repo(s) mapped to no product: ${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? '…' : ''}`);
    // Freshness of the merged view is the OLDEST contributing slice (ambient rollup + every
    // other area a product's repos resolve to) — evidence is only as fresh as its stalest source.
    const oldestGenerated = [rollup.generated, evidence.rollup.generated].filter(Boolean).sort()[0] || null;
    const age = oldestGenerated ? hoursSince(oldestGenerated, at) : Infinity;
    const maxH = Number(process.env.CRA_STALE_HOURS || 26);
    if (age > maxH) errors.push(`rollup slice ${rollup.sliceId || ''} is ${oldestGenerated ? Math.round(age) + 'h' : 'missing a timestamp'} old (> ${maxH}h) — evidence is stale`);
    else info.push(`rollup slice ${rollup.sliceId} is ${Math.round(age)}h old (fresh)`);

    // Would anything actually trigger right now? (dry preview of the watch join, over the
    // ambient rollup's repos UNION every other area's repos a product actually maps to.)
    const kev = kevSet(loadJSON(paths.kev, {}));
    const epss = loadJSON(paths.epss, {});
    const byRepo = new Map();
    for (const p of products) for (const r of p.repos || []) {
      if (!byRepo.has(r)) byRepo.set(r, []);
      byRepo.get(r).push(p);
    }
    const mergedRepos = [...(rollup.repos || [])];
    const haveNames = new Set(mergedRepos.map((r) => r.name));
    for (const r of evidence.rollup.repos) if (!haveNames.has(r.name)) { mergedRepos.push(r); haveNames.add(r.name); }
    // cra/watch.mjs has NO market gate: a trigger opens a case on every product its repo maps to,
    // and market.eu / reporting.locale only pick the track. "No case would be created" is therefore
    // a statement about mapped triggers; the EU-scoped count is reported beside it, not instead.
    let euTriggers = 0, mappedTriggers = 0;
    for (const f of openFindings({ repos: mergedRepos })) {
      if (!f.id) continue;
      const score = typeof f.epss === 'number' ? f.epss : epssFor(epss, f.id);
      const trig = f.kev === true || kev.has(f.id) || (score != null && score >= Number(process.env.CRA_EPSS_THRESHOLD || 0.5));
      const prods = byRepo.get(f.repo) || [];
      if (trig && prods.length) mappedTriggers++;
      if (trig && prods.some((p) => p.market?.eu)) euTriggers++;
    }
    info.push(`current EU-scoped triggers: ${euTriggers} · KEV/EPSS triggers on any mapped product: ${mappedTriggers}${mappedTriggers === 0 ? ' (no KEV/EPSS case would be created right now)' : ''}`);
  }

  // Per-area breakdown: every area a product's repos resolve to OTHER than the ambient one —
  // the old single-directory resolution could never see these at all. Skips the ambient area's
  // own directory (already reported above, whether present or absent) to avoid saying the same
  // thing twice.
  if (hasRegistry) {
    for (const a of evidence.areas) {
      if (a.rollupPath === paths.rollup) continue;
      if (!a.hasRollup) advisories.push(`area '${a.area}' (repo(s): ${a.repos.join(', ')}) has no rollup yet at ${a.rollupPath} — never evidenced (run a sweep for this area)`);
      else info.push(`area '${a.area}': ${a.found.length}/${a.repos.length} repo(s) evidenced from its own rollup (slice ${a.sliceId || '?'}, ${a.generated ? Math.round(hoursSince(a.generated, at)) + 'h old' : 'no timestamp'})${a.missing.length ? `; not in it: ${a.missing.join(', ')}` : ''}`);
    }
  }

  // Input freshness for the SBOM builder (needs the latest sweep's per-repo SBOMs).
  const sweep = latestSweepDir(paths.reportsRoot);
  if (!sweep) advisories.push('no sweep batch under reports/ — cra/sbom.mjs has no per-repo SBOMs to merge yet');
  else info.push(`latest sweep batch: ${sweep.split('/').pop()}`);

  // R22 fix 2: "the newest sweep on disk" and "the newest sweep OF THIS PRODUCT" are different
  // questions — per product, so a product whose repos were last scanned in an OLDER batch than
  // whatever else happens to be newest on the machine is never silently pointed at the wrong one.
  for (const p of products) {
    const productSweep = latestSweepDir(paths.reportsRoot, { repos: p.repos || [] });
    if (!productSweep) {
      advisories.push(`product '${p.id}': no sweep batch under ${paths.reportsRoot} covers any of its repos (${(p.repos || []).join(', ')}) — cra/sbom.mjs would find nothing for it`);
    } else if (sweep && productSweep !== sweep) {
      info.push(`product '${p.id}': latest sweep covering its repos is ${basename(productSweep)} (the newest sweep on disk, ${basename(sweep)}, does not cover it)`);
    } else {
      info.push(`product '${p.id}': latest sweep covering its repos is ${basename(productSweep)}`);
    }
  }

  // KEV/EPSS input freshness — content-based (R21/C5's fix, mirrored here rather than a third
  // mtime-based check): KEV's catalogVersion/dateReleased is the truth, never this file's mtime
  // (a git-tracked-then-untracked cache's mtime says when it was WRITTEN, not what is in it).
  // EPSS carries no comparable field at all, so its freshness is honestly 'unknown', not guessed.
  if (!existsSync(paths.kev)) {
    advisories.push(`KEV catalog missing (${paths.kev}) — run the watch with CRA_FETCH=1 to populate it`);
  } else {
    const kf = kevFreshness(paths, at);
    if (kf.state === 'stale') advisories.push(`KEV catalogue is ${kf.ageDays}d stale (catalogVersion ${kf.catalogVersion || '?'}, released ${kf.dateReleased || '?'}, > ${kf.maxDays}d) — refresh: CRA_FETCH=1 node cra/watch.mjs`);
    else if (kf.state === 'unknown') advisories.push(`KEV catalogue freshness unknown (${kf.reason || `${paths.kev} has no dateReleased/catalogVersion to read`}) — cannot tell how current it is`);
    else info.push(`KEV catalogue fresh: catalogVersion ${kf.catalogVersion || '?'}, ${kf.ageDays}d old (≤ ${kf.maxDays}d)`);
  }
  if (!existsSync(paths.epss)) {
    // EPSS is populated by monitor/rollup.mjs's enrichment pass, NOT the watch (the watch only
    // refreshes KEV) — the old advisory text pointed at the wrong remedy.
    advisories.push(`EPSS store missing (${paths.epss}) — populated by monitor/rollup.mjs's enrichment during a sweep, not by the watch`);
  } else {
    const ef = epssFreshness(paths);
    info.push(`EPSS store freshness: ${ef.state} — ${ef.reason}`);
  }

  return { ready: errors.length === 0, errors, advisories, info };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const paths = resolvePaths();
  const r = preflight(paths);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ready ? 0 : 1); }
  console.log(bold('cra preflight'));
  for (const i of r.info) console.log(dim(`  · ${i}`));
  for (const a of r.advisories) console.log(yel(`  ⚠ ${a}`));
  for (const e of r.errors) console.log(red(`  ✗ ${e}`));
  console.log(r.ready ? grn('  ✓ ready') + dim(r.advisories.length ? ` (${r.advisories.length} advisory)` : '') : red('  ✗ not ready — fix the errors above'));
  process.exit(r.ready ? 0 : 1);
}
