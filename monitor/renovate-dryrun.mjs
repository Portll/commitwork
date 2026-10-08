#!/usr/bin/env node
// Headless Renovate dry-run — pending-update visibility WITHOUT waiting for the Mend app's
// schedule and WITHOUT creating PRs (--dry-run=lookup never writes to the git host).
// Writes <reportsRoot>/<the scanned area's out>/renovate-local.json for the console's Renovate tab
// (source 'local-platform' | 'dry-run'; sits alongside renovate.json [live gh] and
// renovate-manual.json [paste]).
//
// fact: nothing here is a project name any more / three clientA literals (a bare reports/clientA-monorepo/ out path, a sibling dir named `clientA`, the slug 'Portll/clientA') made scanning ANY other checkout write its pending-update state into clientA's report dir, where the panel served it under ClientA's name (expiry: never, prev: wrong)
//   out dir  -> monitor/area.mjs (the one OUT resolver; CW_MONITOR_OUT still wins)
//   local dir-> the registry: the checkout root shared by the area's declared project paths
//   gh slug  -> that checkout's `origin` remote (no remote, no guess — the operator names it)
//
// TWO MODES (same output contract; the same 'packageFiles with updates' debug JSON is parsed):
//   local  (default, offline)  npx renovate --platform=local --dry-run=lookup, cwd=<repoDir>.
//                              Renovate's 'local' platform scans the working directory — NO token,
//                              NO git-host round-trip, NO PRs. Works fully offline once renovate is
//                              fetched. Targets the area's declared checkout by default.
//   github (needs a token)     npx renovate --platform=github --dry-run=lookup <owner/repo>.
//                              Preserved for when RENOVATE_TOKEN (or `gh auth token`) is present.
//
// MODE SELECTION (first match wins):
//   1. argv 'local [repoDir]'         → local, repoDir or the area's declared checkout
//   2. argv 'github [owner/repo]'     → github (explicit; requires a token, aborts if missing)
//   3. RENOVATE_LOCAL=1               → local (repoDir from arg-2 or the area's checkout)
//   4. arg looks like 'owner/repo'    → github IF a token resolves, else FALL BACK to local
//   5. nothing                        → local against the area's checkout
// No token + not-explicitly-github ⇒ local (the tab works offline); we only abort when github
// mode was explicitly requested and no token could be resolved.
//
// usage:
//   node monitor/renovate-dryrun.mjs                       # local scan of the primary area's checkout
//   node monitor/renovate-dryrun.mjs --area client-d          # …of another declared area's checkout
//   node monitor/renovate-dryrun.mjs local /path/to/repo   # local scan of an arbitrary checkout
//   node monitor/renovate-dryrun.mjs github owner/repo     # github dry-run (needs a token)
//   RENOVATE_LOCAL=1 node monitor/renovate-dryrun.mjs      # force local
// token (github mode only): RENOVATE_TOKEN env, else `gh auth token`.
import { execSync, spawnSync } from 'node:child_process';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { withinRoot } from '../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { registry, outDirFor, primaryAreaSlug } from './area.mjs';
import { areaOf, areaLabel } from './registry.mjs';
import { expandHome, resolveRepos } from './discover.mjs';
import { parseRenovateLog } from './renovate-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG = registry();

// npx must write its download cache somewhere user-writable. On this machine ~/.npm has
// root-owned files (old npm bug) so the default cache is unwritable and the fetch fails. Point
// NPM_CONFIG_CACHE at a repo-local dir (fallback: os.tmpdir()) and create it before the spawn, so
// npx bypasses the root-owned ~/.npm entirely. Overridable via CW_NPM_CACHE for a shared cache.
function resolveNpmCacheDir() {
  const candidates = [
    process.env.CW_NPM_CACHE,
    join(HERE, '..', '.npm-cache'),   // repo-local (preferred)
    join(tmpdir(), 'cw-npm-cache'),   // os.tmpdir() fallback if the repo dir is unwritable
  ].filter(Boolean);
  for (const dir of candidates) {
    try { mkdirSync(dir, { recursive: true }); return dir; } catch { /* try next */ }
  }
  return candidates[candidates.length - 1]; // last resort: hand it back even if mkdir failed
}
const NPM_CACHE_DIR = resolveNpmCacheDir();

