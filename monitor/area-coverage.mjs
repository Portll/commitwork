#!/usr/bin/env node
// commitwork monitor — does reports/<area>/rollup.json actually cover its area?
//
// THE DEFECT THIS ANSWERS, measured 2026-09-06. `rollup.json` sits at a stable path and holds
// whatever the LAST sweep wrote. A sweep may cover one repo. commitwork-admin resolved to six
// (commitwork, -business, -remote, -research, -sidecar, -web); the last full sweep was
// 2026-09-05T17:15, and the four sweeps after it were single-repo. So the stable path held
// commitwork-remote ALONE, and a reader asking "how is commitwork doing" got a different
// repository's numbers under the area's name — including a CodeQL coverage figure of 2 files
// against a tree carrying 1,022. That reader was an agent, and it published the wrong subject's
// lane table before anyone caught it.
//
// The slice is not lying: it carries repos[].name, scanned.intendedRepos and coverage.swept, and
// the sweep did exactly what it intended. The consumer is the problem — admin/serve.mjs reads that
// path in ten places, and nothing on the way makes partiality impossible to miss. So this does not
// change what a sweep writes. It makes the question answerable in one command, and gives a gate
// something to exit non-zero on.
//
// WHY MEMBERSHIP IS OBSERVED, NOT DECLARED. monitor/projects.json names ONE repo for this area;
// the other five arrive through the roots walk at sweep time. There is no static list to compare
// against, so the population is the union of what the area has actually been seen to contain —
// declared entries plus every repo named by a preserved slice. That makes the denominator grow
// when discovery finds something new, which is correct, and it means a repo that has never been
// swept at all is invisible here. That limit is stated rather than hidden: this check answers
// "does the stable rollup cover what this area has been seen to hold", not "does it cover the disk".
//
// usage:
//   node monitor/area-coverage.mjs <area>        human summary; exit 1 if the stable rollup is partial
//   node monitor/area-coverage.mjs <area> --json
//   node monitor/area-coverage.mjs --all         every area with a reports dir
//
// exit: 0 stable rollup covers the observed area · 1 partial · 2 cannot determine (unreadable/absent)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { registryPath as sharedRegistryPath } from './registry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Read env at CALL time. A `const` at module load silently defeats every test that sets it after.
const reportsRoot = () => process.env.CW_REPORTS_ROOT || join(REPO, 'reports');
// CW_PROJECTS is kept as an override so any operator or script already exporting it is not
// broken by this change; the DEFAULT is what was wrong. monitor/projects.json is the
// pre-migration path and held a stale 30-area snapshot against the live 35 on 2026-09-06.
// sharedRegistryPath() resolves monitor/private/projects.json and falls back to the shipped
// example, which is the one resolution every other consumer already agrees on.
const registryPath = () => process.env.CW_PROJECTS || sharedRegistryPath();

/**
 * Read JSON, distinguishing the three states that must never collapse into each other.
 * @returns {{ok:true,value:any}|{ok:false,reason:'absent'|'unreadable'|'unparseable',detail?:string}}
 */
export function readJsonState(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    // ONLY ENOENT is "legitimately absent". A permission error is a broken reader, and reporting it
    // as absence is how a check certifies a directory it was never allowed to open.
    if (e && e.code === 'ENOENT') return { ok: false, reason: 'absent' };
    return { ok: false, reason: 'unreadable', detail: e?.code || String(e) };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, reason: 'unparseable', detail: String(e?.message || e) };
  }
}

/** Repo names in a rollup object. A rollup with no repos[] is UNKNOWN, never an empty area. */
export function reposOf(rollup) {
  if (!rollup || typeof rollup !== 'object' || !Array.isArray(rollup.repos)) return null;
  return rollup.repos.map((r) => r?.name).filter((n) => typeof n === 'string' && n);
}

/**
 * The decision, pure.
 *
 * `observed` is the population; `covered` is what the stable rollup holds. `missing` is the
 * difference and is the whole point. A repo in the stable rollup that is NOT in the observed set is
 * reported as `unexpected` rather than ignored — it means the population was computed wrong, and
 * silently widening it to fit would destroy the only signal that says so.
 */
export function assess({ observed, covered, perRepoNewest = {}, stableSliceId = null }) {
  const obs = [...new Set(observed || [])].sort();
  if (covered === null || covered === undefined) {
    return { state: 'undetermined', reason: 'the stable rollup carries no repos[] array', observed: obs, covered: null, missing: null, unexpected: null, stableSliceId, perRepoNewest };
  }
  const cov = [...new Set(covered)].sort();
  const missing = obs.filter((n) => !cov.includes(n));
  const unexpected = cov.filter((n) => !obs.includes(n));
  // An area whose observed population is empty cannot be judged covered. Zero over zero is not 100%.
  if (obs.length === 0) {
    return { state: 'undetermined', reason: 'no repo has ever been observed in this area — nothing to be complete against', observed: obs, covered: cov, missing: null, unexpected, stableSliceId, perRepoNewest };
  }
  return {
    state: missing.length === 0 ? 'complete' : 'partial',
    reason: missing.length === 0
      ? `the stable rollup holds all ${obs.length} observed repo(s)`
      : `the stable rollup holds ${cov.length} of ${obs.length} observed repo(s); ${missing.length} absent`,
    observed: obs, covered: cov, missing, unexpected, stableSliceId, perRepoNewest,
  };
}

