// lib/cobolwork-bridge.mjs — runs the cobolwork lib/cobolwork-resolve.mjs finds, reads what it can
// do from `capabilities --json`, and runs `explain` and `gate` with a timeout. A missing or unusable
// tool is reported as unavailable, never as a result: the caller records the finding as not drafted.

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { windowsSpawnPlan } from './win-spawn.mjs';
import { resolveCobolwork, capabilitiesProblem, INSTALL_COMMAND } from './cobolwork-resolve.mjs';

export const MIN_SCHEMA = 3;
export const FINGERPRINT_RE = /^[0-9a-f]{32}$/;
export const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const STDOUT_CAP = 64 * 1024 * 1024;
const STDERR_CAP = 64 * 1024;
const TIMEOUT_MS = () => Number(process.env.CW_COBOLWORK_TIMEOUT_MS || 1_800_000);
const CAPABILITIES_TIMEOUT_MS = 60_000;

// The resolved cobolwork (CW_COBOLWORK_BIN, else the pinned install; never PATH), as a spawn plan.
export function cobolworkCommand(args, { env = process.env, platform = process.platform } = {}) {
  const r = resolveCobolwork({ env, platform });
  if (!r.ok) return { unavailable: true, reason: r.reason };
  const plan = windowsSpawnPlan(r.file, [...r.args, ...args], { platform });
  if (plan.absent) return { unavailable: true, reason: `CW_COBOLWORK_BIN names ${r.file}, which is not installed (${plan.reason})` };
  if (plan.refused) return { unavailable: true, reason: plan.reason };
  return plan;
}

// -> { ok, status, json, stderr } | { ok:false, unavailable, reason } | { ok:false, timedOut, reason }
export function runCobolwork(args, { env = process.env, signal = null, timeoutMs = TIMEOUT_MS() } = {}) {
  const plan = cobolworkCommand(args, { env });
  if (plan.unavailable) return Promise.resolve({ ok: false, unavailable: true, reason: plan.reason });
  return new Promise((done) => {
    let out = [], outBytes = 0, err = '', settled = false, timedOut = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); done(r); } };
    let p;
    // The working directory is outside every repository, so nothing a scanned tree holds is run by name.
    try { p = spawn(plan.file, plan.args, { cwd: tmpdir(), env, windowsHide: true, windowsVerbatimArguments: !!plan.viaCmd, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return finish({ ok: false, unavailable: true, reason: `cobolwork could not be started: ${e.message}` }); }
    // A kill that throws means the process already exited, and 'close' reports it.
    const onAbort = () => { try { p.kill('SIGKILL'); } catch (e) { err += `\n(kill: ${e.code || e.message})`; } };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const t = setTimeout(() => { timedOut = true; onAbort(); }, timeoutMs);
    p.stdout.on('data', (d) => { outBytes += d.length; if (outBytes <= STDOUT_CAP) out.push(d); else onAbort(); });
    p.stderr.on('data', (d) => { if (err.length < STDERR_CAP) err += d; });
    p.on('error', (e) => finish({ ok: false, unavailable: e.code === 'ENOENT', reason: `cobolwork could not be started: ${e.message}` }));
    p.on('close', (status) => {
      if (signal && signal.aborted) return finish({ ok: false, stopped: true, reason: 'stopped by operator' });
      if (timedOut) return finish({ ok: false, timedOut: true, reason: `cobolwork ran past ${Math.round(timeoutMs / 1000)}s and was stopped` });
      if (outBytes > STDOUT_CAP) return finish({ ok: false, reason: `cobolwork wrote more than ${STDOUT_CAP} bytes and was stopped` });
      const text = Buffer.concat(out).toString('utf8');
      let json = null, parseError = null;
      try { json = text.trim() ? JSON.parse(text) : null; } catch (e) { parseError = e.message; }
      finish({ ok: status === 0 && json !== null, status, json, stderr: err.trim().slice(0, 2000),
        ...(status === 0 && json === null ? { reason: `cobolwork exited 0 without a JSON document${parseError ? ` (${parseError})` : ''}` } : {}) });
    });
  });
}

