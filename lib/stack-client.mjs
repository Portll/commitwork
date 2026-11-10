// The reader for the dispatcher's stack API (runner/api.mjs): one bearer-token GET, returning the
// API's own envelope. A stack that cannot be asked gives an UNMEASURED envelope with the cause and
// a remedy, in the API's failure shape. It never answers zeros and never throws.
//   env, read at call time: CW_STACK_API_URL (else http://127.0.0.1:17990),
//     CW_STACK_API_TOKEN_FILE (else api-token in CW_STACK_STATE, else in ~/.config/portll-stack)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const STACK_DEFAULTS = Object.freeze({ url: 'http://127.0.0.1:17990', timeoutMs: 3000 });
export const UNMEASURED = 'UNMEASURED';
export const UP_REMEDY = 'run node bin/stack.mjs up in the spine checkout';
const GENERATOR = 'commitwork · lib/stack-client.mjs';

export const stackApiUrl = () => process.env.CW_STACK_API_URL || STACK_DEFAULTS.url;

// CW_STACK_STATE is the state directory spine's bin/stack.mjs writes the token into.
export const stackTokenPath = () => (process.env.CW_STACK_API_TOKEN_FILE
  ? resolve(process.env.CW_STACK_API_TOKEN_FILE)
  : join(process.env.CW_STACK_STATE || join(homedir(), '.config', 'portll-stack'), 'api-token'));

// The page shows this path to signed-in users; the home directory names the operator's account.
const shown = (p) => (p.startsWith(homedir() + sep) ? `~${p.slice(homedir().length)}` : p);

/** The API's failure envelope, code UNMEASURED, with the cause a renderer or a test can key on. */
export function unmeasured(route, cause, message, { detail = null, remedy = UP_REMEDY } = {}) {
  return {
    ok: false,
    route,
    schemaVersion: 1,
    stamp: { verifiedAt: null, verifiedAtUnix: null, generator: GENERATOR },
    error: { code: UNMEASURED, cause, message, detail, remedy },
    partial: null,
  };
}

function readToken(path) {
  const at = shown(path);
  const remedy = `${UP_REMEDY}, which writes ${at}, or set CW_STACK_API_TOKEN_FILE`;
  try {
    const token = readFileSync(path, 'utf8').trim();
    return token ? { token } : { cause: 'token-missing', message: `the stack API token file is empty: ${at}`, remedy };
  } catch (e) {
    if (e.code === 'ENOENT') return { cause: 'token-missing', message: `no stack API token at ${at}`, remedy };
    return { cause: 'token-unreadable', message: `the stack API token at ${at} is unreadable: ${e.code || e.message}`, remedy: `make ${at} a file the panel's user can read` };
  }
}

const isEnvelope = (b) => Boolean(b) && typeof b === 'object' && typeof b.ok === 'boolean'
  && (b.ok ? 'data' in b : Boolean(b.error) && typeof b.error === 'object');

function unreachable(route, e, origin, timeoutMs) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return unmeasured(route, 'timeout', `the stack API at ${origin} did not answer in ${timeoutMs} ms`);
  }
  const code = String(e?.cause?.code || e?.code || e?.message || 'unknown error');
  const what = code === 'ECONNREFUSED' ? 'refused the connection' : 'is unreachable';
  return unmeasured(route, 'stack-down', `the stack API at ${origin} ${what}`, { detail: code });
}

/**
 * GET one stack route ('/v1/…', with any query) → the API's envelope, or an UNMEASURED one.
 * Options: url (the API base), token (else read from the token file), timeoutMs, fetch.
 */
export async function readStack(route, { url = stackApiUrl(), token, timeoutMs = STACK_DEFAULTS.timeoutMs, fetch: f = fetch } = {}) {
  const path = String(route ?? '').split('?')[0];
  if (!path.startsWith('/v1/')) return unmeasured(path, 'bad-route', `not a stack API route: ${path.slice(0, 80)}`, { remedy: 'a route under /v1/' });
  let target;
  try { target = new URL(route, url); } catch { target = null; }
  if (!target || !/^https?:$/.test(target.protocol)) {
    return unmeasured(path, 'bad-url', `CW_STACK_API_URL is not an http URL: ${String(url).slice(0, 80)}`, { remedy: `unset CW_STACK_API_URL for ${STACK_DEFAULTS.url}` });
  }
  const file = token === undefined ? stackTokenPath() : null;
  const t = file ? readToken(file) : { token: String(token).trim() };
  if (!t.token) return unmeasured(path, t.cause || 'token-missing', t.message || 'the token supplied is empty', { remedy: t.remedy });

  let res;
  let text;
  try {
    res = await f(target, { headers: { authorization: `Bearer ${t.token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) {
    return unreachable(path, e, target.origin, timeoutMs);
  }
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: refused below */ }
  if (res.status === 401) {
    return unmeasured(path, 'token-rejected', `the stack API rejected the token from ${file ? shown(file) : 'the caller'}`, {
      detail: body?.error?.message ?? `HTTP ${res.status}`,
      remedy: `the token and the running stack disagree: ${UP_REMEDY} again, or point CW_STACK_API_TOKEN_FILE at the file it wrote`,
    });
  }
  if (!isEnvelope(body)) {
    return unmeasured(path, 'bad-response', `the stack API answered HTTP ${res.status} without its envelope`, { detail: target.origin, remedy: 'check that CW_STACK_API_URL names the stack API' });
  }
  return body;
}
