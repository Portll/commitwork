// bin/lib/scan-config.mjs — which lanes the operator has enabled, and which binaries they have
// approved this machine to execute. The runner reads it; the panel writes it; every write is
// hash-chained into the verdict journal so the history is a record rather than a claim.
//
// Two separate questions, deliberately not merged: a lane can be ENABLED and still blocked because
// its tool is unapproved, and the operator must be able to see which of the two is holding it.
// Approval is keyed on the TOOL, never on the lane — 76 lanes draw on 46 tools, and approving per
// lane would ask the same question about `semgrep` eleven times.
//
// The gate is OFF until the store exists. An absent file is a box nobody has configured, which is
// not the same claim as a box where every lane was refused: turning absence into refusal would
// silently stop every existing runner on upgrade. Once the file exists the gate applies, and a
// blocked lane is REPORTED with its reason, never quietly dropped from the run.
//
// Fail closed everywhere else: only ENOENT is absence. An unreadable or unparseable store throws,
// because a scan that cannot read its own configuration must not decide it has none.
//
// Env (read at call time): CW_SCAN_CONFIG, CW_VERDICT_DIR, CW_NOW.

import { nowISO } from '../../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storeDir } from './store-paths.mjs';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { journal } from './verdict-journal-core.mjs';

export const GATE = 'scan-config';
export const configPath = () => process.env.CW_SCAN_CONFIG || join(storeDir(), 'scan-config.json');

export const ABSENT = Object.freeze({ absent: true, version: 1, checks: {}, tools: {} });

/** ENOENT is "nobody has configured this box"; anything else THROWS. */
export function readScanConfig({ path = configPath() } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return ABSENT; throw e; }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Error(`scan-config is unreadable, which is not the same as absent: ${e.message}`); }
  if (!doc || typeof doc !== 'object') throw new Error('scan-config is not an object');
  if (doc.version !== 1) throw new Error(`scan-config version ${doc.version} is not one this build understands`);
  return {
    absent: false,
    version: 1,
    at: doc.at ?? null,
    checks: doc.checks && typeof doc.checks === 'object' ? doc.checks : {},
    tools: doc.tools && typeof doc.tools === 'object' ? doc.tools : {},
  };
}

/** A lane is enabled unless the store says otherwise — a lane added after the last write is new, not refused. */
export function checkEnabled(cfg, id) {
  return cfg.checks?.[id]?.enabled !== false;
}

/** A tool is approved only by an explicit true. Absent means unasked, which is not consent. */
export function toolApproved(cfg, tool) {
  return cfg.tools?.[tool]?.approved === true;
}

export function toolsOf(check) {
  return [...new Set(check?.requires?.tools || [])];
}

/** Every distinct tool across a check set, in first-declaration order. */
export function toolRoster(checks) {
  const seen = [];
  for (const c of checks) for (const t of toolsOf(c)) if (!seen.includes(t)) seen.push(t);
  return seen;
}

/**
 * Split a selected check list into what may run and what may not, with the reason on every row.
 * `blocked` is the deliverable, not a by-product: a lane that does not run is a coverage cost, and
 * a cost the caller cannot display has not been paid.
 */
export function gateChecks(checks, cfg) {
  if (cfg.absent) return { gated: false, runnable: [...checks], blocked: [] };
  const runnable = [], blocked = [];
  for (const c of checks) {
    if (!checkEnabled(cfg, c.id)) { blocked.push({ id: c.id, reason: 'disabled', tools: [] }); continue; }
    const missing = toolsOf(c).filter((t) => !toolApproved(cfg, t));
    if (missing.length) { blocked.push({ id: c.id, reason: 'unapproved-tool', tools: missing }); continue; }
    runnable.push(c);
  }
  return { gated: true, runnable, blocked };
}

function normalise(next) {
  const checks = {};
  for (const [id, v] of Object.entries(next.checks || {})) checks[id] = { enabled: v?.enabled !== false };
  const tools = {};
  for (const [t, v] of Object.entries(next.tools || {})) {
    tools[t] = { approved: v?.approved === true, at: v?.at ?? null, actor: v?.actor ?? null, path: v?.path ?? null };
  }
  return { version: 1, at: nowISO(), checks, tools };
}

/**
 * Write the store and journal the change. `actor` is caller-supplied and may be null — an
 * unattributed approval is honest; an invented one is not.
 * The journal entry carries the DELTA, because a reader asking "who turned this on" is asking
 * about a transition and a snapshot cannot answer it.
 */
export function writeScanConfig(next, { path = configPath(), dir, actor = null, reason = null, session = null } = {}) {
  const before = readScanConfig({ path });
  const doc = normalise(next);
  const delta = diffConfig(before, doc);
  writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
  const receipt = journal(GATE, { actor, reason, ...delta }, { dir, session });
  return { path, at: doc.at, ...delta, receipt };
}

export function diffConfig(before, after) {
  const checksChanged = [], toolsChanged = [];
  const ids = new Set([...Object.keys(before.checks || {}), ...Object.keys(after.checks || {})]);
  for (const id of [...ids].sort()) {
    const was = checkEnabled(before, id), now = checkEnabled(after, id);
    if (was !== now) checksChanged.push({ id, from: was, to: now });
  }
  const tools = new Set([...Object.keys(before.tools || {}), ...Object.keys(after.tools || {})]);
  for (const t of [...tools].sort()) {
    const was = toolApproved(before, t), now = toolApproved(after, t);
    if (was !== now) toolsChanged.push({ tool: t, from: was, to: now });
  }
  return { checksChanged, toolsChanged, wasAbsent: before.absent === true };
}
