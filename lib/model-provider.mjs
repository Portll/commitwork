// lib/model-provider.mjs — one chat interface over a local model server and, when the operator
// configures one, a hosted API. Local is the default and first in PROVIDER_ORDER; a hosted provider
// is used only when CW_MODEL_PROVIDER names it, and a failure there is reported, never retried
// against another provider. Every answer carries `answeredBy` so a recorded result is attributable.
//
// env, read at call time: CW_MODEL_PROVIDER (local, openai-compatible or anthropic; default local) ·
//   CW_MODEL_BASE_URL (API root of a hosted provider) · CW_MODEL_NAME (model id; required for
//   openai-compatible, default claude-sonnet-5-5 for anthropic) · CW_MODEL_API_KEY (key for a hosted
//   provider, sent only to its host) · CW_MODEL_TIMEOUT_MS (bound on one call; default 600 s local,
//   300 s hosted) · ANTHROPIC_API_KEY is accepted only while the base is Anthropic's own host

import http from 'node:http';
import https from 'node:https';
import { reachOf } from '../monitor/llm-runtime.mjs';

export const PROVIDER_ORDER = Object.freeze(['local', 'openai-compatible', 'anthropic']);
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_VERSION = '2023-06-01';

const ALIASES = { '': 'local', local: 'local', openai: 'openai-compatible', 'openai-compatible': 'openai-compatible', anthropic: 'anthropic' };
const LOCAL_TIMEOUT_MS = 600_000;
const API_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

const trimSlash = (s) => String(s).replace(/\/+$/, '');
const fail = (error) => ({ ok: false, error });

/**
 * Which provider answers. `local` is `{ baseUrl, engine }` for the caller's local server (the
 * server root, without /v1). Returns { ok, provider } or { ok: false, error }; never a guess.
 * The provider object holds no key: the key is read from env at request time and nowhere kept.
 */
export function resolveModelProvider({ local = null, env = process.env } = {}) {
  const raw = String(env.CW_MODEL_PROVIDER || '').trim().toLowerCase();
  const id = ALIASES[raw];
  if (!id) return fail(`CW_MODEL_PROVIDER=${raw} is not a provider (${PROVIDER_ORDER.join(', ')})`);
  const pinned = env.CW_MODEL_NAME || null;

  if (id === 'local') {
    // A base URL with no provider named is ambiguous: refusing it is what keeps a hosted URL from
    // being used under the local label, or a local run from being mistaken for a hosted one.
    if (env.CW_MODEL_BASE_URL) {
      return fail('CW_MODEL_BASE_URL is set but CW_MODEL_PROVIDER is not an API provider — set ' +
        'CW_MODEL_PROVIDER=openai-compatible|anthropic to use it, or point a local server with CW_LLM_URL_<HOST>');
    }
    if (!local || !local.baseUrl) return fail('no local model server is configured for this caller');
    const base = `${trimSlash(local.baseUrl)}/v1`;
    return { ok: true, provider: Object.freeze({ id, engine: local.engine || 'local', wire: 'openai', baseUrl: base, model: pinned, reach: reachOf(base) }) };
  }

  const base = id === 'anthropic' ? trimSlash(env.CW_MODEL_BASE_URL || ANTHROPIC_BASE_URL) : env.CW_MODEL_BASE_URL && trimSlash(env.CW_MODEL_BASE_URL);
  if (!base) return fail(`CW_MODEL_PROVIDER=${id} needs CW_MODEL_BASE_URL (the API root that /chat/completions is under)`);
  let url;
  try { url = new URL(base); } catch { return fail(`CW_MODEL_BASE_URL is not a URL: ${base}`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail(`CW_MODEL_BASE_URL must be http(s), not ${url.protocol}`);
  if (url.username || url.password) return fail('CW_MODEL_BASE_URL must not carry credentials; use CW_MODEL_API_KEY');
  const model = id === 'anthropic' ? pinned || ANTHROPIC_DEFAULT_MODEL : pinned;
  if (!model) return fail(`CW_MODEL_PROVIDER=${id} needs CW_MODEL_NAME`);
  const provider = Object.freeze({ id, engine: id, wire: id === 'anthropic' ? 'anthropic' : 'openai', baseUrl: base, model, reach: reachOf(base) });
  const key = apiKeyFor(provider, env);
  if (id === 'anthropic' && !key) {
    return fail(base === ANTHROPIC_BASE_URL
      ? 'CW_MODEL_PROVIDER=anthropic needs ANTHROPIC_API_KEY or CW_MODEL_API_KEY'
      : `CW_MODEL_PROVIDER=anthropic at ${url.host} needs CW_MODEL_API_KEY (ANTHROPIC_API_KEY is sent only to ${new URL(ANTHROPIC_BASE_URL).host})`);
  }
  if (key && url.protocol === 'http:' && provider.reach !== 'local') {
    return fail(`refusing to send an API key in clear text to ${url.host}; use https`);
  }
  return { ok: true, provider };
}

// ANTHROPIC_API_KEY is honoured only for Anthropic's own host, so overriding the base URL can never
// carry that key to another server; anything else needs the explicit CW_MODEL_API_KEY.
function apiKeyFor(provider, env) {
  if (provider.id === 'local') return null;
  if (env.CW_MODEL_API_KEY) return env.CW_MODEL_API_KEY;
  if (provider.id === 'anthropic' && provider.baseUrl === ANTHROPIC_BASE_URL) return env.ANTHROPIC_API_KEY || null;
  return null;
}

/** "anthropic:claude-sonnet-5-5 @ api.anthropic.com" — for a progress line, never carries the key. */
export function describeProvider(p, model = p.model) {
  let host = p.baseUrl;
  try { host = new URL(p.baseUrl).host; } catch { /* the raw string is the honest fallback */ }
  return `${p.engine}:${model || '(model unset)'} @ ${host}`;
}

// node:http, not fetch: fetch drops a response whose headers take over 300 s, and a local model
// sends none until a non-streaming completion finishes. No redirect is followed, so a request — and
// any key on it — reaches only the configured host.
function post(url, { headers, body, timeoutMs, signal }) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const onExt = () => ac.abort();
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onExt, { once: true }); }
    const done = (r) => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onExt); resolve(r); };
    const u = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'POST', agent: false, signal: ac.signal,
      headers: { 'content-type': 'application/json', 'content-length': payload.length, ...headers },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) { req.destroy(); done({ error: `response exceeded ${MAX_RESPONSE_BYTES} bytes` }); return; }
        chunks.push(c);
      });
      res.on('end', () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e) => done({ error: e.message }));
    });
    req.on('error', (e) => {
      if (signal && signal.aborted) return done({ error: 'stopped by caller', stopped: true });
      done({ error: timedOut ? `no answer within ${Math.round(timeoutMs / 1000)}s` : `unreachable: ${e.message}` });
    });
    req.end(payload);
  });
}

