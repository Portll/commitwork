// docsite-versions.mjs — a rolling snapshot of whatever this repo's docsite writers are about to
// overwrite, so an accidental overwrite (autocomplete gone wrong, a generator script pointed at
// the wrong file, a bad restore) is recoverable. Not a durable record: docsite/.versions/ is
// gitignored and excluded from the publish bundle, the same reasoning reports/ already gets
// elsewhere in this repo — this is a local safety net, not a history anyone is meant to read later.
//
// fact: snapshotBeforeWrite takes the OLD content as an argument, never re-reads the file itself /
//   every caller already has the pre-write bytes in hand (it just read them to decide whether
//   anything changed), and a second read is a second place for a race to land between "what we
//   snapshotted" and "what we're about to overwrite" (expiry: never, prev: not built)
// fact: 'editor-save' and 'generated' are separate pools with separate caps (100 / 1000) / one
//   person typing produces far fewer, far more valuable snapshots than every automatic writer
//   in the docsite combined, and a shared cap would let the noisy pool crowd out the narrow one
//   (expiry: never, prev: not built)
// fact: a private doc's snapshots stay in the private root / each function takes `{ root }`, and a
//   caller holding a doc passes rootOf(doc), so draft content is never copied into the public
//   tree's .versions (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE (via lib/docsite-roots.mjs)

import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeAtomic } from '../monitor/lockfile.mjs';
// The roots come from the leaf lib/docsite-roots.mjs, which avoids the import cycle a dependency on
// docsite-manifest.mjs would close (that module imports snapshotBeforeWrite below).
import { docsiteRoot } from './docsite-roots.mjs';

export const ORIGINS = Object.freeze({ 'editor-save': 100, generated: 1000 });

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

// key: a doc's urlPath, or the literal 'manifest' for docsite/manifest.json. Both are already
// constrained (SLUG_RE / UUID_RE, or the fixed literal) by their callers, but re-checked here too
// — this module writes to disk under `key`, so it is the one place a bad key becomes a path.
const KEY_RE = /^([a-z0-9][a-z0-9-]{0,63}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|manifest)$/;
// <ISO ms timestamp>-<6-digit monotonic seq>-<12-hex sha>.snapshot. The seq exists because the ISO
// timestamp alone is only millisecond-resolution: two writes landing in the same millisecond (rare
// in real use, routine under a fast test loop) would otherwise sort by their HASH, not by write
// order, which breaks pruning's "oldest dropped first" contract — measured 2026-08-29, the pruning
// test failed intermittently under a full-suite run for exactly this reason while passing reliably
// in isolation. The seq is per-process and resets on restart; that's fine, since it only has to
// disambiguate writes that share the SAME millisecond, and two processes doing that at once still
// only affects prune order at one boundary, never data loss (nothing is deleted before the write
// that supersedes it, per the prune-after-write rule below).
const ID_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z-[0-9]{6}-[0-9a-f]{12}\.snapshot$/;
let seqCounter = 0;
const nextSeq = () => String(seqCounter++ % 1_000_000).padStart(6, '0');

const versionsRoot = (root = docsiteRoot()) => join(root, '.versions');
const poolDir = (key, origin, root) => {
  if (!KEY_RE.test(key)) throw new Error(`docsite-versions: bad key '${key}'`);
  if (!(origin in ORIGINS)) throw new Error(`docsite-versions: bad origin '${origin}' (want ${Object.keys(ORIGINS).join('|')})`);
  return join(versionsRoot(root), key, origin);
};

// Prune AFTER writing, never before: a crash between prune and write would otherwise lose a
// snapshot that was never superseded by anything.
function prune(dir, cap) {
  let files;
  try { files = readdirSync(dir); } catch { return; }
  files.sort(); // ISO-timestamp-prefixed names sort lexically = chronologically
  for (const f of files.slice(0, Math.max(0, files.length - cap))) {
    try { rmSync(join(dir, f)); } catch { /* another writer already pruned it — fine */ }
  }
}

export function snapshotBeforeWrite(key, origin, previousContent, { root } = {}) {
  if (previousContent == null) return; // nothing existed yet — nothing to protect
  const dir = poolDir(key, origin, root);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const hash = sha256Hex(previousContent).slice(0, 12);
  writeAtomic(join(dir, `${stamp}-${nextSeq()}-${hash}.snapshot`), previousContent);
  prune(dir, ORIGINS[origin]);
}

export function listVersions(key, origin, { root } = {}) {
  const dir = poolDir(key, origin, root);
  let files;
  try { files = readdirSync(dir); } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  return files.filter((f) => ID_RE.test(f)).sort().reverse().map((id) => {
    const at = id.slice(0, 24).replace(/-/g, (m, i) => (i < 10 ? '-' : i === 10 ? 'T' : i < 19 ? ':' : '.'));
    let bytes = 0;
    try { bytes = readFileSync(join(dir, id)).length; } catch { /* raced with a prune — omit size, id still lists */ }
    return { id, at, bytes };
  });
}

export function readVersion(key, origin, id, { root } = {}) {
  if (!ID_RE.test(id)) throw new Error(`docsite-versions: bad version id '${id}'`);
  return readFileSync(join(poolDir(key, origin, root), id));
}
