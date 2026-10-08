#!/usr/bin/env node
// monitor/lane-reach.mjs — did the dependency lane READ the manifests that exist?
//
// THE DEPENDENCY-AXIS TWIN OF codeql-coverage. coverage-manifest says "this ecosystem maps to
// these lanes"; the gate says "this repo fires the lane"; NOTHING verified the lane consumed THIS
// file. The measured hole this closes: a pyproject-only repo fires deps-reachability and not
// deps-osv; a conanfile.txt-only repo fires deps-osv and the scanner extracts nothing from it
// (probed 2026-08-26 — exit 128, no scanned line). Both were accidents someone had to grep for;
// each is now a published grey with the file's own name on it.
//
// V1 READS ONE LANE'S CONSUMPTION, on the clippy rule that a parser is written against real
// output or not at all. osv-scanner's log names every file it extracted — "Scanned <path> file
// and found N package(s)" — and that shape was probed live against the image the sweep pulls
// (2.5.1). trivy (deps-jvm) and dep-scan (deps-reachability) presumably record their own
// consumption somewhere; nobody here has read a real artifact to find out, so those lanes are
// DECLARED unread below rather than half-parsed. Extending this module = probing their output
// first, then adding a reader beside readOsvConsumption.
//
// THREE SOURCES, NO SHARED WRITER — the second witness is the join itself:
//   the disk census        what marker files exist (this module's walk)
//   the gate declaration   what deps-osv's appliesIfExists says fires (the manifest, read at
//                          call time — CW_BASELINE_MANIFEST overrides for tests)
//   the lane's own log     what the tool says it extracted (written by osv-scanner, not by us)
// A file present + gate-fired + log-silent is `consumed: false` — the lane ran and did not read
// it. A file present with NO log is `consumed: null` (unknown 'absent') — the lane has not run
// here, which is not the same claim. Never red: this lens describes OUR coverage.
//
// usage: node monitor/lane-reach.mjs [--json] [--area <slug>]
// writes: <out>/<area>/lane-reach.json. CW_NOW pins `generated`; CW_REGISTRY/CW_MONITOR_OUT/
// CW_BASELINE_MANIFEST isolate tests completely (all read at call time).

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { loadRegistry } from './registry.mjs';
import { resolveRepos } from './discover.mjs';
import { outDirFor, reportsRootDir } from './area.mjs';
import { claim, render } from './denominator.mjs';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

// Mirrors coverage-manifest / surface-census — one tree, three axes (asserted in the test).
export const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'vendor', '_fresh',
  '.next', 'coverage', '.venv', 'venv', '__pycache__', 'reports', 'reference']);
export const MAX_DEPTH = 5;

const LANE = 'deps-osv';

// Lanes this module KNOWS it cannot verify yet, published every run so the partial coverage
// cannot read as the whole answer.
export const LANES_UNREAD = Object.freeze({
  'deps-jvm': 'trivy\'s log format has not been probed against real output — consumption unverifiable until it is',
  'deps-reachability': 'dep-scan\'s log format has not been probed against real output — consumption unverifiable until it is',
});

/** deps-osv's gate markers, read from the manifest at CALL time (a module-load const would defeat
 *  CW_BASELINE_MANIFEST for any test setting it afterwards). */
export function gateMarkers({ path = process.env.CW_BASELINE_MANIFEST
  || join(CW, 'manifests', 'security-baseline.json') } = {}) {
  let checks = [];
  try { checks = JSON.parse(readFileSync(path, 'utf8')).checks || []; } catch { return null; }
  const c = checks.find((x) => x && x.id === LANE);
  return c && Array.isArray(c.appliesIfExists) ? c.appliesIfExists : null;
}

/** Marker files of the gate's vocabulary present in a tree, repo-relative. */
export function walkMarkers(root, markers) {
  const names = new Set(markers.filter((m) => !m.includes('/')));
  const found = [];
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, d] = stack.pop();
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && names.has(e.name)) found.push(relative(root, join(dir, e.name)));
      if (e.isDirectory() && !SKIP.has(e.name) && d < MAX_DEPTH) stack.push([join(dir, e.name), d + 1]);
    }
  }
  // Pathed markers (gradle/libs.versions.toml) are checked literally, the gate's own semantics.
  for (const m of markers.filter((m) => m.includes('/'))) {
    if (existsSync(join(root, m))) found.push(m);
  }
  return found.sort();
}

// The line osv-scanner 2.5.1 writes per extracted file — probed live, not read off a doc page.
const SCANNED_RE = /Scanned (\S+?) file and found \d+ package/g;

/** The repo-relative paths an osv.log says were extracted. The scan mounts the repo at /src, so
 *  that container prefix is stripped; a log with no scanned lines returns an empty set, which is
 *  a real "nothing consumed" — distinguished from a missing log by the caller. */
