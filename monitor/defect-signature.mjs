// monitor/defect-signature.mjs — a detector that fires on almost every repository it sees is
// describing itself, not the fleet.
//
// TruffleHog's Lob detector produced 1,311 of 1,314 published CRITICALs from one upstream defect;
// Prowler asserted 1,067 FAILs about a field GitHub never returned to the credential that ran.
// Each read as a fleet in crisis because the per-row severity was correct in form and nobody
// computed the one number that gives it away: positives over repositories scanned, per detector.
//
// This computes that number and publishes it in its own per-detector artifact. It changes no
// severity and no verdict, and it is fed to the lane band (monitor/lane-confidence.mjs) as a
// boolean field, never as a weight. `rate` and `population` are fields a reader can check; nothing
// here multiplies them into anything.
//
// The population floor is fleet-wide. A rollup is per area, and on the live fleet an area holds one
// or two repositories, so no per-area artifact can reach the floor: 19 areas had written one on
// 2026-10-18 and every `signatures` list was empty while the same cspm control sat at rate 1 in
// every one of them. `--fleet` pools every declared area's artifact at the reports root, where the
// lane band reads it.
//
// usage: node monitor/defect-signature.mjs --fleet [--json] [--no-write]
// exit: 0 pooled · 1 a per-area artifact exists and could not be read, or the registry failed to load · 2 usage
// env, read at call time: CW_REGISTRY (registry, and through it the reports root), CW_DEFECT_SIGNATURES_OUT
//      (fleet artifact path, default <reportsRoot>/defect-signatures.json), CW_DEFECT_SIGNATURE_RATE,
//      CW_DEFECT_SIGNATURE_MIN_REPOS, CW_NOW (the `at` stamp)
// output: the fleet artifact via writeAtomic; --json prints it and writes nothing; --no-write prints
//      the headline and writes nothing

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROW_SCHEMAS } from './detail-schema.mjs';
import { reportsRootDir } from './area.mjs';
import { loadRegistry, registryPath, isExampleRegistry } from './registry.mjs';
import { writeAtomic } from './lockfile.mjs';
import { nowISO } from '../lib/clock.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const DEFAULT_RATE = 0.95;
export const DEFAULT_MIN_REPOS = 20;
export const FLEET_ARTIFACT = 'defect-signatures.json';

const NOTE = 'A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply.';
const AREA_NOTE = `${NOTE} The population floor is applied fleet-wide: this area alone rarely reaches it, and the pooled artifact at the reports root (node monitor/defect-signature.mjs --fleet) is the one that judges.`;

const FALLBACK_DETECTOR_FIELDS = ['rule', 'detector', 'id', 'control', 'marker', 'name'];

function envNumber(env, key, fallback, ok) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !ok(n)) throw new RangeError(`${key}=${JSON.stringify(raw)} is not a usable threshold`);
  return n;
}

/** Thresholds, read from the environment at CALL time. */
export function thresholds(env = process.env) {
  return {
    rate: envNumber(env, 'CW_DEFECT_SIGNATURE_RATE', DEFAULT_RATE, (n) => n > 0 && n <= 1),
    minRepos: envNumber(env, 'CW_DEFECT_SIGNATURE_MIN_REPOS', DEFAULT_MIN_REPOS, (n) => Number.isInteger(n) && n >= 1),
  };
}

/** The row field that names a lane's detector: the first component of its identity tuple. */
export function detectorField(lane, schemas = ROW_SCHEMAS) {
  const spec = schemas && schemas[lane];
  const first = spec && Array.isArray(spec.identity) ? spec.identity[0] : null;
  return typeof first === 'string' && first ? first : null;
}

const detectorIdOf = (row, field) => {
  for (const f of field ? [field, ...FALLBACK_DETECTOR_FIELDS] : FALLBACK_DETECTOR_FIELDS) {
    const v = row[f];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
  }
  return null;
};

