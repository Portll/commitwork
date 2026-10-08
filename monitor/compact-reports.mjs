#!/usr/bin/env node
// commitwork monitor — reports/ retention compactor. Keeps the newest N batches whole and slims
// the rest: prunes regenerable CodeQL DB internals only (every *.sarif, summary and per-repo
// JSON/log stays; each pruned batch gets a prune-manifest.json with a rebuild recipe).
//
// usage: node monitor/compact-reports.mjs [--apply] [--keep N]
//        (default is a DRY RUN; --apply is required to delete anything)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDirFor, reportsRootDir } from './area.mjs'; // THE OUT resolver (one chain, no literals)
import { areaOut } from './registry.mjs';
import { takeReportsLock, describeAge } from './lockfile.mjs';
import { registryPathFor } from './store-paths.mjs';
import { planProtection } from './retention.mjs'; // policy lives there; this file only acts on it

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CW = path.resolve(HERE, '..');
const APPLY = process.argv.includes('--apply');
const keepArg = (() => { const i = process.argv.indexOf('--keep'); return i > -1 ? +process.argv[i + 1] : null; })();

const reg = JSON.parse(fs.readFileSync(registryPathFor(path.join(HERE, '..')), 'utf8'));
const ROOT = reportsRootDir(reg);
const cfg = reg.retention || {};
const KEEP = keepArg || +(process.env.CW_RETENTION_KEEP || 0) || cfg.keepFullSweeps || 3;
// Every CodeQL language database, not only java: a registry copied from projects.example.json
// declares no pattern, and the narrow fallback let codeql-python-db and codeql-ruby-db pile up.
const DROP_DIR = new RegExp(cfg.dropDirPattern || '^codeql(-[a-z0-9]+)*-db$');
// The durable report dir, resolved through area.mjs — this tool deletes, so a wrong name is data loss
const OUT_DIR = outDirFor(null, reg);
const MONITOR_OUT = path.basename(OUT_DIR);

// ROOT-WIDE lock — this deletes across EVERY area; dry runs take no lock. Skipping is the safe
// outcome: retention deferred costs bytes, retention racing a writer costs data.
if (APPLY) {
  const held = takeReportsLock(ROOT, { label: 'compact-reports' });
  if (!held.ok) {
    console.error(`[compact] another reports-root writer is running (${held.path}, ${describeAge(held.heldFor)}) — skipping this compaction rather than racing it.`);
    process.exit(0);
  }
}

// ---- protected set -------------------------------------------------------
// Hard-protected by name, plus the pointer target, plus the newest KEEP batches.
// EVERY declared area's `out` is protected, not just the ambient one.
const PROTECTED = new Set([MONITOR_OUT, 'runtime-latest',
  ...(reg.areas || []).map((a) => areaOut(a.slug, reg)),
  ...(cfg.protect || [])]);
try {
  const ptr = fs.readFileSync(path.join(ROOT, '.codeql-fleet-latest'), 'utf8').trim();
  if (ptr) PROTECTED.add(path.basename(ptr));
} catch { /* no pointer file — nothing extra to protect */ }

// Anchored on purpose: `sweep-latest.log` shares the prefix and sorts after the numeric names.
// Admits the per-area form `sweep-<stamp>-<area>`; do not loosen without re-proving that case.
const BATCH_RE = /^sweep-\d{14}(-[a-z0-9][a-z0-9-]*)?\.?$/;
const isBatch = (name) => BATCH_RE.test(name);
const batchDirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && isBatch(e.name))
  .map((e) => e.name).sort();

