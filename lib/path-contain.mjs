// Is this path inside that root? One implementation for every caller.
//
// `p === root || p.startsWith(root + '/')` is false for every path on Windows: `root` comes from
// `resolve()`, which emits backslashes there, and `'C:\repo\x'` does not start with `'C:\repo/'`.
//
// ── WHY `relative()` RATHER THAN A BETTER PREFIX TEST ───────────────────────────────────────────
// The obvious repair is to normalise separators and keep comparing prefixes. That still leaves the
// bug this shape is famous for: `/repo-evil` starts with `/repo` and a naive prefix test lets it
// through, which is why the `+ '/'` was there in the first place. `path.relative()` answers the
// question directly — "how do I get from root to p" — and a path outside the root always produces a
// result that begins `..`, on both platforms, with the drive-letter and case rules Windows needs
// already applied by path.win32. It is also the only version that gets `C:\repo` vs `c:\REPO` right,
// which a string compare cannot.

import { relative, isAbsolute, resolve } from 'node:path';

// Both separators are checked regardless of platform: a value carrying '../' on Windows is still an
// escape, and belt-and-braces here costs nothing. The backslash is built by code point rather than
// written as an escape — this file has already been mangled once by a tool that ate the escape, and
// a silently-wrong containment check is the failure mode of the whole module.
const BS = String.fromCharCode(92);
const ESCAPES = [`..${BS}`, '../'];

/**
 * True when `p` is `root` itself or lies inside it.
 *
 * Both are resolved first: a containment check on unresolved input answers about the strings, not
 * about the filesystem, and `..` in the middle of a path is exactly what an attacker supplies.
 */
export function withinRoot(root, p) {
  if (root === undefined || root === null || p === undefined || p === null) return false;
  const r = String(root); const q = String(p);
  if (!r || !q) return false;
  const rel = relative(resolve(r), resolve(q));
  // '' means p IS root. A result that escapes begins with '..'; an ABSOLUTE result means the two
  // share no root at all (a different drive on Windows), which is also outside.
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !ESCAPES.some((e) => rel.startsWith(e));
}

/**
 * The path of `p` relative to `root`, or null when `p` is not inside it.
 * Returns '' for `p === root`, which is a real answer and distinct from null.
 */
export function relativeWithin(root, p) {
  if (!withinRoot(root, p)) return null;
  return relative(resolve(String(root)), resolve(String(p)));
}

/** Same as relativeWithin but always POSIX-separated — for anything stored, compared or published. */
export function relativePosix(root, p) {
  const rel = relativeWithin(root, p);
  return rel === null ? null : rel.split('\\').join('/');
}
