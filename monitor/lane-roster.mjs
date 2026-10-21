// monitor/lane-roster.mjs — every lane lane-trust and lane-capability account for, and every
// bundled manifest check that is not one.
//
// A lane is a category of findings some check writes. Most are SCANNER_SPECS rows, which the rollup
// carries under `scanners`. OFF_SPEC_LANES never reach `scanners`: each names the reader its
// findings reach (`readBy`), or says that none does (`unread`). They share the SCANNER_SPECS row
// shape, so the fixture probe and bin/lane-fixture.mjs treat them alike. A check that feeds a lane
// it is not the primary check of is listed by feedersOf(). A check that feeds no lane carries
// `notALane: "<reason>"` in its manifest; accountChecks() sorts every check into one of the three
// states, and a check in none is `unaccounted`. accountBundled() does it for every bundled manifest.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCANNER_SPECS } from './extractors.mjs';
import { CHECK_ALIASES } from './scanner-checks.mjs';
import { parseNpm, parseOsv } from './dep-findings.mjs';
import { baselinePath } from './scan-scope.mjs';
import { parseRuntime } from '../bin/parse-runtime.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const manifestsDir = () => resolve(process.env.CW_MANIFESTS_DIR || join(CW, 'manifests'));
const BASELINE = 'security-baseline';

/** osv.sarif as the rollup's dependency-CVE half reads it: every parseOsv row, MAL- included,
 *  because repoDepFindings counts them all. maliciousPackages reads the MAL- rows alone. null when
 *  absent. */
export function _osvCveCounts(dir, file) {
  if (!existsSync(join(dir, file))) return null;
  const r = parseOsv(dir);
  if (r.state !== 'ok') return { total: 0, ran: true, unparseable: true };
  return { total: r.rows.length, ran: true, findings: r.rows };
}

/** npm-audit.json as the rollup's dependency-CVE half reads it. null when absent. */
export function _npmAuditCounts(dir, file) {
  if (!existsSync(join(dir, file))) return null;
  const r = parseNpm(dir);
  if (r.state !== 'ok') return { total: 0, ran: true, unparseable: true };
  return { total: r.rows.length, ran: true, findings: r.rows };
}

/** authz.json as the runtime report reads it. parseRuntime skips a torn file silently, so the
 *  parse is checked here first. null when absent. */
export function _authzTestCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;
  try { JSON.parse(readFileSync(p, 'utf8')); } catch { return { total: 0, ran: true, unparseable: true }; }
  const rows = parseRuntime(dir).findings.filter((f) => f.tool === 'authz');
  return { total: rows.length, ran: true, findings: rows };
}

/** [category, primary check, extractor, meta]. meta.readBy names the reader, or meta.unread says why
 *  there is none; kind and additive stand in for LANE_KINDS, which covers `scanners` categories only. */
export const OFF_SPEC_LANES = Object.freeze([
  ['depsOsv', 'deps-osv', (d) => _osvCveCounts(d, 'osv.sarif'), Object.freeze({
    readBy: 'the rollup\'s dependency-CVE totals, beside depsNpmAudit (monitor/dep-findings.mjs parseOsv)',
    kind: 'vulnerability', additive: true,
  })],
  ['depsNpmAudit', 'npm-audit', (d) => _npmAuditCounts(d, 'npm-audit.json'), Object.freeze({
    readBy: 'the rollup\'s dependency-CVE totals, beside deps-osv (monitor/dep-findings.mjs parseNpm)',
    kind: 'vulnerability', additive: true,
    also: Object.freeze({ 'yarn-audit': 'writes the same npm-audit.json for yarn.lock trees; its gate excludes npm-audit\'s' }),
  })],
  ['authzIsolation', 'authz-test', (d) => _authzTestCounts(d, 'authz.json'), Object.freeze({
    readBy: 'the runtime report (bin/parse-runtime.mjs)',
    kind: 'vulnerability', additive: false,
  })],
]);

export const LANE_ROSTER = Object.freeze([...SCANNER_SPECS, ...OFF_SPEC_LANES]);

