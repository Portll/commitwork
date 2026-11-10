// How a lane's directory walk treats symbolic links inside the scanned tree.
//
// A link whose target resolves inside the root is part of the package (a workspace alias, a shared
// config) and is followed. A link that resolves outside the root, or to nothing, is not followed and
// is returned as a warning: a checked-out repo can carry a link to `/`, the operator's home or any
// host file, and reading through it puts host content into the lane's findings.
//
// Every directory entered and file read is registered by real path, so a link back to an ancestor
// cannot loop and a target reached by two paths is read once. Links are queued and followed after the
// direct walk, so a file keeps the path it has in the tree rather than an alias's.
import { realpathSync } from 'node:fs';
import { relative, isAbsolute, resolve, sep } from 'node:path';

export const LINK_OUTSIDE = 'symlink-outside-root';
export const LINK_DANGLING = 'symlink-dangling';

export function linkPolicy(root) {
  const realOf = (p) => { try { return realpathSync(p); } catch { return null; } };
  // A missing root is the lane's to report; the policy must not throw before the lane can.
  const realRoot = realOf(root) ?? resolve(root);
  const seen = new Set();
  const pending = [];
  const insideRoot = (real) => {
    const rel = relative(realRoot, real);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  return {
    /**
     * True the first time this directory or file is reached by any path, false after. An unresolvable
     * path is let through so the lane's own read fails and reports it.
     */
    first(p) {
      const real = realOf(p);
      if (real == null) return true;
      if (seen.has(real)) return false;
      seen.add(real);
      return true;
    },
    /** Queue a link that stays inside the root and return null; otherwise return why it is not followed. */
    link(p) {
      const real = realOf(p);
      if (real == null) return LINK_DANGLING;
      if (!insideRoot(real)) return LINK_OUTSIDE;
      pending.push({ path: p, target: relative(realRoot, real).split(sep).join('/') });
      return null;
    },
    /**
     * Yield {path, target} for each queued link until none remain, including links found inside
     * followed directories. target is the real target relative to the root, for the lane to apply its
     * exclusions to: a link must not reach a directory the walk skips by name.
     */
    *drain() { while (pending.length) yield pending.shift(); },
  };
}
