#!/usr/bin/env node
// monitor/preflight-build.mjs — is each monitored repo in a state where a scan MEANS anything?
// Three states, kept apart: ok (lock artifact exists) / blind (a manifest DECLARING dependencies
// has no lock — the scanner is looking at nothing) / no-surface (no manifest, or one declaring no
// dependencies — not a pass, not blindness). --apply stays explicit, never reached from the sweep;
// every write is ledgered (built[].wrote).
//
// usage:
//   node monitor/preflight-build.mjs [--area <slug>] [--json]        detect only (default)
//   node monitor/preflight-build.mjs --apply [--area <slug>]         build the blind ones, into the SIDECAR
//   node monitor/preflight-build.mjs --apply --only <repo>           one repo
//   node monitor/preflight-build.mjs --apply --into-repo …           write the lockfile into the repository instead
// exit: 0 all repos scannable · 4 at least one BLIND repo (a void, not a pass) · 2 usage
//
// fact: built lockfiles land in the sidecar

import { existsSync, readFileSync, statSync, lstatSync, realpathSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// Static, not the dynamic import main() uses: the thirdParty refusal below needs it, and a guard
// that depends on a lazily-imported symbol is a guard that can be skipped by an import ordering.
import { areaSlugOf } from './project-scope.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// fact: sidecar root resolved at call time
export function sidecarLockRoot(env = process.env) {
  if (env.CW_LOCKFILE_ROOT) return resolve(env.CW_LOCKFILE_ROOT);
  const link = join(CW, 'evaluations');
  try {
    if (!lstatSync(link).isSymbolicLink()) return null;   // a tracked directory is not a sidecar
    return join(dirname(realpathSync(link)), 'lockfiles');
  } catch { return null; }                                  // absent or unreadable: no sidecar
}
// fact: keyed on the repo directory name
export function sidecarLockDir(repoPath, env = process.env) {
  const root = sidecarLockRoot(env);
  if (!root || !repoPath) return null;
  return join(root, basename(resolve(repoPath)));
}

// The ecosystem table — declared, never inferred from a filename at the call site. `build` is an
// argv array of literals; no repo-supplied text is ever interpolated.
export const ECOSYSTEMS = Object.freeze([
  {
    id: 'node',
    manifest: ['package.json'],
    // any one of the three lockfile dialects proves the tree is resolved
    lock: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
    build: ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    why: 'without a lockfile the resolved tree does not exist on disk, so osv/npm audit have no versions to match advisories against',
    // --package-lock-only + --ignore-scripts: write the lock, run no third-party hooks.
    // --no-audit is a disclosure bound — the default audit POSTs the dependency graph to the registry.
  },
  {
    id: 'go',
    manifest: ['go.mod'],
    lock: ['go.sum'],
    build: ['go', 'mod', 'download'],
    why: 'go.sum is the checksum database the vulnerability scanners resolve module versions through',
  },
  {
    id: 'jvm-gradle',
    // gradle/libs.versions.toml is the version catalog: a declaration of versions, not a resolved
    // set, so it belongs beside the build scripts rather than in `lock`.
    manifest: ['build.gradle', 'build.gradle.kts', 'gradle/libs.versions.toml'],
    lock: ['gradle.lockfile', 'gradle/dependency-locks'],
    build: ['./gradlew', 'dependencies', '--write-locks'],
    why: 'Gradle resolves dynamically; with no lockfile the dependency set is invisible to osv/npm — the measured blind-jvm era hid 102C/675H behind cells that rendered empty',
  },
  {
    id: 'jvm-maven',
    manifest: ['pom.xml'],
    lock: ['pom.xml'],   // Maven pins in the POM itself; presence of the manifest IS the resolution
    build: null,         // nothing to do — declared explicitly rather than left to look unhandled
    why: 'Maven coordinates are pinned in the POM, so the manifest is its own lock',
  },
  {
    id: 'python',
    manifest: ['pyproject.toml', 'requirements.txt'],
    lock: ['poetry.lock', 'requirements.txt', 'uv.lock', 'Pipfile.lock'],
    build: ['python3', '-m', 'piptools', 'compile', '--quiet'],
    why: 'an unpinned pyproject has no resolved version set, so nothing can be matched to an advisory',
  },
  // The three below were MISSING while deps-osv scanned them anyway, so preflight published
  // "no dependency manifest of any known ecosystem" over repos it was actively finding CVEs in:
  // foundry, reth, quinn and vector all carry Cargo.lock, dependabot-core carries Gemfile.lock,
  // and foundry's own rollup rows cite `file:///src/Cargo.lock`. That is the explicit uncertainty
  // rule failing in the direction the prober is supposed to catch.
  //
  // build: null is a POLICY refusal, not a capability gap — `cargo generate-lockfile`,
  // `bundle lock` and `composer update` all execute package-author code on the host, which GATE A
  // forbids for third-party trees. Stated in `why` so nobody files "add cargo support".
  {
    id: 'rust',
    manifest: ['Cargo.toml'],
    lock: ['Cargo.lock'],
    build: null,
    why: 'Cargo.toml declares semver ranges; without Cargo.lock there is no resolved version set to match against an advisory. Not built here: resolving it runs build scripts from the dependency graph on the host',
  },
  {
    id: 'ruby',
    manifest: ['Gemfile'],   // exact names only — anyPresence stats, it does not glob

    lock: ['Gemfile.lock'],
    build: null,
    why: 'a Gemfile without Gemfile.lock has no resolved gem versions. Not built here: `bundle lock` evaluates the Gemfile and each gemspec as Ruby on the host',
  },
  {
    id: 'php',
    manifest: ['composer.json'],
    lock: ['composer.lock'],
    build: null,
    why: 'composer.json declares constraints; composer.lock is the resolved set osv matches. Not built here: composer runs package scripts on the host',
  },
  {
    // found by the claims test below, not by reading: deps-osv starts on pubspec.lock and nothing
    // here knew what it was. 2 repos in the 100RandomRepos corpus are Dart.
    id: 'dart',
    manifest: ['pubspec.yaml'],
    lock: ['pubspec.lock'],
    build: null,
    why: 'pubspec.yaml declares version ranges; pubspec.lock is the resolved set. Not built here: `dart pub get` runs package build hooks on the host',
  },
  // Added 2026-08-24 alongside the deps-osv gate widening. OSV-Scanner already understood these
  // ecosystems; the gate simply never named their markers, so a repository whose only dependency
  // surface was one of them was published as "no dependency manifest of any known ecosystem" while
  // the lane scanned it. That is a false void — the exact shape this file exists to prevent — and
  // the gate and this registry have to move together or one of them lies.
  {
    id: 'dotnet',
    manifest: ['packages.config'],
    lock: ['packages.lock.json'],
    build: null,
    why: 'packages.config is the legacy manifest and packages.lock.json the modern resolved set. A .csproj cannot be named here because presence() stats a literal path and every project file is differently named. Not built here: `dotnet restore` executes MSBuild targets and NuGet install scripts from the tree',
  },
  {
    id: 'dotnet-paket',
    manifest: ['paket.dependencies'],
    lock: ['paket.lock'],
    build: null,
    why: 'Paket is the alternative .NET dependency manager and pins its resolved set in paket.lock. Not built here: `paket install` resolves and executes from the network on the host',
  },
  {
    id: 'conan',
    manifest: ['conanfile.txt'],
    lock: ['conan.lock'],
    build: null,
    why: 'C and C++ dependency sets are invisible without Conan metadata, and this is the only ecosystem in this list where the absence had no lane at all before today. Not built here: `conan install` compiles recipes, which is arbitrary package-author code',
  },
  {
    id: 'elixir',
    manifest: ['mix.exs'],
    lock: ['mix.lock'],
    build: null,
    why: 'mix.lock carries the resolved hex versions an advisory feed can be matched against. Not built here: mix.exs is Elixir source and `mix deps.get` evaluates it on the host',
  },
  {
    id: 'swift',
    manifest: ['Package.swift'],
    lock: ['Package.resolved'],
    build: null,
    why: 'Package.resolved pins the SwiftPM graph; without it only version ranges exist. Not built here: Package.swift is Swift source that SwiftPM compiles and runs to produce the manifest',
  },
  {
    id: 'cocoapods',
    manifest: ['Podfile'],
    lock: ['Podfile.lock'],
    build: null,
    why: 'Podfile.lock is the resolved pod set for iOS and macOS projects, which otherwise carry no machine-readable dependency surface. Not built here: a Podfile is Ruby and `pod install` evaluates it',
  },
  {
    id: 'haskell-cabal',
    manifest: ['cabal.project'],
    lock: ['cabal.project.freeze'],
    build: null,
    why: 'the freeze file is the pinned Hackage set; a bare cabal.project leaves versions unresolved. Not built here: `cabal freeze` resolves against the network and runs Setup.hs, which is arbitrary Haskell',
  },
  {
    id: 'haskell-stack',
    manifest: ['stack.yaml'],
    lock: ['stack.yaml.lock'],
    build: null,
    why: 'stack.yaml.lock pins the resolver snapshot and any extra dependencies. Not built here: `stack build` compiles custom Setup.hs from the tree',
  },
  {
    id: 'r-renv',
    manifest: ['DESCRIPTION'],
    lock: ['renv.lock'],
    build: null,
    why: 'renv.lock is the resolved CRAN set; R projects otherwise declare dependencies only in prose or in library() calls no scanner can resolve. Not built here: `renv::restore()` compiles source packages on the host',
  },
  {
    id: 'bun',
    manifest: ['bunfig.toml'],
    lock: ['bun.lockb'],
    build: null,
    why: 'bun.lockb is a binary lockfile against the same npm registry the node ecosystem uses, so a Bun repository has a resolved tree the node entry misses by looking only for the three text lockfiles. The manifest named here is bunfig.toml rather than package.json deliberately: claiming package.json would make every Node repository also report a second, blind Bun ecosystem. Not built here: `bun install` runs lifecycle scripts',
  },
  {
    id: 'deno',
    manifest: ['deno.json'],
    lock: ['deno.lock'],
    build: null,
    why: 'deno.lock pins the resolved module graph including JSR and npm specifiers. Note that the deno-lint and deno-check lanes are correctness tools and produce no advisory verdict, so without this entry a Deno repository looks covered while nothing checks its dependencies against a feed. Not built here: `deno cache` fetches and evaluates remote modules',
  },
]);

// SUBTREES ARE WALKED, AND THEIR VERDICTS STAY THEIR OWN. Root-only detection missed 1Panel's
// core/go.mod and agent/go.mod (both scanned by osv) and coze-loop's whole tree. But a depth-2
// walk cannot feed the old blind-if-ANY collapse: every monorepo has an `examples/` package.json
// with no lockfile by convention, and one of those would turn a fully-locked repo blind and
// then invite --apply to "fix" it. The ROOT decides the repo's state; subtrees are reported
// beside it with their own.
const WALK_SKIP = new Set([
  'node_modules', 'vendor', '.git', 'target', 'dist', 'build', '.venv', 'venv',
  // fixtures are deliberately-broken by design (dependabot-core ships a yarn.lock reading
  // `{ something: else`); they are scanned by the lanes, but they never describe the SHIPPED tree
  'fixtures', '__fixtures__', 'testdata', 'test', 'tests', 'spec', 'example', 'examples',
]);
const WALK_DEPTH = 2;

// preflight.json is panel-published, so the operator's home directory is redacted. Read HOME at
// call time — a const at import defeats test overrides.
function redactHome(s) {
  const h = process.env.HOME;
  const str = String(s == null ? '' : s);
  return h && h.length > 1 ? str.split(h).join('~') : str;
}

// Only ENOENT means absent — a permission error is not evidence of absence.
const presence = (p) => {
  try { statSync(p); return 'yes'; } catch (e) { return e && e.code === 'ENOENT' ? 'no' : 'unknown'; }
};

// True only when package.json is readable, parseable, and declares no dependencies of any kind;
// every failure answers false (unreadable stays blind), and a workspace root is never empty.
function declaresNoDeps(repoPath) {
  let j;
  try { j = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8')); } catch { return false; }
  if (!j || typeof j !== 'object') return false;
  if (j.workspaces) return false;
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const v = j[k];
    if (v && typeof v === 'object' && Object.keys(v).length) return false;
  }
  return true;
}
// 'yes' if any name is present, 'no' only if EVERY name is provably absent, 'unknown' if any lookup
// failed for a reason other than absence — unknown outranks no, and never silently becomes it.
const anyPresence = (repoPath, names) => {
  let out = 'no';
  for (const n of names) {
    const p = presence(join(repoPath, n));
    if (p === 'yes') return 'yes';
    if (p === 'unknown') out = 'unknown';
  }
  return out;
};

// One verdict per ecosystem present; no recognised manifest yields [], which is no-surface, not ok.
// fact: repo lock outranks sidecar lock
export function classify(repoPath, { lockDir = null } = {}) {
  const out = [];
  for (const eco of ECOSYSTEMS) {
    const manifest = anyPresence(repoPath, eco.manifest);
    if (manifest === 'no') continue;                     // provably absent — the only silent skip
    let lock = anyPresence(repoPath, eco.lock);
    let lockSource = lock === 'yes' ? 'repo' : null;
    if (lock === 'no' && lockDir) {
      // guard: unreadable sidecar is a void
      const external = anyPresence(lockDir, eco.lock);
      if (external === 'yes') { lock = 'yes'; lockSource = 'sidecar'; }
      else if (external === 'unknown') lock = 'unknown';
    }
    // An unreadable manifest or lock cannot yield `ok` — it falls to `blind` with the real cause.
    const unreadable = manifest === 'unknown' || lock === 'unknown';
    // A manifest declaring no dependencies cannot be blind — there is nothing to be blind TO.
    // Only npm is decided here (the one trivially readable manifest); fail closed on unreadable.
    const empty = !unreadable && eco.id === 'node' && declaresNoDeps(repoPath);
    if (empty) continue;                                 // yields no-surface, the honest fact
    const locked = lock === 'yes' && !unreadable;
    out.push({
      eco: eco.id,
      state: locked ? 'ok' : 'blind',
      lockMissing: locked ? null : eco.lock[0],
      // fact: lockSource names where the lock is
      lockSource: locked ? lockSource : null,
      ...(locked && lockSource === 'sidecar' ? { lockDir } : {}),
      buildable: !!eco.build,
      why: locked ? null
        : (unreadable
          ? `${manifest === 'unknown' ? eco.manifest[0] : eco.lock[0]} could not be read (permissions, or a broken symlink) — this is a VOID, not a clean repo and not a missing lockfile; building will not fix it`
          : eco.why),
    });
  }
  return out;
}

/**
 * Manifest-bearing directories below the root, to WALK_DEPTH, skipping WALK_SKIP.
 * Returns [{ dir: 'core', ecosystems: [...] }] — relative dirs, each with its own verdict.
 * A directory that cannot be read is reported as such, never skipped into silence.
 */
export function classifyTree(repoPath, { depth = WALK_DEPTH } = {}) {
  const out = [];
  const walk = (abs, rel, left) => {
    if (left <= 0) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); }
    catch (e) {
      if (!e || e.code !== 'ENOENT') out.push({ dir: rel || '.', ecosystems: [], unreadable: `${e && e.code ? e.code : 'error'} — this subtree's state is UNKNOWN, not clean` });
      return;
    }
    for (const d of entries) {
      if (!d.isDirectory() || d.name.startsWith('.') || WALK_SKIP.has(d.name)) continue;
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      const childAbs = join(abs, d.name);
      const ecos = classify(childAbs);
      if (ecos.length) out.push({ dir: childRel, ecosystems: ecos });
      walk(childAbs, childRel, left - 1);
    }
  };
  walk(repoPath, '', depth);
  return out;
}

