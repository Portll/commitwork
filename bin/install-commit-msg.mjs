#!/usr/bin/env node
// usage: node bin/install-commit-msg.mjs [--write] [--force] [--uninstall] [--unpinned] <repo>[=<rule set>]…
//        node bin/install-commit-msg.mjs --refresh [--write] [--force]
// Installs bin/commit-msg.mjs as each repository's commit-msg hook and records its rule set in
// `git config commitwork.rules`. The rule set defaults to the repository directory's name. Dry run
// without --write; a hook this did not write is left alone unless --force.
//
// The hook runs an exported copy of a COMMITTED commitwork revision, named in the hook text, never
// this checkout's working tree — see bin/lib/gate-pin.mjs for why. --refresh re-exports every
// pinned install at the trunk's current commit and is the only thing that moves a gate.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { RULE_SETS } from './lib/conventional-commit.mjs';
import { MSG_HOOK_MARKER, msgHookText } from './lib/commit-msg-hook.mjs';
import { forgetRepo, ledgerPath, pinFor, pruneExports, readLedger, recordRepo, resolveRevision } from './lib/gate-pin.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRAILER_GATE_MARKER = 'commitwork self-monitor (installed by monitor/install-git-hook.mjs';

const git = (dir, args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return r.status === 0 ? { out: r.stdout.trim() } : { error: String(r.stderr || r.error || '').trim() };
};

// fact: the hook runs commitwork's main checkout, never a linked worktree that may be removed
export function mainCheckout(dir = CW) {
  const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return !common.error && basename(common.out) === '.git' ? dirname(common.out) : dir;
}

export const isOurs = (text) => text.includes(MSG_HOOK_MARKER) || text.includes(TRAILER_GATE_MARKER);

/**
 * Install, replace or remove one repository's hook. Returns { ok, line }.
 *
 * `unpinned` installs a gate that runs `cw`'s working tree, which is what the gate's own tests
 * need — they assert the rules of the code under test, not of the trunk — and what a commitwork
 * tree with no history has to settle for. It is never the default and it is always reported,
 * because a gate that silently follows a shared working tree is the defect the pin exists for.
 */
export function installOne(spec, { write = false, force = false, uninstall = false, unpinned = false, node = process.execPath, cw = mainCheckout() } = {}) {
  const eq = spec.indexOf('=');
  const repo = resolve(eq === -1 ? spec : spec.slice(0, eq));
  const rules = eq === -1 ? basename(repo) : spec.slice(eq + 1);
  if (!uninstall && !Object.hasOwn(RULE_SETS, rules)) {
    return { ok: false, line: `${repo}: no rule set '${rules}'. Name one: <repo>=<${Object.keys(RULE_SETS).join('|')}>` };
  }
  const hooks = git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  if (hooks.error) return { ok: false, line: `${repo}: not a git repository (${hooks.error})` };
  const hook = join(hooks.out, 'commit-msg');
  const existing = existsSync(hook) ? readFileSync(hook, 'utf8') : null;

  if (uninstall) {
    if (existing === null) return { ok: true, line: `${repo}: no commit-msg hook` };
    if (!isOurs(existing)) return { ok: false, line: `${repo}: ${hook} was not written by commitwork; left in place` };
    if (!write) return { ok: true, line: `${repo}: DRY RUN, would remove ${hook} and commitwork.rules` };
    unlinkSync(hook);
    git(repo, ['config', '--unset', 'commitwork.rules']);
    forgetRepo(cw, repo);
    return { ok: true, line: `${repo}: removed ${hook}` };
  }

  if (existing !== null && !isOurs(existing) && !force) {
    return { ok: false, line: `${repo}: ${hook} exists and was not written by commitwork; --force replaces it` };
  }
  // Refused rather than quietly downgraded: a tree whose history cannot be read is the one case
  // where "install anyway" and "install the pinned gate" differ in what the hook will OBEY.
  const pin = unpinned ? null : pinFor(cw, { write });
  if (pin && !pin.ok) {
    return { ok: false, line: `${repo}: nothing was installed — ${pin.why}. --unpinned installs a gate that runs ${cw}'s working tree instead` };
  }
  const script = pin ? pin.script : join(cw, 'bin', 'commit-msg.mjs');
  const at = pin ? `pinned to ${pin.revision}` : `UNPINNED, running ${cw}'s working tree`;
  if (!write) return { ok: true, line: `${repo}: DRY RUN, would ${existing === null ? 'install' : 'replace'} ${hook} (rules ${rules}, ${at}, ${script})` };
  mkdirSync(hooks.out, { recursive: true });
  writeFileSync(hook, msgHookText({ node, script, revision: pin ? pin.revision : null }));
  chmodSync(hook, 0o755);
  const set = git(repo, ['config', 'commitwork.rules', rules]);
  if (set.error) return { ok: false, line: `${repo}: hook written, but commitwork.rules was not set (${set.error})` };
  // Only pinned installs are recorded: --refresh exists to move a pinned gate to a newer commit,
  // and an unpinned one already follows the tree, so recording it would invent work to do.
  if (pin) {
    try { recordRepo(cw, { repo, rules, revision: pin.revision }); } catch (e) {
      return { ok: false, line: `${repo}: the hook is installed and pinned to ${pin.revision}, but ${ledgerPath(cw)} was not updated (${e.message}), so --refresh will not reach this repository` };
    }
  }
  return { ok: true, line: `${repo}: installed ${hook} (rules ${rules}, ${at}, ${script})` };
}

/**
 * Re-export the trunk's current commit and rewrite every pinned gate at it, then drop the exports
 * no installed gate names any more. Returns an exit code.
 *
 * It rewrites through installOne, so a hook replaced by a foreign one is still refused here, and a
 * repository that cannot be reached is a FAILURE rather than a row quietly dropped — the ledger
 * holds real installs, and forgetting one is how a repository ends up with no gate at all.
 */
export function refresh({ write = false, force = false, cw = mainCheckout() } = {}) {
  const rev = resolveRevision(cw);
  if (!rev.ok) {
    console.error(`install-commit-msg: REFUSED. ${rev.why}.`);
    return 2;
  }
  let led;
  try { led = readLedger(cw); } catch (e) {
    // An unreadable ledger is not an empty one: refuse, rather than report nothing to refresh.
    console.error(`install-commit-msg: REFUSED. ${ledgerPath(cw)} could not be read (${e.message}), so which gates are installed is unknown.`);
    return 2;
  }
  if (!led.repos.length) {
    console.log(`install-commit-msg: no pinned gate is recorded in ${ledgerPath(cw)}, so there is nothing to refresh.`);
    return 0;
  }
  if (!write) {
    for (const row of led.repos) {
      const move = row.revision === rev.revision ? 'already there' : `now at ${row.revision}`;
      console.log(`install-commit-msg: ${row.repo}: DRY RUN, would pin to ${rev.revision} (${move})`);
    }
    return 0;
  }
  let failed = 0;
  for (const row of led.repos) {
    const r = installOne(`${row.repo}=${row.rules}`, { write: true, force, cw });
    (r.ok ? console.log : console.error)(`install-commit-msg: ${r.line}`);
    if (!r.ok) failed++;
  }
  // Read the ledger BACK: a repository whose rewrite failed still names its old export, and that
  // export is the gate it is still running.
  const gone = pruneExports(cw, new Set(readLedger(cw).repos.map((row) => row.revision)));
  for (const n of gone) console.log(`install-commit-msg: removed the export of ${n}; no installed gate names it`);
  return failed ? 2 : 0;
}

function main(argv) {
  const opts = {
    write: argv.includes('--write'),
    force: argv.includes('--force'),
    uninstall: argv.includes('--uninstall'),
    unpinned: argv.includes('--unpinned'),
  };
  const specs = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--refresh')) {
    if (specs.length) {
      console.error('install-commit-msg: --refresh takes no repositories; it rewrites every gate recorded as pinned.');
      return 2;
    }
    return refresh(opts);
  }
  if (!specs.length) {
    console.error('usage: node bin/install-commit-msg.mjs [--write] [--force] [--uninstall] [--unpinned] <repo>[=<rule set>]…');
    console.error('       node bin/install-commit-msg.mjs --refresh [--write] [--force]');
    return 2;
  }
  let failed = 0;
  for (const spec of specs) {
    const r = installOne(spec, opts);
    (r.ok ? console.log : console.error)(`install-commit-msg: ${r.line}`);
    if (!r.ok) failed++;
  }
  return failed ? 2 : 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
