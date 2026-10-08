#!/usr/bin/env node
// usage: node bin/install-commit-msg.mjs [--write] [--force] [--uninstall] <repo>[=<rule set>]…
// Installs bin/commit-msg.mjs as each repository's commit-msg hook and records its rule set in
// `git config commitwork.rules`. The rule set defaults to the repository directory's name. Dry run
// without --write; a hook this did not write is left alone unless --force.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { RULE_SETS } from './lib/conventional-commit.mjs';
import { MSG_HOOK_MARKER, msgHookText } from './lib/commit-msg-hook.mjs';

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

/** Install, replace or remove one repository's hook. Returns { ok, line }. */
export function installOne(spec, { write = false, force = false, uninstall = false, node = process.execPath, cw = mainCheckout() } = {}) {
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
    return { ok: true, line: `${repo}: removed ${hook}` };
  }

  if (existing !== null && !isOurs(existing) && !force) {
    return { ok: false, line: `${repo}: ${hook} exists and was not written by commitwork; --force replaces it` };
  }
  const script = join(cw, 'bin', 'commit-msg.mjs');
  if (!write) return { ok: true, line: `${repo}: DRY RUN, would ${existing === null ? 'install' : 'replace'} ${hook} (rules ${rules}, ${script})` };
  mkdirSync(hooks.out, { recursive: true });
  writeFileSync(hook, msgHookText({ node, script }));
  chmodSync(hook, 0o755);
  const set = git(repo, ['config', 'commitwork.rules', rules]);
  if (set.error) return { ok: false, line: `${repo}: hook written, but commitwork.rules was not set (${set.error})` };
  return { ok: true, line: `${repo}: installed ${hook} (rules ${rules}, ${script})` };
}

function main(argv) {
  const opts = { write: argv.includes('--write'), force: argv.includes('--force'), uninstall: argv.includes('--uninstall') };
  const specs = argv.filter((a) => !a.startsWith('--'));
  if (!specs.length) {
    console.error('usage: node bin/install-commit-msg.mjs [--write] [--force] [--uninstall] <repo>[=<rule set>]…');
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
