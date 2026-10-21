// A rollup's head: everything except the per-finding and per-repo bodies, memoised on file identity.
//
// The fleet overview polls every 30 s and needs only small top-level fields, while a full rollup
// can run to hundreds of MB and is read twice per assembly (once itself, once inside liveness
// checkOne). The head is a small fraction of that, so a long-running panel keeps heads, never
// bodies, and re-parses only when the file changes.
//
// The head is defined by EXCLUSION. A reader of a field nobody listed still gets it; only the
// bodies below are withheld, and a reader that needs them must read the rollup itself.
// rollup-head.test.mjs fails if a head reader's source names one.

import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';

export const BODY_KEYS = Object.freeze(['scannerFindings', 'repos', 'allKeys']);
const MAX_ENTRIES = 256;

const memo = new Map();

const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};

function headOf(rollup) {
  if (!rollup || typeof rollup !== 'object' || Array.isArray(rollup)) return rollup;
  const head = {};
  for (const [k, v] of Object.entries(rollup)) if (!BODY_KEYS.includes(k)) head[k] = v;
  return head;
}

/**
 * -> { ok: true, head } | { ok: false, error }   `error` is the original Error (code + message
 * intact), so a caller's ENOENT-versus-everything-else branch behaves exactly as on a raw read.
 * The head is deep-frozen and shared between callers: a mutation throws instead of leaking into
 * the next request.
 */
export function readRollupHead(path) {
  let fd;
  try { fd = openSync(path, 'r'); }
  catch (error) { return { ok: false, error }; }
  try {
    // Keyed on the open descriptor's stat, so the identity and the bytes read are the same file
    // even if a sweep renames a new rollup into place between the two.
    const st = fstatSync(fd);
    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;
    const hit = memo.get(path);
    if (hit && hit.key === key) return hit.result;
    let result;
    try { result = { ok: true, head: deepFreeze(headOf(JSON.parse(readFileSync(fd, 'utf8')))) }; }
    catch (error) { result = { ok: false, error }; }
    memo.delete(path);
    memo.set(path, { key, result });
    if (memo.size > MAX_ENTRIES) memo.delete(memo.keys().next().value);
    return result;
  } catch (error) {
    return { ok: false, error };
  } finally {
    closeSync(fd);
  }
}

export function resetRollupHeadCache() { memo.clear(); }
export const rollupHeadCacheSize = () => memo.size;
