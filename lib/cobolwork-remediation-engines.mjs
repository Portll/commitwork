// lib/cobolwork-remediation-engines.mjs — the drafter (a local model through LM Studio) and the
// optional reviewer (claude -p), each shaped as lib/cobolwork-remediation.mjs expects. The source
// leaves this machine only through the reviewer, and only when the operator asks for one.

import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { baseUrlFor, urlEnvVar } from '../monitor/llm-hosts.mjs';
import { quotedArgv } from './posix-shell.mjs';
import { windowsSpawnPlan } from './win-spawn.mjs';
import { DRAFT_SCHEMA } from './cobolwork-remediation.mjs';
import { claudeSpawnPlan, PROFILES } from './claude-spawn.mjs';

const LOCAL_TIMEOUT_MS = () => Number(process.env.CW_COBOLWORK_LOCAL_TIMEOUT_MS || 420_000);
const CLAUDE_TIMEOUT_MS = () => Number(process.env.CW_COBOLWORK_CLAUDE_TIMEOUT_MS || 900_000);

// LM_BASE is what the operator's token launcher sets; commitwork's own variables win over it.
export function lmStudioBase(env = process.env) {
  if (!env[urlEnvVar('lmstudio')] && !env.CW_LMSTUDIO_URL && env.LM_BASE) return String(env.LM_BASE).replace(/\/+$/, '');
  return baseUrlFor('lmstudio');
}
// The token is sent and never written anywhere, including into an error.
const authHeaders = (env = process.env) => (env.LM_API_TOKEN ? { authorization: `Bearer ${env.LM_API_TOKEN}` } : {});

// node:http, not fetch: fetch drops a response whose headers take more than 300 s, and a local model
// sends none until a non-streaming completion is finished, so a long draft read as unreachable.
function request(url, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers, signal, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body || undefined);
  });
}

