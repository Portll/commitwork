// commitwork monitor — THE report-directory resolver: one OUT, one precedence chain.
// `slug` is the route/artifact identity, `out` the report directory — never collapsed.
// Precedence, most specific first:
//   1. CW_MONITOR_OUT            injection seam — always wins
//   2. the named area's `out`    <reportsRoot>/<areaOut(slug)> — declared, never inferred
//   3. registry `monitorOutput`  legacy pre-areas[] default; keep unset (it outranks rung 4)
//   4. the primary area's `out`
//   5. THROW                     no project name is baked in here
// No side effects at import: nothing is read or resolved until a function is called.

import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { loadRegistry, areaOut, areaLabel, primaryArea } from './registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CW = resolve(HERE, '..');

// Memoised — many call sites, one read; callers holding a parsed registry pass it in
let cached = null;
export function registry() { return (cached ||= loadRegistry({ quiet: true })); }

// <CW>/<reportsRoot> — the shared root that holds every area dir and every sweep batch.
export const reportsRootDir = (reg = registry()) => resolve(CW, reg.reportsRoot || 'reports');

// Resolve symlinks WITHOUT depending on whether the leaf still exists: realpath the deepest
// ancestor that does, then re-append the segments below it.
//
// The plain `try { realpathSync(x) } catch { return x }` this replaces was the whole defect. It put
// the two sides of `relative()` in different namespaces the moment one of them was gone: on macOS
// the root realpaths into /private/var/… while a deleted batch stayed at /var/…, so the SAME path
// keyed one way while it existed and another after it did not. Measured 2026-09-06:
//
//   while it exists   "cw-sk-k4UMP7"
//   after deletion    "../../../../../../var/folders/n8/…/T/cw-sk-k4UMP7"
//
// Not a cosmetic difference — the second escapes the reports root entirely and can never match a
// prior row. A re-roll then found no row for its own batch and minted a fresh stamp, which six
// assertions across pipeline-canary and rollup-unparseable-cve reported as "no history/index.json
// row for this batch". The key has to be a property of the PATH, not of what is on disk when it is
// asked, because it is compared across the lifetime of a directory that is meant to be swept away.
const realDeep = (x) => {
  let cur = resolve(x);
  const tail = [];
  for (;;) {
    try { const r = realpathSync(cur); return tail.length ? join(r, ...tail) : r; } catch { /* climb */ }
    const parent = dirname(cur);
    if (parent === cur) return resolve(x);   // reached the filesystem root and nothing resolved
    tail.unshift(basename(cur));
    cur = parent;
  }
};

// The batch identity a history row carries as `source`. rollup.mjs dedupes a re-roll by it (prior
// row, prevSlice, the index filter), so the same batch must key identically whether the row was
// recorded absolute (every row before 2026-09-02) or relative (every row after): relative to the
// reports root, posix separators, and both sides resolved through `realDeep` so neither a symlinked
// root nor an already-deleted batch can fork one batch into two keys. A batch outside the root keys
// as `../…` — deterministic, and honest about where it is. Non-strings key as null; compare sites
// keep their v1 guard, so null never matches.
export function sourceKey(p, reg = registry()) {
  if (typeof p !== 'string' || !p) return null;
  const root = reportsRootDir(reg);
  const abs = isAbsolute(p) ? p : resolve(root, p);
  return relative(realDeep(root), realDeep(abs)).split(sep).join('/');
}

// The report directory NAME (one path segment) — compact-reports.mjs protects by name, not path
export function outNameFor(slug, reg = registry()) {
  if (slug) return areaOut(slug, reg);
  if (reg.monitorOutput) return reg.monitorOutput;
  const p = primaryArea(reg);
  if (p) return areaOut(p.slug, reg);
  throw new Error('area: cannot resolve a report directory — monitor/projects.json declares no areas[] '
    + 'and no monitorOutput. Declare an area (primary:true), pass an area slug, or set CW_MONITOR_OUT.');
}

// Default area when the caller named none — throws rather than guessing a project name
export function primaryAreaSlug(reg = registry()) {
  const p = primaryArea(reg);
  if (!p) throw new Error('area: no primary area declared in monitor/projects.json — pass an area slug explicitly');
  return p.slug;
}

// THE resolver. `slug` = area slug, or null for the ambient area; returns an ABSOLUTE dir (never
// created here). `env: false` opts out of CW_MONITOR_OUT for per-project tools invoked inside one
// process tree — one env dir would make every project read one project's rollup.
export function outDirFor(slug, reg = registry(), { env = true } = {}) {
  if (env && process.env.CW_MONITOR_OUT) return resolve(process.env.CW_MONITOR_OUT);
  return join(reportsRootDir(reg), outNameFor(slug, reg));
}

// The area THIS process writes to, for honest labelling. A dir matching no declared area sets
// declared:false and warns once — the slug is then an assumption, not a declaration.
let warnedAmbient = false;
export function ambientArea(reg = registry(), dir = outDirFor(null, reg)) {
  const hit = (reg.areas || []).find((a) => outDirFor(a.slug, reg, { env: false }) === dir);
  const slug = hit?.slug || primaryArea(reg)?.slug || null;
  if (!hit && slug && !warnedAmbient) {
    warnedAmbient = true;
    console.error(`area: '${dir}' matches no declared area; attributing to primary '${slug}'. Output labelled with this area is an assumption, not a declaration.`);
  }
  return { slug, label: slug ? areaLabel(slug, reg) : null, dir, declared: !!hit };
}

// Every sweep batch under the reports root, OLDEST FIRST, manifest parsed once. Selection is the
// permissive `sweep-` form; the anchored 14-digit pattern belongs to compact-reports.mjs alone
// (deleting needs a smaller net than reading).
export function sweepBatches(reg = registry()) {
  const root = reportsRootDir(reg);
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  return names
    .filter((d) => d.startsWith('sweep-') && (() => { try { return statSync(join(root, d)).isDirectory(); } catch { return false; } })())
    .sort()
    .map((name) => {
      const dir = join(root, name);
      let manifest = null;
      try { manifest = JSON.parse(readFileSync(join(dir, 'batch-manifest.json'), 'utf8')); } catch { /* adhoc/pre-manifest batch */ }
      return { name, dir, stamp: (name.match(/^sweep-(\d{14})/) || [])[1] || null, manifest };
    });
}

// Does this batch belong to the given area? -> true | false | NULL (unknown scope: the batch
// predates manifest area recording). Two keys, either sufficient: the declared slug, or the
// recorded output dir resolving to the same place.
export function batchCoversArea(batch, { slug = null, dir = null } = {}) {
  const m = batch?.manifest;
  if (!m) return null;
  const hasArea = typeof m.area === 'string', hasOut = typeof m.areaOut === 'string';
  if (!hasArea && !hasOut) return null;
  if (slug && hasArea && m.area === slug) return true;
  if (dir && hasOut && resolve(CW, m.areaOut) === resolve(dir)) return true;
  return false;
}

// Same list, NEWEST first, split into provably-covering and unknown-scope; nothing that provably
// belongs to ANOTHER area is returned in either list.
export function batchesForArea(target, reg = registry()) {
  const all = sweepBatches(reg).reverse();
  const covers = [], unknown = [];
  for (const b of all) {
    const v = batchCoversArea(b, target);
    if (v === true) covers.push(b);
    else if (v === null) unknown.push(b);
  }
  return { covers, unknown };
}
