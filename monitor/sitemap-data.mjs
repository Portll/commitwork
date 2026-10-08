#!/usr/bin/env node
// commitwork sitemap — S2 full-fleet generator: one sitemap manifest per resolved area for the
// :7878 SiteMap tab. Targets derive from the registry's own resolver, never a parallel one.
//
//   node monitor/sitemap-data.mjs [project-slug ...]     (default: all resolved areas)
//
// Output: sitemap/data/<slug>.sitemap.json (schema/sitemap.schema.json v1); <slug> is the AREA slug.
import { readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { createHarvest } from '../sitemap/harvest.mjs';
import { attachOverlays } from './sitemap-overlays.mjs';
import { registry, reportsRootDir } from './area.mjs';
import { areaOf, repoArea, areaRepos, allAreas } from './registry.mjs';
import { expandHome, resolveRepos } from './discover.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// Registry paths are ~-relative — expand them like every other consumer
const entryDir = (p) => resolve(expandHome(p.path));

// effectiveFrom/effectiveTo gating — same rule as serve.mjs SUPERSEDED
const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
export function lifecycleOf(name, reg) {
  if (new Set(reg.exclude || []).has(name)) return { lifecycle: 'retired' };
  const l = (reg.lifecycle || {})[name];
  if (l && l.state === 'superseded' && (!l.effectiveFrom || nowStamp() >= l.effectiveFrom) && (!l.effectiveTo || nowStamp() < l.effectiveTo))
    return { lifecycle: 'superseded', supersededBy: l.supersededBy || null };
  return { lifecycle: 'active' };
}

const isBakName = (n) => /\.pre-|-bak$|^_/.test(n);
const hasCompose = (dir) => { try { return readdirSync(dir).some((f) => f.startsWith('docker-compose') && f.endsWith('.yml')); } catch { return false; } };

// Honour the repo's OWN gitignore — a harvest describes the product, not scan output parked in it.
// entries:null means git could not answer; the caller prints the unfiltered-walk fallback.
export function gitIgnoredUnder(dir) {
  try {
    // a fleet repo: plain ls-files runs its fsmonitor
    const out = scannedGitOut(dir, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { maxBuffer: 64 * 1024 * 1024 });
    return { entries: out.split('\0').filter(Boolean).map((e) => e.replace(/\/$/, '')), reason: null };
  } catch (e) {
    const msg = String((e.stderr || e.message || 'git failed')).trim().split('\n')[0];
    return { entries: null, reason: msg };
  }
}

function ignoreFor(dir, projectSlug, name) {
  const r = gitIgnoredUnder(dir);
  if (r.entries === null) {
    console.error(`sitemap-data: ${projectSlug}: ${name}: gitignore rules unavailable (${r.reason}) — walking UNFILTERED; generated trees may inflate this manifest`);
    return null;
  }
  return r.entries.length ? r.entries : null;
}

// Harvest one area (explicit entry + riders + discovered checkouts) into a manifest stamped with
// `projectSlug`. Returns null (and prints why) rather than an empty manifest — empty reads as "no code".
export function buildEntry(entry, riders, projectSlug, discovered, reg) {
  // the compose topology lives in whichever rider holds the docker-compose files
  const riderDirs = riders.map(entryDir).filter((d) => existsSync(d));
  const h = createHarvest({ buildoutDir: riderDirs.find(hasCompose) || riderDirs[0] || null });
  const services = [];
  if (entry) {
    const root = entryDir(entry);
    if (!existsSync(root)) {
      console.error(`sitemap-data: ${projectSlug}: declared path missing — ${entry.path} (${root}); nothing harvested from it`);
      // an area that was ONLY this entry emits nothing at all
      if (!discovered.length && !riderDirs.length) return null;
    } else if (entry.expand === 'children') {
      const label = basename(root); // 'services' | 'libs' — the path label the panel shows per service
      const dirs = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !isBakName(e.name))
        .map((e) => e.name).sort();
      let i = 0;
      for (const name of dirs) {
        const lc = lifecycleOf(name, reg);
        console.log(`sitemap-data: (${++i}/${dirs.length}) ${name}${lc.lifecycle !== 'active' ? ' · ' + lc.lifecycle : ''}`);
        const dir = join(root, name);
        services.push(h.service(dir, name, { ...lc, pathLabel: `${label}/${name}`, exclude: ignoreFor(dir, projectSlug, name) }));
      }
    } else {
      console.log(`sitemap-data: ${projectSlug} (single-repo entry ${entry.name})`);
      services.push(h.service(root, basename(root), { pathLabel: '.', exclude: ignoreFor(root, projectSlug, entry.name) }));
    }
  }
  for (const rider of riders) {
    const rd = entryDir(rider);
    if (!existsSync(rd)) { console.error(`sitemap-data: ${projectSlug}: rider path missing — ${rider.path} (${rd}); its services are ABSENT, not empty`); continue; }
    const name = basename(rd);
    console.log(`sitemap-data: (+) ${name} · infra`);
    services.push(h.service(rd, name, { kind: 'infra', pathLabel: name, exclude: ignoreFor(rd, projectSlug, name) }));
  }
  // Discovered checkouts: one service each, lifecycle-gated, sorted for determinism; a vanished
  // checkout prints ABSENT, never a silently shorter manifest.
  const solo = !entry && !riders.length && discovered.length === 1; // a standalone repo is its own root
  for (const r of [...discovered].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!existsSync(r.path)) { console.error(`sitemap-data: ${projectSlug}: resolved checkout missing — ${r.path}; its services are ABSENT, not empty`); continue; }
    const lc = lifecycleOf(r.name, reg);
    console.log(`sitemap-data: (+) ${r.name}${lc.lifecycle !== 'active' ? ' · ' + lc.lifecycle : ''}`);
    services.push(h.service(r.path, r.name, { ...lc, pathLabel: solo ? '.' : r.name, exclude: ignoreFor(r.path, projectSlug, r.name) }));
  }
  if (!services.length) { console.error(`sitemap-data: ${projectSlug}: no services harvested${entry ? ` under ${entryDir(entry)}` : ''}`); return null; }
  return h.manifest(services, { project: projectSlug, tool: 'monitor/sitemap-data.mjs' });
}

