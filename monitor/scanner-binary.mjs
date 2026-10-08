// monitor/scanner-binary.mjs — the scanner-binary hash lens: commitwork trusts scanner OUTPUT
// with an elaborate truthfulness discipline, and until now trusted the BINARY producing it on no
// evidence at all. A swapped semgrep decides what every semgrep lane publishes.
//
// Each roster tool (monitor/scanner-binaries.json) is pinned three ways: resolved path, sha256 of
// the resolved file, and its version string. The accepted baseline lives OFF the repo tree
// (.claude/store/, the operator's sidecar) and only `--accept` moves it — a human act, never this
// lens's (declaration split from authority). Deviations classify:
//   swapped   hash differs, version string IDENTICAL — the supply-chain signature. The alarm.
//   changed   hash and version both differ — an ordinary upgrade, still a diff to re-accept.
//   removed   pinned, now gone from PATH.
//   moved     different path, identical bytes — reported on the row, not a finding.
//   unbaselined  present, never accepted — its own state (grey), not ok and not a finding.
//   absent    not on PATH and never pinned — its own state.
// A version that cannot be read is unknown('unstated') on that axis; classification still runs on
// the hash. An unreadable BASELINE fails closed (only ENOENT means "no baseline yet").
//
// Env (read at call time): CW_SCANNER_ROSTER, CW_SCANNER_BASELINE, CW_NOW.
//
//   node monitor/scanner-binary.mjs [--json]    report vs baseline; exit 0 ok, 1 findings,
//                                               2 grey only (unbaselined/unknown)
//   node monitor/scanner-binary.mjs --accept    pin the currently observed tools as the baseline

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rosterPath = () => process.env.CW_SCANNER_ROSTER || join(REPO, 'monitor', 'scanner-binaries.json');
const ROSTER_SCHEMA = join(REPO, 'schema', 'scanner-binaries.schema.json');
const baselinePath = () => process.env.CW_SCANNER_BASELINE || join(REPO, '.claude', 'store', 'scanner-binaries.json');

/** Read + schema-validate the roster. Throws on an invalid file — a malformed roster must refuse
 *  to load, never silently pin a different tool set than the one declared. */
export function readRoster() {
  const r = JSON.parse(readFileSync(rosterPath(), 'utf8'));
  const { errors } = validateAgainstSchema(r, { path: ROSTER_SCHEMA });
  if (errors.length) throw new Error(`scanner roster invalid (${rosterPath()}):\n  - ${errors.join('\n  - ')}`);
  return r;
}

/** ENOENT is "no baseline yet"; anything else THROWS — an unreadable pin list is never an empty one. */
export function readBaseline() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const b = JSON.parse(raw);   // a parse error propagates: fail closed
  if (!b || typeof b.tools !== 'object') throw new Error('baseline has no tools{}');
  return b;
}

export function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path).on('error', rej).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex')));
  });
}

const whichTool = (name, exec) => {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = exec(cmd, [name], { encoding: 'utf8', timeout: 5000 });
    const p = out.split('\n').map((s) => s.trim()).filter(Boolean)[0];
    return p || null;
  } catch { return null; }
};

