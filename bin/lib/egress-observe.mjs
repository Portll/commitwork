// bin/lib/egress-observe.mjs — one egress proxy per networked lane, started and stopped around the
// lane's shell by bin/commitwork.mjs. The runner is synchronous (spawnSync), so the proxy is a child
// process and this file waits on its port file and its ledger with a blocking sleep.

// CW_EGRESS_OBSERVE=1|observe records what proxy-honouring clients asked for; =enforce refuses
// anything outside manifests/egress-allowlist.json (CW_EGRESS_ALLOWLIST) and refuses to RUN the lane
// when that file is unusable, rather than running it open. The observation lands in
// <report dir>/egress-observed.json for monitor/egress-suggest.mjs.

// A lane that cannot be observed is recorded as `unobserved` with the reason, never as one that
// dialled nothing: an operator's upstream proxy (this proxy does not chain to it) or a command that
// runs a container (the proxy env does not reach inside it).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERAGE } from '../egress-proxy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OBSERVED_FILE = 'egress-observed.json';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** null, 'observe' or 'enforce'; anything else named is a refusal the caller reports. */
export function egressMode(env) {
  const v = String(env.CW_EGRESS_OBSERVE || '').trim().toLowerCase();
  if (!v || v === '0' || v === 'off') return null;
  if (v === '1' || v === 'observe') return 'observe';
  if (v === 'enforce') return 'enforce';
  return { refused: `CW_EGRESS_OBSERVE=${JSON.stringify(env.CW_EGRESS_OBSERVE)} is not 1|observe|enforce` };
}

export const UPSTREAM_KEYS = Object.freeze(['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']);
/** The operator's upstream proxy variable, if one is set; this proxy cannot chain to it. */
export const upstreamProxy = (env) => UPSTREAM_KEYS.find((k) => String(env[k] || '').trim()) || null;
/** A command whose network leaves through a container the proxy env does not reach. */
export const containerised = (cmd) => /\bdocker\s+(?:run|compose|exec|buildx?)\b|\bpodman\s+run\b/.test(String(cmd));
// fact: the ledger lives where a sandboxed lane cannot write / a lane writes /tmp, and would otherwise write the ledger it is judged by (expiry: never, prev: broken)
const stateDir = (env) => env.CW_EGRESS_STATE_DIR || join(homedir(), '.commitwork', 'egress-ledgers');

export const proxyEnv = (url) => ({ HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, ALL_PROXY: url, NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1' });

/** Start the proxy for one lane. { port, url, stop } or { refused }. */
export function startProxy({ lane, mode, allowlistPath = join(ROOT, 'manifests', 'egress-allowlist.json'), cwRoot = ROOT, waitMs = 5000, env = process.env } = {}) {
  if (mode === 'enforce' && !existsSync(allowlistPath)) return { refused: `enforce needs an allowlist and ${allowlistPath} is absent` };
  mkdirSync(stateDir(env), { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(stateDir(env), 'lane-'));
  const portFile = join(dir, 'port'); const ledger = join(dir, 'ledger.json');
  const args = [join(cwRoot, 'bin', 'egress-proxy.mjs'), '--ledger', ledger, '--port-file', portFile, '--mode', mode, '--lane', lane, ...(mode === 'enforce' ? ['--allowlist', allowlistPath] : [])];
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'ignore', 'pipe'], env: { PATH: env.PATH, HOME: env.HOME } });
  let stderr = ''; let exited = null;
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (code) => { exited = code; });
  const started = Date.now();
  while (!existsSync(portFile) && exited === null && Date.now() - started < waitMs) sleep(25);
  const said = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : '';
  const port = Number(said);
  if (!Number.isInteger(port) || port < 1) {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
    return { refused: said.startsWith('error:') ? `egress proxy could not start: ${said.slice(6).trim()}` : exited !== null ? `egress proxy exited ${exited} before listening${stderr.trim() ? `: ${stderr.trim().split('\n')[0]}` : ''}` : `egress proxy did not listen within ${waitMs}ms` };
  }
  return {
    port, url: `http://127.0.0.1:${port}`,
    stop({ waitMs: w = 3000 } = {}) {
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      const t0 = Date.now();
      while (!existsSync(ledger) && Date.now() - t0 < w) sleep(25);
      let out;
      try { out = JSON.parse(readFileSync(ledger, 'utf8')); } catch (e) { out = { mode, coverage: COVERAGE, destinations: null, why: `ledger not written (${e.code || e.message})` }; }
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      rmSync(dir, { recursive: true, force: true });
      return out;
    },
  };
}

/** Append one lane's observation to <reportDir>/egress-observed.json ({ lanes: [...] }), tmp+rename. */
export function recordObservation(reportDir, row) {
  const path = join(reportDir, OBSERVED_FILE);
  let doc = { lanes: [] };
  if (existsSync(path)) { try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch { doc = { lanes: [], unreadablePrevious: true }; } }
  if (!Array.isArray(doc.lanes)) doc = { lanes: [], unreadablePrevious: true };
  doc.lanes.push(row);
  mkdirSync(reportDir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}