// registry + the sweep's own resolved-repo universe -> { targets, skips }, grouped by DECLARED
// area. `repos` is injected so this cannot disagree with what is scanned; every skip carries its reason.
export function buildTargets(reg, repos) {
  const skips = [];
  const byArea = new Map(); // area slug -> { entries: [explicit projects[]], discovered: [resolved repos] }
  const claim = (slug) => { if (!byArea.has(slug)) byArea.set(slug, { entries: [], discovered: [] }); return byArea.get(slug); };
  for (const p of reg.projects || []) {
    const slug = areaOf(p.name, reg);
    if (!slug) { skips.push({ slug: p.name, reason: 'resolves to no usable area slug — declare "area" on the entry' }); continue; }
    claim(slug).entries.push(p);
  }
  for (const r of repos) {
    if (r.source === 'explicit') continue; // explicit entries (and their expanded children) are claimed above
    const slug = repoArea(r, reg);
    if (!slug) { skips.push({ slug: r.name, reason: `discovered at ${r.path} but resolves to no usable area slug (name is not a clean slug and no areas[] block claims it)` }); continue; }
    claim(slug).discovered.push(r);
  }
  const targets = [];
  for (const [slug, { entries, discovered }] of byArea) {
    const fleet = entries.find((e) => e.expand === 'children') || entries[0] || null;
    const riders = entries.filter((e) => e !== fleet && e.expand !== 'children');
    targets.push({ slug, area: slug, build: () => buildEntry(fleet, riders, slug, discovered, reg) });
    // a second children-expanding entry keeps its own manifest, scoped to the same area
    for (const e of entries.filter((x) => x !== fleet && x.expand === 'children')) {
      const s = e.name.toLowerCase();
      targets.push({ slug: s, area: slug, build: () => buildEntry(e, [], s, [], reg) });
    }
  }
  // a declared area that NOTHING resolves into is a loud skip, never an empty manifest
  for (const slug of allAreas(reg)) {
    if (byArea.has(slug)) continue;
    skips.push({ slug, reason: areaRepos(slug, reg, { repos }).reason });
  }
  targets.sort((a, b) => a.slug.localeCompare(b.slug));
  skips.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  return { targets, skips };
}

