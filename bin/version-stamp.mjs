#!/usr/bin/env node
// usage: node bin/version-stamp.mjs stamp [merge] | post-rewrite <amend|rebase> | guard <state>
// Git hooks that give every commit a version above its parent's.
// env (read at call time): CW_VERSION_STAMP (0 skips the stamp and the restamp), CW_VERSION_GUARD
//   (0 skips the guard), CW_GIT_PID (the git process the hook runs under, read to detect an amend)
// exit: 0 stamped, nothing to stamp, or allowed · 1 refused

// bin/install-version-hooks.mjs installs these, and bin/commit-phase.mjs stamps the commit-tree
// path, which runs no hooks. Both apply one rule from commit-phase-core.mjs: a commit carries
// package.json at max(its own version, bumpPatch(parent)).

// stamp (pre-commit): the index the commit is built from, and the working copy's version token,
// take the stamp when the commit does not raise it. stamp merge (pre-merge-commit): git has
// written the merge tree already, so the stamp is staged and the merge stops for
// `git commit --no-edit`, which concludes it through pre-commit.

// post-rewrite: after a rebase, a stack whose versions do not follow the rule is replayed in place
// by `commit-phase --onto <base>`. guard (reference-transaction): refs/heads/main moves forward
// only over first-parent commits that raise the version.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { VERSION_FILE, readVersion, setVersion, compareSemver, versionStamp, replayStamps } from './commit-phase-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GUARDED_REF = 'refs/heads/main';
const SHA = /^[0-9a-f]{40,64}$/;
const ZERO = /^0+$/;

function git(args, { input } = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 1 << 26 });
  if (r.error) return { error: r.error.message };
  return r.status === 0 ? { out: r.stdout } : { error: (r.stderr || '').trim() || `git ${args[0]} exited ${r.status}`, status: r.status };
}

/** package.json at a commit: { text } (null when absent), or { error }. */
function versionFileAt(rev) {
  const ls = git(['ls-tree', rev, '--', VERSION_FILE]);
  if (ls.error) return { error: `${rev}: ${ls.error}` };
  const m = ls.out.match(/^(\d{6}) blob ([0-9a-f]+)\t/);
  if (!m) return { text: null };
  const b = git(['cat-file', 'blob', m[2]]);
  return b.error ? { error: b.error } : { text: b.out, mode: m[1] };
}

/** package.json in the index git is committing from (GIT_INDEX_FILE, which git sets for its hooks). */
function indexVersionFile() {
  const ls = git(['ls-files', '-s', '--', VERSION_FILE]);
  if (ls.error) return { error: ls.error };
  const m = ls.out.match(/^(\d{6}) ([0-9a-f]+) 0\t/);
  if (!m) return { text: null };
  const b = git(['cat-file', 'blob', m[2]]);
  return b.error ? { error: b.error } : { text: b.out, mode: m[1] };
}

// ── the decisions ─────────────────────────────────────────────────────────────────────────────

/**
 * The package.json a commit being made carries. `parentTexts` holds package.json at each parent
 * (null when absent), `indexText` the copy the commit is built from (null when absent).
 * → { action: 'none' } no parent carries one · { action: 'keep', version } already raised ·
 *   { action: 'stamp', from, version, text } · { action: 'refuse', why }
 */
export function stampDecision({ parentTexts = [], indexText = null } = {}) {
  let parentText = null;
  let best = null;
  for (const t of parentTexts) {
    if (t === null || t === undefined) continue;
    const r = readVersion(t);
    if (!r.ok) return { action: 'refuse', why: `${VERSION_FILE} at a parent commit ${r.why}.` };
    if (best === null || compareSemver(r.version, best) > 0) { best = r.version; parentText = t; }
  }
  if (parentText === null) return { action: 'none' };
  const s = versionStamp({ parentText, authorText: indexText === parentText ? undefined : indexText });
  if (!s.ok) return { action: 'refuse', why: s.why };
  if (s.text === indexText) return { action: 'keep', version: s.version };
  const carried = readVersion(indexText ?? '');
  return { action: 'stamp', from: carried.ok ? carried.version : s.from, version: s.version, text: s.text };
}

/** The working copy after a stamp, or null to leave it: only its version token moves, and only when it carried the index's version. */
export function workingCopyText({ worktree = null, indexText = null, stamped, version }) {
  if (worktree === null) return null;
  if (worktree === indexText) return stamped;
  const w = readVersion(worktree);
  const i = readVersion(indexText ?? '');
  if (!w.ok || !i.ok || w.version !== i.version) return null;
  const moved = setVersion(worktree, version);
  return moved.ok ? moved.text : null;
}

