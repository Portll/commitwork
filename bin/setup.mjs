#!/usr/bin/env node
// commitwork setup — cross-platform scanner installer. Checks the toolchain against
// manifests/install-catalog.json; installs via the first package manager present. Non-TTY runs
// never prompt; installs are argv-array spawns (no shell) and every install is re-probed.
//
// usage: node bin/setup.mjs [--yes] [--only a,b]
// exit: 0 every requested tool was present or installed, or nothing was requested (report-only,
//       declined) · 20 a requested install failed, or a tool --only named has no installer here ·
//       21 nothing failed, but a requested tool needs an administrator; the closing block names the
//       command
// env, read at call time: CW_INSTALL_CATALOG (the catalogue to plan from), CW_SETUP_PLATFORM (the
//       platform to plan for), CW_SETUP_ARCH (the architecture to plan for), CW_SETUP_UID (the uid
//       to plan for; a root test suite still reaches the non-root path), CW_SETUP_RELEASE_BASE (the
//       release download origin), CW_SETUP_BIN_DIR (where release binaries go), CW_SKIP_SETUP (1
//       skips the first-run check)

import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { isMainModule } from '../lib/is-main.mjs';
import { useScopedDockerConfig } from '../lib/docker-config.mjs';
import { safeSpawnSync } from '../lib/win-spawn.mjs'; // npm/scoop/gem are .cmd shims on Windows and cannot be spawned directly
import { resolvePinnedTool } from '../lib/cobolwork-resolve.mjs';
import { verifyReleaseSignature } from '../lib/release-signing.mjs';
import { recordProvenance } from '../lib/tool-provenance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// The same override the panel's scanner routes read; both read at call time.
const catalogPath = () => process.env.CW_INSTALL_CATALOG || join(HERE, '..', 'manifests', 'install-catalog.json');
const stampPath = () => join(homedir(), '.commitwork', 'setup.json');
const WIN = process.platform === 'win32';

const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const red = (s) => c('31', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);

export function hasTool(name) {
  // `where.exe`, spelled out: PowerShell aliases the bare word `where` to Where-Object. spawnSync
  // does not go through PowerShell so the .exe is what runs either way, but naming it means a
  // reader does not have to know that to be sure.
  if (WIN) return spawnSync('where.exe', [name], { stdio: 'ignore', shell: false, windowsHide: true }).status === 0;
  return spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', name], { stdio: 'ignore' }).status === 0;
}

