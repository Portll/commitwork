// Git-repo discovery, in Node, with no external process.
//
// This replaced `spawnSync('find', [abs, '-maxdepth', '5', '-type', 'd', '-name', '.git',
// '-not', '-path', '*/node_modules/*'])` in bin/commitwork.mjs. That is GNU findutils. Windows
// ships a `find.exe` which is a TEXT SEARCH tool — it rejects those operands, writes to stderr,
// and exits non-zero — and the caller read only `r.stdout`. So on a stock Windows 11 box the
// flagship `commitwork scan --root <dir>` discovered nothing but roots that were themselves
// repos, reported no error, and looked like a fleet that had simply gone quiet. An empty stdout
// from a tool that failed is the fail-closed rule's textbook violation.
//
// Doing the walk here removes an external dependency on EVERY platform rather than adding a
// Windows branch, which is why this is a rewrite and not a second code path to keep in sync.
//
// Semantics deliberately preserved from the `find` invocation it replaces, so the discovery set
// does not drift:
//   * `.git` must be a DIRECTORY. A `.git` FILE names a linked worktree or a submodule, which
//     `-type d` excluded, so it stays excluded here. Widening that is a discovery-set change and
//     belongs in its own commit with its own measurement, not smuggled in behind a portability fix.
//   * depth is counted from each root, root itself being 0 — `<root>/a/b/c/d/.git` is depth 5.
//   * symlinked directories are not followed (`find` without `-L` does not).
//   * `node_modules` is PRUNED rather than filtered after the fact. `find` descended and then
//     dropped the results; any `.git` beneath a `node_modules` was going to be discarded either
//     way, so the result set is identical and the walk is cheaper.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve, sep } from 'node:path';

// A skip token matches a path SEGMENT. The predicate this replaces was
// `basename(p) === s || p.includes('/' + s + '/') || p.endsWith('/' + s)` — the union of
// "s is the last segment" and "s is an interior segment", i.e. exactly "s is some segment".
// Written that way it was also POSIX-only: on Windows the separator is `\`, so `/node_modules/`
// matched nothing and `--skip` silently did nothing at all. Splitting on both separators is
// both equivalent on POSIX and correct on Windows.
export function pathSegments(p) {
  return String(p || '').split(/[/\\]+/).filter(Boolean);
}

export function isSkipped(repoPath, skip) {
  if (!skip || !skip.length) return false;
  const segs = new Set(pathSegments(repoPath));
  return skip.some((s) => s && segs.has(s));
}

/**
 * Walk one root for `.git` directories.
 *
 * Errors are RECORDED, never swallowed into an empty result: a root we could not read is not a
 * root with no repos in it. EACCES on one subtree must not silently shrink a fleet scan, which is
 * the same defect the `find` version had in a different costume.
 *
 * -> { repos: [absolute repo paths], errors: [{ path, code }] }
 */
export function walkForRepos(root, { maxDepth = 5, prune = ['node_modules'], fs = { readdirSync } } = {}) {
  const repos = [];
  const errors = [];
  const pruneSet = new Set(prune);
  // Explicit stack rather than recursion: a pathological tree should not be a stack overflow,
  // and the depth bound is then a property of the data rather than of the call frames.
  const stack = [{ dir: root, depth: 0 }];
  const seen = new Set();
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    // A directory reached twice (junction, hardlinked dir) is walked once. Symlinks are not
    // followed at all, so this is belt-and-braces against Windows junctions, which readdir
    // reports as directories rather than as links.
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // ENOENT on a path we were handed is worth recording too — the caller asked about it.
      errors.push({ path: dir, code: e.code || String(e.name || e) });
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;      // isDirectory() is false for a symlink: not followed
      if (ent.name === '.git') {
        // depth of the .git itself is depth + 1; `find -maxdepth 5` includes it at exactly 5
        if (depth + 1 <= maxDepth) repos.push(dir);
        continue;                            // never descend into a .git
      }
      if (pruneSet.has(ent.name)) continue;
      stack.push({ dir: join(dir, ent.name), depth: depth + 1 });
    }
  }
  return { repos, errors };
}

/**
 * Discover git repos under `roots`.
 *
 * -> { repos: [sorted absolute paths], errors: [{path, code}], missingRoots: [paths] }
 * The caller decides how loudly to report `errors`; this function's contract is that it never
 * hides them and never returns a short list as if it were a complete one.
 */
export function findGitRepos(roots, { skip = [], maxDepth = 5, cwd = null, prune } = {}) {
  const found = new Set();
  const errors = [];
  const missingRoots = [];
  for (const root of roots || []) {
    const abs = isAbsolute(root) ? root : resolve(cwd || process.cwd(), root);
    if (!existsSync(abs)) { missingRoots.push(abs); continue; }
    // The root itself may be a repo (find would report `<root>/.git` at depth 1; kept explicit
    // because the original did it explicitly and a root repo is the single-repo scan case).
    if (existsSync(join(abs, '.git'))) {
      try { if (statSync(join(abs, '.git')).isDirectory()) found.add(abs); } catch { /* raced away */ }
    }
    const r = walkForRepos(abs, { maxDepth, ...(prune ? { prune } : {}) });
    for (const p of r.repos) found.add(p);
    errors.push(...r.errors);
  }
  return {
    repos: [...found].filter((p) => !isSkipped(p, skip)).sort(),
    errors,
    missingRoots,
  };
}

// Exported for the equivalence test, which needs to build the same predicate `find` applied.
export const WALK_DEFAULTS = { maxDepth: 5, prune: ['node_modules'], sep };
