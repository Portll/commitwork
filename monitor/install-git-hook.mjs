#!/usr/bin/env node
// commitwork self-monitor hook — installs a post-commit trigger that spawns a detached
// `sweep fast <self-area>`. DRY RUN by default; --write installs, --uninstall removes OURS only
// (a hook this script did not write is never clobbered or removed; --force overrides --write only).
// The area is RESOLVED from the registry entry whose path IS this checkout — no entry ⟹ refuse.
// Absolute node path baked in (GUI-fired hooks run without shell PATH). CW_SELF_SWEEP=0 disables
// at runtime; overlapping sweeps are refused by the sweep's own lock (an exit-3 log line is benign).
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadRegistry, areaOf } from './registry.mjs';
import { expandHome } from './discover.mjs';
import { msgHookText } from '../bin/lib/commit-msg-hook.mjs';
import { mainCheckout, isOurs } from '../bin/install-commit-msg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const MARKER = 'commitwork self-monitor (installed by monitor/install-git-hook.mjs';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const UNINSTALL = argv.includes('--uninstall');
const FORCE = argv.includes('--force');
// --prepare: the npm lifecycle path (package.json "prepare", so a fresh clone gets the gate on
// `npm install`). It must NEVER fail the install — a missing registry, a foreign hook, or a
// non-checkout is reported and tolerated. Interactive runs keep the strict exits.
const PREPARE = argv.includes('--prepare');

// fixture seam (house rule: every input path is env-overridable) — tests install into a scratch
// dir; the real path comes from git itself, so worktrees and relocated GIT_DIRs resolve correctly
function hooksDir() {
  if (process.env.CW_HOOKS_DIR) return resolve(process.env.CW_HOOKS_DIR);
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: CW, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`install-git-hook: not a git checkout? ${String(r.stderr).trim()}`);
    // A tarball install has no hooks to write and is not a failure of the install itself.
    process.exit(PREPARE ? 0 : 2);
  }
  return resolve(CW, r.stdout.trim());
}

/** Does the registry declare THIS checkout? Probe form of selfArea — reports, never exits. */
function registryDeclaresSelf() {
  try {
    const reg = loadRegistry({ quiet: true });
    const me = (reg.projects || []).find((p) => p.path && resolve(expandHome(p.path)) === CW);
    return !!(me && areaOf(me.name, reg));
  } catch {
    return false;   // an unreadable registry is "not declared", never an assumed yes
  }
}

// Registry entry declaring THIS checkout → its area. Match by path, not name; refuse when absent —
// never sweep an area this checkout does not declare.
function selfArea() {
  const reg = loadRegistry({ quiet: true });
  const me = (reg.projects || []).find((p) => p.path && resolve(expandHome(p.path)) === CW);
  const area = me && areaOf(me.name, reg);
  if (!area) {
    console.error('install-git-hook: no registry entry declares this checkout (monitor/projects.json '
      + `projects[].path === ${CW}), so there is no declared area for the self-sweep to write into.`);
    console.error('install-git-hook: declare it first — a guessed area would be a cross-area write.');
    process.exit(2);
  }
  return area;
}

function hookText(area) {
  return `#!/bin/sh
# ${MARKER} — change or remove it THERE, not here).
# post-commit: refresh this repo's own monitor state in the background, so the panel (:7878,
# published via the tunnel) serves a rollup that reflects this commit without waiting for the
# nightly sweep. Overlap is refused by the sweep's own lock (an exit-3 line below is benign).
# CW_SELF_SWEEP=0 skips without uninstalling. CW_PROJECTSTATUS=0 keeps every commit from
# regenerating the status document; scheduled and manual sweeps still refresh it.
[ "\${CW_SELF_SWEEP:-1}" = "0" ] && exit 0
# guard: a linked worktree's stores are strays, and its sweep anchors them into ~/.commitwork as this checkout's
[ "$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)" = "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ] || exit 0
CW="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
# In a linked worktree git exports an absolute GIT_DIR to this hook, and every git call the sweep
# makes would resolve to this repository whatever -C names: the off-host witness was pushed here.
unset $(git rev-parse --local-env-vars 2>/dev/null) GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
[ -d "$CW/reports" ] || mkdir -p "$CW/reports"
CW_PROJECTSTATUS=0 nohup "${process.execPath}" "$CW/monitor/sweep.mjs" fast ${area} >> "$CW/reports/self-sweep.log" 2>&1 &
exit 0
`;
}

// ── commit-msg: the commit message gate ──────────────────────────────────────
//
// Installed SEPARATELY from, and BEFORE, the self-monitor above, because the two have different
// dependencies and only one of them can fail. The self-monitor needs a registry entry declaring
// this checkout; the message gate needs nothing but a hooks dir. They shared a script, so when
// monitor/projects.json went missing (absent on disk AND 0 in HEAD, measured 2026-09-01) selfArea()
// exited 2 and took the gate down with it — a rule with no enforcement, uninstallable, and silent
// about it. A guard must not inherit an unrelated dependency's failure.
//
// This is HALF the gate and cannot be the whole one: bin/commit-phase.mjs — the commit path
// CLAUDE.md mandates — lands with `git commit-tree`, which runs NO hooks. The other half lives
// there. Hooks live in the COMMON git dir, so one install covers every worktree. The hook text is
// bin/install-commit-msg.mjs's, which installs the same gate in other repositories.
// fact: a CW_HOOKS_DIR fixture runs this checkout's gate, the code under test; a real install runs the main checkout's
const msgGateText = () => msgHookText({
  node: process.execPath,
  script: join(process.env.CW_HOOKS_DIR ? CW : mainCheckout(CW), 'bin', 'commit-msg.mjs'),
});

