#!/usr/bin/env node
// bin/semgrep-retry.mjs — re-run Semgrep on the files the main scan timed out on.
//
// Semgrep's per-rule timeout is 5 s per file, and after three rules time out on one file it skips
// the file for every remaining rule (--timeout-threshold). Both arrive as warning-level Timeout
// notices while the run exits 0; monitor/sarif-read.mjs partialAnalysis reads them as files read
// only in part. A taint fixpoint timeout drops a function's flows with no SARIF notice at all; Semgrep
// names it only in its JSON time.fixpoint_timeouts (1.180.0, exit 0, JSON errors empty). Given the
// main scan's JSON, this step first copies those entries into the SARIF as an invocation carrying
// properties.commitworkFixpoint, so the reader counts them as files read in part too.
//
// It then scans the files whose reasons include `timeout` or `fixpoint-timeout`, and only those,
// again with a long per-rule timeout and no skip threshold, and merges what it finds into the lane
// SARIF. A retry of a fixpoint-timeout file runs at one job: measured on 15 live-composer files,
// the default job count lost 28-29 fixpoint timeouts and a single job lost 3-4. The per-rule timeout
// does not reach the fixpoint: Semgrep caps each function's taint fixpoint at a compiled 0.2 s
// (Limits_semgrep.taint_FIXPOINT_TIMEOUT; no rule option or flag sets it in 1.180.0), so a function
// that exceeds it alone, such as a 6,600-line options() builder, times out at any job count and stays
// read in part.
//
// The original evidence is never erased. The main invocation keeps its notices; the retry is
// appended as a further invocation carrying properties.commitworkRetry {files, timeoutSec, jobs,
// fixpointMeasured}. The reader drops a file's timeout only when the retry targeted it and did not
// time out on it again, and its fixpoint timeout only when the retry's own JSON was read as well.
// A retry that fails, is killed by its budget, or is switched off leaves the SARIF as detection left it.
//
// The files go to Semgrep in batches, in the order the reader names them, and each batch that
// completes is merged before the next starts. One run over a capped list left every file past the
// cap read in part on every scan: measured 2026-11-27 on this repository, 50 of 175 timed-out files
// were retried and recovered in about two minutes and the same 125 were never reached. The budget is
// shared by the batches, so a kill costs the batch in flight and the ones behind it, not the merged ones.
//
//   node bin/semgrep-retry.mjs <lane-sarif> [--json <semgrep.json>] [--bin semgrep] [--log <file>] -- <config args…>
//
// Beside the SARIF it writes <name>-retry.sarif and <name>-retry.scan.json (the first batch as Semgrep
// wrote it; batch N of a later one is <name>-retry.N.sarif and <name>-retry.N.scan.json) and
// <name>-retry.json (the receipt: state, files, batches, what was recovered, what still times out,
// what the fixpoint record holds).
//
// env, read at call time: CW_SEMGREP_RETRY (0 or off switches the retry off and the main scan's
//   timeouts stand as reduced coverage), CW_SEMGREP_RETRY_TIMEOUT (seconds Semgrep may spend per
//   rule on one file in the retry, default 60), CW_SEMGREP_RETRY_MAX_FILES (most files one retry
//   scans across all its batches, default 500; the rest are named in the receipt as not retried),
//   CW_SEMGREP_RETRY_BATCH_FILES (files per Semgrep run, default 50; a run that completes is merged
//   before the next starts), CW_SEMGREP_RETRY_BUDGET_SEC (wall-clock seconds for all the batches
//   together, default 600; a batch that passes it is killed, its files and every later batch are named
//   as not retried, and the batches already merged stand), CW_SEMGREP_RETRY_JOBS (Semgrep -j for the retry; unset keeps Semgrep's default
//   unless a fixpoint-timeout file is retried, which forces 1), CW_NOW (pins the receipt timestamp)
//
// Any other non-zero exit is a defect in this script, and the lane fails loudly on it.
// exit: 0 every handled state (the receipt carries the retry's outcome; the lane's exit sidecar
//       was written before this step) · 2 usage
import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { readSarif, RETRIED_REASONS } from '../monitor/sarif-read.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { nowISO } from '../lib/clock.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const DEFAULTS = Object.freeze({ timeoutSec: 60, maxFiles: 500, batchFiles: 50, budgetSec: 600, jobs: null });

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export function retryControls(env = process.env) {
  const jobs = num(env.CW_SEMGREP_RETRY_JOBS, null);
  return {
    enabled: !['0', 'off', 'false', 'no'].includes(String(env.CW_SEMGREP_RETRY ?? '').toLowerCase()),
    // Semgrep validates --timeout as an integer whatever its help text says (measured 1.180.0)
    timeoutSec: Math.max(1, Math.floor(num(env.CW_SEMGREP_RETRY_TIMEOUT, DEFAULTS.timeoutSec))),
    maxFiles: Math.max(1, Math.floor(num(env.CW_SEMGREP_RETRY_MAX_FILES, DEFAULTS.maxFiles))),
    batchFiles: Math.max(1, Math.floor(num(env.CW_SEMGREP_RETRY_BATCH_FILES, DEFAULTS.batchFiles))),
    budgetSec: num(env.CW_SEMGREP_RETRY_BUDGET_SEC, DEFAULTS.budgetSec),
    jobs: jobs == null ? DEFAULTS.jobs : Math.max(1, Math.floor(jobs)),
  };
}