/** `git commit --amend`, or an unambiguous prefix of it, in the argv of the git process. */
export const isAmend = (argv) => /(?:^|\s)--am(?:e(?:nd?)?)?(?=\s|$)/.test(String(argv ?? ''));

/** Whether a first-parent commit raises the version: { ok } or { ok: false, why }. */
export function commitRaises({ parentText = null, text = null } = {}) {
  if (parentText === null) return { ok: true };
  if (text === null) return { ok: false, why: `deletes ${VERSION_FILE}` };
  const p = readVersion(parentText);
  const c = readVersion(text);
  if (!p.ok) return { ok: false, why: `its parent's ${VERSION_FILE} ${p.why}` };
  if (!c.ok) return { ok: false, why: `its ${VERSION_FILE} ${c.why}` };
  return compareSemver(c.version, p.version) > 0 ? { ok: true } : { ok: false, why: `${c.version} after ${p.version}` };
}

// ── stamp: pre-commit and pre-merge-commit ────────────────────────────────────────────────────

function gitArgv(pid) {
  if (!pid || process.platform === 'win32') return '';
  const r = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : '';
}

/** The parents of the commit git is about to write: [] for the first commit, or { error }. */
function newCommitParents(env) {
  const head = git(['rev-parse', '-q', '--verify', 'HEAD^{commit}']);
  // rev-parse -q --verify exits 1 only when HEAD names no commit yet: the first commit
  if (head.error) return head.status === 1 ? [] : { error: `HEAD is unreadable: ${head.error}` };
  if (isAmend(gitArgv(env.CW_GIT_PID))) {
    const p = git(['rev-list', '--parents', '-n', '1', 'HEAD']);
    return p.error ? { error: p.error } : p.out.trim().split(/\s+/).slice(1);
  }
  const mh = git(['rev-parse', '--git-path', 'MERGE_HEAD']);
  const file = mh.error ? null : resolve(mh.out.trim());
  const merging = file && existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => SHA.test(l)) : [];
  return [head.out.trim(), ...merging];
}

export function runStamp(env = process.env, { merge = false } = {}) {
  if (env.CW_VERSION_STAMP === '0') return { code: 0 };
  const refuse = (why) => ({ code: 1, lines: [`version-stamp: REFUSED. ${why} Nothing was committed.`, '  CW_VERSION_STAMP=0 commits without the stamp.'] });
  const parents = newCommitParents(env);
  if (parents.error) return refuse(parents.error);
  const parentTexts = [];
  let parentMode = null;
  for (const p of parents) {
    const v = versionFileAt(p);
    if (v.error) return refuse(`${VERSION_FILE} at ${p.slice(0, 8)} could not be read: ${v.error}`);
    parentTexts.push(v.text);
    parentMode = parentMode || v.mode || null;
  }
  const idx = indexVersionFile();
  if (idx.error) return refuse(`${VERSION_FILE} in the index could not be read: ${idx.error}`);
  const d = stampDecision({ parentTexts, indexText: idx.text });
  if (d.action === 'refuse') return refuse(d.why);
  if (d.action !== 'stamp') return { code: 0 };

  const blob = git(['hash-object', '-w', '--stdin'], { input: d.text });
  if (blob.error) return refuse(`the stamped ${VERSION_FILE} could not be written: ${blob.error}`);
  const add = git(['update-index', '--add', '--cacheinfo', `${idx.mode || parentMode || '100644'},${blob.out.trim()},${VERSION_FILE}`]);
  if (add.error) return refuse(`the stamped ${VERSION_FILE} could not be staged: ${add.error}`);

  const lines = [`version-stamp: ${VERSION_FILE} ${d.from} → ${d.version} in this commit`];
  const top = git(['rev-parse', '--show-toplevel']);
  const path = top.error ? null : join(top.out.trim(), VERSION_FILE);
  const worktree = path && existsSync(path) ? readFileSync(path, 'utf8') : null;
  const next = workingCopyText({ worktree, indexText: idx.text, stamped: d.text, version: d.version });
  if (next !== null && next !== worktree) writeAtomic(path, next, { mode: statSync(path).mode & 0o777 });
  else if (worktree !== null && next === null) lines.push(`  the working copy's ${VERSION_FILE} has its own version edit and was left as it is`);
  // a pathspec commit stamps a temporary index; the real one is locked and keeps its entry
  if (basename(env.GIT_INDEX_FILE || '').startsWith('next-index')) {
    lines.push(`  the index entry stays at ${d.from} until: git reset -q -- ${VERSION_FILE}`);
  }
  if (merge) {
    lines.push('  git wrote this merge\'s tree before the hook ran, so the merge stops here with the stamp staged. Conclude it with: git commit --no-edit');
    return { code: 1, lines };
  }
  return { code: 0, lines };
}

// ── post-rewrite: a rebased stack ─────────────────────────────────────────────────────────────