/**
 * Per-detector positive rate across the sweep population.
 *
 * `repos` is the rollup's repo list (array or object); a lane's population is every repo whose
 * `scanners[lane]` exists, which is every repo the lane produced an artifact for, plus every repo
 * carrying a row in the lane — a live rollup had 71 detectors with rows for a repo whose scanners
 * entry was missing, which read as 1 of 0. `scannerFindings` is the fleet-flattened detail, every
 * row carrying `repo`. A detector is `${lane}/${id}`, id taken from the lane's identity tuple. Rows
 * with no identity are counted in `unkeyed` rather than invented a detector for.
 *
 * Returns { population: {lane: n}, detectors: [{detector, lane, id, population, positives, rate}],
 *           unkeyed: {lane: n} } with every list sorted, so the output is byte-stable.
 */
export function detectorRates({ repos, scannerFindings } = {}, { schemas = ROW_SCHEMAS } = {}) {
  const repoList = Array.isArray(repos) ? repos : Object.values(repos || {});
  const scanned = {};
  for (const r of repoList) {
    if (!r || !r.scanners || typeof r.scanners !== 'object') continue;
    for (const lane of Object.keys(r.scanners)) if (r.scanners[lane]) (scanned[lane] ||= new Set()).add(String(r.name || ''));
  }
  const positives = new Map();
  const unkeyed = {};
  for (const lane of Object.keys(scannerFindings || {}).sort()) {
    const field = detectorField(lane, schemas);
    for (const row of scannerFindings[lane] || []) {
      if (!row) continue;
      const id = detectorIdOf(row, field);
      if (id === null) { unkeyed[lane] = (unkeyed[lane] || 0) + 1; continue; }
      const detector = `${lane}/${id}`;
      if (!positives.has(detector)) positives.set(detector, { lane, id, repos: new Set() });
      positives.get(detector).repos.add(String(row.repo || ''));
      (scanned[lane] ||= new Set()).add(String(row.repo || ''));
    }
  }
  const population = {};
  for (const lane of Object.keys(scanned)) population[lane] = scanned[lane].size;
  const detectors = [];
  for (const [detector, e] of positives) {
    const pop = population[e.lane] || 0;
    const pos = e.repos.size;
    detectors.push({ detector, lane: e.lane, id: e.id, population: pop, positives: pos,
      rate: pop ? Number((pos / pop).toFixed(4)) : null });
  }
  detectors.sort((a, b) => (a.detector < b.detector ? -1 : a.detector > b.detector ? 1 : 0));
  const sortedPopulation = {};
  for (const k of Object.keys(population).sort()) sortedPopulation[k] = population[k];
  const sortedUnkeyed = {};
  for (const k of Object.keys(unkeyed).sort()) sortedUnkeyed[k] = unkeyed[k];
  return { population: sortedPopulation, detectors, unkeyed: sortedUnkeyed };
}

/**
 * The per-detector artifact. A detector carries `signature: true` when its positive rate is at or
 * above `rate` AND its population is at least `minRepos`; below the floor the rate is published
 * and not judged, because 3 of 3 says nothing about a detector.
 */
export function defectSignatures(input, { rate = thresholds().rate, minRepos = thresholds().minRepos } = {}, { at = null, schemas = ROW_SCHEMAS } = {}) {
  const rates = detectorRates(input, { schemas });
  const detectors = rates.detectors.map((d) => ({
    ...d,
    signature: d.population >= minRepos && d.population > 0 && d.positives / d.population >= rate,
  }));
  return {
    at,
    scope: 'area',
    note: AREA_NOTE,
    thresholds: { rate, minRepos },
    population: rates.population,
    detectors,
    signatures: signatureList(detectors),
    unkeyed: rates.unkeyed,
  };
}

const signatureList = (detectors) => detectors.filter((d) => d.signature)
  .map((d) => ({ detector: d.detector, lane: d.lane, rate: d.rate, population: d.population, positives: d.positives, signature: true }));