/**
 * A whole repo's verdict. The ROOT decides `state`; subtrees carry their own.
 *
 * It used to be "blind if ANY ecosystem is blind" over the root only. Widening the search without
 * changing that collapse would have made every monorepo blind on one unlocked examples/ package —
 * and then invited --apply to build it. So the two facts stay apart: `state` is about the tree this
 * repo ships, `subtrees` is about everything else the scanners will nonetheless read.
 */
export function verdictFor(repo, { env = process.env } = {}) {
  if (!repo.path || !existsSync(repo.path)) {
    return { name: repo.name, path: repo.path ?? null, state: 'missing', ecosystems: [],
      note: 'declared or discovered but not on disk — a scan of it would be a void, never a clean' };
  }
  const subtrees = classifyTree(repo.path);
  const subBlind = subtrees.filter((s) => s.ecosystems.some((e) => e.state === 'blind'));
  const subNote = subBlind.length
    ? `${subBlind.length} subtree(s) below the root are blind (${subBlind.slice(0, 4).map((s) => `${s.dir}: ${s.ecosystems.filter((e) => e.state === 'blind').map((e) => e.eco).join('/')}`).join(', ')}${subBlind.length > 4 ? ', …' : ''}) — the scanners read them, so their findings are partial, but they do not decide this repo's state`
    : null;
  const withSub = (v) => (subtrees.length ? { ...v, subtrees, ...(subNote ? { subtreeNote: subNote } : {}) } : v);
  // fact: only the root reads the sidecar
  const ecosystems = classify(repo.path, { lockDir: sidecarLockDir(repo.path, env) });
  if (!ecosystems.length) {
    // Two ways to have no surface: no manifest at all vs a manifest declaring nothing.
    const emptyManifest = presence(join(repo.path, 'package.json')) === 'yes' && declaresNoDeps(repo.path);
    // "No manifest AT THE ROOT" is not "no manifest": a repo whose dependencies live one level
    // down (1Panel's core/ and agent/ go.mod, both scanned by osv) is not a surfaceless one.
    const state = subtrees.length ? 'subtree-only' : 'no-surface';
    return withSub({ name: repo.name, path: repo.path, state, ecosystems: [],
      note: subtrees.length
        ? `no dependency manifest at the root, but ${subtrees.length} subtree(s) below it declare one (${subtrees.slice(0, 4).map((x) => x.dir).join(', ')}${subtrees.length > 4 ? ', …' : ''}) — the deps scanners read those, so this is neither no-surface nor a clean repo`
        : emptyManifest
          ? 'package.json declares no dependencies of any kind — there is no resolved tree to be missing, so this is not blindness and no lockfile should be built for it'
          : 'no dependency manifest of any known ecosystem — nothing for the deps scanners to find, which is not the same as remediated' });
  }
  const blind = ecosystems.filter((e) => e.state === 'blind');
  return withSub({
    name: repo.name, path: repo.path,
    state: blind.length ? 'blind' : 'ok',
    ecosystems,
    note: blind.length ? blind.map((b) => `${b.eco}: ${b.why}`).join(' · ') : null,
  });
}