const FIXPOINT_AT = /^Fixpoint timeout while performing taint analysis at (.+?):(\d+):(\d+)/;

/** Semgrep's JSON time.fixpoint_timeouts, placed: {measured, json, count, unattributed, entries}
 *  sorted by uri then line, or {measured:false, json, reason}. Only ENOENT reads as not written. */
export function readFixpoint(path) {
  const json = basename(path);
  const blind = (reason) => ({ measured: false, json, reason });
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    return blind(e.code === 'ENOENT' ? `${json} was not written` : `${json} could not be read — ${e.code || e.message}`);
  }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return blind(`${json} is not valid JSON — ${e.message}`); }
  const list = doc && doc.time && doc.time.fixpoint_timeouts;
  if (!Array.isArray(list)) return blind(`${json} carries no time.fixpoint_timeouts`);
  const entries = [];
  for (const e of list) {
    const message = typeof (e && e.message) === 'string' ? e.message : '';
    const at = FIXPOINT_AT.exec(message);
    const loc = (e && e.location) || {};
    const uri = (typeof loc.path === 'string' && loc.path) || (at && at[1]) || null;
    const line = Number((loc.start && loc.start.line) ?? (at && at[2]));
    if (!uri || !Number.isInteger(line) || line < 1) continue;
    const col = Number((loc.start && loc.start.col) ?? (at && at[3]));
    entries.push({ uri, line, col: Number.isInteger(col) && col > 0 ? col : null, message: message || `Fixpoint timeout while performing taint analysis at ${uri}:${line}` });
  }
  entries.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : a.line - b.line || (a.col ?? 0) - (b.col ?? 0)));
  return { measured: true, json, count: list.length, unattributed: list.length - entries.length, entries };
}

const fixpointNotice = (e) => ({
  descriptor: { id: 'Fixpoint timeout' }, level: 'warning', message: { text: e.message },
  locations: [{ physicalLocation: { artifactLocation: { uri: e.uri }, region: { startLine: e.line, ...(e.col ? { startColumn: e.col } : {}) } } }],
});
const withoutEntries = ({ entries, ...rest }) => rest;