const scrub = (s, key) => (key ? String(s).split(key).join('[redacted]') : String(s));

function errorDetail(text) {
  try {
    const j = JSON.parse(text);
    const e = j && j.error;
    const msg = e && (typeof e === 'string' ? e : e.message || e.type);
    if (msg) return String(msg).slice(0, 200);
  } catch { /* a non-JSON error body is described by its status alone */ }
  return null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p && p.type === 'text').map((p) => p.text || '').join('');
  return '';
}

function readOpenAi(j) {
  const choice = j && Array.isArray(j.choices) && j.choices[0];
  if (!choice || !choice.message) return null;
  const msg = choice.message;
  return {
    text: textOf(msg.content), thinking: msg.reasoning_content || msg.reasoning || null,
    finishReason: choice.finish_reason || null, truncated: choice.finish_reason === 'length', model: j.model,
  };
}

function readAnthropic(j) {
  if (!j || !Array.isArray(j.content)) return null;
  const thinking = j.content.filter((b) => b && b.type === 'thinking').map((b) => b.thinking || '').join('\n\n');
  return {
    text: textOf(j.content), thinking: thinking || null,
    finishReason: j.stop_reason || null, truncated: j.stop_reason === 'max_tokens', model: j.model,
  };
}

/**
 * One chat completion. `messages` are {role: 'user'|'assistant', content}; `system` is separate
 * because the two wires carry it differently. Resolves, never throws:
 *   { ok: true, text, thinking, truncated, finishReason, answeredBy }
 *   { ok: false, error, status?, code?, thinking?, answeredBy }
 * An empty answer is `code: 'empty-answer'`, not a success; its reasoning, if any, is kept.
 */
export async function chatComplete(provider, { messages, system = null, model = provider.model, maxTokens = 2048, temperature = 0, timeoutMs, signal = null, env = process.env } = {}) {
  const answeredBy = { provider: provider.id, engine: provider.engine, model: model || null, host: hostOf(provider.baseUrl) };
  if (!model) return { ok: false, error: 'no model selected', answeredBy };
  const key = apiKeyFor(provider, env);
  if (provider.wire === 'anthropic' && !key) return { ok: false, error: 'no API key for anthropic in the environment', answeredBy };
  const limit = timeoutMs || Number(env.CW_MODEL_TIMEOUT_MS) || (provider.id === 'local' ? LOCAL_TIMEOUT_MS : API_TIMEOUT_MS);
  const label = provider.id === 'local' ? `${provider.engine} at ${answeredBy.host}` : `${provider.engine} (${answeredBy.host})`;

  const temp = Number.isFinite(temperature) ? temperature : 0;
  let url, headers, body;
  if (provider.wire === 'openai') {
    url = `${provider.baseUrl}/chat/completions`;
    headers = key ? { authorization: `Bearer ${key}` } : {};
    body = { model, temperature: temp, max_tokens: maxTokens, messages: system ? [{ role: 'system', content: system }, ...messages] : messages };
  } else {
    url = `${provider.baseUrl}/v1/messages`;
    headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
    body = { model, max_tokens: maxTokens, temperature: temp, messages, ...(system ? { system } : {}) };
  }

  const r = await post(url, { headers, body, timeoutMs: limit, signal });
  if (r.error) return { ok: false, error: scrub(`${label}: ${r.error}`, key), stopped: !!r.stopped, answeredBy };
  if (r.status < 200 || r.status > 299) {
    const detail = errorDetail(r.text);
    return { ok: false, status: r.status, error: scrub(`${label} answered HTTP ${r.status}${detail ? `: ${detail}` : ''}`, key), answeredBy };
  }
  let j;
  try { j = JSON.parse(r.text); } catch (e) { return { ok: false, status: r.status, error: `${label} answered HTTP ${r.status} with a body that is not JSON (${e.message})`, answeredBy }; }
  const out = provider.wire === 'anthropic' ? readAnthropic(j) : readOpenAi(j);
  if (!out) return { ok: false, status: r.status, error: `${label} answered HTTP ${r.status} without a completion in its body`, answeredBy };
  if (typeof out.model === 'string' && out.model) answeredBy.model = out.model;
  if (!out.text.trim()) {
    return { ok: false, status: r.status, code: 'empty-answer', error: `${label} returned no answer text${out.truncated ? ' (cut off at the token limit)' : ''}`, thinking: out.thinking, truncated: out.truncated, answeredBy };
  }
  return { ok: true, text: out.text, thinking: out.thinking, truncated: out.truncated, finishReason: out.finishReason, answeredBy };
}

function hostOf(base) {
  try { return new URL(base).host; } catch { return String(base); }
}
