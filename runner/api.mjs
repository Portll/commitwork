// The stack API: read-only HTTP over the ledger, the meter and the slot table, behind a bearer
// token. GET only. It binds one configured address; hostOnSubnet picks the control-subnet one.
//   routes: /v1/health, /v1/runner/slots, /v1/runner/jobs, /v1/runner/decisions,
//           /v1/resources/now, /v1/resources/series
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { ApiError, errorEnvelope } from './api-envelope.mjs';
import { routeStack } from './api-routes.mjs';

export { hostOnSubnet } from './net-host.mjs';
export const API_DEFAULTS = Object.freeze({ host: '127.0.0.1', port: 17990, minTokenLength: 16 });

const HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** Compares sha256 digests in constant time, so the token's length does not leak either. */
export function tokenMatches(header, token) {
  const m = /^Bearer (\S+)$/.exec(String(header ?? ''));
  const same = timingSafeEqual(digest(m ? m[1] : ''), digest(token));
  return Boolean(m) && same;
}

function send(res, status, payload, extra = {}) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  res.writeHead(status, { ...HEADERS, 'content-length': String(body.length), ...extra });
  res.end(body);
}

const refuse = (res, route, status, code, message, detail, remedy, extra) =>
  send(res, status, errorEnvelope(route, new ApiError(status, code, message, detail, remedy)), extra);

async function handle(ctx, token, req, res) {
  const route = String(req.url).split('?')[0].slice(0, 200);
  if (req.method !== 'GET') {
    req.resume();
    return refuse(res, route, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not registered`, 'the stack API is read-only', 'GET', { allow: 'GET' });
  }
  if (!tokenMatches(req.headers.authorization, token)) {
    return refuse(res, route, 401, 'UNAUTHORIZED', 'a valid bearer token is required', null,
      'send Authorization: Bearer <the token in ~/.config/portll-stack/api-token>', { 'www-authenticate': 'Bearer' });
  }
  let url;
  try { url = new URL(req.url, 'http://stack.invalid'); } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    return refuse(res, route, 400, 'BAD_TARGET', 'the request target does not parse', null, null);
  }
  try {
    const out = await routeStack(url.pathname, url.searchParams, ctx);
    return send(res, out.status, out.payload);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'SOURCE_UNREADABLE', 'the route failed', e.message, null);
    return send(res, err.status, errorEnvelope(url.pathname, err));
  }
}

/**
 * ({ ledger, meter, slots, token, host, port, probes, fetch, probeTimeoutMs }) →
 * { server, listen() → address, close() }. A missing or short token refuses to build.
 */
export function createStackApi({ token, host = API_DEFAULTS.host, port = API_DEFAULTS.port, ...rest } = {}) {
  if (typeof token !== 'string' || token.trim().length < API_DEFAULTS.minTokenLength) {
    throw new TypeError(`the stack API needs a bearer token of at least ${API_DEFAULTS.minTokenLength} characters`);
  }
  const ctx = { ...rest };
  const secret = token.trim();
  const server = createServer((req, res) => {
    handle(ctx, secret, req, res).catch((e) => { if (!res.headersSent) send(res, 500, errorEnvelope('', e)); else res.destroy(); });
  });
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
    }),
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