const stem = (sarifPath) => `${basename(sarifPath).replace(/\.sarif$/, '')}-retry`;
const sidecar = (sarifPath, suffix) => join(dirname(sarifPath), `${stem(sarifPath)}${suffix}`);
const batchOutputs = (sarifPath, n) => {
  const tag = n === 1 ? '' : `.${n}`;
  return { sarif: sidecar(sarifPath, `${tag}.sarif`), json: sidecar(sarifPath, `${tag}.scan.json`) };
};
const BATCH_OUTPUT = /^(\.\d+)?\.(sarif|scan\.json)$/;
const staleOutputs = (sarifPath) => readdirSync(dirname(sarifPath))
  .filter((name) => name.startsWith(stem(sarifPath)) && BATCH_OUTPUT.test(name.slice(stem(sarifPath).length)))
  .map((name) => join(dirname(sarifPath), name));

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Why one Semgrep run produced nothing to merge, or null. `ends` marks a cause the next batch shares. */
function spawnFault(r, stderr, bin, budgetSec) {
  if (r.error) {
    return r.error.code === 'ETIMEDOUT'
      ? { what: `the retry exceeded its ${budgetSec}s budget and was killed`, unchanged: 'the SARIF is unchanged', ends: true }
      : { what: `${bin} could not be run — ${r.error.code || r.error.message}`, ends: true };
  }
  if (r.signal) {
    const budget = r.signal === 'SIGTERM';
    return { what: `${bin} was killed by ${r.signal}${budget ? ` (the ${budgetSec}s budget)` : ''}`, unchanged: 'the SARIF is unchanged', ends: budget };
  }
  if (r.status > 1) return { what: `${bin} exited ${r.status}`, unchanged: 'the SARIF is unchanged', detail: stderr.trim().split('\n').pop() || 'no stderr' };
  return null;
}
const faultText = (f, { whole }) => `${f.what}${whole && f.unchanged ? `; ${f.unchanged}` : ''}${f.detail ? ` — ${f.detail}` : ''}`;

const sumFixpoint = (list) => {
  if (list.length < 2) return list[0] || null;
  const blind = list.find((f) => !f.measured);
  if (blind) return { ...blind, json: list[0].json };
  return { measured: true, json: list[0].json, count: list.reduce((n, f) => n + f.count, 0), unattributed: list.reduce((n, f) => n + f.unattributed, 0) };
};

/** The dedupe identity of one result: Semgrep's own match id, else rule + place. */
export function resultKey(res) {
  const fp = res && res.fingerprints && res.fingerprints['matchBasedId/v1'];
  if (fp) return `fp:${fp}`;
  const loc = (((res && res.locations) || [])[0] || {}).physicalLocation || {};
  const reg = loc.region || {};
  return `place:${res && res.ruleId}|${loc.artifactLocation && loc.artifactLocation.uri}|${reg.startLine}|${reg.startColumn}|${reg.endLine}|${reg.endColumn}`;
}

/** Merge a retry run into the main SARIF: new results appended and marked, rules unioned, the
 *  retry invocation appended with its targeting recorded. `retryRuns` is readSarif's `runs` for the
 *  retry, so it is only ever an ok read. Pure on its inputs; returns {doc, added}. */
export function mergeRetry(main, retryRuns, { files, timeoutSec, bin, at, exit, jobs = null, fixpoint = null }) {
  const run = main.runs[0];
  const rrun = retryRuns[0];
  if (!Array.isArray(run.results)) run.results = [];
  const seen = new Set(run.results.map(resultKey));
  const added = [];
  for (const res of rrun.results) {
    const k = resultKey(res);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push({ ...res, properties: { ...(res.properties || {}), commitworkRecoveredOnRetry: true } });
  }
  run.results.push(...added);
  const driver = run.tool && run.tool.driver;
  const rdriver = rrun.tool && rrun.tool.driver;
  if (driver && rdriver && Array.isArray(rdriver.rules)) {
    if (!Array.isArray(driver.rules)) driver.rules = [];
    const ids = new Set(driver.rules.map((r) => r && r.id));
    for (const r of rdriver.rules) if (r && r.id && !ids.has(r.id)) { driver.rules.push(r); ids.add(r.id); }
  }
  const rinv = ((rrun.invocations || [])[0]) || { executionSuccessful: exit <= 1 };
  if (!Array.isArray(run.invocations)) run.invocations = [];
  const spec = { files, timeoutSec, timeoutThreshold: 0, bin, at, exit, ...(jobs != null ? { jobs } : {}) };
  const notes = [...(rinv.toolExecutionNotifications || [])];
  if (fixpoint) {
    spec.fixpointMeasured = !!fixpoint.measured && fixpoint.unattributed === 0;
    if (fixpoint.measured) notes.push(...fixpoint.entries.map(fixpointNotice));
  }
  run.invocations.push({ ...rinv, toolExecutionNotifications: notes, properties: { ...(rinv.properties || {}), commitworkRetry: spec } });
  return { doc: main, added: added.length };
}