/** Checks other than the primary one that write this lane's artifact, each with the reason. */
export function feedersOf(row, aliases = CHECK_ALIASES) {
  const [, check, , meta] = row;
  const out = {};
  for (const [alias, target] of Object.entries(aliases)) {
    if (target === check) out[alias] = `declared alias of ${check} (monitor/scanner-checks.mjs CHECK_ALIASES)`;
  }
  Object.assign(out, (meta && meta.also) || {});
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Every check sorted into a lane, not-a-lane (with its reason) or unaccounted. A check that is
 *  both is a contradiction and is unaccounted too: one of the two declarations is wrong. */
export function accountChecks(checks, roster = LANE_ROSTER, aliases = CHECK_ALIASES) {
  const laneOf = new Map();
  for (const row of roster) {
    laneOf.set(row[1], row[0]);
    for (const c of Object.keys(feedersOf(row, aliases))) if (!laneOf.has(c)) laneOf.set(c, row[0]);
  }
  const lanes = {}; const notLanes = {}; const unaccounted = [];
  for (const c of [...checks].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const category = laneOf.get(c.id);
    const marked = Object.prototype.hasOwnProperty.call(c, 'notALane');
    const reason = typeof c.notALane === 'string' ? c.notALane.trim() : '';
    if (category && marked) unaccounted.push({ check: c.id, why: `feeds lane ${category} and is also marked notALane` });
    else if (category) lanes[c.id] = category;
    else if (reason) notLanes[c.id] = { reason };
    else if (marked) unaccounted.push({ check: c.id, why: 'notALane carries no reason' });
    else unaccounted.push({ check: c.id, why: 'no lane reads it and it is not marked notALane' });
  }
  return { declared: checks.length, lanes, notLanes, unaccounted };
}

/** The baseline manifest's checks, or null when the file is absent. Unreadable throws. */
export function readBaselineChecks(path = baselinePath()) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  if (!Array.isArray(doc?.checks)) throw new Error(`${path}: no checks array`);
  return doc.checks;
}

/** Every bundled manifest's checks by manifest name, names sorted: the baseline from baselinePath()
 *  (CW_BASELINE_MANIFEST) and every other `*.json` in manifestsDir() (CW_MANIFESTS_DIR), the set
 *  bin/commitwork.mjs and the MCP server resolve by name. A file with no `checks` key is data and
 *  declares none. null when the baseline or the directory is absent, since a partial account would
 *  read as the whole; unreadable throws. */
export function readBundledChecks({ dir = manifestsDir(), baseline = baselinePath() } = {}) {
  const base = readBaselineChecks(baseline);
  if (!base) return null;
  let names;
  try { names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== `${BASELINE}.json`).sort(); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  const out = { [BASELINE]: base };
  for (const f of names) {
    const path = join(dir, f);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (!doc || typeof doc !== 'object' || !Object.prototype.hasOwnProperty.call(doc, 'checks')) continue;
    if (!Array.isArray(doc.checks)) throw new Error(`${path}: checks is not an array`);
    out[f.slice(0, -'.json'.length)] = doc.checks;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** accountChecks per manifest: lanes and notLanes keyed by manifest, unaccounted naming its
 *  manifest, and `manifests` giving each one's counts. An id two manifests declare counts in each. */
export function accountBundled(byManifest, roster = LANE_ROSTER, aliases = CHECK_ALIASES) {
  const manifests = {}; const lanes = {}; const notLanes = {}; const unaccounted = [];
  let declared = 0;
  for (const name of Object.keys(byManifest).sort()) {
    const a = accountChecks(byManifest[name], roster, aliases);
    declared += a.declared;
    manifests[name] = { declared: a.declared, inLanes: Object.keys(a.lanes).length,
      notLanes: Object.keys(a.notLanes).length, unaccounted: a.unaccounted.length };
    lanes[name] = a.lanes;
    notLanes[name] = a.notLanes;
    for (const u of a.unaccounted) unaccounted.push({ manifest: name, ...u });
  }
  return { declared, manifests, lanes, notLanes, unaccounted };
}