// WHERE RESOLUTION IS ALLOWED TO RUN, per ecosystem. The thirdParty refusal above stops --apply
// pointing at a corpus we do not own; this decides what happens for the repos it DOES cover, and
// they are not equivalent:
//
// fact: node/python resolution reads a registry and, for a python sdist, EXECUTES that package's build backend, so it is delegated to bin/lockfile-synth.sh's container — --ignore-scripts for npm, a wheel-metadata-only first pass for python, and buildBackendsExecuted reported when it falls back (expiry: never, prev: broken)
// fact: what stays HERE is the one thing that container deliberately refuses — copying the result INTO the tree / that is the mutation --apply exists to perform and it belongs in the function whose name says so (expiry: never, prev: unknown)
// fact: go stays on the host because `go mod download` fetches modules and verifies checksums without executing package code (expiry: if go mod gains an execution path, prev: unknown)
// fact: jvm-gradle is REFUSED by default and there is no container lane for it / `./gradlew dependencies --write-locks` EVALUATES repo-authored Groovy or Kotlin as the operator, with the keychain and every fleet git remote in reach — CW_PREFLIGHT_ALLOW_HOST_EXEC=1 is the deliberate override, an env var rather than a flag so it cannot be typed by habit (expiry: when a container lane exists for gradle, prev: broken)
const CONTAINER_LANE = { node: 'npm', python: 'python' };
const HOST_EXECUTES_REPO_CODE = new Set(['jvm-gradle']);