// A path becomes an argv entry, so one that reads as a flag or leaves the scan root is not retried.
const retryable = (cwd, u) => {
  if (u.startsWith('-') || isAbsolute(u)) return false;
  const rel = relative(cwd, resolve(cwd, u));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && existsSync(join(cwd, u));
};

/**
 * Run the retry for one SARIF. Returns the receipt it also writes. `spawn` is the seam the tests
 * use to stand in for Semgrep; the default is the real binary on PATH.
 */
export function retrySemgrep({ sarifPath, jsonPath = null, bin = 'semgrep', configArgs = [], cwd = process.cwd(), env = process.env, logPath = null, spawn = spawnSync, now = Date.now }) {
  const sarif = resolve(sarifPath);
  const receiptPath = sidecar(sarif, '.json');
  const log = logPath ? resolve(logPath) : sidecar(sarif, '.log');
  const ctl = retryControls(env);
  const at = nowISO(env);
  const base = { tool: 'semgrep-retry', sarif: basename(sarif), bin, timeoutSec: ctl.timeoutSec, timeoutThreshold: 0, maxFiles: ctl.maxFiles, batchFiles: ctl.batchFiles, budgetSec: ctl.budgetSec, at };
  const fixpoint = detectFixpoint(sarif, jsonPath);
  const done = (state, extra = {}) => {
    const receipt = { ...base, state, fixpoint, ...extra };
    writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  };

  if (!ctl.enabled) return done('disabled', { reason: 'CW_SEMGREP_RETRY is off; the main scan\'s timeouts stand as reduced coverage' });
  const before = readSarif(sarif);
  if (before.state !== 'ok') return done('no-artifact', { sarifState: before.state, reason: before.reason || `the SARIF is ${before.state}, so there is nothing to retry against` });
  if (before.partialRetry) return done('already-retried', { reason: 'this SARIF already carries a retry invocation; a second pass would stack retries', recovered: before.partialRetry.recovered, stillTimedOut: before.partialRetry.stillTimedOut });
  const named = before.partialAnalysis.filter((p) => p.reasons.some((r) => RETRIED_REASONS.includes(r))).map((p) => p.uri);
  if (!named.length) return done('nothing-to-retry', { reason: 'the main scan timed out on no file' });
  const present = named.filter((u) => retryable(cwd, u));
  const missing = named.filter((u) => !present.includes(u));
  if (!present.length) return done('nothing-to-retry', { reason: 'none of the timed-out paths is a file under the scan directory', notRetried: missing });
  const files = present.slice(0, ctl.maxFiles);
  const capped = present.slice(ctl.maxFiles);
  const fixpointFiles = new Set(before.partialAnalysis.filter((p) => p.reasons.includes('fixpoint-timeout')).map((p) => p.uri));
  const anyFixpoint = files.some((u) => fixpointFiles.has(u));
  const jobs = ctl.jobs ?? (anyFixpoint ? 1 : null);
  const askJson = !!jsonPath || anyFixpoint;
  // A stale sidecar from an earlier run would otherwise be read as this retry's output.
  for (const p of staleOutputs(sarif)) rmSync(p, { force: true });

  const budgetMs = ctl.budgetSec * 1000;
  const logged = [];
  const batches = [];
  const fixpoints = [];
  let spentMs = 0;
  let main = null;
  let ended = null;
  let first = null;
  for (const [i, batch] of chunk(files, ctl.batchFiles).entries()) {
    const leftMs = budgetMs - spentMs;
    if (ended || leftMs <= 0) {
      batches.push({ files: batch, state: 'not-started', reason: ended || `the ${ctl.budgetSec}s budget was spent by the earlier batches` });
      continue;
    }
    const out = batchOutputs(sarif, i + 1);
    const args = ['scan', ...configArgs, '--metrics=off', '--sarif', '--output', out.sarif,
      ...(askJson ? ['--json-output', out.json] : []), ...(jobs != null ? ['-j', String(jobs)] : []),
      '--timeout', String(ctl.timeoutSec), '--timeout-threshold', '0', '--quiet', ...batch];
    const startedMs = now();
    const r = spawn(bin, args, { cwd, env, encoding: 'utf8', timeout: leftMs, maxBuffer: 64 * 1024 * 1024 });
    spentMs += now() - startedMs;
    const stderr = String((r && r.stderr) || '');
    logged.push(`${[bin, ...args].join(' ')}\n${stderr}`);
    try { writeAtomic(log, logged.join('\n')); } catch { /* the log is a convenience; the receipt is the record */ }

    let fault = spawnFault(r, stderr, bin, ctl.budgetSec);
    const retry = fault ? null : readSarif(out.sarif);
    if (retry && retry.state !== 'ok') fault = { what: `the retry wrote a SARIF that reads ${retry.state}`, unchanged: 'the main SARIF is unchanged' };
    // The main document is re-parsed whole so the merge writes back every top-level key; readSarif
    // already read it ok above, which is what licenses runs[0].
    if (!fault && !main) {
      try { main = JSON.parse(readFileSync(sarif, 'utf8')); } catch (e) { fault = { what: `the main SARIF could not be re-read for the merge — ${e.message}`, ends: true }; }
    }
    if (fault) {
      first ??= { fault, exit: r.status, signal: r.signal };
      if (fault.ends) ended = `batch ${i + 1} ended the retry: ${faultText(fault, { whole: false })}`;
      batches.push({ files: batch, state: 'failed', exit: r.status, ...(r.signal ? { signal: r.signal } : {}), reason: faultText(fault, { whole: false }) });
      continue;
    }
    const retryFixpoint = askJson ? readFixpoint(out.json) : null;
    const { added } = mergeRetry(main, retry.runs, { files: batch, timeoutSec: ctl.timeoutSec, bin, at, exit: r.status, jobs, fixpoint: retryFixpoint });
    writeAtomic(sarif, JSON.stringify(main));
    if (retryFixpoint) fixpoints.push(withoutEntries(retryFixpoint));
    batches.push({ files: batch, state: 'merged', exit: r.status, resultsAdded: added });
  }

  const merged = batches.filter((b) => b.state === 'merged');
  const ledger = batches.map(({ files: of, ...rest }) => ({ files: of.length, ...rest }));
  if (!merged.length) {
    return done('failed', { reason: faultText(first.fault, { whole: true }), files, notRetried: [...missing, ...capped], exit: first.exit, signal: first.signal, jobs, batches: ledger });
  }
  // The reader decides what was recovered; the receipt quotes it rather than deciding again.
  const after = readSarif(sarif).partialRetry || { recovered: [], stillTimedOut: [] };
  return done('retried', {
    files: merged.flatMap((b) => b.files),
    notRetried: [...missing, ...batches.filter((b) => b.state !== 'merged').flatMap((b) => b.files), ...capped],
    exit: Math.max(...merged.map((b) => b.exit)), jobs, resultsAdded: merged.reduce((n, b) => n + b.resultsAdded, 0),
    recovered: after.recovered, stillTimedOut: after.stillTimedOut,
    unmeasured: after.unmeasured || [], retryFixpoint: sumFixpoint(fixpoints), batches: ledger,
  });
}