function main() {
  const REG = registry();
  const REPORTS_DIR = reportsRootDir(REG); // v2 overlay source root (declared reportsRoot, not a literal)
  // Env read at CALL time (house rule); selfRoot mirrors sweep.mjs — never auto-discover self
  const OUT_DIR = process.env.CW_SITEMAP_OUT ? resolve(process.env.CW_SITEMAP_OUT) : join(CW, 'sitemap', 'data');
  const { targets: all, skips } = buildTargets(REG, resolveRepos(REG, { selfRoot: CW }).repos);
  for (const s of skips) console.error(`sitemap-data: SKIP ${s.slug} — ${s.reason}`);
  const want = process.argv.slice(2);
  const targets = all.filter((t) => !want.length || want.includes(t.slug));
  if (want.length && !targets.length) {
    console.error(`sitemap-data: no target matches ${want.join(', ')} — known: ${all.map((t) => t.slug).join(', ')}`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const t of targets) {
    const m = t.build();
    if (!m) continue;
    // v2 overlays read this target's OWN area under reports/; absence of a field means no artifact,
    // and the reason is printed below
    const ov = attachOverlays(m, { reportsDir: REPORTS_DIR, project: t.slug, area: t.area, reg: REG });
    const out = join(OUT_DIR, `${t.slug}.sitemap.json`);
    const json = JSON.stringify(m, null, 1) + '\n';
    // Size guard — REFUSED, not truncated: a truncated code map silently lies about what exists
    const maxBytes = Number(process.env.CW_SITEMAP_MAX_BYTES) > 0 ? Number(process.env.CW_SITEMAP_MAX_BYTES) : 64 * 1024 * 1024;
    const bytes = Buffer.byteLength(json);
    if (bytes > maxBytes) {
      console.error(`sitemap-data: ${t.slug}: manifest is ${bytes} bytes — exceeds the ${maxBytes}-byte cap (CW_SITEMAP_MAX_BYTES); REFUSED, nothing written for this target. An oversize manifest usually means the walk swallowed generated trees — check the gitignored-excluded count and any UNFILTERED warnings above.`);
      process.exitCode = 1;
      continue;
    }
    writeFileSync(out, json);
    const p = m.provenance.files;
    const lc = m.services.reduce((a, s) => (a[s.lifecycle || 'active'] = (a[s.lifecycle || 'active'] || 0) + 1, a), {});
    const wiringEdges = m.services.reduce((n, s) => n + (s.wiring ? s.wiring.length : 0), 0);
    const fileWiringEdges = m.services.reduce((n, s) => n + (s.fileWiring ? s.fileWiring.length : 0), 0);
    console.log(`sitemap-data: ${t.slug} -> ${m.services.length} services (${Object.entries(lc).map(([k, v]) => `${v} ${k}`).join(' · ')}) · ${p.scanned} files (${p.symbolled} symbolled / ${p.inventoryOnly} inventory / ${p.void} void) · ${p.excluded || 0} gitignored entr(ies) excluded · ${m.externalLinks.length} links · ${Math.round(statSync(out).size / 1024)}KB -> ${out.replace(CW + '/', '')}`);
    // Every overlay says what it did OR why it did nothing
    const said = (s, ran) => (s.scanned ? ran(s) : `NOT SCANNED (${s.reason || s.skipped || 'no reason given'})`);
    console.log(`sitemap-data: ${t.slug} v2 [area ${t.area}] -> wiring ${wiringEdges} · fileWiring ${fileWiringEdges} · airBridges ${ov.stats.airBridges} · vulns ${ov.stats.vulns}`
      + ` · trivy ${said(ov.stats.trivy, (s) => `${s.images} imgs from ${s.tag}${s.scope === 'global' ? ' (registry-global image set — no area dimension)' : ''}${s.unattributed ? ` · ${s.unattributed} finding(s) unattributed to any service here` : ''}`)}`
      + ` · races ${said(ov.stats.races, (s) => `${s.mapped} mapped / ${s.unmapped} unmapped from ${s.tag}`)}`
      + ` · authz ${said(ov.stats.authz, (s) => `${s.filesRead} file(s) from ${s.tag}${s.scope === 'unknown' ? ' (UNKNOWN SCOPE — batch predates area recording)' : ''} · ${s.pinned} pinned / ${s.serviceScoped} service-scoped / ${s.unmatched} unmatched`)}`
      + `${ov.stats.droppedVulns ? ' · dropped ' + ov.stats.droppedVulns : ''}${m.truncation ? ' · TRUNCATION present' : ''}`);
  }
}

if (isMainModule(import.meta.url)) main();
