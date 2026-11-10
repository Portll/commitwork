#!/usr/bin/env node
// bin/semgrep-retry.mjs — re-run Semgrep on the files the main scan timed out on.
//
// Semgrep's per-rule timeout is 5 s per file, and after three rules time out on one file it skips
// the file for every remaining rule (--timeout-threshold). Both arrive as warning-level Timeout
// notices while the run exits 0; monitor/sarif-read.mjs partialAnalysis reads them as files read
// only in part. This step scans the files whose reasons include `timeout`, and only those, again
// with a long per-rule timeout and no skip threshold, and merges what it finds into the lane SARIF.
//
// The original evidence is never erased. The main invocation keeps its Timeout notices; the retry
// is appended as a further invocation carrying properties.commitworkRetry {files, timeoutSec}, and
// the reader drops a file's timeout only when the retry targeted it and did not time out on it
// again. A retry that fails, is killed by its budget, or is switched off leaves the SARIF untouched.
//
//   node bin/semgrep-retry.mjs <lane-sarif> [--bin semgrep] [--log <file>] -- <config args…>
//
// Beside the SARIF it writes <name>-retry.sarif (the retry run as Semgrep wrote it) and
// <name>-retry.json (the receipt: state, files, what was recovered, what still times out).
//
// env, read at call time: CW_SEMGREP_RETRY (0 or off switches the retry off and the main scan's
//   timeouts stand as reduced coverage), CW_SEMGREP_RETRY_TIMEOUT (seconds Semgrep may spend per
//   rule on one file in the retry, default 60), CW_SEMGREP_RETRY_MAX_FILES (most files one retry
//   scans, default 50; the rest are named in the receipt as not retried), CW_SEMGREP_RETRY_BUDGET_SEC
//   (wall-clock seconds for the whole retry, default 600; past it the retry is killed and the SARIF
//   is left untouched), CW_NOW (pins the receipt timestamp)
//
// Any other non-zero exit is a defect in this script, and the lane fails loudly on it.
// exit: 0 every handled state (the receipt carries the retry's outcome; the lane's exit sidecar
//       was written before this step) · 2 usage
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { readSarif } from '../monitor/sarif-read.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { nowISO } from '../lib/clock.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const DEFAULTS = Object.freeze({ timeoutSec: 60, maxFiles: 50, budgetSec: 600 });

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export function retryControls(env = process.env) {
  return {
    enabled: !['0', 'off', 'false', 'no'].includes(String(env.CW_SEMGREP_RETRY ?? '').toLowerCase()),
    // Semgrep validates --timeout as an integer whatever its help text says (measured 1.180.0)
    timeoutSec: Math.max(1, Math.floor(num(env.CW_SEMGREP_RETRY_TIMEOUT, DEFAULTS.timeoutSec))),
    maxFiles: Math.floor(num(env.CW_SEMGREP_RETRY_MAX_FILES, DEFAULTS.maxFiles)),
    budgetSec: num(env.CW_SEMGREP_RETRY_BUDGET_SEC, DEFAULTS.budgetSec),
  };
}

