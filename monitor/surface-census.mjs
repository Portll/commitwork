#!/usr/bin/env node
// monitor/surface-census.mjs — unscanned SOURCE surface as a first-class grey.
//
// THE MISSING AXIS. coverage-manifest.mjs is the dependency-ecosystem axis (markers → advisory
// lanes); codeql-coverage.mjs measures only lanes that declare appliesIfSourceExt; denominator is
// the value type. Nothing published "this repo holds 1,091 Rust files and zero source lanes read
// them" — the languages with the least coverage were exactly the ones with no row anywhere, which
// is the shape the coverage manifest was built to forbid one axis over. This lens is the SOURCE
// axis: per repo × language, surface PRESENT joined against lanes that (a) are declared capable of
// reading that language's source, (b) actually ran, (c) can actually COUNT (lane-capability), and
// (d) demonstrably read the surface where a read-ratio exists (codeql-coverage).
//
// STATES — never red; this lens describes OUR coverage, it does not judge a repo:
//   covered          ≥1 counting source lane ran, and no ratio-bearing lane read below the floor
//   grey-unread      a lane ran but its measured read-ratio is below floor, or its SARIF claims
//                    no-language while the walk sees files (the two witnesses dispute)
//   grey-shape-only  the only capable lanes that ran cannot emit a count (stub extractors)
//   grey-unscanned   capable lanes exist and none ran on this repo (or the repo has no rollup)
//   void-declared    NO lane in the roster reads this language's source — declared below with a
//                    reason, the first-class grey this lens exists to publish
//
// THE LANGUAGE TABLE IS DECLARED, NEVER INFERRED. Only lanes that read L SOURCE with a security
// lens count for L: hygiene lanes (clippy, hlint, deno-lint, stub-detect) and dependency lanes
// never make a language green — a lint-clean repo must not earn a covered SAST row (the
// scanner-checks.mjs deno rule, applied per language). Semgrep counts only for languages where
// its registry coverage is substantive; for rust/c/cpp/swift its thin generic rules would turn
// an unscanned language into an unsupported pass, which is the exact defect this lens measures elsewhere.
//
// TWO ENUMERATORS. The readdir walk mirrors coverage-manifest's SKIP/MAX_DEPTH (asserted equal in
// the test beside this file); `git ls-files` respects the index instead. They cannot share a
// failure mode. When one sees a language and the other sees zero of it, that language row is
// `enumeration: 'disputed'` and its state degrades to grey — an enumerator disagreement is a fact
// about our measurement, not about the repo.
//
// usage: node monitor/surface-census.mjs [--json] [--area <slug>]
// writes: <out>/<area>/surface-census.json per area. CW_NOW pins `generated`; CW_REGISTRY and
// CW_MONITOR_OUT isolate tests; CW_LANE_FIXTURES flows through to lane-capability.

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { loadRegistry } from './registry.mjs';
import { resolveRepos } from './discover.mjs';
import { outDirFor, reportsRootDir } from './area.mjs';
import { SCANNER_CHECKS } from './scanner-checks.mjs';
import { laneCapability } from './lane-capability.mjs';
import { claim, render } from './denominator.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// A ratio rendered for humans. `(ratio || 0)` stood here and turned an UNMEASURABLE ratio into the
// string "0%" — a lane that could not be measured then read as a lane that read nothing, which is
// the same absence-as-verdict this module exists to publish rather than hide. Zero is a measurement;
// absent is not, and they must not print the same.
const pctOf = (r) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : 'ratio unmeasured');

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

// Mirrors coverage-manifest.mjs SKIP / MAX_DEPTH — asserted equal in surface-census.test.mjs so
// the two axes cannot silently enumerate different trees.
export const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'vendor', '_fresh',
  '.next', 'coverage', '.venv', 'venv', '__pycache__', 'reports', 'reference']);
export const MAX_DEPTH = 5;