// TWO ENTRY SHAPES, and conflating them makes tools uninstallable everywhere.
//
//   `pkg`  — brew/winget/scoop/pipx/npm carry a PACKAGE ID, wrapped in that manager's install verb.
//   `cmd`  — cargo/gem/composer/go carry a WHOLE COMMAND STRING ("cargo install cargo-audit
//            --locked", "gem install brakeman"), because the language managers each want their own
//            flags and the catalog already stated them that way.
//
// Every manager the catalog names needs an entry here, or `toolPlan()`'s `managers.find((m) =>
// spec[m])` can never select it: cargo-audit, brakeman, bundle-audit, psalm and
// phpcs-security-audit have no other installer at all.
//
// A catalog entry no manager can act on is worse than a missing entry: the missing one is a gap
// somebody can see, and the inert one looks like coverage.
const MANAGERS = {
  brew: { cmd: (pkg) => ['brew', 'install', pkg] },
  winget: { cmd: (pkg) => ['winget', 'install', '--id', pkg, '-e', '--accept-source-agreements', '--accept-package-agreements'] },
  // No `cmd /c` special case for scoop: lib/win-spawn.mjs resolves what a command actually IS on
  // the host and routes a batch shim through cmd.exe for every manager.
  scoop: { cmd: (pkg) => ['scoop', 'install', pkg] },
  pipx: { cmd: (pkg) => ['pipx', 'install', pkg] },
  // npm -g — for CLIs that ship only on npm; a catalog entry no manager can act on is inert.
  npm: { cmd: (pkg) => ['npm', 'install', '-g', pkg] },
  // The language managers. These carry EITHER shape, and the catalogue genuinely uses both under
  // the same key: `psalm.composer` is the package id "vimeo/psalm:6.x-dev", while
  // `phpcs-security-audit.composer` is the whole command "composer global require pheromone/…".
  // So the shape is DETECTED from the value rather than declared per manager — an entry beginning
  // with the manager's own name is a command, anything else is a package id to be wrapped.
  cargo: { cmd: (pkg) => ['cargo', 'install', pkg] },
  gem: { cmd: (pkg) => ['gem', 'install', pkg] },
  composer: { cmd: (pkg) => ['composer', 'global', 'require', pkg] },
  go: { cmd: (pkg) => ['go', 'install', pkg] },
  // Distribution managers, Linux only and LAST in the order. Their versions trail by years (Debian 12
  // ships go 1.19 and no gitleaks), so the catalogue gives them only the language managers and
  // bubblewrap, never a scanner another manager supplies. On a clean Debian host with none of brew,
  // pipx, cargo, gem or go, these make the managers themselves installable.
  apt: { cmd: (pkg) => [...asRoot(), 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--no-install-recommends', pkg],
    probe: 'apt-get', root: true, prepare: () => [...asRoot(), 'apt-get', 'update'] },
  dnf: { cmd: (pkg) => [...asRoot(), 'dnf', 'install', '-y', pkg], root: true },
  // An upstream release binary, pinned by tag and per-platform SHA-256 in the catalogue and checked
  // against the publisher's signature (lib/release-signing.mjs). It goes FIRST on every platform:
  // the publisher's own bytes under our pin outrank a package manager's rebuild or re-pointer
  // (brew/winget/scoop choose the version and the bytes; apt/dnf trail by years).
  release: { cmd: () => null, probe: 'tar', supports: (v) => !!releaseAsset(v) },
};

const arch = () => process.env.CW_SETUP_ARCH || process.arch;
/** The pinned asset for this platform and architecture, or null. */
export function releaseAsset(spec) {
  const a = spec?.[platform()]?.[arch()];
  return a && typeof a.asset === 'string' && /^[0-9a-f]{64}$/.test(a.sha256 || '') ? a : null;
}
const releaseBase = () => process.env.CW_SETUP_RELEASE_BASE || 'https://github.com';
export const releaseUrl = (spec, a) => `${releaseBase()}/${spec.repo}/releases/download/${spec.tag}/${a.asset}`;
const releaseBinDir = () => process.env.CW_SETUP_BIN_DIR || join(homedir(), '.local', 'bin');

// sudo -n never prompts: without root or passwordless sudo the manager is reported, not driven.
const uid = () => {
  const o = process.env.CW_SETUP_UID;
  if (o !== undefined && o !== '') return Number(o);
  return typeof process.getuid === 'function' ? process.getuid() : null;
};
const isRoot = () => uid() === 0;
const asRoot = () => (isRoot() ? [] : ['sudo', '-n']);
let _elevation = null;
/** 'root', 'passwordless' (sudo -n works), 'password' (sudo is here and asks for one) or 'absent'. */
export function elevation() {
  if (_elevation === null) {
    _elevation = isRoot() ? 'root' : !hasTool('sudo') ? 'absent'
      : spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0 ? 'passwordless' : 'password';
  }
  return _elevation;
}
const canRoot = () => elevation() === 'root' || elevation() === 'passwordless';
const managerBinary = (m) => MANAGERS[m].probe || m;

/**
 * The argv for one catalog entry, honouring both shapes.
 *
 * Getting this wrong in either direction is silent: wrapping a command produces
 * `cargo install "cargo install cargo-audit --locked"`, and splitting a package id produces a
 * one-word argv that runs the manager with no arguments. Both "succeed" at the spawn level.
 */
export function argvFor(manager, value) {
  if (manager === 'release') {
    const a = releaseAsset(value);
    return a ? ['download', releaseUrl(value, a), `sha256:${a.sha256}`] : null;
  }
  const m = MANAGERS[manager];
  if (!m || value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  // A value that begins with the manager's own name IS the command, verbatim. Split on whitespace
  // only: these are catalogue-authored constants with no quoting, asserted by the shape test.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- manager is a MANAGERS key checked on the line above, never free text
  if (new RegExp(`^${manager}\\s`).test(s)) {
    const argv = s.split(/\s+/).filter(Boolean);
    return argv.length > 1 ? argv : null;
  }
  return m.cmd(s);
}

/**
 * `postInstall` also carries two shapes, and the code read only one.
 *
 * The catalogue has ONE entry that is an array of argv arrays (codeql: `[["codeql","pack",…]]`)
 * and SIX that are prose strings ("needs Ruby >= 3.2. macOS system Ruby is 2.6, where gem
 * silently installs brakeman 5.4.1 instead of failing…"). Both installOne() and the not-ready
 * report iterated `postInstall` and called `.join(' ')` on each element — with a string that
 * iterates CHARACTERS, and `'n'.join` is not a function. A TypeError mid-install, for six of
 * forty-six tools, on every platform.
 *
 * Prose is a NOTE and is never executed. Anything not confidently readable as an argv array is
 * treated as a note too: refusing to run an unrecognised shape is the only safe default when the
 * alternative is spawning it.
 * -> { commands: string[][], notes: string[] }
 */
export function postInstallSteps(spec) {
  const raw = spec && spec.postInstall;
  if (!raw) return { commands: [], notes: [] };
  if (typeof raw === 'string') return { commands: [], notes: [raw] };
  if (!Array.isArray(raw)) return { commands: [], notes: [String(raw)] };
  const commands = [], notes = [];
  for (const step of raw) {
    if (Array.isArray(step) && step.length && step.every((a) => typeof a === 'string' && a.length)) commands.push(step);
    else notes.push(typeof step === 'string' ? step : JSON.stringify(step));
  }
  return { commands, notes };
}

// Order matters: the FIRST manager present wins. The language managers go last on every platform
// because a native package is preferable to a from-source build, but they are present on both.
// CW_SETUP_PLATFORM lets a test drive the Linux order from another OS; read at call time.
const platform = () => process.env.CW_SETUP_PLATFORM || process.platform;
const managerOrder = () => (WIN
  ? ['release', 'winget', 'scoop', 'pipx', 'npm', 'cargo', 'gem', 'composer', 'go']
  : ['release', 'brew', 'pipx', 'npm', 'cargo', 'gem', 'composer', 'go', ...(platform() === 'linux' ? ['apt', 'dnf'] : [])]);

let _managers = null;
function managersPresent() {
  if (_managers === null) {
    _managers = managerOrder().filter((m) => hasTool(managerBinary(m)) && (!MANAGERS[m].root || canRoot()));
  }
  return _managers;
}

const resetProbes = () => { _managers = null; _elevation = null; };

/** A distribution manager on PATH that cannot be driven here because it needs root. */
function rootGatedManagers() {
  return managerOrder().filter((m) => MANAGERS[m].root && hasTool(managerBinary(m)) && !managersPresent().includes(m));
}

/**
 * Each manager this platform orders: 'usable', 'needs-root' (on PATH, but no root and no
 * passwordless sudo) or 'absent'. Folding the middle state into 'absent' would tell a non-root
 * Debian user apt is not installed, when what is missing is permission.
 */
export function managerStates() {
  const usable = managersPresent();
  const gated = rootGatedManagers();
  return Object.fromEntries(managerOrder().map((m) => [m, usable.includes(m) ? 'usable' : gated.includes(m) ? 'needs-root' : 'absent']));
}

export const elevationWhy = (how = elevation()) => (how !== 'password'
  ? 'this user is not root and there is no sudo' : 'this user is not root and sudo asks for a password');

/** What an administrator runs to install `pkgs` through root-only manager `m`. */
export function elevatedCommand(m, pkgs, how = elevation()) {
  const s = how === 'password' ? 'sudo ' : '';
  const line = m === 'apt' ? `${s}apt-get update && ${s}apt-get install -y --no-install-recommends ${pkgs.join(' ')}`
    : `${s}${m} install -y ${pkgs.join(' ')}`;
  return s ? line : `as root: ${line}`;
}

// Missing either one changes what a lane's result means, so the block says which way.
const CONFINEMENT = {
  bwrap: 'without bwrap every lane runs unconfined',
  pasta: 'without pasta every lane with network egress is refused as noscan',
};

/**
 * The closing block: every missing package a root-only manager here could install, one command per
 * manager, or null. Printed on every path out of runSetup, report-only included.
 */
export function elevationBlock(rows, how = null) {
  const gatedRows = rows.filter((r) => !r.present && r.absence === 'needs-root');
  if (!gatedRows.length) return null;
  how ??= elevation();
  const by = [...new Set(gatedRows.map((r) => r.needsRoot))];
  const lines = [`needs an administrator — ${by.join(' and ')} ${by.length > 1 ? 'are' : 'is'} installed, but ${elevationWhy(how)}. Run:`];
  for (const m of by) lines.push(`    ${elevatedCommand(m, [...new Set(gatedRows.filter((r) => r.needsRoot === m).map((r) => r.rootPkg))], how)}`);
  const conf = gatedRows.filter((r) => CONFINEMENT[r.name]);
  if (conf.length) {
    lines.push(`  ${conf.map((r) => `${r.name} (package ${r.rootPkg})`).join(' and ')} decide${conf.length > 1 ? '' : 's'} whether lanes are confined: ${conf.map((r) => CONFINEMENT[r.name]).join('; ')}`);
  }
  lines.push('  then run `commitwork setup --yes` again for the tools those managers install');
  return lines;
}

export function loadCatalog() {
  return JSON.parse(readFileSync(catalogPath(), 'utf8'));
}

// Every manager this installer knows how to drive, in catalog-key form. Used to tell a tool that
// CANNOT be installed here from one whose install line was simply never written down.
export const KNOWN_MANAGERS = Object.keys(MANAGERS);

/**
 * Why is there no argv for this tool? THREE distinct answers, and printing one sentence for all
 * three hides which one applies.
 *
 *   'manual'        — the catalog says so on purpose (docker, safe-chain). A platform fact.
 *   'needs-manager' — the catalog HAS an installer for this tool; the manager it needs is not on
 *                     this box. One human action clears it, and the message can name that action.
 *   'catalog-gap'   — no manager in the catalog can install this tool AT ALL. That is not a
 *                     property of the machine, it is a hole in our own data, and it must not be
 *                     reported as if the platform were at fault. `opengrep` and `sobelow` are here.
 */
export function absenceKind(spec) {
  if (spec.manual) return 'manual';
  if (spec.providedBy) return 'provided-by';
  const declared = KNOWN_MANAGERS.filter((m) => spec[m]);
  if (!declared.length) return 'catalog-gap';
  return 'needs-manager';
}

// -> [{name, why, present, manual, via, argv, url}] for the catalog (or an --only subset)
export function toolPlan(only = []) {
  const cat = loadCatalog();
  const managers = managersPresent();
  const gated = rootGatedManagers();
  return Object.entries(cat.tools)
    .filter(([name]) => !only.length || only.includes(name))
    // bubblewrap is the Linux sandbox; reporting it missing on macOS would be a false gap.
    .filter(([, spec]) => !spec.platforms || spec.platforms.includes(platform()))
    .map(([name, spec]) => {
      const usable = (m) => spec[m] && (!MANAGERS[m].supports || MANAGERS[m].supports(spec[m]));
      const via = spec.manual ? null : managers.find(usable);
      // A pinned tool is present when its pinned install verifies; PATH is not asked.
      const pinned = resolvePinnedTool(name);
      const present = pinned ? pinned.ok : hasTool(name);
      const couldUse = via ? null : KNOWN_MANAGERS.filter(usable);
      const kind = via ? null : absenceKind(spec);
      const needsRoot = kind === 'needs-manager' ? couldUse.find((m) => gated.includes(m)) || null : null;
      return { name, why: spec.why, present, manual: !!spec.manual, via,
        argv: via ? argvFor(via, spec[via]) : null, url: spec.url,
        // Which managers COULD install this, so "install one of these" is actionable rather than
        // a shrug. Empty for a catalog gap, which is our problem and not the operator's.
        absence: needsRoot ? 'needs-root' : kind,
        couldUse,
        // The root-only manager on PATH that would install it, and the package it would ask for.
        needsRoot, rootPkg: needsRoot ? spec[needsRoot] : null,
        // `providedBy` is declared in the catalog (mix <- elixir, cargo-clippy <- cargo); unread,
        // both would render as "no installer for this platform" — a false statement about a tool
        // that arrives with another one.
        providedBy: spec.providedBy || null,
        // Present is not ready: hasTool() only proves the binary resolves on PATH.
        ready: present ? toolReady(spec) : null,
        readyWhy: spec.ready?.why || null,
        // requiresAccount: what's missing lives at a vendor — no local probe can pass.
        requiresAccount: spec.requiresAccount || null,
        steps: spec.steps || null,
        postInstall: spec.postInstall || null };
    });
}

/** `steps` as lines: the catalogue writes them as an array or as an {id: text} map. */
export function stepLines(steps) {
  if (!steps) return [];
  return Array.isArray(steps) ? steps.map(String) : Object.entries(steps).map(([k, v]) => `${k}: ${v}`);
}

/**
 * One line naming the managers that would unblock the missing tools, most first, or null. A box
 * with only npm installs one tool and is told nothing about the rest without it.
 */
export function strandedSummary(rows, order = managerOrder()) {
  const stranded = rows.filter((r) => !r.present && r.absence === 'needs-manager');
  if (!stranded.length) return null;
  const unlocks = order.map((m) => [m, stranded.filter((r) => r.couldUse.includes(m)).length])
    .filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  return `${stranded.length} missing tool(s) need a package manager this machine lacks — `
    + unlocks.map(([m, n]) => `${m} would install ${n}`).join(', ');
}

// one-liner for doctor: how to get a missing tool on this machine
export function installHintFor(name) {
  const spec = loadCatalog().tools[name];
  if (!spec) return null;
  if (spec.manual) return spec.url;
  const via = managersPresent().find((m) => spec[m]);
  if (via) return argvFor(via, spec[via]).join(' ');
  // Not "here is a url" for every case. A tool whose installer needs a manager the box lacks gets
  // told WHICH manager — that is one action away, and a url is a reading assignment.
  if (spec.providedBy) return `arrives with ${spec.providedBy} — install that`;
  const gated = rootGatedManagers().find((m) => spec[m]);
  if (gated) return `needs root: ${gated} is installed, but ${elevationWhy()} — ${elevatedCommand(gated, [spec[gated]])}`;
  const could = KNOWN_MANAGERS.filter((m) => spec[m]);
  if (could.length) return `needs ${could.join(' or ')} — none is installed; or ${spec.url}`;
  return spec.url;
}

// Absent `ready` means presence IS readiness; a failing probe is reported, never assumed fine.
function toolReady(spec) {
  if (!spec.ready) return true;
  const { cmd, expect } = spec.ready;
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
  if (r.error || r.status !== 0) return false;
  return expect ? String(r.stdout || '').includes(expect) : true;
}

const spawnOut = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
};

/** Where each language manager puts the binaries it installs, read at call time. */
export function managerBinDirs(manager, { home = homedir(), env = process.env, ask = spawnOut } = {}) {
  switch (manager) {
    case 'pipx': return [env.PIPX_BIN_DIR, join(home, '.local', 'bin')];
    case 'go': return [env.GOBIN, join(env.GOPATH || join(home, 'go'), 'bin')];
    case 'cargo': return [join(env.CARGO_HOME || join(home, '.cargo'), 'bin')];
    case 'composer': return [join(env.COMPOSER_HOME || join(home, '.config', 'composer'), 'vendor', 'bin'), join(home, '.composer', 'vendor', 'bin')];
    case 'gem': return [ask('ruby', ['-e', 'print Gem.bindir']), ask('ruby', ['-e', 'print Gem.user_dir']) && join(ask('ruby', ['-e', 'print Gem.user_dir']), 'bin')];
    case 'npm': { const prefix = ask('npm', ['prefix', '-g']); return prefix ? [WIN ? prefix : join(prefix, 'bin')] : []; }
    case 'release': return [releaseBinDir()];
    default: return [];
  }
}

/** The manager's bin directory holding `name` when PATH does not reach it, or null. */
export function locateOffPath(name, manager, opts) {
  const names = platform() === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  return managerBinDirs(manager, opts).filter(Boolean).find((d) => names.some((n) => existsSync(join(d, n)))) || null;
}

// A manager that succeeded can still leave its binary outside this process's PATH: pipx writes to
// ~/.local/bin, which a login shell adds only once the directory exists. Reporting that as a
// failure would publish working scanners as broken.
const offPath = new Map();
const releaseTier = new Map();
async function fetchRelease(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
/**
 * Download a pinned release asset, refuse it unless its SHA-256 is the catalogued one AND its
 * declared publisher signature verifies (lib/release-signing.mjs), and copy only the tool's own
 * binary into the release bin directory. Nothing from the archive is run.
 */
async function installRelease(row) {
  const spec = loadCatalog().tools[row.name].release;
  const a = releaseAsset(spec);
  const url = releaseUrl(spec, a);
  console.log(dim(`  $ download ${url}`));
  let buf;
  try { buf = await fetchRelease(url); } catch (e) { console.log(red(`  ✗ ${row.name} download failed — ${e.message}`)); return false; }
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== a.sha256) { console.log(red(`  ✗ ${row.name} REFUSED — sha256 ${got} is not the pinned ${a.sha256}`)); return false; }
  const sig = await verifyReleaseSignature({ spec, asset: a.asset, sha256: a.sha256, fetchAsset: (name) => fetchRelease(releaseUrl(spec, { asset: name })) });
  if (!sig.ok) { console.log(red(`  ✗ ${row.name} REFUSED — ${sig.reason}`)); return false; }
  console.log((sig.tier === 'cosign' ? green : yellow)(`  ${row.name}: sha256 pinned; ${sig.detail}`));
  releaseTier.set(row.name, sig);
  const bin = a.bin || (platform() === 'win32' ? `${row.name}.exe` : row.name);
  const tmp = mkdtempSync(join(tmpdir(), 'cw-setup-release-'));
  try {
    // The archive keeps its own name: bsdtar (macOS, Windows 10+) reads a .zip through the same
    // verb, and the format is detected from the bytes rather than assumed from a flag.
    writeFileSync(join(tmp, a.asset), buf);
    const x = spawnSync('tar', ['-xf', join(tmp, a.asset), '-C', tmp, bin], { stdio: 'ignore' });
    if (x.status !== 0 || !existsSync(join(tmp, bin))) { console.log(red(`  ✗ ${row.name}: ${bin} not found in ${a.asset}`)); return false; }
    const dir = releaseBinDir();
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(tmp, bin), join(dir, bin));
    chmodSync(join(dir, bin), 0o755);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return true;
}

/**
 * Why an npm -g install failed, when npm said: EACCES is the global prefix refusing this user, which
 * is correct for a non-root user and not a fault of the package. Null for anything else.
 */
export function npmFailureReason(stderr) {
  const s = String(stderr || '');
  if (!/\bEACCES\b/.test(s)) return null;
  const path = s.match(/^npm (?:error|ERR!) path (\S+)/m)?.[1];
  return `needs a writable npm prefix${path ? ` (EACCES on ${path})` : ''} — set npm_config_prefix to a directory you own and put its bin on PATH, or run as a user who owns the prefix`;
}

const prepared = new Set();
/** -> { ok: true } or { ok: false, reason } where reason is null when nothing more is known. */
async function installOne(row) {
  const ok = await installAttempt(row);
  return typeof ok === 'string' ? { ok: false, reason: ok } : { ok, reason: null };
}

async function installAttempt(row) {
  const prepare = MANAGERS[row.via]?.prepare;
  if (prepare && !prepared.has(row.via)) {
    prepared.add(row.via);
    const argv = prepare();
    console.log(dim(`  $ ${argv.join(' ')}`));
    // A container image ships with empty package lists, and every install then fails to locate.
    if (safeSpawnSync(argv[0], argv.slice(1), { stdio: 'inherit' }).status !== 0) console.log(yellow(`  ${row.via} index refresh failed; installing anyway`));
  }
  if (row.via === 'release') { if (!(await installRelease(row))) return false; } else {
    console.log(dim(`  $ ${row.argv.join(' ')}`));
    // safeSpawnSync, not spawnSync. On Windows most of these managers are BATCH SHIMS — `npm` is
    // `npm.cmd` — and node cannot spawn one without a shell: `spawnSync('npm', …)` returns ENOENT
    // (node does not apply PATHEXT when shell is false) and handing it the explicit `npm.cmd` path
    // returns EINVAL (node ≥18.20.2 refuses, the CVE-2024-27980 fix), so without it the npm manager
    // could install nothing on Windows. The wrapper resolves what the command actually is and
    // routes a shim through cmd.exe with correct quoting — and REFUSES rather than escaping if an
    // argument carries a cmd.exe metacharacter, because `shell: true` here is exactly the
    // vulnerability node declined to try to escape its way out of. npm's stderr is held so an
    // EACCES can be named, then passed on unchanged.
    const npm = row.via === 'npm';
    const r = safeSpawnSync(row.argv[0], row.argv.slice(1), npm
      ? { stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 16 << 20 } : { stdio: 'inherit' });
    if (npm && r.stderr) process.stderr.write(r.stderr);
    if (r.refused) { console.log(red(`  ✗ ${row.name} REFUSED — ${r.reason}`)); return false; }
    if (r.status !== 0) return (npm && npmFailureReason(r.stderr)) || false;
  }
  if (!hasTool(row.name)) {
    const dir = locateOffPath(row.name, row.via);
    if (!dir) return false;
    offPath.set(row.name, dir);
    process.env.PATH = `${dir}${delimiter}${process.env.PATH || ''}`;
  }
  // The install stands whether or not its record does; a record that failed to write is said so.
  try {
    const sig = releaseTier.get(row.name);
    recordProvenance(row.name, { via: row.via, signatureTier: sig?.tier || null, detail: sig?.detail || null });
  } catch (e) { console.log(yellow(`  ${row.name}: provenance not recorded — ${e.message}`)); }
  // installing the binary is not finishing the job for a tool that declares postInstall
  const { commands, notes } = postInstallSteps(row);
  for (const argv of commands) {
    console.log(dim(`  $ ${argv.join(' ')}`));
    const p = safeSpawnSync(argv[0], argv.slice(1), { stdio: 'inherit' });
    if (p.refused) console.log(red(`      post-install REFUSED — ${p.reason}`));
  }
  // Prose is advice for a human and is never spawned. It is still PRINTED — six tools carry a
  // caveat here (brakeman's Ruby version, joern's post-brew fixup) that decides whether the tool
  // that just installed actually works.
  for (const n of notes) console.log(yellow(`      note: ${n}`));
  return true;
}

function writeStamp(data) {
  mkdirSync(dirname(stampPath()), { recursive: true });
  writeFileSync(stampPath(), JSON.stringify({ at: new Date().toISOString(), ...data }, null, 2));
}

export const SETUP_EXIT = { OK: 0, FAILED: 20, NEEDS_ROOT: 21 };

/**
 * The exit status of a runSetup result. Only what was requested counts: a report-only run and a
 * declined prompt requested nothing, and exit 0 whatever is missing.
 */
export function setupExitCode(r) {
  if (r.failed?.length || r.unavailable?.length) return SETUP_EXIT.FAILED;
  if (r.needsRoot?.length) return SETUP_EXIT.NEEDS_ROOT;
  return SETUP_EXIT.OK;
}

export async function runSetup({ yes = false, only = [] } = {}) {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  // A scripted report-only run must never write the stamp
  const stamp = (data) => { if (yes || interactive) writeStamp(data); };
  const rows = toolPlan(only);
  const missing = rows.filter((r) => !r.present);
  const tools = loadCatalog().tools;
  const unknown = only.filter((n) => n && !Object.hasOwn(tools, n));
  console.log(bold('commitwork setup') + dim(` — scanner toolchain: ${rows.length - missing.length}/${rows.length} present`));
  const states = managerStates();
  const inState = (s) => Object.keys(states).filter((m) => states[m] === s);
  console.log(dim(`  package managers: ${[
    inState('usable').length && `${inState('usable').join(', ')} usable`,
    inState('needs-root').length && `${inState('needs-root').join(', ')} installed but needs root (${elevationWhy()})`,
    inState('absent').length && `${inState('absent').join(', ')} not installed`,
  ].filter(Boolean).join(' · ')}`));
  for (const r of rows) {
    if (r.present && r.ready === false) {
      // Louder than missing — it looks installed everywhere else
      console.log(`  ${yellow('▚')} ${r.name}  ${yellow('present but NOT READY')}`);
      if (r.readyWhy) console.log(dim(`      ${r.readyWhy}`));
      // Both shapes: a prose entry is a string, and `.join(' ')` on it throws in the NOT-READY
      // branch, exactly when the operator most needs to be told what to do.
      {
        const { commands, notes } = postInstallSteps(r);
        for (const a of commands) console.log(dim(`      fix: ${a.join(' ')}`));
        for (const n of notes) console.log(dim(`      fix: ${n}`));
      }
      continue;
    }
    if (r.present) {
      // Present is not usable when the missing part is at a vendor
      if (r.requiresAccount) {
        console.log(`  ${green('✓')} ${r.name}  ${yellow(`installed — NOT USABLE without a ${r.requiresAccount.vendor} account`)}`);
        for (const n of r.requiresAccount.needs || []) console.log(dim(`      needs: ${n}`));
      } else console.log(`  ${green('✓')} ${r.name}`);
      continue;
    }
    // One sentence per absence: one sentence for all of them can hide a declared installer behind
    // "no installer for this platform".
    const how = r.argv ? r.argv.join(' ')
      : r.absence === 'manual' ? (r.url ? `manual: ${r.url}` : 'manual — the steps below are the whole instruction')
        : r.absence === 'provided-by' ? `arrives with ${r.providedBy} — install that`
          : r.absence === 'needs-root' ? `needs root: ${r.needsRoot} is installed, but ${elevationWhy()} — ${elevatedCommand(r.needsRoot, [r.rootPkg])}`
            : r.absence === 'needs-manager' ? `needs ${r.couldUse.join(' or ')}, none installed — or ${r.url}`
              : `NOT IN THE CATALOG for any manager (our gap, not your machine) — ${r.url}`;
    console.log(`  ${red('✗')} ${r.name}  ${dim(`${r.why}  → ${how}`)}`);
    for (const line of stepLines(r.steps)) console.log(dim(`      step: ${line}`));
    if (r.requiresAccount) {
      console.log(`      ${yellow(`installing this is NOT enough — needs a ${r.requiresAccount.vendor} account`)}`);
      for (const n of r.requiresAccount.needs || []) console.log(dim(`      needs: ${n}`));
    }
  }
  for (const n of unknown) console.log(`  ${red('✗')} ${n}  ${dim('not in manifests/install-catalog.json — nothing here can install it')}`);
  const dockerRow = rows.find((r) => r.name === 'docker');
  if (dockerRow?.present && spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 }).status !== 0) {
    console.log(yellow('  ! docker is installed but the daemon is not running or not responding within 10s (osv/deps-updates checks need it)'));
  }
  const stranded = strandedSummary(rows);
  if (stranded) console.log(yellow(`  ${stranded}`));

  // Every path out ends here: the administrator block prints however the run ended, and the verdict
  // counts what was requested — the --only names, else whatever this run could act on.
  const finish = (res) => {
    const done = new Set([...res.installed, ...res.failed]);
    const asked = yes ? missing.filter((r) => !done.has(r.name) && (only.length || r.absence === 'needs-root')) : [];
    const needsRoot = asked.filter((r) => r.absence === 'needs-root').map((r) => r.name);
    const unavailable = yes && only.length ? [...unknown, ...asked.filter((r) => r.absence !== 'needs-root').map((r) => r.name)] : [];
    if (unavailable.length) console.log(red(`  ✗ requested, and nothing here can install: ${unavailable.join(', ')}`));
    // A manager that arrived mid-run may have installed one of these after all.
    const block = elevationBlock(rows.filter((r) => !res.installed.includes(r.name)));
    if (block) for (const l of block) console.log(l.startsWith('    ') ? bold(`  ${l}`) : yellow(`  ${l}`));
    return { ...res, needsRoot, unavailable };
  };

  const installable = missing.filter((r) => r.argv);
  if (!installable.length) {
    if (missing.length) console.log(dim('  nothing auto-installable — use the urls above'));
    stamp({ choice: 'nothing-to-do', missing: missing.map((r) => r.name) });
    return finish({ installed: [], failed: [], declined: [] });
  }
  if (!managersPresent().length) {
    console.log(yellow(`  no package manager found (${managerOrder().join('/')}) — install one, or use the urls above`));
    stamp({ choice: 'no-manager', missing: missing.map((r) => r.name) });
    return finish({ installed: [], failed: [], declined: missing.map((r) => r.name) });
  }
  if (!yes && !interactive) {
    // piped/CI stdin: never prompt (rl.question would hang on an open pipe) — report only
    console.log(dim('  non-interactive without --yes — report only (run `commitwork setup --yes` to install)'));
    return finish({ installed: [], failed: [], declined: installable.map((r) => r.name) });
  }

  let chosen = installable;
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // EOF / Ctrl+C / Ctrl+D at a prompt counts as "no", never a crash
    const ask = async (q) => { try { return (await rl.question(q)).trim().toLowerCase(); } catch { return ''; } };
    try {
      const a = await ask(`Install ${installable.length} missing scanner(s) now? [y/N/pick] `);
      if (a === 'pick' || a === 'p') {
        chosen = [];
        for (const r of installable) if ((await ask(`  install ${r.name}? [y/N] `)).startsWith('y')) chosen.push(r);
      } else if (!a.startsWith('y')) chosen = [];
    } finally { rl.close(); }
  }

  const installed = [], failed = [], reasons = new Map();
  const attempt = async (r) => {
    const res = await installOne(r);
    (res.ok ? installed : failed).push(r.name);
    if (res.reason) reasons.set(r.name, res.reason);
  };
  for (const r of chosen) await attempt(r);
  // Managers are detected once, before any install. On Linux, brew installs cargo and composer, and
  // the tools only they install stayed missing until a second run. Re-plan while managers appear.
  for (let pass = 0; pass < 4; pass++) {
    const before = new Set(managersPresent());
    resetProbes();
    const grown = managersPresent().filter((m) => !before.has(m));
    if (!grown.length) break;
    const tried = new Set([...installed, ...failed]);
    const next = toolPlan(only).filter((r) => !r.present && r.argv && !tried.has(r.name));
    if (!next.length) break;
    if (!yes) {
      console.log(yellow(`  ${grown.join(', ')} arrived with this install — run \`commitwork setup\` again for ${next.length} more`));
      break;
    }
    console.log(dim(`  ${grown.join(', ')} arrived with this install — ${next.length} more now installable`));
    for (const r of next) await attempt(r);
  }
  for (const name of failed) {
    const why = reasons.get(name);
    console.log(red(`  ✗ ${name} install failed`) + dim(`${why ? ` — ${why}` : ''} — fallback: ${rows.find((r) => r.name === name).url}`));
  }
  if (installed.length) console.log(green(`  installed: ${installed.join(', ')}`));
  const dirs = [...new Set(installed.filter((n) => offPath.has(n)).map((n) => offPath.get(n)))];
  for (const d of dirs) {
    const names = installed.filter((n) => offPath.get(n) === d);
    console.log(yellow(`  ${names.join(', ')} installed in ${d}, which is not on PATH — add it to PATH so later runs find ${names.length === 1 ? 'it' : 'them'}`));
  }
  const declined = installable.filter((r) => !chosen.includes(r)).map((r) => r.name);
  const notOnPath = Object.fromEntries(installed.filter((n) => offPath.has(n)).map((n) => [n, offPath.get(n)]));
  stamp({ choice: yes ? 'auto-yes' : chosen.length ? 'accepted' : 'declined', installed, failed, declined, notOnPath });
  return finish({ installed, failed, declined, notOnPath, reasons: Object.fromEntries(reasons) });
}

// First interactive launch only: no stamp yet, real TTY, not explicitly suppressed. The verdict is
// dropped on purpose: a scanner that did not install must not fail the command the operator ran.
export async function ensureFirstRunSetup() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  if (process.env.CW_SKIP_SETUP === '1') return;
  if (existsSync(stampPath())) return;
  console.log(dim('first launch — checking the scanner toolchain (asked once; rerun anytime with `commitwork setup`)'));
  await runSetup({});
  console.log('');
}

export function parseSetupArgs(args) {
  const yes = args.includes('--yes') || args.includes('-y');
  const only = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) only.push(...args[++i].split(','));
    else if (args[i].startsWith('--only=')) only.push(...args[i].slice(7).split(','));
  }
  return { yes, only };
}

// Point docker/trivy/grype at commitwork's own docker config before anything spawns them.
// Without this the launchd agents are quiet and every hand-run scan still raises the App Data
// prompt — the gap that left 7 requests a day attributed to a bare "node".
const invokedDirectly = isMainModule(import.meta.url);
if (invokedDirectly) useScopedDockerConfig();
if (invokedDirectly) process.exitCode = setupExitCode(await runSetup(parseSetupArgs(process.argv.slice(2))));
