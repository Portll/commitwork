// Is this path inside that root? One implementation, because there were eight and none worked on
// Windows.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
// The containment check written eight times across this codebase was
//
//     p === root || p.startsWith(root + '/')
//
// and `root` comes from `resolve()`, which emits BACKSLASHES on Windows. `'C:\repo\x'` does not
// start with `'C:\repo/'`, so the test is false for every path on the platform. Measured
// consequences, all live:
//
//   admin/routes/comments.mjs:31        every file refused as "path escapes the repository"
//   admin/routes/codeql-remediation.mjs every source read refused
//   admin/lib/core.mjs:81               area resolution always UNRESOLVED — and there is on-disk
//                                       proof: `reports/__unresolved__` exists in this checkout
//   monitor/history-chain.mjs:163       fixture-registry detection inverted
//   monitor/nondeterministic-store.mjs  containment always false
//   monitor/scan-scope.mjs:120          paths never relativised, so they stay absolute in output
//   monitor/renovate-dryrun.mjs:111     area matching always misses
//
// Seven fail CLOSED and are merely broken. `bin/lib/sandbox.mjs` had the same shape and failed
// OPEN — a credential-mount refusal that stopped refusing — which is why that one was fixed first
// and separately.
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
