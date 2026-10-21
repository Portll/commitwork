#!/usr/bin/env node
/*
 * scan-exclusions.mjs — renders manifests/scan-exclude-dirs.txt into whatever form a lane needs.
 *
 *   node bin/scan-exclusions.mjs --regex   -> .*\/(node_modules|target|...)\/.*      (joern, generic)
 *   node bin/scan-exclusions.mjs --grep    -> -e /node_modules/ -e /target/ ...     (shell-lint)
 *   node bin/scan-exclusions.mjs --list    -> one name per line
 *
 * WHY A RENDERER RATHER THAN A LIST EACH LANE GREPS ITSELF. Every lane needs the same set in a
 * different syntax, and hand-maintained copies drift apart. A renderer makes "the same set" a fact
 * the shell cannot get wrong, and puts the escaping in one place — a `.` in `.gradle` is a regex
 * metacharacter.
 *
 * FAILS CLOSED, and this is the important half. If the list cannot be read this exits NON-ZERO and
 * prints nothing usable, so a lane that substitutes it gets an empty expression and — because every
 * caller is written to `|| exit 1` — does not run at all. The alternative, defaulting to "exclude
 * nothing", would silently restore every build-output false finding this exists to remove, at
 * exactly the moment nobody is watching. An unreadable policy is a reason to stop, not a
 * reason to proceed unfiltered.
 *
 * Env-overridable at CALL time (house rule): CW_SCAN_EXCLUDE_DIRS.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LIST_PATH = () => process.env.CW_SCAN_EXCLUDE_DIRS
  || join(__dirname, '..', 'manifests', 'scan-exclude-dirs.txt');

const SEGMENT = /^[.A-Za-z0-9_-]+$/;
const isEntry = (d) => d.split('/').every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');

/** Entries in file order: directory names, or `a/b` paths of them. Throws if the list is unreadable or empty — see the header. */
export function excludeDirs(path = LIST_PATH()) {
  const raw = readFileSync(path, 'utf8');                 // throws: unreadable policy => stop
  // `split(/\r?\n/)`, not `split('\n')`. Git for Windows checks out CRLF by default, so on Windows
  // every line ends `\r`; `#.*$` then matches NOTHING, because JavaScript's `.` does not match
  // `\r` and `$` without `m` only matches the very end of the string. Every comment line would
  // survive `.trim()` and reach the plain-name validator below, which throws on it, and
  // bin/weak-random-detect.mjs calls excludeDirs() at module top level, so it would not import.
  const dirs = raw.split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
  if (!dirs.length) throw new Error(`${path} lists no directories — refusing to render an exclusion that excludes nothing`);
  // A shell metacharacter, a `..` or an absolute path would change the meaning of every rendering
  // below. Reject rather than escape: the list is hand-written and short, and an entry that needs
  // escaping is a sign the format is being pushed somewhere it was not designed to go.
  for (const d of dirs) {
    if (!isEntry(d)) throw new Error(`${path}: ${JSON.stringify(d)} is not a plain directory name or a relative path of them`);
  }
  return dirs;
}

/**
 * The predicate every in-house walker tests a directory against, given its ROOT-RELATIVE path.
 * A name entry matches the last segment anywhere; a path entry matches only when the whole path
 * ends with it on a segment boundary, so `.claude/worktrees` never excludes a `worktrees/` of its own.
 */
export function dirExcluder(dirs = excludeDirs()) {
  const names = new Set(dirs.filter((d) => !d.includes('/')));
  const paths = dirs.filter((d) => d.includes('/'));
  return (rel) => {
    const r = String(rel || '').split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (names.has(r.slice(r.lastIndexOf('/') + 1))) return true;
    return paths.some((p) => r === p || r.endsWith(`/${p}`));
  };
}

// NO BACKSLASHES IN THE RENDERED REGEX, and this is a correctness requirement rather than a style
// one. joern-scan takes `--frontend-args` and embeds them in generated Scala, where `\.` inside a
// string literal is an INVALID ESCAPE: the scan never runs, stdout is a 41-byte husk, and the
// process does not reliably report it (its exit code can be 1 or 0). On one CPG, one variable:
// `(\.gradle|\.git)` => 0 results, `([.]gradle|[.]git)` => 3 results, same input.
//
// `[.]` is exactly equivalent to `\.` in every regex flavour and survives any string-literal
// round-trip, so this costs nothing and removes the whole class. excludeDirs() has already
// constrained names to [.A-Za-z0-9_-], so `.` is the ONLY metacharacter that can reach here; any
// other one means the caller bypassed that validation, and emitting a backslash for it would
// silently reintroduce the defect. Refuse instead.
const rxEscape = (s) => {
  const bad = s.match(/[*+?^${}()|[\]\\]/);
  if (bad) throw new Error(`scan-exclusions: ${JSON.stringify(s)} contains regex metacharacter ${JSON.stringify(bad[0])}, which cannot be rendered without a backslash — see the no-backslash rule above`);
  return s.replace(/\./g, '[.]');
};

// The leading separator is OPTIONAL, and that is the whole point of `(.*/)?` over `.*/`. c2cpg
// matches "paths relative to <input-dir>", so a repo-root `node_modules/` arrives as
// `node_modules/evil/x.c` with NOTHING before it — and `.*/(node_modules)/.*` requires a literal
// `/` ahead of the name, so it never matches the commonest case there is. On a planted vendored
// file: `.*/(…)` leaves it in the results, `(.*/)?(…)` removes it, same input.
export const asRegex = (dirs) => `(.*/)?(${dirs.map(rxEscape).join('|')})/.*`;
export const asGrepArgs = (dirs) => dirs.map((d) => `-e /${d}/`).join(' ');

// REALPATH BOTH SIDES. `import.meta.url === `file://${process.argv[1]}`` is false whenever the
// script is reached through a symlink, because import.meta.url is realpath-resolved and argv[1] is
// the path as typed — on macOS `node /tmp/x.mjs` compares file:///private/tmp/x.mjs against
// file:///tmp/x.mjs. The CLI block then does not run, and the process prints NOTHING and exits
// ZERO: the exact silent-success this file's header promises it cannot do ("exits NON-ZERO and
// prints nothing usable"), and a caller that checks only the exit code cannot see it.
// Template-literal concatenation is also wrong for any path needing URL escaping (a space, a #).
const _argvPath = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })() : null;
if (_argvPath && _argvPath === fileURLToPath(import.meta.url)) {
  let dirs;
  try { dirs = excludeDirs(); }
  catch (e) { console.error(`scan-exclusions: ${e.message}`); process.exit(1); }
  const mode = process.argv[2] || '--list';
  if (mode === '--regex') process.stdout.write(asRegex(dirs));
  else if (mode === '--grep') process.stdout.write(asGrepArgs(dirs));
  else if (mode === '--list') process.stdout.write(dirs.join('\n') + '\n');
  else { console.error(`scan-exclusions: unknown mode ${mode} (expected --regex, --grep or --list)`); process.exit(1); }
}
