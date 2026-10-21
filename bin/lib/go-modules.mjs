// Where a repository's Go modules are. Measured on the corpus for the gosec lane: 13 of 29 Go repos
// carry go.mod one or more levels down, and two carry several, so a scanner run only at the root
// reports a void for a tree full of Go. A vendored go.mod is somebody else's module, not a target.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SKIP = new Set(['.git', 'vendor', 'node_modules', 'testdata', 'reports', 'reference']);

/**
 * Walk `root` for go.mod files. `modules` are directories (root included), sorted by path so the
 * order is the same on every filesystem: readdir order is not specified, and go-lane-scan serialises
 * merged SARIF runs[] in this order, so an unsorted walk made the artifact's bytes depend on the
 * disk. `unexplored` lists directories at the depth bound that have subdirectories the walk did not
 * enter: a module there is invisible, and a bound nobody can see is the same as no bound.
 */
export function walkGoModules(root, maxDepth = 4) {
  const modules = [];
  const unexplored = [];
  (function walk(dir, depth) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Code-unit order, not localeCompare: locale collation is itself environment-dependent.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (entries.some((e) => e.isFile() && e.name === 'go.mod')) modules.push(dir);
    const subdirs = entries.filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'));
    if (depth >= maxDepth) {
      if (subdirs.length) unexplored.push(dir);
      return;
    }
    for (const e of subdirs) walk(join(dir, e.name), depth + 1);
  })(root, 0);
  return { modules, unexplored };
}

/** Directories under `root` (root included) holding a go.mod, sorted by path. */
export function findGoModules(root, maxDepth = 4) {
  return walkGoModules(root, maxDepth).modules;
}