// ---- which AREA, and which checkout? -----------------------------------------------------------
// `--area <slug>` names the area; absent, the registry's primary area (which THROWS rather than
// fall back to a project name — see area.mjs). Nothing here defaults to a repo called clientA.
const argvAll = process.argv.slice(2);
const areaFlagAt = argvAll.findIndex((a) => a === '--area' || a.startsWith('--area='));
const areaFlag = areaFlagAt < 0 ? null
  : (argvAll[areaFlagAt].startsWith('--area=') ? argvAll[areaFlagAt].slice('--area='.length) : argvAll[areaFlagAt + 1]) || null;
const AREA_SLUG = areaFlag || primaryAreaSlug(REG);

// fact: the area's checkout root is DERIVED from the registry, never guessed from a sibling directory name / an area's entries point into one checkout (clientA declares services/, libs/, buildout/ of the monorepo), so the deepest directory containing all of them is the one renovate must scan (expiry: never, prev: wrong)
// fact: the common ancestor is accepted only when it is itself a declared path or a git checkout root / an area spanning two unrelated repos otherwise resolves to their shared PARENT (~/Repositories) and renovate walks the whole library (expiry: never, prev: broken)
// fact: unresolvable ⇒ NULL and the caller must name a dir / a guess here silently scans the wrong tree (expiry: never, prev: broken)
function areaCheckoutRoot(slug) {
  let paths = (REG.projects || []).filter((p) => areaOf(p.name, REG) === slug).map((p) => resolve(expandHome(p.path)));
  // No DECLARED entry for this area? It is a root-discovered repo that is its own area (client-d,
  // an internal app, …). Ask the same resolver the sweep uses, so "area X's checkout" means the same
  // directory to both tools — and only then, because discovery walks the library roots from disk.
  if (!paths.length) {
    try { paths = resolveRepos(REG, { selfRoot: join(HERE, '..') }).repos.filter((r) => areaOf(r.name, REG) === slug).map((r) => resolve(r.path)); }
    catch { paths = []; }
  }
  if (!paths.length) return null;
  let common = paths[0].split('/');
  for (const p of paths.slice(1)) {
    const parts = p.split('/');
    let i = 0; while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  const dir = common.join('/');
  if (!dir || dir === '/') return null;
  if (paths.includes(dir) || existsSync(join(dir, '.git'))) return dir;
  return null;
}
// CW_RENOVATE_DIR is the area-neutral override; CLIENTA_DIR is kept as a legacy alias so an
// operator's existing environment keeps working (it names one area's checkout, hence the ordering).
const AREA_DIR = process.env.CW_RENOVATE_DIR || process.env.CLIENTA_DIR || areaCheckoutRoot(AREA_SLUG);

// Which area does a scanned checkout belong to? A declared entry whose path contains (or sits
// inside) the target wins; otherwise the directory name goes through the registry's own
// name/members/prefixes rule. areaOf() returns null for a name that is not a safe slug, and null
// must ABORT: writing to a guessed area is precisely the misrouting this resolver removes.
function areaForDir(dir) {
  const t = resolve(dir);
  for (const p of REG.projects || []) {
    const pp = resolve(expandHome(p.path));
    // withinRoot() both ways: the prefix tests were false for every path on Windows, so a declared
    // area never matched its own repository. Either containment direction is a match, as before.
    if (withinRoot(t, pp) || withinRoot(pp, t)) return areaOf(p.name, REG);
  }
  return areaOf(basename(t), REG);
}
// github mode with no explicit slug: derive owner/repo from the checkout's origin remote rather
// than a baked-in 'Portll/clientA'. scannedGit spawns without a shell, so a path is never interpreted.
function slugFromRemote(dir) {
  if (!dir || !existsSync(dir)) return null;
  try {
    const url = scannedGitOut(dir, ['remote', 'get-url', 'origin']).trim();
    const m = url.match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

// npx fetches renovate on first run (it is NOT installed globally). Give it room and never hang.
const RENOVATE_TIMEOUT_MS = Number(process.env.RENOVATE_TIMEOUT_MS || 600000); // 10 min: fetch + full resolve

// ---- resolve a token (github mode only) --------------------------------------------------------
function resolveToken() {
  let t = process.env.RENOVATE_TOKEN;
  if (!t) { try { t = execSync('gh auth token', { encoding: 'utf8' }).trim(); } catch { /* no gh / not logged in */ } }
  return t || null;
}

// ---- decide mode + target ----------------------------------------------------------------------
// --area is consumed above; drop it (and its value) so it can never be read as a repo dir or slug.
const argv = argvAll.filter((a, i) => !(a === '--area' || a.startsWith('--area=') || (areaFlagAt >= 0 && !argvAll[areaFlagAt].includes('=') && i === areaFlagAt + 1)));
const explicitMode = argv[0] === 'local' || argv[0] === 'github' ? argv[0] : null;
const rest = explicitMode ? argv.slice(1) : argv;
const arg0 = rest[0] || '';
const looksLikeSlug = /^[\w.-]+\/[\w.-]+$/.test(arg0) && !existsSync(arg0);

let mode;      // 'local' | 'github'
let repoDir;   // local mode: filesystem dir to scan
let repo;      // github mode: owner/repo slug  (also a label field in the output for local)
let token = null;

// The area's checkout is the default target in every local branch below. Missing (an area whose
// entries span unrelated repos, or a registry with no path for it) is a NAMED abort, not a guess.
function defaultLocalDir() {
  if (AREA_DIR) return AREA_DIR;
  console.error(`renovate-dryrun: no local checkout resolves for area '${AREA_SLUG}' — its declared paths share no single checkout root.`);
  console.error('renovate-dryrun: pass one explicitly (`local <dir>`) or set CW_RENOVATE_DIR. Aborting rather than scanning a guessed directory.');
  process.exit(2);
}

if (explicitMode === 'github') {
  mode = 'github';
  // no slug passed → the area checkout's own origin remote. No remote, no default: a hardcoded
  // owner/repo would dry-run SOMEONE ELSE'S repo and file the result under this area's name.
  repo = arg0 || slugFromRemote(AREA_DIR);
  if (!repo) {
    console.error(`renovate-dryrun: github mode needs an <owner/repo> — none was passed and no origin remote resolved for area '${AREA_SLUG}'${AREA_DIR ? ` (${AREA_DIR})` : ''}.`);
    console.error('renovate-dryrun: pass it explicitly: node monitor/renovate-dryrun.mjs github <owner/repo>. Aborting.');
    process.exit(2);
  }
  token = resolveToken();
  if (!token) {
    console.error('renovate-dryrun: github mode requested but no RENOVATE_TOKEN and `gh auth token` failed — aborting.');
    console.error('renovate-dryrun: drop the "github" arg (or unset it) to run the offline local-platform scan instead.');
    process.exit(2);
  }
} else if (explicitMode === 'local' || process.env.RENOVATE_LOCAL === '1') {
  mode = 'local';
  repoDir = arg0 && existsSync(arg0) ? arg0 : defaultLocalDir();
  repo = 'local:' + repoDir;
} else if (looksLikeSlug) {
  // a slug was passed without an explicit mode → github IF a token resolves, else fall back to local
  token = resolveToken();
  if (token) { mode = 'github'; repo = arg0; }
  else {
    mode = 'local'; repoDir = defaultLocalDir(); repo = 'local:' + repoDir;
    console.error(`renovate-dryrun: "${arg0}" needs a token for github mode and none resolved — falling back to offline local scan of ${repoDir}`);
  }
} else {
  // nothing usable → default offline local scan of the area's checkout
  mode = 'local';
  repoDir = arg0 && existsSync(arg0) ? arg0 : defaultLocalDir();
  repo = 'local:' + repoDir;
}

// ---- where the report lands --------------------------------------------------------------------
// The area of the thing actually SCANNED, not of the tool: a local scan of some other checkout, or
// a github dry-run of another repo, belongs in THAT area's report dir. An explicit --area wins
// (the operator named it); CW_MONITOR_OUT still wins over both inside outDirFor().
const scannedArea = areaFlag || (mode === 'local' ? areaForDir(repoDir) : areaOf(repo.split('/').pop(), REG));
if (!scannedArea) {
  console.error(`renovate-dryrun: cannot resolve an area for ${mode === 'local' ? repoDir : repo} — its name is not a usable area slug.`);
  console.error('renovate-dryrun: pass --area <slug> (or set CW_MONITOR_OUT) rather than have the report filed under a guessed project. Aborting.');
  process.exit(2);
}
const OUT_DIR = outDirFor(scannedArea, REG);
const OUT = join(OUT_DIR, 'renovate-local.json');

// ---- build the spawn --------------------------------------------------------------------------
// The 'packageFiles with updates' inventory is a DEBUG-level, LOG_FORMAT=json message in BOTH
// platforms — LOG_LEVEL=debug + LOG_FORMAT=json is REQUIRED or the parser sees nothing and reports
// a false 0 (proven 2026-07-20). --yes lets npx fetch renovate non-interactively (not global).
//
// fact: the fetch is PINNED (2026-08-20) / a bare 'renovate' spec made every run resolve and execute whatever the registry served — a several-hundred-package unpinned fetch performed by the security monitor itself (expiry: never, prev: broken)
// fact: an unpinned renovate also moves this tool's ANSWER — "which updates would renovate propose" — for reasons unrelated to the scanned repo, so a diff in the pending-update count could not be attributed (expiry: never, prev: broken)
// fact: the same version lives in three places — here, package.json devDependencies (^44.140.0), and manifests/security-baseline.json's deps-renovate pin / three independent races to `latest` otherwise (expiry: when they are derived from one source, prev: drifted)
// fact: bin/test/no-unpinned-fetch.test.mjs fails if the pin is DROPPED but does NOT check that the three agree / bump this alongside package.json by hand (expiry: when that test compares the three, prev: missing)
const RENOVATE_PIN = 'renovate@44.140.0';
let renoArgs, spawnCwd, spawnEnv, targetDesc;
if (mode === 'github') {
  renoArgs = ['--yes', RENOVATE_PIN, '--platform=github', '--dry-run=lookup', repo];
  spawnCwd = join(HERE, '..');
  spawnEnv = { ...process.env, NPM_CONFIG_CACHE: NPM_CACHE_DIR, RENOVATE_TOKEN: token, LOG_LEVEL: 'debug', LOG_FORMAT: 'json' };
  targetDesc = `github ${repo}`;
} else {
  if (!existsSync(repoDir)) {
    console.error(`renovate-dryrun: local target dir does not exist: ${repoDir} — set CW_RENOVATE_DIR or pass "local <dir>". Aborting.`);
    process.exit(2);
  }
  // local platform reads the working directory; ONBOARDING off + REQUIRE_CONFIG=optional so a
  // repo without renovate.json still resolves against manager defaults (no PRs at --dry-run=lookup).
  renoArgs = ['--yes', RENOVATE_PIN, '--platform=local', '--dry-run=lookup'];
  spawnCwd = repoDir;
  spawnEnv = {
    ...process.env,
    NPM_CONFIG_CACHE: NPM_CACHE_DIR,
    LOG_LEVEL: 'debug', LOG_FORMAT: 'json',
    RENOVATE_PLATFORM: 'local',
    RENOVATE_ONBOARDING: 'false',
    RENOVATE_REQUIRE_CONFIG: process.env.RENOVATE_REQUIRE_CONFIG || 'optional',
  };
  delete spawnEnv.RENOVATE_TOKEN; // local platform needs no token; don't leak one in
  targetDesc = `local ${repoDir}`;
}

// structural/dry preview: --print-argv prints the exact command and exits WITHOUT running renovate
// (handy for verification / when the npx fetch would be slow). e.g. RENOVATE_LOCAL=1 node … --print-argv
if (argv.includes('--print-argv') || process.env.RENOVATE_PRINT_ARGV === '1') {
  console.log(JSON.stringify({
    mode, target: targetDesc, cwd: spawnCwd,
    area: scannedArea, areaLabel: areaLabel(scannedArea, REG), // WHICH area's dir this report lands in
    argv: ['npx', ...renoArgs],
    env: Object.fromEntries(Object.entries(spawnEnv).filter(([k]) => k.startsWith('RENOVATE_') || k === 'LOG_LEVEL' || k === 'LOG_FORMAT' || k === 'NPM_CONFIG_CACHE')),
    out: OUT,
  }, null, 2));
  process.exit(0);
}

console.log(`renovate-dryrun: ${targetDesc} · --dry-run=lookup (no PRs will be created)`);
const r = spawnSync('npx', renoArgs, {
  cwd: spawnCwd,
  env: spawnEnv,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  timeout: RENOVATE_TIMEOUT_MS,
});

// honest failure when npx couldn't even launch or fetch renovate (offline + not cached, ENOENT, timeout)
if (r.error) {
  const why = r.error.code === 'ETIMEDOUT'
    ? `renovate did not finish within ${RENOVATE_TIMEOUT_MS}ms (npx fetch may be slow / offline)`
    : `could not launch npx renovate: ${r.error.message}`;
  console.error(`renovate-dryrun: ${why} — writing an honest "did not run" report.`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: mode === 'local' ? 'local-platform' : 'dry-run',
    mode, repo, target: targetDesc,
    // WHOSE state this is: the reader (and any future merge with renovate.json) must be able to
    // tell an area's own dry-run from a file that merely landed in its directory.
    area: scannedArea, areaLabel: areaLabel(scannedArea, REG),
    ran: false,
    error: why,
    exitCode: null,
    updateCount: 0,
    repoProblems: [],
    updates: [],
  }, null, 2));
  process.exit(1);
}

const { updates, repoProblems, notLookedUp } = parseRenovateLog(r.stdout);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: mode === 'local' ? 'local-platform' : 'dry-run',
  mode,
  repo,
  target: targetDesc,
  area: scannedArea, areaLabel: areaLabel(scannedArea, REG),
  ran: true,
  exitCode: r.status,
  updateCount: updates.length,
  // updateCount is a floor while any lookup was not performed; these deps have no known state.
  lookupComplete: notLookedUp.length === 0,
  notLookedUp,
  repoProblems,
  updates,
}, null, 2));
console.log(`renovate-dryrun: exit ${r.status} · ${updates.length} pending update(s) · area ${areaLabel(scannedArea, REG)} -> ${OUT}`);
if (notLookedUp.length) {
  const reasons = [...new Set(notLookedUp.map((d) => d.skipReason))].join(', ');
  console.error(`renovate-dryrun: ${notLookedUp.length} dependency lookup(s) NOT performed (${reasons}) — the pending count is a floor, not a total. Set RENOVATE_GITHUB_COM_TOKEN to a read-only github.com token to look them up.`);
}
if (r.status !== 0) {
  const errTail = (r.stderr || '').split('\n').filter(Boolean).slice(-5).join('\n');
  console.error('renovate stderr tail:\n' + errTail);
  process.exit(r.status ?? 1);
}