async function fetchJson(url, { body = null, timeoutMs, signal = null }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const onExt = () => ac.abort();
  if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onExt, { once: true }); }
  try {
    const r = await request(url, { method: body ? 'POST' : 'GET', signal: ac.signal,
      headers: { 'content-type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : null });
    if (r.status === 401 || r.status === 403) return { ok: false, error: `LM Studio refused the request (HTTP ${r.status}); run commitwork through the token launcher so LM_API_TOKEN is set` };
    if (r.status < 200 || r.status > 299) return { ok: false, error: `LM Studio answered HTTP ${r.status}` };
    return { ok: true, json: JSON.parse(r.text) };
  } catch (e) {
    if (signal && signal.aborted) return { ok: false, stopped: true, error: 'stopped by operator' };
    return { ok: false, error: ac.signal.aborted ? `LM Studio did not answer within ${Math.round(timeoutMs / 1000)}s` : `LM Studio unreachable: ${e.message}` };
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onExt); }
}

// CW_COBOLWORK_LOCAL_MODEL pins it; otherwise the loaded Qwen 3.8-family model, as the CodeQL route picks.
export async function resolveLocalModel() {
  const pinned = process.env.CW_COBOLWORK_LOCAL_MODEL || process.env.CW_CODEQL_LOCAL_MODEL;
  if (pinned) return { ok: true, model: pinned, pinned: true };
  const base = lmStudioBase();
  const r = await fetchJson(`${base}/v1/models`, { timeoutMs: 5000 });
  if (!r.ok) return { ok: false, error: `${r.error} at ${base}` };
  const ids = ((r.json && r.json.data) || []).map((m) => m && m.id).filter((s) => typeof s === 'string');
  const hit = ids.find((id) => /qwen[/-]?3[._-]?8/i.test(id) && !/embed/i.test(id));
  if (!hit) return { ok: false, error: `no Qwen 3.8-family model is loaded in LM Studio at ${base} (loaded: ${ids.join(', ') || 'none'}); load one or set CW_COBOLWORK_LOCAL_MODEL` };
  return { ok: true, model: hit, pinned: false };
}

const unfence = (s) => String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

// Temperature 0 and a strict schema: the draft is evidence a person reads, so it must be re-derivable.
// Reasoning none by default: at Qwen's default level a draft can spend its whole budget thinking.
export function lmStudioDrafter({ model }) {
  return async ({ prompt, signal }) => {
    const engine = { engine: 'lmstudio', model };
    const r = await fetchJson(`${lmStudioBase()}/v1/chat/completions`, { signal, timeoutMs: LOCAL_TIMEOUT_MS(), body: {
      model, temperature: 0, reasoning_effort: process.env.CW_COBOLWORK_LOCAL_REASONING || 'none',
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      response_format: { type: 'json_schema', json_schema: { name: 'cobolwork_remediation_draft', strict: true, schema: DRAFT_SCHEMA } },
    } });
    if (!r.ok) return { ok: false, stopped: !!r.stopped, error: r.error, engine };
    const msg = (r.json.choices && r.json.choices[0] && r.json.choices[0].message) || {};
    const content = String(msg.content || '').replace(/^\s*<think>[\s\S]*?<\/think>/, '');
    const reasoning = String(msg.reasoning_content || msg.reasoning || '');
    for (const candidate of [unfence(content), reasoning.slice(Math.max(0, reasoning.lastIndexOf('{"rationale"')))]) {
      try { const draft = JSON.parse(candidate); if (draft && Array.isArray(draft.edits)) return { ok: true, draft, engine }; }
      catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    }
    return { ok: false, error: 'the model did not reply with a draft in the schema', engine };
  };
}

// claude -p over stdin (argv is visible in ps); CW_COBOLWORK_CLAUDE_CMD is the test seam.
// guard: a review needs no tool, no MCP server, no settings and no harness credential, in its own scratch cwd (review 2026-10-07 D10)
export function claudeReviewer() {
  return ({ prompt, signal }) => new Promise((done) => {
    const engine = { engine: 'claude-p', model: process.env.CW_COBOLWORK_CLAUDE_CMD ? 'stub' : 'default' };
    let run;
    try { run = claudeSpawnPlan(PROFILES.cobolworkReviewer); }
    catch (e) { return done({ engine, ok: false, error: `claude -p not started: ${e.message}` }); }
    const argv = process.env.CW_COBOLWORK_CLAUDE_CMD ? quotedArgv(process.env.CW_COBOLWORK_CLAUDE_CMD) : [run.file, ...run.args];
    let out = '', err = '', settled = false;
    const finish = (r) => { if (!settled) { settled = true; run.cleanup(); clearTimeout(t); if (signal) signal.removeEventListener('abort', kill); done({ engine, ...r }); } };
    // On Windows `claude` is a batch shim; the plan runs it through cmd.exe only with inert arguments.
    const plan = windowsSpawnPlan(argv[0], argv.slice(1));
    if (plan.absent || plan.refused) return finish({ ok: false, error: plan.reason });
    let p;
    try { p = spawn(plan.file, plan.args, { cwd: run.cwd, env: run.env, windowsHide: true, windowsVerbatimArguments: !!plan.viaCmd, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return finish({ ok: false, error: `could not start ${argv[0]}: ${e.message}` }); }
    const kill = () => { try { p.kill('SIGKILL'); } catch (e) { err += `\n(kill: ${e.code || e.message})`; } };
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true }); }
    const t = setTimeout(kill, CLAUDE_TIMEOUT_MS());
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => finish({ ok: false, error: `could not start ${argv[0]}: ${e.message}` }));
    p.on('close', (code) => {
      if (signal && signal.aborted) return finish({ ok: false, stopped: true, error: 'stopped by operator' });
      if (code !== 0) return finish({ ok: false, error: `${argv[0]} exited ${code}: ${err.trim().slice(0, 300) || 'no message'}` });
      try {
        const outer = JSON.parse(unfence(out));
        const review = outer && typeof outer.result === 'string' ? JSON.parse(unfence(outer.result)) : outer;
        if (!review || typeof review.agrees !== 'boolean') return finish({ ok: false, error: 'the reviewer did not reply with {agrees, concerns}' });
        return finish({ ok: true, review });
      } catch (e) { return finish({ ok: false, error: `the reviewer's reply is not JSON: ${e.message}` }); }
    });
    p.stdin.on('error', (e) => { err += `\n(stdin: ${e.code || e.message})`; });
    p.stdin.end(`${prompt}\n`);
  });
}