// ── the declared language table ──────────────────────────────────────────────────────────────────
// `lanes` = manifest CHECK ids of source-reading security lanes. An EMPTY lanes list is a
// DELIBERATE declaration and carries its reason — that is the void-declared state, not an
// omission. Kotlin is its own row on purpose: it was previously folded into "jvm" invisibly.
export const LANGUAGES = [
  { id: 'javascript', exts: ['.js', '.mjs', '.cjs', '.jsx'], lanes: ['sast', 'sast-codeql'] },
  { id: 'typescript', exts: ['.ts', '.tsx', '.mts', '.cts'], lanes: ['sast', 'sast-codeql'] },
  { id: 'python', exts: ['.py', '.pyi'], lanes: ['sast', 'sast-codeql-python'] },
  { id: 'java', exts: ['.java'], lanes: ['sast', 'sast-codeql-java'] },
  // sast-codeql-java gates on .kt/.kts since 2026-08-26 (its pack is java-kotlin), but Kotlin
  // EXTRACTION remains unverified-upstream until a .kt repo exists — the readRatio witness grades
  // that the day one appears.
  { id: 'kotlin', exts: ['.kt', '.kts'], lanes: ['sast-codeql-java'] },
  { id: 'ruby', exts: ['.rb', '.rake'], lanes: ['sast', 'sast-codeql-ruby'] },
  { id: 'go', exts: ['.go'], lanes: ['sast', 'sast-go-gosec', 'sast-codeql-go'] },
  { id: 'php', exts: ['.php'], lanes: ['sast'] },
  { id: 'c', exts: ['.c', '.h'], lanes: ['sast-codeql-cpp'] },
  { id: 'cpp', exts: ['.cc', '.cpp', '.cxx', '.hpp', '.hxx'], lanes: ['sast-codeql-cpp'] },
  { id: 'csharp', exts: ['.cs', '.csx'], lanes: ['sast-codeql-csharp'] },
  { id: 'swift', exts: ['.swift'], lanes: ['sast-codeql-swift'] },
  { id: 'elixir', exts: ['.ex', '.exs'], lanes: ['sast-elixir-sobelow'] },
  // sast-codeql-rust landed 2026-08-26 — Rust's first security reading of source. clippy stays
  // excluded (hygiene: a lint must not earn a green SAST row) and semgrep's Rust registry is thin
  // generic patterns; the CodeQL lane is deliberately the lone entry, and singleWitness will say
  // so on every covered row.
  { id: 'rust', exts: ['.rs'], lanes: ['sast-codeql-rust'] },
  // The declared voids. hlint is hygiene and semgrep's coverage for these is thin generic
  // patterns — counting either would turn this lens's own subject into an unsupported pass.
  { id: 'haskell', exts: ['.hs', '.lhs'], lanes: [], voidNote: 'no security lane reads Haskell source: no CodeQL pack exists, hlint is a style linter.' },
  { id: 'dart', exts: ['.dart'], lanes: [], voidNote: 'no security lane of any kind reads Dart source.' },
];

// check id → rollup category, derived from the authoritative map (never by name).
const CATEGORY_OF = Object.fromEntries(Object.entries(SCANNER_CHECKS).map(([cat, id]) => [id, cat]));

// ── enumerators ──────────────────────────────────────────────────────────────────────────────────
const extIndex = new Map(LANGUAGES.flatMap((l) => l.exts.map((e) => [e, l.id])));
const langOfName = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? extIndex.get(name.slice(dot).toLowerCase()) || null : null;
};

/** readdir walk: { lang: { files, bytes } } */
export function walkSurface(root) {
  const out = {};
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, d] = stack.pop();
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && d < MAX_DEPTH) stack.push([join(dir, e.name), d + 1]);
        continue;
      }
      const lang = e.isFile() ? langOfName(e.name) : null;
      if (!lang) continue;
      const row = out[lang] || (out[lang] = { files: 0, bytes: 0 });
      row.files += 1;
      try { row.bytes += statSync(join(dir, e.name)).size; } catch { /* counted, size unknowable */ }
    }
  }
  return out;
}

/** git ls-files histogram: { lang: files } — null for a non-git tree (the witness is absent, not
 *  zero). Reads the INDEX, so it cannot share the walk's SKIP/depth blind spots. */
export function gitSurface(root) {
  if (!existsSync(join(root, '.git'))) return null;
  let raw;
  try { raw = scannedGitOut(root, ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 }); } // a fleet repo: plain ls-files runs its fsmonitor
  catch { return null; }
  const out = {};
  for (const f of raw.split('\0')) {
    if (!f) continue;
    const lang = langOfName(f.slice(f.lastIndexOf('/') + 1));
    if (lang) out[lang] = (out[lang] || 0) + 1;
  }
  return out;
}

// ── the join ─────────────────────────────────────────────────────────────────────────────────────
const ranish = (block) => !!block && (block.ran === true || (typeof block.ran === 'number' && block.ran > 0));

