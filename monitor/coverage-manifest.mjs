#!/usr/bin/env node
// coverage-manifest.mjs — what the scanner SHOULD check, and WHERE: per-repo ecosystems, the
// marker that put each in scope, and the ecosystems with NO vulnerability lane (declared voids —
// an ecosystem with no check produces no artifact and reads exactly like a clean repo).
//
// usage: node monitor/coverage-manifest.mjs [--json] [--area <slug>]
// writes: reports/<area>/coverage-manifest.json   (honours CW_MONITOR_OUT like the rest of monitor/)
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveRepos } from './discover.mjs';
import { loadRegistry } from './registry.mjs';
import { outDirFor } from './area.mjs'; // THE OUT resolver — never re-derive the chain here
import { isMainModule } from '../lib/is-main.mjs';
import { resolvePinnedTool } from '../lib/cobolwork-resolve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// Mirrors bin/commitwork.mjs's SKIP_SOURCE / maxDepth — asserted equal in the test beside this file
const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'vendor', '_fresh',
  '.next', 'coverage', '.venv', 'venv', '__pycache__', 'reports', 'reference']);
const MAX_DEPTH = 5;

// `exts` exists because some ecosystems have no fixed-name marker at all: a .NET project is a
// *.csproj / *.sln, and matching only exact names makes such a repo invisible — not
// under-covered, absent. A marker set that can only express fixed names silently
// excludes every ecosystem that does not use one.
function findMarkers(root, names, exts = []) {
  const hits = [];
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, d] = stack.pop();
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && (names.has(e.name) || exts.some((x) => e.name.endsWith(x)))) {
        hits.push(relative(root, join(dir, e.name)) || e.name);
      }
      if (e.isDirectory() && !SKIP.has(e.name) && d < MAX_DEPTH) stack.push([join(dir, e.name), d + 1]);
    }
  }
  return hits.sort();
}