/** Copy the main scan's fixpoint timeouts into the SARIF once, as their own invocation. Returns the
 *  receipt's `fixpoint` field: what was read, and how many notices this call wrote. */
function detectFixpoint(sarif, jsonPath) {
  if (!jsonPath) return { measured: false, reason: 'no Semgrep JSON was given (--json)' };
  const fx = readFixpoint(resolve(jsonPath));
  if (!fx.measured) return fx;
  const out = { ...withoutEntries(fx), injected: 0 };
  if (!fx.entries.length) return out;
  const read = readSarif(sarif);
  if (read.state !== 'ok') return { ...out, reason: `the SARIF reads ${read.state}, so the fixpoint timeouts were not recorded in it` };
  if ((read.runs[0].invocations || []).some((i) => i && i.properties && i.properties.commitworkFixpoint)) return out;
  let doc;
  try { doc = JSON.parse(readFileSync(sarif, 'utf8')); } catch (e) { return { ...out, reason: `the SARIF could not be re-read for the record — ${e.message}` }; }
  const run = doc.runs[0];
  if (!Array.isArray(run.invocations)) run.invocations = [];
  run.invocations.push({
    executionSuccessful: true,
    toolExecutionNotifications: fx.entries.map(fixpointNotice),
    properties: { commitworkFixpoint: { source: 'time.fixpoint_timeouts', json: fx.json, count: fx.count, unattributed: fx.unattributed } },
  });
  writeAtomic(sarif, JSON.stringify(doc));
  return { ...out, injected: fx.entries.length };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  const own = dash >= 0 ? argv.slice(0, dash) : argv;
  const configArgs = dash >= 0 ? argv.slice(dash + 1) : [];
  const flag = (k) => { const i = own.indexOf(k); return i >= 0 ? own[i + 1] : undefined; };
  const sarifPath = own.find((a, i) => !a.startsWith('--') && !['--bin', '--log', '--json'].includes(own[i - 1]));
  if (!sarifPath) {
    process.stderr.write('usage: semgrep-retry.mjs <lane-sarif> [--json <semgrep.json>] [--bin semgrep] [--log <file>] -- <config args…>\n');
    process.exitCode = 2;
  } else {
    const receipt = retrySemgrep({ sarifPath, jsonPath: flag('--json') || null, bin: flag('--bin') || 'semgrep', logPath: flag('--log') || null, configArgs });
    const unmeasured = (receipt.unmeasured || []).length;
    const unmerged = (receipt.batches || []).filter((b) => b.state !== 'merged').length;
    const summary = receipt.state === 'retried'
      ? `retried ${receipt.files.length} file(s) at ${receipt.timeoutSec}s per rule: ${receipt.recovered.length} recovered, ${receipt.stillTimedOut.length} still timing out, ${receipt.resultsAdded} result(s) added${receipt.notRetried.length ? `, ${receipt.notRetried.length} not retried` : ''}${unmeasured ? `, ${unmeasured} not re-measured` : ''}${unmerged ? `, ${unmerged} of ${receipt.batches.length} batch(es) not merged` : ''}`
      : `${receipt.state}${receipt.reason ? ` — ${receipt.reason}` : ''}`;
    const fx = receipt.fixpoint;
    const fixpoint = fx.measured
      ? `; ${fx.count} fixpoint timeout(s) recorded from ${fx.json}${fx.unattributed ? `, ${fx.unattributed} not attributable to a file` : ''}${fx.reason ? ` — ${fx.reason}` : ''}`
      : `; fixpoint timeouts not measured — ${fx.reason}`;
    process.stderr.write(`semgrep-retry: ${summary}${fixpoint}\n`);
  }
}