// which area a batch belongs to, from the manifest sweep.mjs wrote before running
const batchArea = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name, 'batch-manifest.json'), 'utf8')).area || null; }
  catch { return null; }
};
// PER-AREA policy — a global slice(-KEEP) lets a busy area starve a quiet area's newest batch, and
// an area may also declare its own count or an age floor. retention.mjs owns the decision; this
// file only acts on it. Reasons are kept so a survivor can SAY which rule saved it.
const plan = planProtection(batchDirs.map((b) => ({ name: b, area: batchArea(b) })), { reg, globalKeep: KEEP });
for (const k of plan.protect) PROTECTED.add(k);
for (const [area, s] of [...plan.byArea].sort()) {
  const p = s.policy;
  if (p.keepDaysFrom || p.keepFrom !== 'global') {
    // NO colon anywhere on this line — retention-protect.test.mjs reads `[compact] <name>:` as a
    // touched batch, so a colon here would report an area as a pruning candidate.
    console.log(`[compact] policy for ${area} — keep ${p.keepFullSweeps} (${p.keepFrom})`
      + (p.keepDays === null ? '' : ` + ${p.keepDays}d floor (${p.keepDaysFrom})`)
      + ` — ${s.protected}/${s.total} batches protected`);
  }
}

// ---- helpers -------------------------------------------------------------
const bytesOf = (p) => {
  let total = 0;
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else { try { total += fs.statSync(fp).size; } catch { /* vanished mid-walk */ } }
    }
  };
  walk(p);
  return total;
};

// PER-AREA anchors — each area resolves its own; an area with no history records null WITH a
// reason rather than borrowing another project's SHA
const anchorCache = new Map();
function anchorsForArea(area) {
  const key = area || '(unscoped)';
  if (anchorCache.has(key)) return anchorCache.get(key);
  let res = { anchors: {}, source: null, reason: null };
  try {
    const outDir = area ? path.join(ROOT, areaOut(area, reg) || area) : OUT_DIR;
    const histDir = path.join(outDir, 'history');
    const slices = fs.readdirSync(histDir).filter((f) => /^\d{14}\.json$/.test(f)).sort();
    if (!slices.length) res.reason = `area '${key}' has no history slices`;
    else {
      const latest = slices[slices.length - 1];
      res.anchors = JSON.parse(fs.readFileSync(path.join(histDir, latest), 'utf8')).anchors || {};
      res.source = path.relative(ROOT, path.join(histDir, latest));
    }
  } catch (e) { res.reason = `area '${key}' history unreadable: ${e.message}`; }
  anchorCache.set(key, res);
  return res;
}

// ---- compaction ----------------------------------------------------------
// FAIL-CLOSED: deletion requires a POSITIVE match — "unrecognised" is never "disposable"
const allDirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const candidates = allDirs.filter((n) => isBatch(n) && !PROTECTED.has(n)).sort();
// Anything neither a batch nor a declared area is protected BY DEFAULT, and reported
const undeclared = allDirs.filter((n) => !isBatch(n) && !PROTECTED.has(n));
if (undeclared.length) {
  // no trailing colon — retention-protect.test.mjs reads the `[compact] <name>:` shape as a touched batch
  console.log(`[compact] protected ${undeclared.length} undeclared director(ies) under ${path.relative(CW, ROOT)}/ — never pruned; declare in projects.json areas[] or remove`);
  for (const n of undeclared) console.log(`  · ${n}  ${(bytesOf(path.join(ROOT, n)) / 1e6).toFixed(1)} MB`);
}