const sidecar = (sarifPath, suffix) => join(dirname(sarifPath), `${basename(sarifPath).replace(/\.sarif$/, '')}-retry${suffix}`);

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
export function mergeRetry(main, retryRuns, { files, timeoutSec, bin, at, exit }) {
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
  run.invocations.push({ ...rinv, properties: { ...(rinv.properties || {}), commitworkRetry: { files, timeoutSec, timeoutThreshold: 0, bin, at, exit } } });
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
export function retrySemgrep({ sarifPath, bin = 'semgrep', configArgs = [], cwd = process.cwd(), env = process.env, logPath = null, spawn = spawnSync }) {
  const sarif = resolve(sarifPath);
  const receiptPath = sidecar(sarif, '.json');
  const retrySarifPath = sidecar(sarif, '.sarif');
  const log = logPath ? resolve(logPath) : sidecar(sarif, '.log');
  const ctl = retryControls(env);
  const at = nowISO(env);
  const base = { tool: 'semgrep-retry', sarif: basename(sarif), bin, timeoutSec: ctl.timeoutSec, timeoutThreshold: 0, maxFiles: ctl.maxFiles, budgetSec: ctl.budgetSec, at };
  const done = (state, extra = {}) => {
    const receipt = { ...base, state, ...extra };
    writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  };

  if (!ctl.enabled) return done('disabled', { reason: 'CW_SEMGREP_RETRY is off; the main scan\'s timeouts stand as reduced coverage' });
  const before = readSarif(sarif);
  if (before.state !== 'ok') return done('no-artifact', { sarifState: before.state, reason: before.reason || `the SARIF is ${before.state}, so there is nothing to retry against` });
  if (before.partialRetry) return done('already-retried', { reason: 'this SARIF already carries a retry invocation; a second pass would stack retries', recovered: before.partialRetry.recovered, stillTimedOut: before.partialRetry.stillTimedOut });
  const named = before.partialAnalysis.filter((p) => p.reasons.includes('timeout')).map((p) => p.uri);
  if (!named.length) return done('nothing-to-retry', { reason: 'the main scan timed out on no file' });
  const present = named.filter((u) => retryable(cwd, u));
  const missing = named.filter((u) => !present.includes(u));
  if (!present.length) return done('nothing-to-retry', { reason: 'none of the timed-out paths is a file under the scan directory', notRetried: missing });
  const files = present.slice(0, ctl.maxFiles);
  const notRetried = [...missing, ...present.slice(ctl.maxFiles)];

  const args = ['scan', ...configArgs, '--metrics=off', '--sarif', '--output', retrySarifPath,
    '--timeout', String(ctl.timeoutSec), '--timeout-threshold', '0', '--quiet', ...files];
  const r = spawn(bin, args, { cwd, env, encoding: 'utf8', timeout: ctl.budgetSec * 1000, maxBuffer: 64 * 1024 * 1024 });
  const stderr = String((r && r.stderr) || '');
  try { writeAtomic(log, `${[bin, ...args].join(' ')}\n${stderr}`); } catch { /* the log is a convenience; the receipt is the record */ }
  const failed = (reason, extra = {}) => done('failed', { reason, files, notRetried, exit: r && r.status, signal: r && r.signal, ...extra });
  if (r.error) return failed(r.error.code === 'ETIMEDOUT' ? `the retry exceeded its ${ctl.budgetSec}s budget and was killed; the SARIF is unchanged` : `${bin} could not be run — ${r.error.code || r.error.message}`);
  if (r.signal) return failed(`${bin} was killed by ${r.signal}${r.signal === 'SIGTERM' ? ` (the ${ctl.budgetSec}s budget)` : ''}; the SARIF is unchanged`);
  if (r.status > 1) return failed(`${bin} exited ${r.status}; the SARIF is unchanged — ${stderr.trim().split('\n').pop() || 'no stderr'}`);
  const retry = readSarif(retrySarifPath);
  if (retry.state !== 'ok') return failed(`the retry wrote a SARIF that reads ${retry.state}; the main SARIF is unchanged`);

  // The main document is re-parsed whole so the merge writes back every top-level key; readSarif
  // already read it ok above, which is what licenses runs[0].
  let main;
  try { main = JSON.parse(readFileSync(sarif, 'utf8')); } catch (e) { return failed(`the main SARIF could not be re-read for the merge — ${e.message}`); }
  const { doc, added } = mergeRetry(main, retry.runs, { files, timeoutSec: ctl.timeoutSec, bin, at, exit: r.status });
  writeAtomic(sarif, JSON.stringify(doc));
  // The reader decides what was recovered; the receipt quotes it rather than deciding again.
  const after = readSarif(sarif).partialRetry || { recovered: [], stillTimedOut: [] };
  return done('retried', { files, notRetried, exit: r.status, resultsAdded: added, recovered: after.recovered, stillTimedOut: after.stillTimedOut });
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  const own = dash >= 0 ? argv.slice(0, dash) : argv;
  const configArgs = dash >= 0 ? argv.slice(dash + 1) : [];
  const flag = (k) => { const i = own.indexOf(k); return i >= 0 ? own[i + 1] : undefined; };
  const sarifPath = own.find((a, i) => !a.startsWith('--') && !['--bin', '--log'].includes(own[i - 1]));
  if (!sarifPath) {
    process.stderr.write('usage: semgrep-retry.mjs <lane-sarif> [--bin semgrep] [--log <file>] -- <config args…>\n');
    process.exitCode = 2;
  } else {
    const receipt = retrySemgrep({ sarifPath, bin: flag('--bin') || 'semgrep', logPath: flag('--log') || null, configArgs });
    const summary = receipt.state === 'retried'
      ? `retried ${receipt.files.length} file(s) at ${receipt.timeoutSec}s per rule: ${receipt.recovered.length} recovered, ${receipt.stillTimedOut.length} still timing out, ${receipt.resultsAdded} result(s) added${receipt.notRetried.length ? `, ${receipt.notRetried.length} not retried` : ''}`
      : `${receipt.state}${receipt.reason ? ` — ${receipt.reason}` : ''}`;
    process.stderr.write(`semgrep-retry: ${summary}\n`);
  }
}
