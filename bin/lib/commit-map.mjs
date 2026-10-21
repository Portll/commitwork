// The one reader for the rewrite commit map: old sha -> what that commit is called NOW.
//
// History here has been rewritten three times (2026-09-24, 2026-09-25, 2026-10-11), so a sha
// recorded before a rewrite resolves to nothing in a fresh clone and to an orphaned object locally
// until gc takes it. Anything that STORED a sha — a doc stamp, an audit baseline, a commit citation
// — is stale by that act alone, and the map is the only thing that can say what it became.
//
// Two callers, one definition: bin/resolve-sha.mjs answers the question for a person, and
// bin/anchor-staleness.mjs needs the answer to run at all. Two copies of a lookup rule is how a
// second witness comes to share the first one's failure mode.
//
// env, read at call time: CW_COMMIT_MAP (the map file; else the private store's)

import { existsSync, readFileSync } from 'node:fs';
import { commitMapPathFor } from '../../monitor/store-paths.mjs';

export const commitMapPath = (repoRoot) => commitMapPathFor(repoRoot);

/**
 * Read the map. Returns { ok: true, map, rows, path } or { ok: false, reason, path }.
 *
 * `ok: false` means the map could not be READ — absent, unreadable. Only ENOENT is a legitimate
 * absence; a permission failure says so rather than reading as "nothing was rewritten". A map that
 * reads fine and holds no rows is `ok: true` with `rows: 0`, because what that means depends on who
 * is asking (see the note at the return).
 */
export function loadCommitMap(repoRoot, { path = null } = {}) {
  const p = path || commitMapPath(repoRoot);
  if (!existsSync(p)) {
    return { ok: false, path: p, reason: `no commit map at ${p} — run \`node bin/resolve-sha.mjs --rebuild\` while the old objects are still in the object store` };
  }
  let text;
  try { text = readFileSync(p, 'utf8'); }
  catch (e) { return { ok: false, path: p, reason: `commit map at ${p} could not be read: ${e.code || e.message}` }; }
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [o, n] = line.trim().split(/\s+/);
    if (o && n) map.set(o, n);
  }
  // A READABLE map with no rows is ok, and that is not a technicality. The two callers mean
  // different things by it: bin/resolve-sha.mjs can still answer "that sha resolves as-is" from the
  // object store, while bin/anchor-staleness.mjs has nothing to translate with and must refuse. So
  // emptiness is reported as a FACT (`rows`) and judged by the caller, rather than being decided
  // here for both of them.
  return { ok: true, path: p, map, rows: map.size };
}

/**
 * old -> new, by prefix: a stored sha is usually 7-10 characters and the map holds 40.
 *
 * A prefix matching SEVERAL rows is ambiguous and answers null. Picking the first would hand back
 * one of two different commits with no way for the caller to know it had a choice.
 */
export function resolveRewritten(sha, map) {
  const s = String(sha ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!s || !map) return null;
  if (map.has(s)) return map.get(s);
  let hit = null;
  for (const [o, n] of map) {
    if (!o.startsWith(s)) continue;
    if (hit && hit !== n) return null;   // ambiguous prefix
    hit = n;
  }
  return hit;
}