/**
 * One repo's census. Pure given its inputs:
 * @param walk        walkSurface() result
 * @param git         gitSurface() result or null
 * @param scanners    the repo's rollup `scanners` object, or null when no rollup exists
 * @param capability  laneCapability().categories
 */
export function censusRepo(walk, git, scanners, capability) {
  const rows = [];
  const langs = new Set([...Object.keys(walk), ...Object.keys(git || {})]);
  for (const lang of [...langs].sort()) {
    const decl = LANGUAGES.find((l) => l.id === lang);
    if (!decl) continue;
    const w = walk[lang] || { files: 0, bytes: 0 };
    const g = git ? (git[lang] || 0) : null;
    // Zero-vs-nonzero is the strong disagreement: exact counts legitimately differ (untracked
    // files, tracked files under SKIP dirs), but one enumerator seeing a language the other
    // cannot see at all is a measurement fault and the row must say so.
    const enumeration = git === null ? 'walk-only'
      : (w.files > 0) === (g > 0) ? 'agree' : 'disputed';

    const lanes = decl.lanes.map((id) => {
      const category = CATEGORY_OF[id] || null;
      const cap = category && capability[category] ? capability[category].witness : 'no-fixture';
      const block = scanners && category ? scanners[category] : undefined;
      const ran = ranish(block);
      const coverage = ran && block && block.coverage ? block.coverage : null;
      return { check: id, category, capability: cap, ran, coverage };
    });

    let state;
    let note;
    if (!decl.lanes.length) {
      state = 'void-declared'; note = decl.voidNote;
    } else if (scanners === null) {
      state = 'grey-unscanned'; note = 'no rollup for this repo — no lane has ever been recorded running here';
    } else {
      const ranLanes = lanes.filter((l) => l.ran);
      // MEASURED voicelessness only: shape-only and zero-on-golden are behaviours the capability
      // probe demonstrated. `no-fixture` is UNMEASURED — treating it as voiceless would grey-flood
      // every lane the fixture corpus has not reached yet, with prose ("cannot count") that is
      // false for an unmeasured parser. An unmeasured lane is voiced here and stays visibly
      // unmeasured in its own `capability` field.
      const voiced = ranLanes.filter((l) => l.capability !== 'shape-only' && l.capability !== 'zero-on-golden');
      if (!ranLanes.length) { state = 'grey-unscanned'; note = 'capable lanes exist and none ran'; }
      else if (!voiced.length) { state = 'grey-shape-only'; note = 'every capable lane that ran was MEASURED unable to count (shape-only extractor) — presence was attested, coverage was not'; }
      else {
        const partial = voiced.filter((l) => l.coverage && l.coverage.state === 'partial');
        const disputes = voiced.filter((l) => l.coverage && l.coverage.state === 'no-language' && w.files > 0);
        if (partial.length) { state = 'grey-unread'; note = `read-ratio below floor: ${partial.map((l) => `${l.check} ${pctOf(l.coverage.ratio)}`).join(', ')}`; }
        else if (disputes.length) { state = 'grey-unread'; note = `the lane's SARIF claims no ${lang} files while the walk sees ${w.files} — the witnesses dispute`; }
        else state = 'covered';
      }
    }
    if (enumeration === 'disputed' && state === 'covered') {
      state = 'grey-unread';
      note = `enumerators dispute: walk sees ${w.files} file(s), git ls-files sees ${g} — coverage cannot be claimed over a surface the enumerators cannot agree exists`;
    }

    // Voiced witnesses (measured-counting or unmeasured); `witnessMeasured` is the strict count —
    // singleWitness discloses the quorum either way, which is the honest form of a "second
    // witness" for languages where a second tool does not exist.
    const witnessCount = decl.lanes.length
      ? lanes.filter((l) => l.ran && l.capability !== 'shape-only' && l.capability !== 'zero-on-golden').length : 0;
    const witnessMeasured = decl.lanes.length
      ? lanes.filter((l) => l.ran && l.capability === 'counting').length : 0;
    // The read-ratio as a NUMBER, not only inside an English sentence. `note` already carried it,
    // and a support matrix that wants to show whether a lane LOOKED had no way to get it except by
    // parsing that prose back apart — a sentence is not an interface, and the first renderer to try
    // would be one comma away from publishing the wrong number. Emitted for every ratio-bearing
    // lane that ran, not only the ones below floor, because "read 100%" and "no ratio exists here"
    // are different facts and a matrix has to be able to tell them apart.
    const readRatios = (decl.lanes.length ? lanes : [])
      .filter((l) => l.ran && l.coverage && Number.isFinite(l.coverage.ratio))
      .map((l) => ({ check: l.check, ratio: l.coverage.ratio, coverageState: l.coverage.state }));
    rows.push({
      language: lang,
      files: w.files, bytes: w.bytes, gitFiles: g,
      enumeration,
      state,
      ...(note ? { note } : {}),
      ...(readRatios.length ? { readRatios } : {}),
      lanes,
      witnessCount,
      witnessMeasured,
      ...(state === 'covered' && witnessCount === 1 ? { singleWitness: true } : {}),
    });
  }
  return rows;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const areaArg = args.includes('--area') ? args[args.indexOf('--area') + 1] : null;
  const reg = loadRegistry();
  const { repos } = resolveRepos(reg, { selfRoot: null });
  const capability = laneCapability().categories;
  const root = reportsRootDir(reg);

  const byArea = new Map();
  for (const r of repos) {
    const area = r.area || r.name;
    if (areaArg && area !== areaArg) continue;
    if (!existsSync(r.path)) continue;
    if (!byArea.has(area)) {
      let rollup = null;
      try { rollup = JSON.parse(readFileSync(join(root, area, 'rollup.json'), 'utf8')); }
      catch (e) { if (e && e.code !== 'ENOENT') rollup = { unreadable: true }; }
      byArea.set(area, { rollup, entries: [] });
    }
    const a = byArea.get(area);
    const rollupRepos = a.rollup && Array.isArray(a.rollup.repos) ? a.rollup.repos : null;
    const mine = rollupRepos ? rollupRepos.find((x) => x.repo === r.name || x.name === r.name) : null;
    const scanners = mine && mine.scanners && typeof mine.scanners === 'object' ? mine.scanners : (mine ? {} : null);
    const rows = censusRepo(walkSurface(r.path), gitSurface(r.path), scanners, capability);
    if (rows.length) a.entries.push({ repo: r.name, path: r.path.replace(process.env.HOME, '~'), rows });
  }

  if (areaArg && !byArea.size) {
    console.error(`surface-census: --area '${areaArg}' matched none of the ${repos.length} resolved repos — refused rather than reported empty (the coverage-manifest rule).`);
    process.exit(2);
  }

  const nowIso = process.env.CW_NOW || new Date().toISOString();
  let fleetRows = 0, greyRows = 0;
  const voidBytes = {};
  for (const [area, a] of [...byArea.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const allRows = a.entries.flatMap((e) => e.rows);
    fleetRows += allRows.length;
    greyRows += allRows.filter((r) => r.state !== 'covered').length;
    for (const r of allRows) if (r.state === 'void-declared') voidBytes[r.language] = (voidBytes[r.language] || 0) + r.files;
    const out = {
      generated: nowIso,
      note: 'Per repo × source language: surface present vs lanes that can, did, and demonstrably read it. Grey states are the product — an unscanned surface is published as unknown, never omitted. See LANGUAGES in monitor/surface-census.mjs for which lanes count for which language, and why.',
      area,
      summary: claim({
        count: allRows.filter((r) => r.state !== 'covered').length,
        observed: allRows.length, population: allRows.length,
        unit: 'repo-language row', of: 'source surface without a demonstrated reading',
      }),
      repos: a.entries,
    };
    // outDirFor resolves declared areas; a repo whose area is undeclared still gets its census,
    // filed under its own slug — silence for undeclared areas would be the outermost void again.
    let dir;
    try { dir = outDirFor(area, reg); } catch { dir = null; }
    if (!dir || typeof dir !== 'string') dir = join(root, area);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, 'surface-census.json'), JSON.stringify(out, null, 1) + '\n');
  }

  const fleet = claim({ count: greyRows, observed: fleetRows, population: fleetRows,
    unit: 'repo-language row', of: 'source surface without a demonstrated reading' });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ generated: nowIso, fleet, voidFiles: voidBytes,
      areas: [...byArea.keys()].sort() }, null, 1));
    return;
  }
  console.log(`surface-census: ${render(fleet)} · ${byArea.size} area(s)`);
  for (const [lang, files] of Object.entries(voidBytes).sort(([, a], [, b]) => b - a)) {
    console.log(`  VOID ${lang}: ${files} file(s) across the fleet, read by no security lane`);
  }
}

if (isMain) main();