// Marker files that put a repo in scope + the roster's lanes. `vuln` = whether ANY check maps
// this ecosystem to an advisory database.
//
// EVERY ECOSYSTEM WE CAN DETECT IS LISTED, INCLUDING THE ONES NOTHING SCANS. An ecosystem absent
// from this array produces no row at all — not a void, nothing — because the loop below skips a
// marker set it never searched for, which would leave the coverage manifest, whose entire job is
// to declare where nothing is looking, with an undeclared gap of its own.
//
// `voidKind` SEPARATES TWO THINGS THAT LOOK ALIKE AND ARE NOT:
//   no-advisory-db  Nothing in the world covers this. Not a bug, not a TODO — a fact, and the
//                   honest answer is that these dependencies are checked against nothing.
//   not-wired       An advisory database DOES cover it and osv-scanner parses it; our deps-osv
//                   check simply does not list the marker in appliesIfExists, so the lane never
//                   fires. That is a fixable gap and should read as one.
const ECOSYSTEMS = [
  { id: 'npm',    markers: ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'], vuln: true,  lanes: ['deps-osv', 'npm-audit', 'deps-retire', 'supply-chain-socket', 'sbom'] },
  { id: 'rust',   markers: ['Cargo.toml', 'Cargo.lock'],                                        vuln: true,  lanes: ['deps-osv', 'lint-rust-clippy', 'format-rust-rustfmt', 'sast-codeql-rust', 'deps-rust-audit'] },
  // exts .kt/.kts: a Kotlin tree with no gradle marker still gets a row. sast-codeql-java gates on
  // .java/.kt/.kts (its pack is java-kotlin), so a .kt file both fires the lane and shows up here.
  { id: 'jvm',    markers: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'pom.xml'],
    exts: ['.kt', '.kts'], vuln: true,  lanes: ['deps-jvm', 'deps-osv', 'sast-codeql-java'] },
  { id: 'go',     markers: ['go.mod', 'go.sum'],                                                 vuln: true,  lanes: ['deps-go-govulncheck', 'sast-go-gosec', 'sast-codeql-go', 'deps-osv'] },
  // pyproject.toml / uv.lock are PEP-621 and uv, which deps-osv's appliesIfExists does not list.
  // A repo carrying only a pyproject must register as Python with an unresolved tree, not as
  // not-Python at all.
  { id: 'python', markers: ['requirements.txt', 'poetry.lock', 'Pipfile.lock', 'pyproject.toml', 'uv.lock'], vuln: true, lanes: ['deps-osv'] },
  { id: 'ruby',   markers: ['Gemfile.lock'],                                                     vuln: true,  lanes: ['deps-osv'] },
  { id: 'php',    markers: ['composer.lock'],                                                    vuln: true,  lanes: ['deps-osv'] },
  // Conan is the RESOLVED face of C/C++ and gets its own row: osv-scanner 2.5.1 extracts conan.lock
  // in both v1 (graph_lock) and v2 (requires) shapes. conanfile.txt is kept as a DETECTION marker
  // but is NOT extracted (exit 128, no scanned line) — a conanfile-without-lock tree is
  // preflight's `blind`, never covered.
  { id: 'conan', markers: ['conan.lock', 'conanfile.txt'], vuln: true, lanes: ['deps-osv', 'sast-codeql-cpp'] },
  // ── DETECTED, NOT SCANNED ──────────────────────────────────────────────────────────────────
  { id: 'cpp', markers: ['CMakeLists.txt', 'configure.ac', 'meson.build', 'Makefile.am', 'conanfile.py', 'vcpkg.json'],
    exts: ['.vcxproj'], vuln: false, lanes: ['sast-codeql-cpp'], voidKind: 'no-advisory-db',
    voidNote: 'C/C++ dependencies are vendored, submoduled or taken from the system, and a CMake or autotools tree declares no resolvable dependency set at all. Nothing here is checked against any CVE feed on the DEPENDENCY axis; the source axis is covered by sast-codeql-cpp. This is the memory-safety class the CRA cares most about. A conan.lock tree is the covered exception (see the conan row); conanfile.py declares via Python and vcpkg.json declares names without versions, and neither is extracted by osv-scanner 2.5.1.' },
  { id: 'nix', markers: ['flake.nix', 'flake.lock', 'default.nix', 'shell.nix'], vuln: false, lanes: [], voidKind: 'no-advisory-db',
    voidNote: 'No advisory database indexes nixpkgs attribute paths, so a flake.lock pins exactly which sources were used and still cannot be matched to a CVE.' },
  // The deps-osv gate lists packages.lock.json / packages.config / paket.lock, and osv-scanner
  // 2.5.1 extracts packages.lock.json (advisories matched on a fixture lockfile).
  // A *.csproj/*.sln-only tree still carries NO resolvable set — that is preflight-build's `blind`
  // (restore executes MSBuild targets, a policy refusal), and blind is a named grey, not covered.
  { id: 'dotnet', markers: ['packages.lock.json', 'packages.config', 'paket.lock', 'Directory.Packages.props', 'global.json', 'nuget.config'],
    exts: ['.csproj', '.fsproj', '.sln'], vuln: true, lanes: ['deps-osv', 'sast-codeql-csharp'] },
  // Package.resolved is in the deps-osv gate and osv-scanner extracts its v2 pins shape; the
  // legacy v1 object.pins shape is NOT recognised (exit 128). Package.swift with no
  // Package.resolved is preflight's `blind`, not coverage.
  { id: 'swift', markers: ['Package.swift', 'Package.resolved'], vuln: true, lanes: ['deps-osv', 'sast-codeql-swift'] },
  // CocoaPods is a SEPARATE ecosystem from SwiftPM. osv-scanner 2.5.1 does NOT extract
  // Podfile.lock (exit 128, no scanned line) even though the deps-osv gate lists it, and OSV.dev
  // publishes no CocoaPods ecosystem — so this is a fact about the world, not a wiring TODO.
  { id: 'cocoapods', markers: ['Podfile', 'Podfile.lock'], vuln: false, lanes: [], voidKind: 'no-advisory-db',
    voidNote: 'As of 2026-08-26, OSV.dev has no CocoaPods ecosystem and osv-scanner 2.5.1 does not extract Podfile.lock: the deps-osv gate lists the marker, the scan extracts nothing from it and exits 128 when it is the only artifact. Pod dependencies are checked against no advisory feed.' },
  // pubspec.lock is in deps-osv's appliesIfExists because osv-scanner parses it: the worked example
  // of a `not-wired` void, which closes in one line once the tool is shown to handle the file.
  { id: 'dart', markers: ['pubspec.yaml', 'pubspec.lock'], vuln: true, lanes: ['deps-osv'] },
  // mix.lock is in the deps-osv gate and osv-scanner extracts it (advisories matched).
  // mix.exs-without-lock is preflight's `blind`.
  { id: 'elixir', markers: ['mix.exs', 'mix.lock'], vuln: true, lanes: ['deps-osv', 'sast-elixir-sobelow'] },
  // Both Haskell resolved formats are in the deps-osv gate, and osv-scanner extracts
  // cabal.project.freeze and stack.yaml.lock (advisories matched). stack.yaml / cabal.project
  // alone declare without resolving.
  { id: 'haskell', markers: ['stack.yaml', 'cabal.project', 'cabal.project.freeze', 'stack.yaml.lock'], vuln: true, lanes: ['deps-osv', 'lint-haskell-hlint'] },
  // renv.lock: in the deps-osv gate; osv-scanner extracts it (CRAN).
  { id: 'r', markers: ['renv.lock'], vuln: true, lanes: ['deps-osv'] },
  { id: 'deno',   markers: ['deno.json', 'deno.jsonc', 'deno.lock'],                             vuln: false, lanes: ['deno-check', 'deno-lint'],
    voidNote: 'No advisory database covers Deno\'s URL/JSR import graph, and osv-scanner rejects deno.lock outright (as of 2026-08-26, osv-scanner 2.5.1 exits 128 with no extraction on a v4 deno.lock; the deps-osv gate lists the marker and the scan gets nothing from it). deno-check and deno-lint measure CORRECTNESS, not vulnerability — a green Deno repo here has never had its dependencies checked against any CVE feed.' },
  { id: 'docker', markers: ['Dockerfile'],                                                       vuln: false, lanes: ['dockerfile-lint', 'iac-config'],
    voidNote: 'Lint and config only. Nothing here scans the CONTENTS of a built image, so a pinned-but-ancient base layer reports clean.' },
  { id: 'gha',    markers: ['.github/workflows'],                                                vuln: false, lanes: ['actions-zizmor'] },
];

