// monitor/sandbox-coverage.mjs — how much of a sweep ran CONFINED, and which lanes executed
// repository code without a sandbox around them.
//
// THE EXPOSURE THIS MEASURES. bin/commitwork.mjs wraps a lane in a host sandbox (sandbox-exec, via
// bin/lib/sandbox.mjs) when it can, and when it cannot the lane still runs — unconfined, under the
// operator's own user — and its row says so with `isolation: 'none'` plus an `isolationReason`.
// For most lanes that is a tool reading files. For a lane whose manifest declares
// `executesRepoCode` it is a third party's build script running on this laptop, and the fleet
// sweeps corpora of random public repositories. The row has carried the fact all along; nothing
// counted it, so the number nobody could state was "how many times did that happen last night".
//
// THE JOIN, AND THE HOLE IN IT. `isolation` is written per lane into <batch>/<repo>/checks-status.json;
// `executesRepoCode` is a property of the CHECK and lives in the manifests. This lens joins the two
// by check id — and refuses to guess when it cannot: if NO manifest declares the flag at all (a
// tree that predates it, or a manifests directory this process cannot read), every lane's
// repo-code dimension is `unknown`, not `false`. Defaulting there would print "0 unsandboxed
// repo-code lanes" from a join that never resolved, which is the exact false clean this repository
// keeps finding: the form satisfied, nothing fed.
//
// Missing artifacts are unknown('absent'), never zero: a sweep whose rows were never written, or a
// reports root that is not there, is an unmeasured sweep and says so.
//
// Env (read at call time): CW_SANDBOX_COVERAGE_ROOT (reports root), CW_SANDBOX_COVERAGE_MANIFESTS,
// CW_NOW.
//
//   node monitor/sandbox-coverage.mjs [--json] [--sweep <dir>]
//   exit 0 ok, 1 a lane executed repo code unconfined, 2 grey (no artifacts / unresolved join)

import { nowISO } from '../lib/clock.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { reportsRootDir } from './area.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestsDir = () => process.env.CW_SANDBOX_COVERAGE_MANIFESTS || join(REPO, 'manifests');

/** The reports root: the env seam first, then the registry's declared root. */
export function reportsRoot() {
  if (process.env.CW_SANDBOX_COVERAGE_ROOT) return process.env.CW_SANDBOX_COVERAGE_ROOT;
  return reportsRootDir();
}

/** The newest sweep batch under a root, or null. ENOENT is "no reports root"; anything else throws. */
export function latestSweep(root) {
  let names;
  try { names = readdirSync(root); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const batches = names.filter((n) => n.startsWith('sweep-')).filter((n) => {
    try { return statSync(join(root, n)).isDirectory(); } catch { return false; }
  }).sort();                       // the names carry a sortable stamp; newest is last
  return batches.length ? join(root, batches[batches.length - 1]) : null;
}

/**
 * Every checks-status.json in one batch: `<batch>/<repo>/checks-status.json`, plus the
 * `<batch>/checks-status.json` shape a few batches on disk use. Sorted, so the same batch reads
 * the same way twice.
 */
export function sweepStatusFiles(sweepDir) {
  const out = [];
  const shallow = join(sweepDir, 'checks-status.json');
  try { statSync(shallow); out.push({ file: shallow, repo: null }); } catch { /* the usual shape */ }
  let inner = [];
  try { inner = readdirSync(sweepDir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const d of inner) {
    if (!d.isDirectory()) continue;
    const f = join(sweepDir, d.name, 'checks-status.json');
    try { statSync(f); out.push({ file: f, repo: d.name }); } catch { /* no rows for this repo */ }
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : 1));
}

const rowsOf = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.checks)) return parsed.checks;
  if (parsed && typeof parsed === 'object') return Object.values(parsed).filter((v) => v && typeof v === 'object');
  return [];
};

/**
 * check id → does the check execute repository code?
 *
 * `declared` is the load-bearing number: it is how many checks state the flag anywhere. Zero means
 * the vocabulary is absent from this tree, and the caller must treat the whole dimension as
 * unknown rather than reading every silence as `false`.
 */
export function repoCodeFlags(dir = manifestsDir()) {
  const byCheck = new Map();
  let declared = 0;
  let files = 0;
  const unreadable = [];
  let names;
  try { names = readdirSync(dir); }
  catch (e) { return { byCheck, declared, files, unreadable: [`${dir}: ${e.code}`], dir }; }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')); }
    catch (e) { unreadable.push(`${name}: ${e.code || 'unparseable'}`); continue; }
    files++;
    for (const check of Array.isArray(parsed?.checks) ? parsed.checks : []) {
      if (!check || typeof check.id !== 'string') continue;
      const has = Object.prototype.hasOwnProperty.call(check, 'executesRepoCode');
      if (has) declared++;
      // Last writer wins only upward: a check declared true in one manifest is true.
      byCheck.set(check.id, byCheck.get(check.id) === true || check.executesRepoCode === true);
    }
  }
  return { byCheck, declared, files, unreadable, dir };
}