// Only cobolwork's own exit 2, with its reason, is a refusal: capabilities --json has already said
// the command and every option commitwork passes exist. A run that did not finish (a crash, a
// timeout, no document) judged nothing, so it is unavailable.
const refusal = (r, what) => {
  if (r.stopped || r.unavailable) return { ...r, ok: false };
  if (r.status === 2 && !r.reason) return { ...r, ok: false, reason: `cobolwork refused the ${what}: ${r.stderr || 'no reason given'}` };
  return { ...r, ok: false, unavailable: true, reason: r.reason || `cobolwork ${what} exited ${r.status}: ${r.stderr || 'no message'}` };
};

// What the resolved cobolwork can do, held to the interim contract (capabilities schemaVersion 1,
// fingerprint identity cobolwork/v1) and to `needs`, the commands and options the caller will pass.
export async function capabilities(needs = {}, opts = {}) {
  const r = await runCobolwork(['capabilities', '--json'], { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? CAPABILITIES_TIMEOUT_MS, CAPABILITIES_TIMEOUT_MS) });
  if (r.stopped || r.unavailable) return { ...r, ok: false };
  if (!r.ok) {
    const why = r.reason || `exited ${r.status}: ${String(r.stderr || '').split('\n')[0] || 'no message'}`;
    return { ok: false, unavailable: true, reason: `cobolwork capabilities --json ${why}; commitwork reads what a cobolwork can do from that document, so this one is not used (\`${INSTALL_COMMAND}\` installs the pinned release)` };
  }
  const problem = capabilitiesProblem(r.json, { needs });
  if (problem) return { ok: false, unavailable: true, reason: `the resolved cobolwork is not used: ${problem}` };
  return { ok: true, caps: r.json };
}

// The fix packet for one finding, from a tree on disk.
export async function explain(root, fingerprint, opts = {}) {
  if (!FINGERPRINT_RE.test(String(fingerprint))) return { ok: false, reason: 'a fingerprint is 32 lowercase hex characters' };
  const c = await capabilities({ explain: [] }, opts);
  if (!c.ok) return c;
  const r = await runCobolwork(['explain', root, fingerprint], opts);
  if (!r.ok) return refusal(r, 'explain');
  if (r.json.tool !== 'cobolwork-explain') return { ok: false, unavailable: true, reason: `expected a cobolwork-explain packet, got ${JSON.stringify(r.json.tool)}` };
  return { ok: true, packet: r.json };
}

// The gate's document for base..head in a repository; targetOnly for a resweep.
export async function gate(repo, { base, head, target, targetOnly = false }, opts = {}) {
  if (!FINGERPRINT_RE.test(String(target))) return { ok: false, reason: 'a fingerprint is 32 lowercase hex characters' };
  if (!SHA_RE.test(String(base)) || !SHA_RE.test(String(head))) return { ok: false, reason: 'base and head are full commit ids' };
  const c = await capabilities({ gate: ['--base', '--head', '--target', ...(targetOnly ? ['--target-only'] : [])] }, opts);
  if (!c.ok) return c;
  const r = await runCobolwork(['gate', repo, '--base', base, '--head', head, '--target', target, ...(targetOnly ? ['--target-only'] : [])], opts);
  if (!r.ok) return refusal(r, 'gate');
  const doc = r.json;
  if (doc.tool !== 'cobolwork-gate') return { ok: false, reason: `expected a cobolwork-gate document, got ${JSON.stringify(doc.tool)}` };
  if (!(Number(doc.schemaVersion) >= MIN_SCHEMA)) return { ok: false, reason: `the gate's schemaVersion ${doc.schemaVersion} is below ${MIN_SCHEMA}` };
  if (!['pass', 'fail', 'undecided'].includes(doc.verdict)) return { ok: false, reason: `the gate returned no verdict (${JSON.stringify(doc.verdict)})` };
  return { ok: true, doc };
}