// ── the weakness-CLASS axis (lane E) ─────────────────────────────────────────────────────────────
// The class-axis void: weakness CLASSES the in-scope lanes never look for. Universe = the DECLARED
// weaknessClassVocab in approach-taxonomy.json (business-logic/race/authz live there whether or not
// a lane covers them); covered = the union of `weaknessClasses` over the in-scope approaches; void =
// universe minus covered. Mirrors the ecosystem-axis void shape ({ecosystem,kind,why} ->
// {class,kind,why}), kind 'no-tool-class'. FAILS CLOSED: a taxonomy with no vocab/approaches THROWS —
// an empty [] here would read as "every class is covered", the exact false-clean this axis kills.
export function weaknessClassVoids(taxonomy, inScopeChecks) {
  const vocab = taxonomy && taxonomy.weaknessClassVocab;
  const approaches = taxonomy && taxonomy.approaches;
  if (!vocab || typeof vocab !== 'object' || !Array.isArray(approaches)) {
    throw new Error('weaknessClassVoids: taxonomy has no weaknessClassVocab or approaches — cannot compute class voids (fail closed, never [])');
  }
  const inScope = inScopeChecks instanceof Set ? inScopeChecks : new Set(inScopeChecks || []);
  const covered = new Set();
  for (const a of approaches) {
    if (!inScope.has(a.check)) continue;
    for (const c of (Array.isArray(a.weaknessClasses) ? a.weaknessClasses : [])) covered.add(c);
  }
  const voids = [];
  for (const [slug, def] of Object.entries(vocab)) {
    if (def && def.agnostic) continue;   // '*-advisory-dep' is the dependency axis, not a first-party class
    if (covered.has(slug)) continue;
    voids.push({ class: slug, kind: 'no-tool-class', label: (def && def.label) || null, cwes: (def && def.cwes) || [],
      why: 'no in-scope lane declares it — a weakness class nothing looks for reads exactly like a clean one' });
  }
  return voids.sort((a, b) => (a.class < b.class ? -1 : a.class > b.class ? 1 : 0));
}