export function readOsvConsumption(logText) {
  const out = new Set();
  for (const m of String(logText).matchAll(SCANNED_RE)) {
    out.add(m[1].replace(/^\/src\//, ''));
  }
  return out;
}

/**
 * The join, pure. @param markers repo-relative marker files present on disk
 * @param gate the gate's marker vocabulary  @param consumed Set from readOsvConsumption, or null
 * when no log exists for this repo.
 */
export function reachRows(markers, gate, consumed) {
  const gateNames = new Set(gate);
  return markers.map((path) => {
    const base = path.includes('/') && gateNames.has(path) ? path : path.split('/').pop();
    const gateFired = gateNames.has(base) || gateNames.has(path);
    const row = { manifestPath: path, lane: LANE, present: true, gateFired, laneRan: consumed !== null };
    if (consumed === null) return { ...row, consumed: null, ...unknown('absent', 'no osv.log recorded for this repo — the lane has not run here, which is not the same as declining this file') };
    return { ...row, consumed: consumed.has(path) };
  });
}

/** The newest osv.log written about repoName — findSbom's rule: the path must NAME the repo. */
export function findOsvLog(reportsDir, repoName) {
  let batches = [];
  try { batches = readdirSync(reportsDir); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
  const hits = [];
  for (const b of batches.sort()) {
    const p = join(reportsDir, b, repoName, 'osv.log');
    if (existsSync(p)) hits.push(p);
  }
  return hits.length ? hits[hits.length - 1] : null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const areaArg = args.includes('--area') ? args[args.indexOf('--area') + 1] : null;
  const reg = loadRegistry();
  const { repos } = resolveRepos(reg, { selfRoot: null });
  const root = reportsRootDir(reg);
  const gate = gateMarkers();
  if (!gate) { console.error('lane-reach: deps-osv appliesIfExists unreadable — refusing to census against a guessed gate'); process.exit(2); }

  const nowIso = process.env.CW_NOW || new Date().toISOString();
  const byArea = new Map();
  for (const r of repos) {
    const area = r.area || r.name;
    if (areaArg && area !== areaArg) continue;
    if (!existsSync(r.path)) continue;
    const markers = walkMarkers(r.path, gate);
    if (!markers.length) continue;
    const logPath = findOsvLog(root, r.name);
    let consumed = null;
    if (logPath) {
      try { consumed = readOsvConsumption(readFileSync(logPath, 'utf8')); } catch { consumed = null; }
    }
    const rows = reachRows(markers, gate, consumed);
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push({
      repo: r.name,
      rows,
      claim: claim({
        count: rows.filter((x) => x.consumed === true).length,
        observed: rows.filter((x) => x.consumed !== null).length,
        population: rows.length,
        undetermined: rows.filter((x) => x.consumed === null).length,
        unit: 'manifest file', of: 'present dependency manifest the lane demonstrably read',
      }),
    });
  }

  if (areaArg && !byArea.size) {
    console.error(`lane-reach: --area '${areaArg}' matched none of the ${repos.length} resolved repos — refused rather than reported empty.`);
    process.exit(2);
  }

  let fleetRows = 0, fleetRead = 0, fleetUnknown = 0;
  for (const [area, entries] of [...byArea.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    for (const e of entries) {
      fleetRows += e.rows.length;
      fleetRead += e.rows.filter((x) => x.consumed === true).length;
      fleetUnknown += e.rows.filter((x) => x.consumed === null).length;
    }
    const out = {
      generated: nowIso,
      note: 'Per manifest file: present on disk vs gate-fired vs demonstrably consumed by deps-osv (its own log names every extracted file). consumed:false with gateFired:true is the lane running past a file it cannot read — the conanfile.txt/deno.lock shape. Lanes whose consumption format has not been probed are in lanesUnread, never silently omitted.',
      area,
      lanesUnread: LANES_UNREAD,
      repos: entries,
    };
    let dir;
    try { dir = outDirFor(area, reg); } catch { dir = null; }
    if (!dir || typeof dir !== 'string') dir = join(root, area);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, 'lane-reach.json'), JSON.stringify(out, null, 1) + '\n');
  }

  const fleet = claim({ count: fleetRead, observed: fleetRows - fleetUnknown, population: fleetRows,
    undetermined: fleetUnknown, unit: 'manifest file', of: 'present dependency manifest the lane demonstrably read' });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ generated: nowIso, fleet, areas: [...byArea.keys()].sort(), lanesUnread: LANES_UNREAD }, null, 1));
    return;
  }
  console.log(`lane-reach: ${render(fleet)} · ${byArea.size} area(s) · ${Object.keys(LANES_UNREAD).length} lane(s) unverifiable (declared)`);
}

if (isMain) main();