// Copies the container's lockfile into destDir
// fact: wrote carries absolute paths
function adoptSynthesised(destDir, reportDir) {
  const dir = join(reportDir, 'lockfile-synth');
  let names = [];
  try { names = readdirSync(dir); } catch { return { ok: false, reason: 'the container produced no lockfile-synth/ directory' }; }
  const wrote = [];
  for (const n of names) {
    try {
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, n), readFileSync(join(dir, n)));
      wrote.push(join(destDir, n));
    } catch (e) { return { ok: false, reason: `could not adopt ${n} into ${redactHome(destDir)}: ${e.code || e.message}` }; }
  }
  return wrote.length ? { ok: true, wrote } : { ok: false, reason: 'the container produced no lockfile to adopt' };
}

// Run the minimal build for one blind ecosystem. Never called without an explicit --apply;
// bounded and non-fatal — a repo that refuses to build stays blind and says so.
// fact: only container lanes honour dest
export function buildOne(repoPath, ecoId, { timeoutMs = 300_000, env = process.env, dest = 'sidecar' } = {}) {
  const eco = ECOSYSTEMS.find((e) => e.id === ecoId);
  if (!eco) return { ok: false, reason: `unknown ecosystem '${ecoId}'` };
  if (!eco.build) return { ok: false, reason: 'no build defined for this ecosystem (nothing to do)' };

  if (HOST_EXECUTES_REPO_CODE.has(ecoId) && (env.CW_PREFLIGHT_ALLOW_HOST_EXEC || '') !== '1') {
    return { ok: false, hostExecRefused: true, reason:
      `resolving ${ecoId} runs ${eco.build[0]}, which evaluates this repository's build script as code on the host, as you. `
      + 'There is no container lane for it. Set CW_PREFLIGHT_ALLOW_HOST_EXEC=1 to override deliberately, '
      + 'or leave the repo blind — blind is a stated void and is the safer of the two.' };
  }

  const lane = CONTAINER_LANE[ecoId];
  if (lane) {
    // guard: destination decided before resolving
    const destDir = dest === 'repo' ? repoPath : sidecarLockDir(repoPath, env);
    if (!destDir) {
      return { ok: false, reason: 'no sidecar lockfile root: CW_LOCKFILE_ROOT is unset and evaluations/ is not a symlink into a sidecar — '
        + 'set the root, or pass --into-repo to write the lockfile into the repository itself (a deliberate act on a tree this fleet may not own)' };
    }
    const reportDir = mkdtempSync(join(tmpdir(), 'cw-synth-'));
    const r = spawnSync(join(CW, 'bin', 'lockfile-synth.sh'), [repoPath], {
      encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL',
      env: { ...env, CW_REPORT_DIR: reportDir },
    });
    if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, reason: `lockfile-synth exceeded ${Math.round(timeoutMs / 1000)}s and was killed` };
    // "Could not build it" and "have nothing to build it with" send someone to two different
    // places, and routing through a container adds a THIRD way to have nothing: the script itself
    // could not be executed. All three are toolchainMissing — the repo is not the problem in any
    // of them — and only a real resolution failure is the repo's.
    if (r.error && r.error.code === 'ENOENT') {
      return { ok: false, toolchainMissing: true, reason: 'bin/lockfile-synth.sh could not be executed (no shell on PATH?)' };
    }
    let receipt = null;
    try { receipt = JSON.parse(readFileSync(join(reportDir, 'lockfile-synth.json'), 'utf8')); } catch { /* fall through to the generic reason */ }
    if (!receipt || receipt.synthesised !== true) {
      const why = (receipt && receipt.reason) || '';
      const toolchainMissing = /docker/i.test(why) || (!receipt && r.status !== 0);
      return { ok: false, toolchainMissing,
        reason: redactHome(why || `lockfile-synth wrote no receipt (exit ${r.status}) — the container lane could not run, which is not the repository's defect`).slice(0, 300) };
    }
    const adopted = adoptSynthesised(destDir, reportDir);
    // buildBackendsExecuted travels: a version set obtained by running a third party's build code
    // has different provenance from one read out of wheel metadata, and the caller must be able to
    // tell them apart even though both produce a lockfile.
    return adopted.ok
      ? { ok: true, viaContainer: true, dest: destDir, lockSource: dest === 'repo' ? 'repo' : 'sidecar', wrote: adopted.wrote,
        buildBackendsExecuted: !!receipt.buildBackendsExecuted, packages: receipt.packages ?? null }
      : { ok: false, viaContainer: true, dest: destDir, reason: adopted.reason };
  }

  const [cmd, ...args] = eco.build;
  // Refuse rather than fall back to a system gradle that may resolve different versions.
  if (cmd.startsWith('./') && !existsSync(join(repoPath, cmd.slice(2)))) {
    return { ok: false, reason: `${cmd} is not present in the repo; refusing to substitute a system toolchain that may resolve different versions` };
  }
  try {
    execFileSync(cmd, args, { cwd: repoPath, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], env });
    return { ok: true };
  } catch (e) {
    const raw = String(e.stderr || e.message || '');
    // Prefer the cause line(s) over npm's useless last line; two lines — the KIND and WHICH package.
    const cause = raw.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((l) => /^npm (error|ERR!) (code |404|401|403|E[A-Z]+)/.test(l) || /^(error|Error):/.test(l))
      .slice(0, 2).join(' · ');
    const err = redactHome(cause || raw.split('\n').filter(Boolean).slice(-1)[0] || e.message);
    // "Could not build it" and "have nothing to build it with" are different facts; only the first
    // is the repo's problem.
    const toolchainMissing = e.code === 'ENOENT'
      || /No module named|installing Java|command not found|not recognized as|Unable to locate a Java Runtime/i.test(raw);
    return { ok: false, reason: err.slice(0, 300), toolchainMissing };
  }
}