const sortedTally = (rows, keyOf) => {
  const by = {};
  for (const r of rows) { const k = keyOf(r); by[k] = (by[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(by).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/**
 * Pure assessment over rows already read. `repoCode` is true / false / null, and null is a state:
 * a lane whose check no manifest names, or a tree where the flag is undeclared entirely.
 */
export function assessSandboxCoverage(rows, flags) {
  const graded = rows.map((r) => {
    const isolation = typeof r.isolation === 'string' && r.isolation ? r.isolation : 'unrecorded';
    const known = flags.declared > 0 && flags.byCheck.has(r.check);
    return {
      repo: r.repo ?? null,
      check: r.check,
      isolation,
      isolationReason: typeof r.isolationReason === 'string' ? r.isolationReason : null,
      repoCode: known ? flags.byCheck.get(r.check) === true : null,
    };
  }).sort((a, b) => (a.repo ?? '').localeCompare(b.repo ?? '') || a.check.localeCompare(b.check));

  const unconfined = graded.filter((g) => g.repoCode === true && g.isolation === 'none');
  const repoCodeUnknown = graded.filter((g) => g.repoCode === null).length;
  const isolationUnrecorded = graded.filter((g) => g.isolation === 'unrecorded').length;
  return {
    lanes: graded.length,
    byIsolation: sortedTally(graded, (g) => g.isolation),
    // The matrix the question is actually about: (isolation × does it run their code).
    matrix: sortedTally(graded, (g) => `${g.isolation}/${g.repoCode === true ? 'repo-code' : g.repoCode === false ? 'no-repo-code' : 'repo-code-unknown'}`),
    unconfined: unconfined.map(({ repo, check, isolationReason }) => ({ repo, check, isolationReason })),
    unconfinedReasons: sortedTally(unconfined, (g) => g.isolationReason || '(no reason recorded)'),
    repoCodeUnknown,
    isolationUnrecorded,
    repoCodeDeclared: flags.declared,
  };
}

/**
 * The lens. -> a payload with `state`:
 *   findings  a lane executed repository code with isolation 'none'
 *   partial   measured, with a dimension unresolved (no flag declared, rows predating `isolation`,
 *             an unreadable artifact)
 *   ok        every lane accounted for and none of them unconfined repo code
 *   unknown   there was nothing to measure — absent, never zero
 */
export function runLens({ sweepDir = null, root = null, flags = null } = {}) {
  const at = nowISO();
  let base;
  try { base = root || reportsRoot(); }
  catch (e) { return { at, ...unknown('absent', `reports root unresolved: ${e.message}`), state: 'unknown' }; }
  let dir = sweepDir;
  if (!dir) {
    try { dir = latestSweep(base); }
    catch (e) { return { at, root: base, ...unknown('not-permitted', `reports root unreadable: ${e.code}`), state: 'unknown' }; }
  }
  if (!dir) return { at, root: base, ...unknown('absent', 'no sweep batch under the reports root'), state: 'unknown' };

  const files = sweepStatusFiles(dir);
  if (!files.length) return { at, root: base, sweep: dir, ...unknown('absent', 'the batch holds no checks-status.json — this sweep is unmeasured, not clean'), state: 'unknown' };

  const rows = [];
  const unreadable = [];
  for (const f of files) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(f.file, 'utf8')); }
    catch (e) { unreadable.push({ file: f.file, why: e.code || 'unparseable' }); continue; }
    for (const r of rowsOf(parsed)) if (r && typeof r.check === 'string') rows.push({ ...r, repo: f.repo });
  }
  if (!rows.length) {
    return { at, root: base, sweep: dir, files: files.length, unreadable, ...unknown(unreadable.length ? 'unparseable' : 'empty', 'no lane rows could be read from this batch'), state: 'unknown' };
  }

  const f = flags || repoCodeFlags();
  const a = assessSandboxCoverage(rows, f);
  const state = a.unconfined.length ? 'findings'
    : (a.repoCodeUnknown || a.isolationUnrecorded || unreadable.length || f.unreadable.length) ? 'partial'
    : 'ok';
  return {
    at, root: base, sweep: dir, statusFiles: files.length, unreadable,
    manifests: { dir: f.dir, files: f.files, declaredRepoCode: f.declared, unreadable: f.unreadable },
    ...a,
    state,
  };
}

/** One line for an end-of-sweep log. Says what was measured AND what was not. */
export function summaryLine(r) {
  if (r.unknown) return `sandbox-coverage: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`;
  const iso = Object.entries(r.byIsolation).map(([k, n]) => `${n} ${k}`).join(' · ');
  const grey = [];
  if (r.repoCodeUnknown) grey.push(`${r.repoCodeUnknown} lane(s) with no executesRepoCode declaration${r.repoCodeDeclared ? '' : ' (the flag is declared nowhere in manifests/)'}`);
  if (r.isolationUnrecorded) grey.push(`${r.isolationUnrecorded} row(s) predate the isolation field`);
  if (r.unreadable.length) grey.push(`${r.unreadable.length} unreadable artifact(s)`);
  return `sandbox-coverage: ${r.state} — ${r.lanes} lane(s): ${iso}`
    + ` · ${r.unconfined.length} executing repo code UNCONFINED`
    + (grey.length ? ` · grey: ${grey.join('; ')}` : '');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node monitor/sandbox-coverage.mjs [--json] [--sweep <dir>]\n'
      + '  lanes by (isolation × executesRepoCode) for the latest sweep, and every lane that ran a\n'
      + "  repository's own code unconfined, with its reason\n"
      + '  exit 0 ok, 1 unconfined repo-code lane(s), 2 grey (no artifacts, or the join is unresolved)');
    process.exit(0);
  }
  const i = argv.indexOf('--sweep');
  const r = runLens({ sweepDir: i >= 0 ? argv[i + 1] : null });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(summaryLine(r));
    if (!r.unknown) {
      for (const u of r.unconfined) console.log(`  UNCONFINED  ${u.repo ?? '(batch)'}  ${u.check}  — ${u.isolationReason || 'no reason recorded'}`);
      for (const [reason, n] of Object.entries(r.unconfinedReasons)) console.log(`  reason ×${n}  ${reason}`);
      for (const u of r.unreadable) console.log(`  UNREADABLE  ${u.file} (${u.why})`);
    }
  }
  process.exit(r.state === 'findings' ? 1 : r.state === 'ok' ? 0 : 2);
}