export function runPostRewrite(kind, input, env = process.env) {
  if (kind !== 'rebase' || env.CW_VERSION_STAMP === '0') return { code: 0 };
  const warn = (why) => ({ code: 0, lines: [`version-stamp: the rebased commits were NOT restamped: ${why}`] });
  const rewritten = String(input ?? '').split('\n').map((l) => l.trim().split(/\s+/)[1]).filter((s) => s && SHA.test(s));
  if (!rewritten.length) return { code: 0 };
  const base = git(['rev-parse', '--verify', `${rewritten[0]}^`]);
  if (base.error) return warn(`the base of ${rewritten[0].slice(0, 8)} is unreadable (${base.error})`);
  const b = base.out.trim();
  const list = git(['rev-list', '--reverse', `${b}..HEAD`]);
  if (list.error) return warn(list.error);
  const commits = list.out.split('\n').filter((s) => SHA.test(s));
  const baseVf = versionFileAt(b);
  const steps = commits.map((c) => ({ before: versionFileAt(`${c}^`), after: versionFileAt(c) }));
  const unread = [baseVf, ...steps.flatMap((s) => [s.before, s.after])].find((x) => x.error);
  if (unread) return warn(unread.error);
  const texts = steps.map((s) => ({ before: s.before.text, after: s.after.text }));
  const plan = replayStamps({ baseText: baseVf.text, steps: texts });
  if (!plan.ok) return warn(`${commits[plan.at].slice(0, 8)}: ${plan.why}`);
  if (plan.stamps.every((s, i) => s.none || s.text === texts[i].after)) return { code: 0 };
  const top = git(['rev-parse', '--show-toplevel']);
  const r = spawnSync(process.execPath, [join(HERE, 'commit-phase.mjs'), '--onto', b], {
    cwd: top.error ? process.cwd() : top.out.trim(), env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  return r.status === 0 ? { code: 0 } : warn(`commit-phase --onto ${b.slice(0, 8)} exited ${r.status ?? r.signal}; run it by hand on this branch`);
}

// ── guard: reference-transaction ──────────────────────────────────────────────────────────────

export function runGuard(state, input, env = process.env) {
  if (state !== 'prepared' || env.CW_VERSION_GUARD === '0') return { code: 0 };
  const refuse = (lines) => ({ code: 1, lines: [...lines, `  Restamp the branch with \`node bin/commit-phase.mjs --onto <current main>\` before moving ${GUARDED_REF}; CW_VERSION_GUARD=0 lets this update through.`] });
  for (const row of String(input ?? '').split('\n')) {
    const [old, next, ref] = row.trim().split(/\s+/);
    if (ref !== GUARDED_REF || !old || !next || ZERO.test(old) || ZERO.test(next) || old === next) continue;
    const anc = git(['merge-base', '--is-ancestor', old, next]);
    if (anc.status === 1) continue;
    if (anc.error) return refuse([`version-guard: REFUSED. Whether ${GUARDED_REF} moves forward could not be read: ${anc.error}`]);
    const list = git(['rev-list', '--first-parent', '--reverse', `${old}..${next}`]);
    if (list.error) return refuse([`version-guard: REFUSED. ${old.slice(0, 8)}..${next.slice(0, 8)} could not be listed: ${list.error}`]);
    const bad = [];
    for (const c of list.out.split('\n').filter((s) => SHA.test(s))) {
      const parent = versionFileAt(`${c}^1`);
      const own = versionFileAt(c);
      const err = parent.error || own.error;
      const v = err ? { ok: false, why: `${VERSION_FILE} unreadable: ${err}` } : commitRaises({ parentText: parent.text, text: own.text });
      if (!v.ok) bad.push(`  ${c.slice(0, 8)} ${v.why}`);
    }
    if (bad.length) {
      return refuse([`version-guard: REFUSED. ${GUARDED_REF} would take ${bad.length} commit(s) that do not raise ${VERSION_FILE}'s version:`, ...bad.slice(0, 8), ...(bad.length > 8 ? [`  … and ${bad.length - 8} more`] : [])]);
    }
  }
  return { code: 0 };
}

function main(argv) {
  const [mode, arg] = argv;
  const stdin = mode === 'post-rewrite' || mode === 'guard' ? readFileSync(0, 'utf8') : '';
  const r = mode === 'stamp' ? runStamp(process.env, { merge: arg === 'merge' })
    : mode === 'post-rewrite' ? runPostRewrite(arg, stdin)
      : mode === 'guard' ? runGuard(arg, stdin)
        : { code: 1, lines: ['usage: node bin/version-stamp.mjs stamp [merge] | post-rewrite <amend|rebase> | guard <state>'] };
  for (const l of r.lines || []) console.error(l);
  return r.code;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