/**
 * The fleet sweep. `apply:false` (the default) mutates nothing anywhere.
 *
 * fact: `thirdPartyAreas` is a Set of area slugs whose repos --apply REFUSES / building a blind repo runs that repo's OWN resolver — ./gradlew evaluates build.gradle, pip-compile executes an sdist's setup.py, cargo runs build scripts — on the host, as the operator, on a box holding the login keychain and every fleet git remote (expiry: never, prev: broken)
 * fact: for the 100-repo third-party corpus, which already contains 26 OSV-confirmed malicious packages, that is arbitrary code execution / the container-or-refuse rule every other lane follows (bin/depscan-scan.sh, bin/lockfile-synth.sh) had no counterpart here (expiry: never, prev: missing)
 * fact: the sweep never reaches --apply, so this was DORMANT rather than firing — one operator command away, with no guard (expiry: if a caller starts passing apply:true, prev: broken)
 *
 * IT WAS STILL DORMANT UNTIL 2026-08-24, and for two independent reasons, either of which alone
 * defeated it. Both were found by measuring rather than by reading the guard, which looks correct:
 *
 * fact: NOTHING ever passed `thirdPartyAreas` — the only caller that can reach --apply is this file's own CLI (cra.mjs and sweep.mjs pass apply:false) and it omitted the parameter, so it sat at its `null` default and isThirdParty() returned false for every repo in the fleet / built, documented at length, fed by nothing (expiry: never, prev: broken)
 * fact: the predicate read `repo.area`, which is UNSET for 100 of the 101 repos it protects / resolveRepos() leaves `.area` undefined when the area is derived from the name rather than declared per-repo, and everywhere else in this file the resolution is `r.area || areaSlugOf(...)` (expiry: never, prev: broken)
 * fact: 101 repos resolve into a thirdParty area and exactly 1 carries `.area`, so wiring the parameter ALONE would have protected one repo out of 101 and passed a test written against that one (expiry: on re-measure, prev: broken)
 *
 * Hence the fail-closed default below. `thirdPartyAreas: null` NO LONGER MEANS "protect nothing" —
 * with apply:true it now refuses everything, because a caller that has not said which areas are
 * third-party has not established that ANY repo is safe to build. Suppressing the guard is now an
 * explicit act: pass an empty Set. An omission can no longer be silently unsafe, which is the
 * property this guard lacked for its whole existence.
 */
