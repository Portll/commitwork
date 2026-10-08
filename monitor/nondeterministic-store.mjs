// nondeterministic-store.mjs — the ONE store for values that CANNOT be recomputed byte-for-byte:
// LLM divergence scores (D3), version-delta anomaly ranks (C). It lives OUTSIDE reportsRoot so the
// deterministic rollup's readdirSync(reportsDir) can never reach it (G2/F1/F2), records are APPENDED
// and never overwritten (two runs of a nondeterministic lane are two facts, not a correction), the
// writer is atomic + bounded + fail-loud, and retention is per-(subject,dimension) with a hot depth
// (the slider) and manual-only deletion for now.
//
// fact: excluded-from-determinism is NOT excluded-from-retention — the sweep-<stamp> keyed compactor
// never sees this store, so it carries its OWN bound. An unbounded store here reprises the volume wedge.
// fact: this module must NOT import the rollup graph (area/rollup). Sharing that graph would give the
// two a common failure mode, and the whole point is that they cannot.

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, mkdirSync, existsSync, statSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { withinRoot } from '../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// Read at CALL time, never module load — a `const X = process.env.Y` at import silently defeats the
// override for any test that sets it after. Default is a hidden top-level dir OUTSIDE reports/, so it
// cannot sit under any sweep batch (or the reports root) the rollup enumerates.
export function storeRoot() {
  return resolve(process.env.CW_NONDET_STORE || join(CW, '.nondeterministic'));
}

// The deterministic reports root — mirrored here (not imported from area.mjs) so callers/tests can
// prove the store is outside it WITHOUT this module pulling in the very graph it is excluded from.
export function reportsRootDefault() {
  return resolve(process.env.CW_MONITOR_OUT || join(CW, 'reports'));
}


// A filename fragment that is safe and POSITION-FREE — never a line number, never anything that moves
// when unrelated code moves (house rule: identity excludes line).
const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);

// One JSONL file per (subject, dimension).
function recordPath(subject, dimension) {
  return join(storeRoot(), safe(dimension), `${safe(subject)}.jsonl`);
}

// The hot-retention depth per (subject, dimension) — this is the slider. Read at call time.
const hotDepth = () => Math.max(1, Number(process.env.CW_NONDET_HOT || 50));

function readRows(p) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; } // ONLY ENOENT is legitimately empty
  // A parse failure THROWS — a corrupt store is never silently reset to clean (fail closed).
  return raw.split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); }
    catch (e) { throw new Error(`nondeterministic-store: corrupt record at ${p}:${i + 1} — ${e.message}`); }
  });
}

// Append an observation, then bound the file to the hot depth via tmp+rename (atomic replace). A
// re-run APPENDS; it never overwrites a prior observation with a new one.
export function record({ subject, dimension, score, detail = null } = {}) {
  if (!subject || !dimension) throw new Error('record: subject and dimension are required');
  if (typeof score !== 'number' || Number.isNaN(score) || score < 0 || score > 1) {
    throw new Error(`record: score must be a number in [0,1], got ${JSON.stringify(score)}`);
  }
  const p = recordPath(subject, dimension);
  mkdirSync(dirname(p), { recursive: true });
  const rows = readRows(p);
  rows.push({ subject, dimension, score, detail, ts: nowISO() });
  const kept = rows.slice(-hotDepth());
  writeAtomic(p, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { path: p, kept: kept.length, dropped: rows.length - kept.length };
}

// Observations for a (subject, dimension), oldest first, latest last. ENOENT -> [].
export function read(subject, dimension) {
  return readRows(recordPath(subject, dimension));
}

// Every subject's observations for one dimension, by subject. The store or dimension directory
// being ENOENT is `absent`; any other read or parse failure throws.
export function readDimension(dimension) {
  const dir = join(storeRoot(), safe(dimension));
  let names;
  try { names = readdirSync(dir); }
  catch (e) { if (e.code === 'ENOENT') return { absent: true, subjects: [] }; throw e; }
  const subjects = names.filter((n) => n.endsWith('.jsonl')).sort().map((n) => {
    const rows = readRows(join(dir, n));
    return { subject: (rows.find((r) => r && r.subject) || {}).subject ?? n.slice(0, -'.jsonl'.length), rows };
  });
  return { absent: false, subjects };
}

// Every record file (*.jsonl) under the store.
function recordFiles(root) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) out.push(p);
  } };
  if (existsSync(root)) walk(root);
  return out;
}

// Archive the store to `dest`. Space is freed ONLY if `dest` is on a DIFFERENT device (F3): on the
// same st_dev a move relocates bytes inside one free pool and frees NOTHING, so a prune on the same
// device is REFUSED and said so, never reported as a phantom reclaim. Manual-delete only: the copy is
// verified byte-for-byte first (a read-back receipt — an archive you cannot read back is worse than a
// deletion), and prune defaults OFF.
export function archive(dest, { prune = false } = {}) {
  const root = storeRoot();
  const files = recordFiles(root);
  if (!files.length) return { archived: 0, verified: 0, freedBytes: 0, sameDevice: null, note: 'store empty — nothing to archive' };
  mkdirSync(dest, { recursive: true });
  const sameDevice = statSync(root).dev === statSync(dest).dev;
  cpSync(root, dest, { recursive: true }); // COPY, never move — durability before space
  let verified = 0;
  for (const f of files) {
    const d = join(dest, relative(root, f));
    if (!existsSync(d) || readFileSync(d, 'utf8') !== readFileSync(f, 'utf8')) {
      throw new Error(`archive: read-back FAILED for ${d} — refusing to prune an unverifiable archive`);
    }
    verified++;
  }
  let freedBytes = 0;
  if (prune && !sameDevice) for (const f of files) { freedBytes += statSync(f).size; rmSync(f); }
  const note = prune && sameDevice
    ? 'same device: prune would free 0 bytes and was refused; archive copied, source kept'
    : prune ? `pruned ${files.length} verified source files` : 'archived (verified copy); source kept — manual delete only';
  return { archived: files.length, verified, freedBytes, sameDevice, note };
}

// Is `p` within the deterministic reports tree? The guard test asserts the store is NOT, which is the
// structural half of the two-witness exclusion (W2). Trailing slash so `reports-foo` is not "within".
export function isWithinReports(p, reportsRoot = reportsRootDefault()) {
  const root = resolve(reportsRoot);
  // withinRoot(): `startsWith(root + '/')` is false for every path on Windows, so containment was
  // always false there. See lib/path-contain.mjs.
  return withinRoot(root, p);
}