let totalBytes = 0, totalDirs = 0, touched = 0;
const skipped = [];
for (const batch of candidates) {
  const batchPath = path.join(ROOT, batch);
  const hits = [];
  const scan = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const fp = path.join(d, e.name);
      if (DROP_DIR.test(e.name)) hits.push(fp);
      else if (e.name !== 'docs') scan(fp); // never descend into races/docs
    }
  };
  scan(batchPath);
  if (!hits.length) continue;

  const area = batchArea(batch);
  const anc = anchorsForArea(area);
  const entries = hits.map((h) => {
    const repo = path.basename(path.dirname(h));
    return { path: path.relative(ROOT, h), repo, bytes: bytesOf(h),
      anchorSha: (anc.anchors[repo] || {}).sha || null,
      anchorMissingReason: (anc.anchors[repo] || {}).sha ? undefined : (anc.reason || `no anchor recorded for ${repo}`) };
  });
  const bytes = entries.reduce((n, e) => n + e.bytes, 0);
  totalBytes += bytes; totalDirs += entries.length; touched++;

  if (!APPLY) { console.log(`[compact] DRY ${batch}: ${entries.length} dirs, ${(bytes / 1e9).toFixed(2)} GB`); continue; }

  try {
    // manifest FIRST — the reversibility record must exist before the bytes go
    fs.writeFileSync(path.join(batchPath, 'prune-manifest.json'), JSON.stringify({
      tool: 'commitwork compact-reports', batch, prunedAt: new Date().toISOString(),
      keepFullSweeps: KEEP,
      rationale: 'CodeQL database internals + query logs are write-only after rollup; only their SARIF is consumed. The durable record is the slice in history/.',
      preserved: 'all *.sarif, osv.sarif, npm-audit.json, summary.md and per-repo JSON/log reports in this batch are UNTOUCHED',
      removedDirs: entries.length, removedBytes: bytes, entries,
      regeneration: {
        recipe: 'codeql database create <dir> --language=<java|javascript> --source-root=<repo checked out at anchorSha>',
        anchorsSource: anc.source || null,
        anchorsUnavailable: anc.source ? undefined : (anc.reason || 'no history for this batch\'s area'),
        area: area || null,
      },
    }, null, 2));
    for (const e of entries) fs.rmSync(path.join(ROOT, e.path), { recursive: true, force: true });
    console.log(`[compact] ${batch}: freed ${(bytes / 1e9).toFixed(2)} GB (${entries.length} dirs)`);
  } catch (err) {
    // Retention must never take the reporting pipeline down with it.
    skipped.push({ batch, reason: err.message });
    console.log(`[compact] SKIPPED ${batch}: ${err.message}`);
  }
}

// Versioned-rollup prune: rollup-<sliceId>.json duplicates grow without bound inside the
// protected tree. history/ is NEVER touched — the slices are the durable record.
const KEEP_VERSIONED = +(cfg.keepVersionedRollups ?? 10);
let vPruned = 0, vBytes = 0;
for (const areaDir of new Set([...(reg.areas || []).map((a) => areaOut(a.slug, reg)), ...allDirs.filter((n) => !isBatch(n))])) {
  const dir = path.join(ROOT, areaDir);
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^rollup-.+\.json$/.test(f)).sort(); } catch { continue; }
  const surplus = files.slice(0, Math.max(0, files.length - KEEP_VERSIONED));
  for (const f of surplus) {
    const fp = path.join(dir, f);
    let sz = 0; try { sz = fs.statSync(fp).size; } catch { /* vanished */ }
    vBytes += sz; vPruned++;
    if (APPLY) { try { fs.rmSync(fp, { force: true }); } catch { /* best-effort */ } }
  }
}
if (vPruned) console.log(`[compact] ${APPLY ? 'pruned' : 'would prune'} ${vPruned} surplus rollup-<slice>.json duplicate(s) (${(vBytes / 1e6).toFixed(1)} MB, keeping newest ${KEEP_VERSIONED} per area; history/ untouched)`);

// `keeping newest N` is the GLOBAL default; say so when an area overrides it, or the summary reads
// as the whole policy while some areas are on a different one.
const overrides = [...plan.byArea].filter(([, s]) => s.policy.keepDaysFrom || s.policy.keepFrom !== 'global').length;
console.log(`[compact] ${APPLY ? 'freed' : 'would free'} ${(totalBytes / 1e9).toFixed(2)} GB across ${touched} batches (${totalDirs} dirs) · keeping newest ${KEEP} full`
  + (overrides ? ` (global default; ${overrides} area(s) declare their own — see the policy lines above)` : ''));
if (skipped.length) console.log(`[compact] ${skipped.length} batch(es) SKIPPED — not silent: ${skipped.map((s) => s.batch).join(', ')}`);
if (!APPLY && touched) console.log('[compact] dry run — re-run with --apply to delete');