/** Install the message gate. Returns 'installed' | 'foreign' | 'dry'. Never throws, never exits. */
function installTrailerGate(dir) {
  const p = join(dir, 'commit-msg');
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (existing != null && !isOurs(existing) && !FORCE) {
    console.error(`install-git-hook: ${p} exists and was not written by this script — refusing to clobber it (--force overrides).`);
    console.error('--- existing hook ---\n' + existing.trim());
    return 'foreign';
  }
  if (!WRITE) { console.log(`install-git-hook: DRY RUN — would ${existing ? 'replace' : 'install'} ${p} (commit message gate). Re-run with --write.`); return 'dry'; }
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, msgGateText());
  chmodSync(p, 0o755);
  console.log(`install-git-hook: installed ${p} (commit message gate; the commit-tree half lives in bin/commit-phase.mjs)`);
  return 'installed';
}

const dir = hooksDir();
const hookPath = join(dir, 'post-commit');
const existing = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : null;
const ours = existing != null && existing.includes(MARKER);

if (UNINSTALL) {
  if (existing == null) { console.log(`install-git-hook: nothing installed at ${hookPath}`); process.exit(0); }
  if (!ours) {
    console.error(`install-git-hook: ${hookPath} exists but was not written by this script — refusing to remove it.`);
    console.error('--- existing hook ---\n' + existing.trim());
    process.exit(2);
  }
  unlinkSync(hookPath);
  console.log(`install-git-hook: removed ${hookPath}`);
  // The commit-msg gate is installed by the same command, so --uninstall must take it too —
  // otherwise "uninstalled" leaves half a gate behind, which is worse than either state.
  const msgPath = join(dir, 'commit-msg');
  if (existsSync(msgPath)) {
    if (isOurs(readFileSync(msgPath, 'utf8'))) {
      unlinkSync(msgPath);
      console.log(`install-git-hook: removed ${msgPath}`);
    } else {
      console.error(`install-git-hook: ${msgPath} exists but was not written by this script — left in place.`);
    }
  }
  process.exit(0);
}

// THE npm LIFECYCLE PATH IS OPT-IN. `npm install` in a clone runs package.json's `prepare`, and
// this script then wrote executable hooks into that clone's .git/hooks without being asked. Two
// separate reasons that is wrong for a consumer rather than merely surprising: a commit-msg gate
// REFUSES commits whose subject or trailers fall outside this project's rules, which is a policy
// nobody installing a scanner agreed to; and the hook text bakes in an absolute interpreter path
// resolved on the machine that generated it. Measured on 2026-10-05 against a redirected hooks dir:
// `--write --prepare` installed BOTH commit-msg and post-commit, exit 0, silently.
//
// Opting in is one variable because the decision belongs to whoever owns the checkout, and the
// operator's own tree sets it once. Interactive runs are untouched: `--write` without `--prepare`
// still installs, so no existing workflow changes and the uninstall path stays reachable.
if (PREPARE && process.env.CW_INSTALL_HOOKS !== '1') {
  console.log('install-git-hook: skipping hook installation (npm `prepare` is opt-in). '
    + 'Set CW_INSTALL_HOOKS=1 before `npm install`, or run `node monitor/install-git-hook.mjs --write` to install now.');
  process.exit(0);
}

// The gate goes in FIRST and independently — see installTrailerGate's header. If the self-monitor
// below refuses for want of a registry entry, the gate is already in place rather than collateral.
const gate = installTrailerGate(dir);
if (PREPARE && gate === 'foreign') {
  // Under `npm install` a foreign hook is a reason to WARN, not to fail the install for everyone.
  console.error('install-git-hook: leaving the existing commit-msg hook alone; the commit message gate is NOT installed here.');
}
if (gate === 'foreign' && !PREPARE) process.exit(2);

// From here down is the self-monitor, whose area must be DECLARED. Under --prepare a missing
// registry is reported and tolerated: npm install must not fail, and the gate above is already in.
if (PREPARE && !registryDeclaresSelf()) {
  console.error('install-git-hook: no registry entry declares this checkout — self-monitor post-commit hook NOT installed.');
  console.error('  The commit message gate above is unaffected: it needs no registry.');
  process.exit(0);
}
const area = selfArea();
const text = hookText(area);

if (existing != null && !ours && !FORCE) {
  console.error(`install-git-hook: ${hookPath} already exists and was not written by this script — refusing to clobber it (--force overrides).`);
  console.error('--- existing hook ---\n' + existing.trim());
  process.exit(2);
}

if (!WRITE) {
  console.log(`install-git-hook: DRY RUN — would ${existing ? 'replace' : 'install'} ${hookPath} (self-area: ${area}). Re-run with --write.`);
  console.log('--- hook ---\n' + text);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
writeFileSync(hookPath, text);
chmodSync(hookPath, 0o755);
console.log(`install-git-hook: installed ${hookPath} (self-area: ${area}; disable per-commit with CW_SELF_SWEEP=0, remove with --uninstall)`);