/** Preserved slices for an area, newest last. Names carry the sweep id; content names the repos. */
export function scanSlices(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, reason: 'absent' };
    return { ok: false, reason: 'unreadable', detail: e?.code || String(e) };
  }
  const slices = [];
  const unreadable = [];
  for (const f of entries.filter((n) => /^rollup-sweep-.*\.json$/.test(n)).sort()) {
    const st = readJsonState(join(dir, f));
    if (!st.ok) { unreadable.push({ file: f, reason: st.reason }); continue; }
    slices.push({ file: f, sliceId: st.value?.sliceId ?? null, generated: st.value?.generated ?? null, repos: reposOf(st.value) || [] });
  }
  return { ok: true, slices, unreadable };
}

/** Newest slice per repo, so a partial stable rollup still tells you where each repo was last seen. */
export function newestPerRepo(slices) {
  const out = {};
  for (const s of slices) {
    for (const name of s.repos) {
      const prev = out[name];
      // Compare on `generated` when both carry one; fall back to file order, which is sweep-id
      // sorted. A slice with no timestamp never displaces one that has a comparable timestamp.
      const better = !prev
        || (s.generated && prev.generated && s.generated > prev.generated)
        || (s.generated && !prev.generated);
      if (better) out[name] = { sliceId: s.sliceId, generated: s.generated, file: s.file };
    }
  }
  return out;
}

/** Repos monitor/projects.json explicitly declares for an area. */
export function declaredFor(registry, area) {
  const list = Array.isArray(registry) ? registry : (registry?.projects || []);
  return list.filter((p) => p && p.area === area).map((p) => p.name).filter(Boolean);
}

export function coverageFor(area, { root = reportsRoot(), registry = null } = {}) {
  const dir = join(root, area);
  const stable = readJsonState(join(dir, 'rollup.json'));
  const scanned = scanSlices(dir);
  if (!stable.ok && stable.reason !== 'absent') {
    return { area, state: 'undetermined', reason: `stable rollup.json is ${stable.reason}`, observed: [], covered: null, missing: null, unexpected: null, perRepoNewest: {}, stableSliceId: null };
  }
  if (!scanned.ok) {
    return { area, state: 'undetermined', reason: `slice directory is ${scanned.reason}`, observed: [], covered: null, missing: null, unexpected: null, perRepoNewest: {}, stableSliceId: null };
  }
  const perRepoNewest = newestPerRepo(scanned.slices);
  const declared = registry ? declaredFor(registry, area) : [];
  const observed = [...new Set([...declared, ...Object.keys(perRepoNewest)])];
  const covered = stable.ok ? reposOf(stable.value) : null;
  const out = assess({ observed, covered, perRepoNewest, stableSliceId: stable.ok ? (stable.value?.sliceId ?? null) : null });
  return { area, ...out, unreadableSlices: scanned.unreadable, stableRollup: stable.ok ? 'present' : 'absent' };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const asJson = argv.includes('--json');
  const all = argv.includes('--all');
  const areas = argv.filter((a) => !a.startsWith('--'));
  const reg = readJsonState(registryPath());
  const registry = reg.ok ? reg.value : null;

  let targets = areas;
  if (all) {
    try {
      targets = readdirSync(reportsRoot(), { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(reportsRoot(), e.name, 'rollup.json')))
        .map((e) => e.name).sort();
    } catch { targets = []; }
  }
  if (targets.length === 0) {
    console.error('usage: node monitor/area-coverage.mjs <area> [--json] | --all');
    return 2;
  }

  const results = targets.map((a) => coverageFor(a, { registry }));
  if (asJson) {
    console.log(JSON.stringify({ generated: process.env.CW_NOW || new Date().toISOString(), results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.state === 'complete' ? 'OK  ' : r.state === 'partial' ? 'PART' : '????';
      console.log(`${mark}  ${r.area} — ${r.reason}`);
      // The covered list is only worth printing when something is WRONG. Printing it always buried
      // the one partial area under 100-name lists from every healthy one — a report nobody reads is
      // the same as no report, and this check exists because a detail went unnoticed.
      if (r.stableSliceId && r.state !== 'complete') {
        const cov = r.covered || [];
        const shown = cov.length > 12 ? `${cov.slice(0, 12).join(', ')} … (+${cov.length - 12})` : (cov.join(', ') || '(none)');
        console.log(`      stable rollup.json is slice ${r.stableSliceId}, holding: ${shown}`);
      }
      for (const name of r.missing || []) {
        const n = r.perRepoNewest[name];
        console.log(`      absent: ${name} — last seen in ${n ? `${n.sliceId} at ${n.generated}` : 'no preserved slice'}`);
      }
      for (const name of r.unexpected || []) console.log(`      UNEXPECTED: ${name} is in the rollup but not in the observed population`);
      for (const u of r.unreadableSlices || []) console.log(`      slice ${u.file} is ${u.reason} — excluded from the population, not treated as empty`);
    }
  }
  if (results.some((r) => r.state === 'undetermined')) return 2;
  return results.some((r) => r.state === 'partial') ? 1 : 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
