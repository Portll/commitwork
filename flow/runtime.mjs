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
 * `-r` and not `--import`: an `--import` hook that imports the builtin misses
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
  return { state: 'usable', rows, reason: null, malformed, node: installed.node, pid: installed.pid, network: networkWitness(rows) };
}

/**
 * -> { state: 'usable'|'unusable', reason, pids }
 *
 * The network has its own non-vacuity proof, per PROCESS: one trace file collects every process a
 * run spawns (`node --test` forks one per file), and a process whose probe was not observed may be
 * one whose patches never took. Its network rows are refused, not merged into a clean-looking set.
 */
export function networkWitness(rows) {
  const installed = rows.filter((r) => r.t === 'installed');
  const pids = installed.filter((r) => r.netWitness === true).map((r) => r.pid);
  if (pids.length === 0) {
    const why = installed.map((r) => r.netReason).find(Boolean) || 'no installed row carries a network self-witness';
    return { state: 'unusable', reason: `hook could not witness its own network probe — ${why}`, pids };
  }
  return { state: 'usable', reason: null, pids };
}

/**
 * -> { state, observations, coverage, reason, unattributed, network }
 *
 * `coverage` is the set of repo modules this run actually entered, derived from module loads. An
 * observation whose actor is null is kept but produces no edge — attribution failed, which is
 * unknown, not absent.
 *
 * Kinds: reads | writes | spawns from fs and child_process; connects | listens from the network,
 * with `to` in C1's endpoint key form (`<scheme>://<host>[:<port>]`, `listen:<port>`). An actual
 * open carries `access` (read | write | append | readwrite, accumulated); a stat does not.
 * `network.state` says whether absence of a network observation means anything.
 */
export function summarise(traceRead) {
  if (traceRead.state !== 'usable') {
    return { v: SCHEMA_VERSION, state: traceRead.state, reason: traceRead.reason, observations: [], coverage: [], unattributed: 0,
      network: { state: 'unusable', reason: traceRead.reason, observed: 0, refused: 0 } };
  }
  const coverage = new Set();
  const observations = [];
  let unattributed = 0;
  let refused = 0;
  const network = traceRead.network || networkWitness(traceRead.rows);
  const netPids = new Set(network.pids);

  for (const r of traceRead.rows) {
    if (r.t === 'installed' || r.probe) continue;
    // A module load: the ESM/CJS loader reads the source through the public fs, and no repo frame is
    // on the stack. That is coverage, not a dataflow edge.
    const isModuleLoad = r.actor === null && r.t === 'read' && /\.[cm]?js$/.test(r.path || '');
    if (isModuleLoad) { coverage.add(r.path); continue; }
    const isNet = r.t === 'connect' || r.t === 'listen';
    // A network row from a process that never proved it can see the network is refused outright:
    // keeping it would be harmless, but it would let a half-blind run look like a sighted one.
    if (isNet && !netPids.has(r.pid)) { refused += 1; continue; }
    if (!r.actor || (isNet && !r.key)) { unattributed += 1; continue; }
    coverage.add(r.actor);
    observations.push({ from: r.actor, to: isNet ? r.key : r.path, kind: KIND[r.t] || 'reads', via: r.via,
      ...(r.access ? { access: r.access } : {}), ...(r.ephemeral ? { ephemeral: true } : {}) });
  }

  // One observation per from|to|kind. `access` accumulates — a module that reads a file and later
  // rewrites it opened it both ways, and that union is what gives a `touches` edge `both`.
  const by = new Map();
  for (const o of observations) {
    const k = JSON.stringify([o.from, o.to, o.kind]);
    const prev = by.get(k);
    const { access, ...rest } = o;
    if (!prev) { by.set(k, { ...rest, ...(access ? { access: [access] } : {}) }); continue; }
    if (prev.ephemeral && !rest.ephemeral) delete prev.ephemeral;   // named once is named: a literal could match
    if (access && !(prev.access || []).includes(access)) prev.access = [...(prev.access || []), access].sort();
  }
  const deduped = [...by.values()];
  const netObserved = deduped.filter((o) => o.kind === 'connects' || o.kind === 'listens').length;
  return { v: SCHEMA_VERSION, state: 'usable', reason: null, observations: deduped, coverage: [...coverage].sort(), unattributed,
    network: { state: network.state, reason: network.reason, observed: netObserved, refused } };
}

const KIND = { read: 'reads', write: 'writes', spawn: 'spawns', connect: 'connects', listen: 'listens' };

/** Convenience: run, read, summarise. Cleans the trace unless `keep` is set. */
export function observe(argv, opts = {}) {
  const run = record(argv, opts);
  const summary = summarise(readTrace(run.trace));
  if (!opts.keep) {
    try { rmSync(run.trace, { force: true }); rmSync(`${run.trace}.probe`, { force: true }); } catch { /* best effort */ }
  }
  return { ...summary, status: run.status, stderr: run.stderr, tracePath: run.trace };
}