// CLI — GUARDED so importing this module (the posture test does, for weaknessClassVoids) runs no I/O
// and writes no files. The body below stays at column 0 inside the guard on purpose.
const IS_MAIN = isMainModule(import.meta.url);
if (IS_MAIN) {

const args = process.argv.slice(2);
const reg = loadRegistry();
const areaArg = args.includes('--area') ? args[args.indexOf('--area') + 1] : null;
const { repos } = resolveRepos(reg, { selfRoot: null });

// execFileSync with NO shell — a tool name must never concatenate into a command line
const toolCache = new Map();
const haveTool = (t) => {
  if (toolCache.has(t)) return toolCache.get(t);
  let ok = false;
  const pinned = resolvePinnedTool(t);   // a pinned tool is its verified install, never PATH
  if (pinned) ok = pinned.ok;
  else try { execFileSync('/usr/bin/which', [t], { stdio: 'ignore' }); ok = true; } catch { ok = false; }
  toolCache.set(t, ok);
  return ok;
};

const manifestPath = join(CW, 'manifests', 'security-baseline.json');
const roster = JSON.parse(readFileSync(manifestPath, 'utf8')).checks || [];
const rosterById = new Map(roster.map((c) => [c.id, c]));

// class-axis voids over the roster's own checks. FAIL CLOSED — an unreadable taxonomy is recorded as
// an error object, never as [] (which would read as "every weakness class is covered").
let classVoids;
try {
  const taxonomy = JSON.parse(readFileSync(join(HERE, 'approach-taxonomy.json'), 'utf8'));
  classVoids = weaknessClassVoids(taxonomy, new Set(roster.map((c) => c.id)));
} catch (e) {
  classVoids = { error: `weakness-class axis unavailable (fail-closed, not empty): ${e.message}` };
}

const entries = [];
for (const r of repos) {
  if (areaArg && (r.area || r.name) !== areaArg) continue;
  const onDisk = existsSync(r.path);
  const eco = [];
  for (const e of ECOSYSTEMS) {
    const names = new Set(e.markers.filter((m) => !m.includes('/')));
    const found = onDisk ? findMarkers(r.path, names, e.exts || []) : [];
    // directory-shaped markers (.github/workflows) are checked directly, not by the file walk
    for (const m of e.markers.filter((m) => m.includes('/'))) {
      if (onDisk && existsSync(join(r.path, m))) found.push(m);
    }
    if (!found.length) continue;
    const lanes = e.lanes.map((id) => {
      const c = rosterById.get(id);
      const tools = c?.requires?.tools || [];
      const missing = tools.filter((t) => !haveTool(t));
      return { check: id, declared: !!c, toolsMissing: missing };
    });
    eco.push({
      ecosystem: e.id,
      markers: found.sort(),
      vulnerabilityLane: e.vuln,
      lanes,
      ...(e.vuln ? {} : {
        void: e.voidNote || 'No vulnerability lane for this ecosystem.',
        // `not-wired` is a TODO with a known fix; `no-advisory-db` is a fact about the world. A
        // reader who cannot tell them apart cannot tell which voids are worth anyone's afternoon.
        voidKind: e.voidKind || 'no-advisory-db',
      }),
    });
  }
  // THE OUTERMOST VOID. A bare `ecosystems: []` for a repo matching no ecosystem at all would read
  // as "nothing to declare", indistinguishable from a repo whose ecosystems are all covered. Two
  // different unknowns:
  //   unknown-ecosystem  nothing on disk matched ANY marker set — we cannot say what this is built
  //                      with, so we cannot say what is not being scanned.
  //   all-voids          every ecosystem we DID detect has no vulnerability lane: the repo can be
  //                      fully scanned by SAST with its dependencies checked against nothing.
  const covered = eco.filter((x) => x.vulnerabilityLane);
  const dependencyCoverage = !onDisk ? 'not-on-disk'
    : !eco.length ? 'unknown-ecosystem'
      : covered.length ? 'covered' : 'all-voids';
  entries.push({
    repo: r.name, area: r.area || r.name, path: r.path.replace(process.env.HOME, '~'), onDisk,
    dependencyCoverage,
    ...(dependencyCoverage === 'unknown-ecosystem'
      ? { note: 'no marker of any DECLARED ecosystem was found. This is not "no dependencies" — it is "we do not know what this is built with", and nothing here can be checked against an advisory feed.' }
      : {}),
    ecosystems: eco,
  });
}

// AN --area THAT MATCHES NOTHING IS A MISTAKE, NOT AN EMPTY FLEET. When an area's members carry
// their own name as `area`, the filter matches none of them, and a coverage manifest that reports
// "nothing to scan" because its own selector missed is the exact false-clean this file exists to
// prevent, one level up from the ecosystems it declares.
if (areaArg && !entries.length) {
  const known = [...new Set(repos.map((r) => r.area || r.name))].sort();
  console.error(`coverage-manifest: --area '${areaArg}' matched none of the ${repos.length} resolved repos.`);
  console.error('This is refused rather than reported as an empty manifest — an empty result here is indistinguishable from a fleet with nothing to scan.');
  console.error(`Known areas: ${known.slice(0, 40).join(', ')}${known.length > 40 ? `, … (${known.length} total)` : ''}`);
  process.exit(2);
}

// Unconditional checks listed once — the per-repo section stays about what is distinctive
const unconditional = roster.filter((c) => !c.appliesIfExists && !c.appliesIfSourceExt).map((c) => c.id);

const out = {
  generated: new Date().toISOString(),
  note: 'What the scanner SHOULD check and where the marker for it lives. Compare against a rollup to find silent gaps: an ecosystem listed here with no corresponding artifact in the batch is a void, not a clean result.',
  rosterChecks: roster.length,
  unconditional,
  toolsMissing: [...toolCache.entries()].filter(([, v]) => !v).map(([k]) => k),
  voids: entries.flatMap((e) => e.ecosystems.filter((x) => !x.vulnerabilityLane)
    .map((x) => ({ repo: e.repo, ecosystem: x.ecosystem, kind: x.voidKind, why: x.void }))),
  // The two counts a reader acts on differently: `notWired` is work with a known fix, `noAdvisoryDb`
  // is the honest limit of what any tool can currently say.
  voidsByKind: entries.flatMap((e) => e.ecosystems.filter((x) => !x.vulnerabilityLane))
    .reduce((a, x) => { a[x.voidKind] = (a[x.voidKind] || 0) + 1; return a; }, {}),
  // The class-axis void beside the ecosystem-axis void: weakness classes no rostered lane declares
  // (authz/business-logic/race are the ones that surface here). Roster-level; a per-repo/per-execution
  // refinement — "this repo only had SAST run, so authz is void HERE" — is the panel follow-up.
  classVoids,
  // Repos with NO covered dependency ecosystem at all — the outermost void, counted so it cannot
  // hide inside a per-ecosystem list.
  unscannedRepos: entries.filter((e) => e.dependencyCoverage === 'all-voids').map((e) => e.repo).sort(),
  unknownEcosystemRepos: entries.filter((e) => e.dependencyCoverage === 'unknown-ecosystem').map((e) => e.repo).sort(),
  repos: entries,
};

if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

// area.mjs's chain, not a copy — a coverage claim filed against the wrong area is worse than none
const OUT_DIR = (() => {
  try { return outDirFor(areaArg, reg); }
  catch (e) { console.error(`coverage-manifest: ${e.message}`); process.exit(2); }
})();
mkdirSync(OUT_DIR, { recursive: true });
const dest = join(OUT_DIR, 'coverage-manifest.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');

const withEco = entries.filter((e) => e.ecosystems.length).length;
console.log(`coverage-manifest: ${entries.length} repos (${withEco} with a detected ecosystem) · ${out.voids.length} declared void(s) · ${roster.length} roster checks, ${unconditional.length} unconditional`);
for (const v of out.voids.slice(0, 8)) console.log(`  VOID  ${v.repo} · ${v.ecosystem} — no vulnerability lane`);
if (Array.isArray(classVoids)) for (const v of classVoids) console.log(`  CLASS-VOID  ${v.class} — no lane in the roster looks for this weakness class`);
console.log(`wrote ${relative(CW, dest)}`);

}