const readVersion = (path, versionArgs, exec) => {
  try {
    const out = exec(path, versionArgs, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const line = String(out).split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    return line ? line.slice(0, 200) : null;
  } catch { return null; }
};

/** Observe every roster tool: {name, path, sha256, version}. Absent tools carry path:null. */
export async function observeTools(roster, { exec = execFileSync, hashFile = sha256File } = {}) {
  const out = [];
  for (const t of roster.tools) {
    const path = whichTool(t.name, exec);
    if (!path) { out.push({ name: t.name, path: null }); continue; }
    let sha;
    try { sha = await hashFile(path); }
    catch (e) { out.push({ name: t.name, path, sha256: null, ...unknown('tool-failed', `hash: ${e.code || e.message}`) }); continue; }
    const version = readVersion(path, t.versionArgs || ['--version'], exec);
    out.push({ name: t.name, path, sha256: sha, version });
  }
  return out;
}

/** Pure classification of observed vs baseline. Deterministic; rows sorted by name. */
export function compareTools(observed, baseline) {
  const base = baseline?.tools || null;
  const rows = [];
  for (const o of [...observed].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const b = base ? base[o.name] : undefined;
    if (!o.path) {
      rows.push(b
        ? { name: o.name, state: 'removed', baseline: b }
        : { name: o.name, state: 'absent' });
      continue;
    }
    if (o.sha256 === null) { rows.push({ name: o.name, state: 'unhashable', path: o.path, unknownReason: o.unknownReason, unknownDetail: o.unknownDetail }); continue; }
    const row = { name: o.name, path: o.path, sha256: o.sha256, version: o.version };
    if (o.version === null) Object.assign(row, { versionAxis: unknown('unstated', 'version output unreadable') });
    if (!b) { rows.push({ ...row, state: 'unbaselined' }); continue; }
    const moved = b.path !== o.path;
    if (b.sha256 === o.sha256) { rows.push({ ...row, state: 'ok', ...(moved ? { moved: true, from: b.path } : {}) }); continue; }
    const bothVersionsReadable = b.version != null && o.version != null;
    const state = bothVersionsReadable && b.version === o.version ? 'swapped' : 'changed';
    rows.push({ ...row, state, baseline: { path: b.path, sha256: b.sha256, version: b.version ?? null }, ...(moved ? { moved: true } : {}), versionComparable: bothVersionsReadable });
  }
  const findings = rows.filter((r) => ['swapped', 'changed', 'removed'].includes(r.state));
  const grey = rows.filter((r) => ['unbaselined', 'unhashable'].includes(r.state));
  const state = findings.length ? 'findings' : !baseline ? 'no-baseline' : grey.length ? 'unpinned' : 'ok';
  return { rows, findings, state };
}

export async function runLens({ exec, hashFile } = {}) {
  const roster = readRoster();
  const baseline = readBaseline();
  const observed = await observeTools(roster, { exec, hashFile });
  return { at: nowISO(), baselineAt: baseline?.at ?? null, ...compareTools(observed, baseline) };
}

/** The human act: pin what is observed NOW. Writes atomically; returns what was pinned. */
export async function acceptBaseline({ exec, hashFile } = {}) {
  const roster = readRoster();
  const observed = await observeTools(roster, { exec, hashFile });
  const tools = {};
  for (const o of observed) {
    if (o.path && o.sha256) tools[o.name] = { path: o.path, sha256: o.sha256, version: o.version ?? null };
  }
  const doc = { at: nowISO(), tools };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), pinned: Object.keys(tools).sort(), skipped: observed.filter((o) => !o.path || !o.sha256).map((o) => o.name).sort() };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/scanner-binary.mjs [--json]   report observed scanner binaries vs the accepted baseline\n'
      + 'node monitor/scanner-binary.mjs --accept   pin the currently observed tools (the human act)\n'
      + 'exit 0 ok, 1 findings (swapped/changed/removed), 2 grey only (unbaselined/unhashable/no baseline)');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = await acceptBaseline();
    console.log(`pinned ${a.pinned.length} tool(s) → ${a.path}`);
    if (a.skipped.length) console.log(`not pinned (absent/unhashable): ${a.skipped.join(', ')}`);
    process.exit(0);
  }
  const r = await runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`scanner-binary: ${r.state}  (baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    for (const row of r.rows) {
      const v = row.version ? ` — ${row.version}` : row.versionAxis ? ' — version unreadable' : '';
      const extra = row.state === 'swapped' ? '  ⚠ same version string, different bytes'
        : row.state === 'changed' ? `  (was ${row.baseline?.version ?? 'unreadable'})`
        : row.moved ? `  (moved from ${row.from ?? row.baseline?.path})` : '';
      console.log(`  ${row.state.toUpperCase().padEnd(12)} ${row.name}${row.path ? ` @ ${row.path}` : ''}${v}${extra}`);
    }
  }
  process.exit(r.findings.length ? 1 : r.state === 'ok' ? 0 : 2);
}
