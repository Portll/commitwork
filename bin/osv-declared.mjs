#!/usr/bin/env node
/*
 * osv-declared.mjs — did the repository DECLARE the version osv-scanner reported, or did the
 * scanner RESOLVE it?
 *
 *   node bin/osv-declared.mjs <repoDir> <osv.sarif> > osv-declared.json
 *
 * WHY. osv-scanner does transitive resolution for a requirements.txt that carries only `>=` floors
 * (its log says `extracting as transitivedependency/requirements`) and reports the MINIMUM
 * satisfying tree. Measured 2026-08-28 on memory-layer: benchmarks/requirements.txt lists
 * `datasets>=2.14.0`, `tqdm>=4.65.0`, `openai>=1.0.0` — and osv reported `pillow@9.5.0` and
 * `aiohttp@3.9.5`, named nowhere in that file, as 54 of memory-layer's 135 dependency findings including
 * BOTH criticals and the only CISA-KEV row. Across the three area rollups on disk, 3 of 3 osv
 * criticals and 1 of 1 KEV came from an unpinned Python manifest; `internal-d`, whose 98 osv findings
 * come from no requirements file, has zero criticals.
 *
 * A resolved version is a real statement about the lowest tree the declared floors permit. It is
 * NOT a statement about what this repository installs, and publishing it in the same bucket as a
 * Cargo.lock pin makes the two indistinguishable. explicit uncertainty.
 *
 * WHY AT SCAN TIME AND NOT IN THE ROLLUP. rollup.mjs can reach the repo (resolveRepos is already
 * imported), and reading the working tree there would have been three lines. It would also make a
 * re-roll's answer depend on the tree as it is NOW rather than as it was when the batch was
 * scanned — so re-rolling a 2026-07 batch would classify it against a 2026-08 checkout and
 * silently disagree with the run it is meant to reproduce. Corrected-history is only worth
 * anything if a re-roll reads nothing but the batch. So the fact is captured HERE, beside
 * osv.sarif, and travels with the evidence.
 *
 * THE TEST IS LITERAL AND DELIBERATELY DUMB: does the manifest name this package at this version?
 * A lockfile does, by construction. `pkg==1.2.3` does. `pkg>=1.0` does not. Nothing is inferred
 * about ecosystems or resolvers, because an inference here would be the second guess in a chain
 * whose first guess is already the problem.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
// The ONE SARIF reader. Hand-rolling `sarif.runs || []` here was caught by
// bin/test/... 'SARIF-document access lives in monitor/sarif-read.mjs and nowhere else', and the
// gate is right: a hand-rolled reader cannot tell a document with no runs from a scanner that
// never ran, and this file's verdict decides whether real findings get demoted.
import { readSarif } from '../monitor/sarif-read.mjs';

const [, , repoArg, sarifArg] = process.argv;
if (!repoArg || !sarifArg) {
  console.error('usage: osv-declared.mjs <repoDir> <osv.sarif>');
  process.exit(2);
}
const REPO = resolve(repoArg);

// FAIL CLOSED, and note which direction that is HERE. This file's output causes DEMOTION, so the
// dangerous failure is emitting a verdict from a document we did not really read — that would move
// real lockfile findings out of the headline. `ran:false` is the safe state: the rollup applies no
// demotion without a verdict, which leaves the pre-existing behaviour intact.
const r = readSarif(sarifArg);
if (r.state !== 'ok') {
  console.error(`osv-declared: ${sarifArg} is ${r.state}${r.reason ? ` — ${r.reason}` : ''}; emitting NO verdict, so nothing is demoted`);
  process.stdout.write(JSON.stringify({ tool: 'osv-declared', ran: false, reason: r.state, manifests: {} }, null, 2) + '\n');
  process.exit(0);
}
// No `|| []` anywhere below. readSarif returns results:null for every non-ok state ON PURPOSE, and
// defaulting it converts a void back into a clean zero — the exact laundering the shared-reader
// gate exists to catch. The state check above already guarantees these are arrays.

/** `file:///src/benchmarks/requirements.txt` -> `benchmarks/requirements.txt` */
const toRel = (uri) => String(uri || '').replace(/^file:\/\/\/?/, '').replace(/^src\//, '');

// fact: /locks/ paths read from CW_LOCKFILE_DIR
const LOCKS_PREFIX = 'locks/';
const sidecarLockPath = (rel) => (rel.startsWith(LOCKS_PREFIX) && process.env.CW_LOCKFILE_DIR
  ? join(process.env.CW_LOCKFILE_DIR, rel.slice(LOCKS_PREFIX.length))
  : null);

// fact: lockfiles declare by name, not text
// fact: requirements.txt and pom.xml can float
import { ECOSYSTEMS } from '../monitor/preflight-build.mjs';
const FLOATING = new Set(['requirements.txt', 'pom.xml']);
const LOCK_BY_CONSTRUCTION = new Set(ECOSYSTEMS.flatMap((e) => e.lock)
  .filter((n) => !FLOATING.has(n) && !n.includes('/'))
  .concat(['npm-shrinkwrap.json', 'bun.lock']));
const pinsByConstruction = (rel) => LOCK_BY_CONSTRUCTION.has(basename(rel));

const manifestText = new Map();
function readManifest(rel) {
  if (manifestText.has(rel)) return manifestText.get(rel);
  const p = sidecarLockPath(rel) || join(REPO, rel);
  let t = null;
  if (existsSync(p)) { try { t = readFileSync(p, 'utf8'); } catch { t = null; } }
  manifestText.set(rel, t);
  return t;
}

const out = {};
for (const run of r.runs) {
  for (const res of run.results) {
    const m = (res.message && res.message.text || '').match(/Package '([^'@]+(?:@[^'@]+)?)@([^']+)'/);
    if (!m) continue;
    const [, pkg, version] = m;
    for (const loc of (res.locations || [])) {
      const uri = loc.physicalLocation && loc.physicalLocation.artifactLocation && loc.physicalLocation.artifactLocation.uri;
      if (!uri) continue;
      const rel = toRel(uri);
      const text = readManifest(rel);
      const entry = (out[uri] = out[uri] || { path: rel, readable: text !== null, declared: {}, resolved: {} });
      if (text === null) continue;           // unreadable manifest: no verdict, never a guess
      const key = `${pkg}@${version}`;
      if (key in entry.declared || key in entry.resolved) continue;
      if (pinsByConstruction(rel)) { entry.declared[key] = true; entry.byConstruction = true; continue; }
      // The version must appear NEAR the package name — not merely somewhere in the file, or an
      // unrelated `1.2.3` would vouch for every package.
      //
      // A WINDOW, not the same line, and this was found by running it. A same-line test read a
      // Cargo.lock as declaring NOTHING, because the format is
      //     [[package]]
      //     name = "anyhow"
      //     version = "1.0.100"
      // — three lines. The result came out exactly inverted: lockfiles, which pin by construction,
      // read as resolved, and a requirements.txt read as declared. Two lines either side covers
      // Cargo.lock, package-lock.json, go.sum, Gemfile.lock and the `pkg==1.2.3` one-liner alike.
      const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRe = new RegExp(`(^|[^\\w./-])${esc}([^\\w./-]|$)`, 'i');
      const all = text.split('\n');
      let stated = false;
      for (let li = 0; li < all.length && !stated; li++) {
        if (!nameRe.test(all[li])) continue;
        for (let k = Math.max(0, li - 2); k <= Math.min(all.length - 1, li + 2); k++) {
          if (all[k].includes(version)) { stated = true; break; }
        }
      }
      if (stated) entry.declared[key] = true; else entry.resolved[key] = true;
    }
  }
}

const manifests = {};
for (const [uri, e] of Object.entries(out)) {
  manifests[uri] = {
    path: e.path,
    // fact: external marks the fleet's pin
    ...(sidecarLockPath(e.path) ? { external: true, source: 'sidecar' } : {}),
    // fact: byConstruction marks name-decided declarations
    ...(e.byConstruction ? { byConstruction: true } : {}),
    readable: e.readable,
    declaredCount: Object.keys(e.declared).length,
    resolvedCount: Object.keys(e.resolved).length,
    resolved: Object.keys(e.resolved).sort(),
  };
}
process.stdout.write(JSON.stringify({
  tool: 'osv-declared', ran: true,
  note: 'For each osv finding, whether the manifest it names STATES that package at that version. A lockfile does by construction; a `>=` floor does not, and osv-scanner resolves those itself. `resolved` entries describe the lowest tree the declared floors permit, which is a real statement and not a statement about what this repository installs.',
  manifests,
}, null, 2) + '\n');