const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * Pool per-area artifacts into one fleet artifact. `perArea` is `[{ area, artifact }]`, each
 * artifact a defectSignatures() record. A detector's pooled population is its LANE's population
 * summed over every area that ran the lane, including areas where the detector never fired —
 * summing only the areas it appeared in would make a detector that fires in one repo of one area
 * read as 100%. Positives sum where it appeared. The same thresholds judge the pooled rate.
 * A malformed artifact throws, naming its area.
 */
export function poolSignatures(perArea, { rate = thresholds().rate, minRepos = thresholds().minRepos } = {}, { at = null, areas = null } = {}) {
  const population = {};
  const unkeyed = {};
  const byDetector = new Map();
  const slugs = [];
  for (const { area, artifact } of perArea || []) {
    const where = `defect-signatures for area '${area}'`;
    if (!artifact || typeof artifact !== 'object' || !artifact.population || typeof artifact.population !== 'object' || !Array.isArray(artifact.detectors)) {
      throw new Error(`${where}: not a defect-signature artifact (needs population and detectors)`);
    }
    slugs.push(String(area));
    for (const [lane, n] of Object.entries(artifact.population)) {
      if (!isCount(n)) throw new Error(`${where}: population.${lane} is not a count`);
      population[lane] = (population[lane] || 0) + n;
    }
    for (const [lane, n] of Object.entries(artifact.unkeyed || {})) {
      if (!isCount(n)) throw new Error(`${where}: unkeyed.${lane} is not a count`);
      unkeyed[lane] = (unkeyed[lane] || 0) + n;
    }
    for (const d of artifact.detectors) {
      if (!d || typeof d.detector !== 'string' || typeof d.lane !== 'string' || !isCount(d.positives)) {
        throw new Error(`${where}: a detector row lacks detector, lane or a positives count`);
      }
      const e = byDetector.get(d.detector) || { lane: d.lane, id: d.id ?? d.detector.slice(d.lane.length + 1), positives: 0 };
      e.positives += d.positives;
      byDetector.set(d.detector, e);
    }
  }
  // An artifact written before population counted row-bearing repos can carry more positives than
  // population; the pooled row is then undetermined, with both numbers kept, never a rate over 1.
  const OVER = 'positives exceed the lane population; the per-area artifact predates the row-bearing denominator';
  const detectors = [...byDetector.entries()].map(([detector, e]) => {
    const pop = population[e.lane] || 0;
    if (e.positives > pop) return { detector, lane: e.lane, id: e.id, population: pop, positives: e.positives, rate: null, signature: false, undetermined: OVER };
    return { detector, lane: e.lane, id: e.id, population: pop, positives: e.positives,
      rate: pop ? Number((e.positives / pop).toFixed(4)) : null,
      signature: pop >= minRepos && pop > 0 && e.positives / pop >= rate };
  }).sort((a, b) => (a.detector < b.detector ? -1 : a.detector > b.detector ? 1 : 0));
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const pooledFrom = [...slugs].sort();
  return {
    at,
    scope: 'fleet',
    note: `${NOTE} Pooled over every declared area's artifact; the population floor applies to this pooled population.`,
    thresholds: { rate, minRepos },
    areas: areas || { declared: pooledFrom.length, read: pooledFrom.length, absent: 0, failed: 0 },
    pooledFrom,
    population: sorted(population),
    detectors,
    signatures: signatureList(detectors),
    undetermined: detectors.filter((d) => d.undetermined).map((d) => d.detector),
    unkeyed: sorted(unkeyed),
  };
}

/** Where the fleet artifact lives: CW_DEFECT_SIGNATURES_OUT, else beside lane-trust.json at the reports root. */
export const fleetSignaturesPath = (reg) => process.env.CW_DEFECT_SIGNATURES_OUT || join(reportsRootDir(reg), FLEET_ARTIFACT);

