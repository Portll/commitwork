#!/usr/bin/env node
// usage: node bin/install-version-hooks.mjs [--write] [--uninstall] [<repo>]
// exit: 0 done or dry run · 2 refused or usage

// Installs bin/version-stamp.mjs as a repository's pre-commit, pre-merge-commit, post-rewrite and
// reference-transaction hooks; <repo> defaults to commitwork's own checkout. A hook another tool
// wrote is kept and chained: it moves to <hook>.version-chained and runs after this one, and an
// uninstall puts it back. Dry run without --write.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { mainCheckout } from './install-commit-msg.mjs';

export const VERSION_HOOK_MARKER = 'commitwork version hook';
export const HOOKS = ['pre-commit', 'pre-merge-commit', 'post-rewrite', 'reference-transaction'];
export const chainedName = (hook) => `${hook}.version-chained`;
export const isOurs = (text) => text.includes(VERSION_HOOK_MARKER);

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const PURPOSE = {
  'pre-commit': 'stamps package.json\'s patch version into a commit that does not raise it',
  'pre-merge-commit': 'stages the stamp for a merge that does not raise the version and stops it for `git commit --no-edit`',
  'post-rewrite': 'restamps a rebased stack whose versions no longer rise one per commit',
  'reference-transaction': 'refuses to move refs/heads/main over a commit that does not raise the version',
};

// fact: a stamp or guard that cannot run refuses rather than passing / a missing hook program would otherwise read as a commit that needed no stamp (expiry: never, prev: missing)
export function hookText(hook, { node, script }) {
  const head = [
    '#!/bin/sh',
    `# ${VERSION_HOOK_MARKER} (installed by commitwork's bin/install-version-hooks.mjs; change or remove it there, not here).`,
    `# ${hook}: ${PURPOSE[hook]}.`,
    `node=${shq(node)}`,
    '[ -x "$node" ] || node="$(command -v node)"',
    `script=${shq(script)}`,
    `chained="$(dirname "$0")/${chainedName(hook)}"`,
    'missing() { [ -z "$node" ] || [ ! -f "$script" ]; }',
    'chain_ok() { [ ! -e "$chained" ] || [ -x "$chained" ] || { echo "version hook: REFUSED. The chained hook $chained is not executable, so it did not run." >&2; exit 1; }; }',
  ];
  const reinstall = '  Reinstall it: node <commitwork>/bin/install-version-hooks.mjs --write';
  if (hook === 'pre-commit' || hook === 'pre-merge-commit') {
    return [...head,
      'if [ "${CW_VERSION_STAMP:-1}" != 0 ]; then',
      '  if missing; then',
      '    echo "version-stamp: REFUSED. The stamp cannot run: node or $script is missing. Nothing was committed." >&2',
      `    echo "${reinstall}, or commit with CW_VERSION_STAMP=0" >&2`,
      '    exit 1',
      '  fi',
      `  CW_GIT_PID=$PPID "$node" "$script" stamp${hook === 'pre-merge-commit' ? ' merge' : ''} || exit $?`,
      'fi',
      'chain_ok',
      '[ -e "$chained" ] && exec "$chained" "$@"',
      'exit 0', ''].join('\n');
  }
  if (hook === 'post-rewrite') {
    return [...head,
      'input=$(cat)',
      'if [ "${CW_VERSION_STAMP:-1}" != 0 ]; then',
      '  if missing; then echo "version-stamp: the rewritten commits were NOT checked: node or $script is missing." >&2',
      '  else printf \'%s\\n\' "$input" | "$node" "$script" post-rewrite "$1"; fi',
      'fi',
      'chain_ok',
      'if [ -e "$chained" ]; then printf \'%s\\n\' "$input" | "$chained" "$@"; exit $?; fi',
      'exit 0', ''].join('\n');
  }
  return [...head,
    'input=$(cat)',
    'if [ "$1" = prepared ] && [ "${CW_VERSION_GUARD:-1}" != 0 ] && printf \'%s\\n\' "$input" | grep -q \' refs/heads/main$\'; then',
    '  if missing; then',
    '    echo "version-guard: REFUSED. The guard cannot run: node or $script is missing, so refs/heads/main was not moved." >&2',
    `    echo "${reinstall}, or move it with CW_VERSION_GUARD=0" >&2`,
    '    exit 1',
    '  fi',
    '  printf \'%s\\n\' "$input" | "$node" "$script" guard "$1" || exit $?',
    'fi',
    'chain_ok',
    'if [ -e "$chained" ]; then printf \'%s\\n\' "$input" | "$chained" "$@"; exit $?; fi',
    'exit 0', ''].join('\n');
}

const hooksDir = (repo) => {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks'], { encoding: 'utf8' });
  return r.status === 0 ? { dir: r.stdout.trim() } : { error: (r.stderr || '').trim() || 'not a git repository' };
};

/** Plan, and with `write` apply, every hook for one repository. Returns { ok, lines }. */
export function installHooks(repo, { write = false, uninstall = false, node = process.execPath, cw = mainCheckout() } = {}) {
  const h = hooksDir(repo);
  if (h.error) return { ok: false, lines: [`${repo}: ${h.error}`] };
  const script = join(cw, 'bin', 'version-stamp.mjs');
  const plan = [];
  for (const hook of HOOKS) {
    const path = join(h.dir, hook);
    const chained = join(h.dir, chainedName(hook));
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const ours = existing !== null && isOurs(existing);
    if (uninstall) {
      if (!ours) { plan.push({ hook, line: existing === null ? 'not installed' : 'not ours; left in place' }); continue; }
      plan.push({ hook, line: existsSync(chained) ? `remove, and restore ${chainedName(hook)}` : 'remove',
        apply: () => { unlinkSync(path); if (existsSync(chained)) renameSync(chained, path); } });
      continue;
    }
    if (existing !== null && !ours && existsSync(chained)) {
      return { ok: false, lines: [`${path} was not written by commitwork and ${chained} already exists; refusing to overwrite either.`] };
    }
    const text = hookText(hook, { node, script });
    const moveAside = existing !== null && !ours;
    plan.push({ hook, line: moveAside ? `chain the existing hook to ${chainedName(hook)} and install` : existing === null ? 'install' : 'replace',
      apply: () => {
        mkdirSync(h.dir, { recursive: true });
        if (moveAside) renameSync(path, chained);
        writeFileSync(path, text);
        chmodSync(path, 0o755);
      } });
  }
  const lines = plan.map((p) => `${write ? '' : 'DRY RUN, would '}${p.line}: ${join(h.dir, p.hook)}`);
  if (write) for (const p of plan) if (p.apply) p.apply();
  return { ok: true, lines: [...lines, ...(uninstall ? [] : [`  program: ${script}`])] };
}

function main(argv) {
  const write = argv.includes('--write');
  const uninstall = argv.includes('--uninstall');
  const repos = argv.filter((a) => !a.startsWith('--'));
  if (repos.length > 1 || argv.some((a) => a.startsWith('--') && !['--write', '--uninstall'].includes(a))) {
    console.error('usage: node bin/install-version-hooks.mjs [--write] [--uninstall] [<repo>]');
    return 2;
  }
  const repo = resolve(repos[0] || mainCheckout(resolve(dirname(fileURLToPath(import.meta.url)), '..')));
  const r = installHooks(repo, { write, uninstall });
  for (const l of r.lines) (r.ok ? console.log : console.error)(`install-version-hooks: ${l}`);
  return r.ok ? 0 : 2;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
