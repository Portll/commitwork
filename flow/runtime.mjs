// C2 — the runtime pass. The SECOND WITNESS.
//
// It must be able to fail independently, so it imports NOTHING from flow/ — not the lexer, not the
// graph helpers, not the store. flow/test/independence.test.mjs asserts that mechanically, because
// "shares no extraction code" decays into "shares a little" one convenience import at a time.
//
// It observes EFFECTS through patched builtins (flow/trace-hook.cjs) and attributes them by STACK,
// never by reading source text. C1 can be completely wrong about this repo and C2 is unaffected.
//
// The coverage set is the point of the design as much as the rows are: an edge C1 claims in a
// module this run never entered is NOT a contradiction, and scoring it as one turns "we did not
// look" into a finding that scales with how much code you did not exercise.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 1;

export function hookPath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'trace-hook.cjs');
}

/**
 * Run `argv` under the trace hook. -> { status, trace, stdout, stderr }
 *
 * `-r` and not `--import`: measured 2026-09-02, an `--import` hook that imports the builtin misses
 * every `import { readFileSync } from 'node:fs'` in the traced program. See flow/trace-hook.cjs.
 */
export function record(argv, { root, trace, env = process.env, cwd, timeout = 120000 } = {}) {
  const repo = root || resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = trace || join(repo, 'reports', 'harness', `trace-${process.pid}-${Date.now()}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(process.execPath, ['-r', hookPath(), ...argv], {
    cwd: cwd || repo,
    encoding: 'utf8',
    timeout,
    env: { ...env, CW_FLOW_TRACE: out, CW_FLOW_ROOT: repo },
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, trace: out };
}

/**
 * -> { state, rows, reason }
 *
 * `state` is the grey carrier and it has three values, not two:
 *   'usable'   the hook installed AND proved it intercepts (selfWitness)
 *   'unusable' the trace exists but carries no installed row, or the hook could not witness itself
 *   'absent'   no trace file
 *
 * An 'unusable' trace must never be read as an edgeless run. That is the inert-instrument failure:
 * an empty observation agrees with an empty expectation, and the reconciliation reports concord.
 */
export function readTrace(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', rows: [], reason: 'no trace file' };
    return { state: 'unusable', rows: [], reason: `trace unreadable: ${e.code || e.message}` };
  }
  const rows = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { malformed += 1; }
  }
  const installed = rows.find((r) => r.t === 'installed');
  if (!installed) return { state: 'unusable', rows, reason: 'no installed row — the preload never ran' };
  if (!installed.selfWitness) return { state: 'unusable', rows, reason: 'hook could not witness its own read — patch is inert' };
  return { state: 'usable', rows, reason: null, malformed, node: installed.node, pid: installed.pid };
}

/**
 * -> { state, observations, coverage, reason }
 *
 * `coverage` is the set of repo modules this run actually entered, derived from module loads. An
 * observation whose actor is null is kept but produces no edge — attribution failed, which is
 * unknown, not absent.
 */
export function summarise(traceRead) {
  if (traceRead.state !== 'usable') {
    return { v: SCHEMA_VERSION, state: traceRead.state, reason: traceRead.reason, observations: [], coverage: [], unattributed: 0 };
  }
  const coverage = new Set();
  const observations = [];
  let unattributed = 0;

  for (const r of traceRead.rows) {
    if (r.t === 'installed') continue;
    // A module load: the ESM/CJS loader reads the source through the public fs, and no repo frame is
    // on the stack. That is coverage, not a dataflow edge.
    const isModuleLoad = r.actor === null && r.t === 'read' && /\.[cm]?js$/.test(r.path || '');
    if (isModuleLoad) { coverage.add(r.path); continue; }
    if (!r.actor) { unattributed += 1; continue; }
    coverage.add(r.actor);
    observations.push({ from: r.actor, to: r.path, kind: r.t === 'spawn' ? 'spawns' : (r.t === 'write' ? 'writes' : 'reads'), via: r.via });
  }

  const seen = new Set();
  const deduped = observations.filter((o) => {
    const k = JSON.stringify([o.from, o.to, o.kind]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { v: SCHEMA_VERSION, state: 'usable', reason: null, observations: deduped, coverage: [...coverage].sort(), unattributed };
}

/** Convenience: run, read, summarise. Cleans the trace unless `keep` is set. */
export function observe(argv, opts = {}) {
  const run = record(argv, opts);
  const summary = summarise(readTrace(run.trace));
  if (!opts.keep) {
    try { rmSync(run.trace, { force: true }); rmSync(`${run.trace}.probe`, { force: true }); } catch { /* best effort */ }
  }
  return { ...summary, status: run.status, stderr: run.stderr, tracePath: run.trace };
}