export function preflight(repos, { apply = false, only = null, timeoutMs, thirdPartyAreas = null, intoRepo = false, env = process.env } = {}) {
  const results = [];
  // Fail closed: an --apply that never declared its third-party set is not safe to run at all.
  const undeclared = apply && thirdPartyAreas === null;
  // Resolve area the SAME way the rest of the file does. `repo.area` alone is unset for ~99% of the
  // corpus this exists to protect.
  const areaOf = (repo) => repo.area || areaSlugOf(repo.name);
  const isThirdParty = (repo) => undeclared || !!(thirdPartyAreas && thirdPartyAreas.has(areaOf(repo)));
  for (const repo of repos) {
    if (only && repo.name !== only) continue;
    const v = verdictFor(repo, { env });
    if (apply && v.state === 'blind' && isThirdParty(repo)) {
      const eco = (v.ecosystems || []).filter((e) => e.state === 'blind').map((e) => e.eco).join(', ') || 'its build tooling';
      v.applyRefused = undeclared ? {
        reason: `--apply was called without declaring which areas are thirdParty, so no repo can be shown safe to build — building this one would run ITS resolver (${eco}) on this host, as you`,
        remedy: 'pass thirdPartyAreas (a Set of area slugs) — build it from monitor/projects.json as the CLI does. To deliberately protect nothing, pass an empty Set: silence is no longer consent',
      } : {
        reason: `area '${areaOf(repo)}' is declared thirdParty in monitor/projects.json — building this repo would run ITS resolver (${eco}) on this host, as you, against code nobody here wrote`,
        remedy: `if the fleet does own this code, set thirdParty:false on area '${areaOf(repo)}' in monitor/projects.json; otherwise leave it blind — a blind repo reported as blind is honest, and a lockfile built by us is not the one the project ships`,
      };
    } else if (apply && v.state === 'blind') {
      v.built = [];
      for (const e of v.ecosystems.filter((x) => x.state === 'blind' && x.buildable)) {
        // The ledger: diffed rather than assumed — whatever lock names appear that were not there
        // a moment ago are what this run created.
        const spec = ECOSYSTEMS.find((x) => x.id === e.eco);
        const before = new Set((spec ? spec.lock : []).filter((n) => presence(join(v.path, n)) === 'yes'));
        const r = buildOne(v.path, e.eco, { timeoutMs, env, dest: intoRepo ? 'repo' : 'sidecar' });
        const wroteInRepo = (spec ? spec.lock : [])
          .filter((n) => !before.has(n) && presence(join(v.path, n)) === 'yes')
          .map((n) => join(v.path, n));
        // fact: container lanes report wrote, host lanes diffed
        const wrote = Array.isArray(r.wrote) && r.wrote.length ? r.wrote : wroteInRepo;
        v.built.push({ eco: e.eco, ...r, wrote });
      }
      // A repo left blind only by a missing toolchain is flagged as such.
      if (v.built.length && v.built.every((b) => !b.ok && b.toolchainMissing)) v.toolchainMissing = true;
      // Re-classify from disk rather than trusting the exit code.
      const after = verdictFor(repo, { env });
      const tm = v.toolchainMissing;
      v.state = after.state;
      if (tm) v.toolchainMissing = true;
      v.ecosystems = after.ecosystems;
      v.note = after.note;
    }
    results.push(v);
  }
  // Every state this function can return is initialised, so a state with zero repos prints as 0
  // rather than disappearing. A state that exists but is never displayed is the defect this file exists to catch.
  const tally = { ok: 0, blind: 0, 'subtree-only': 0, 'no-surface': 0, missing: 0 };
  for (const r of results) tally[r.state] = (tally[r.state] || 0) + 1;
  // Redact on the way out, not in the verdict — buildOne() needs the live path.
  const published = results.map((r) => ({
    ...r,
    path: r.path == null ? null : redactHome(r.path),
    ecosystems: (r.ecosystems || []).map((e) => (e.lockDir ? { ...e, lockDir: redactHome(e.lockDir) } : e)),
    ...(r.built ? { built: r.built.map((b) => ({ ...b, ...(b.dest ? { dest: redactHome(b.dest) } : {}), wrote: (b.wrote || []).map(redactHome) })) } : {}),
  }));
  // Bumped when the ecosystem table or the walk changes: 1 -> 2 added rust/ruby/php and the
  // depth-2 subtree walk, which moves repos between states with no change in the repos themselves.
  // A history reader comparing across the bump must treat it as a RE-BASIS, not as repos gaining
  // manifests overnight (the move openTotals made on 2026-08-22).
  return { generated: process.env.CW_NOW || new Date().toISOString(), ecosystemsVersion: 2, tally, repos: published };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const isMain = isMainModule(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
  const has = (n) => argv.includes(n);

  const { loadRegistry } = await import('./registry.mjs');
  const { resolveRepos } = await import('./discover.mjs');

  const reg = loadRegistry({ quiet: true });
  let { repos } = resolveRepos(reg, { selfRoot: CW });
  const area = flag('--area');
  if (area) repos = repos.filter((r) => (r.area || areaSlugOf(r.name)) === area);

  // THE WIRING. This line did not exist until 2026-08-24, which is why the thirdParty guard above
  // protected nothing: this CLI is the only path in the codebase that can reach --apply.
  const thirdPartyAreas = new Set((reg.areas || []).filter((a) => a.thirdParty).map((a) => a.slug));

  const out = preflight(repos, { apply: has('--apply'), only: flag('--only'), thirdPartyAreas, intoRepo: has('--into-repo') });

  if (has('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else {
    for (const r of out.repos) {
      if (r.state === 'ok') continue;
      const glyph = { blind: '▨ BLIND', 'no-surface': '· no surface', missing: '✕ missing' }[r.state] || r.state;
      process.stdout.write(`${glyph.padEnd(14)} ${r.name}${r.note ? `\n${' '.repeat(15)}${r.note}` : ''}\n`);
      for (const b of r.built || []) {
        process.stdout.write(`${' '.repeat(15)}build ${b.eco}: ${b.ok ? 'ok' : `FAILED — ${b.reason}`}\n`);
      }
    }
    const t = out.tally;
    process.stdout.write(`\n${t.ok} scannable · ${t.blind} BLIND · ${t['subtree-only']} subtree-only · ${t['no-surface']} no dependency surface · ${t.missing} not on disk\n`);
    if (t.blind) {
      const tool = out.repos.filter((r) => r.state === 'blind' && r.toolchainMissing);
      process.stdout.write('BLIND is not clean: those repos scan empty because nothing can see their dependencies.\n');
      if (tool.length) process.stdout.write(`${tool.length} of them are blocked on THIS BOX, not on themselves — a missing toolchain (${tool.map((r) => r.name).join(', ')}). Install it and re-run; do not go reading their build scripts.\n`);
      if (tool.length < t.blind) process.stdout.write('The rest: re-run with --apply to build them.\n');
    }
  }
  // A blind repo is a coverage VOID, and a void exits non-zero — the same rule liveness.mjs follows.
  process.exitCode = out.tally.blind ? 4 : 0;
}