/**
 * Every declared area's defect-signatures.json, read through the registry the way lane-trust reads
 * rollups. ENOENT is counted absent; any other failure to read or parse is collected and thrown
 * naming every area, so a torn artifact can never be pooled around.
 */
export function readAreaSignatures(reg, { root = reportsRootDir(reg) } = {}) {
  const perArea = [];
  const failed = [];
  let absent = 0;
  const areas = reg.areas || [];
  for (const area of areas) {
    const p = join(root, area.out || area.slug, FLEET_ARTIFACT);
    let raw;
    try { raw = readFileSync(p, 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') { absent += 1; continue; }
      failed.push(`${area.slug}: ${p}: ${e && e.message || e}`);
      continue;
    }
    try { perArea.push({ area: area.slug, artifact: JSON.parse(raw) }); } catch (e) {
      failed.push(`${area.slug}: ${p}: ${e && e.message || e}`);
    }
  }
  if (failed.length) throw new Error(`${failed.length} area defect-signature artifact(s) could not be read:\n  ${failed.join('\n  ')}`);
  return { perArea, areas: { declared: areas.length, read: perArea.length, absent, failed: 0 } };
}

/** Read the fleet artifact at call time. ENOENT is null; anything else throws. */
export function readFleetSignatures(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Load the registry, read every area, pool. Pure apart from the reads. */
export function gatherFleetSignatures({ at = nowISO() } = {}) {
  const path = registryPath();
  const reg = loadRegistry({ path, quiet: true });
  const { perArea, areas } = readAreaSignatures(reg);
  const artifact = poolSignatures(perArea, {}, { at, areas });
  if (isExampleRegistry(path)) artifact.registry = 'example';
  return { reg, artifact };
}

function main(argv = process.argv.slice(2)) {
  const known = new Set(['--fleet', '--json', '--no-write']);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length || !argv.includes('--fleet')) {
    console.error(`defect-signature: ${bad.length ? `unknown argument ${bad[0]}` : '--fleet is the only mode'}\nusage: node monitor/defect-signature.mjs --fleet [--json] [--no-write]`);
    process.exitCode = 2;
    return;
  }
  let gathered;
  try { gathered = gatherFleetSignatures(); } catch (e) {
    console.error(`defect-signature: ${e && e.message || e}`);
    process.exitCode = 1;
    return;
  }
  const { reg, artifact } = gathered;
  const text = JSON.stringify(artifact, null, 1) + '\n';
  if (argv.includes('--json')) { process.stdout.write(text); return; }
  const a = artifact.areas;
  console.log(`defect-signature: fleet · ${a.read} of ${a.declared} areas read, ${a.absent} absent · ${artifact.detectors.length} detectors · ${artifact.signatures.length} signature(s) at rate>=${artifact.thresholds.rate} over >=${artifact.thresholds.minRepos} repos`);
  for (const s of artifact.signatures) console.log(`  SIGNATURE ${s.detector}  ${s.positives}/${s.population}`);
  if (argv.includes('--no-write')) { console.log('-> not written (--no-write)'); return; }
  const dest = fleetSignaturesPath(reg);
  writeAtomic(dest, text);
  console.log(`-> ${dest}`);
}


/** The signature rows out of an artifact, or a bare list, as one shape. */
export function signatureRows(artifact) {
  if (!artifact) return [];
  if (Array.isArray(artifact)) return artifact.filter((d) => d && d.signature === true);
  if (Array.isArray(artifact.signatures)) return artifact.signatures.filter((d) => d && d.signature === true);
  if (Array.isArray(artifact.detectors)) return artifact.detectors.filter((d) => d && d.signature === true);
  return [];
}

export default {
  DEFAULT_RATE, DEFAULT_MIN_REPOS, FLEET_ARTIFACT, thresholds, detectorField, detectorRates, defectSignatures, signatureRows,
  poolSignatures, fleetSignaturesPath, readAreaSignatures, readFleetSignatures, gatherFleetSignatures,
};

if (isMainModule(import.meta.url)) main();
