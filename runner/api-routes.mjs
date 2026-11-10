// The stack API's GET routes. Each resolves to { status, payload } and declares its sources; an
// unavailable source gives null data, never an empty list.
//   ctx: { ledger, meter, slots() → slot states, probes: { veld, spine } URLs, fetch, probeTimeoutMs }
//   env, read at call time when ctx.probes is absent: CW_STACK_VELD_URL, CW_STACK_SPINE_URL
import { ApiError, envelope } from './api-envelope.mjs';

const GEN = 'runner/api-routes.mjs';
const MAX_WINDOW_SEC = 86_400;
const unavailable = (id, reason) => ({ id, status: 'unavailable', reason });

function refuseUnknown(params, accepted) {
  for (const k of params.keys()) {
    if (!accepted.includes(k)) {
      throw new ApiError(400, 'UNKNOWN_PARAM', `unknown parameter "${k.slice(0, 40)}"`, `accepted: ${accepted.join(', ') || 'none'}`, `drop ${k.slice(0, 40)}`);
    }
  }
}

/** since: an ISO 8601 time or unix seconds. */
function sinceOf(params) {
  const v = params.get('since');
  if (v === null) return undefined;
  const ms = /^\d+$/.test(v) ? Number(v) * 1000 : Date.parse(v);
  if (!Number.isFinite(ms)) throw new ApiError(400, 'BAD_PARAM', `since is not a time: ${v.slice(0, 40)}`, null, 'an ISO 8601 time or unix seconds');
  return ms;
}

function intParam(params, name, min, max, fallback) {
  const v = params.get(name);
  if (v === null) return fallback;
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < min || n > max) throw new ApiError(400, 'BAD_PARAM', `${name} must be an integer from ${min} to ${max}`, null, `?${name}=${fallback}`);
  return n;
}

const ledgerSource = (ctx) => (ctx.ledger ? { id: 'ledger', ...ctx.ledger.check() } : unavailable('ledger', 'no ledger configured'));
const meterSource = (ctx) => (ctx.meter ? { id: 'meter', ...ctx.meter.status() } : unavailable('meter', 'no meter configured'));
const slotsSource = (ctx) => (typeof ctx.slots === 'function' ? { id: 'slots', status: 'live', reason: null } : unavailable('slots', 'no slot table configured'));

async function probe(id, url, ctx) {
  if (!url) return { id, status: 'unmeasured', reason: 'no URL configured' };
  const ms = ctx.probeTimeoutMs ?? 2000;
  try {
    const res = await (ctx.fetch ?? fetch)(url, { signal: AbortSignal.timeout(ms), redirect: 'manual' });
    await res.body?.cancel();
    return res.ok ? { id, status: 'live', reason: null } : unavailable(id, `HTTP ${res.status}`);
  } catch (e) {
    return unavailable(id, e.name === 'TimeoutError' ? `no answer in ${ms} ms` : (e.cause?.code || e.message));
  }
}

async function health(ctx) {
  const urls = ctx.probes ?? { veld: process.env.CW_STACK_VELD_URL, spine: process.env.CW_STACK_SPINE_URL };
  const sources = [
    { id: 'dispatcher', status: 'live', reason: null },
    meterSource(ctx),
    ledgerSource(ctx),
    ...(await Promise.all([probe('veld', urls.veld, ctx), probe('spine', urls.spine, ctx)])),
  ];
  const count = (st) => sources.filter((s) => s.status === st).length;
  const data = { uptimeSec: Math.round(process.uptime()), sourcesUp: count('live'), sourcesUnmeasured: count('unmeasured') };
  return { sources, data: { ...data, sourcesDown: sources.length - data.sourcesUp - data.sourcesUnmeasured } };
}

function slots(ctx) {
  const src = slotsSource(ctx);
  return { sources: [src], data: { slots: src.status === 'live' ? ctx.slots() : null } };
}

function fromLedger(ctx, params, read) {
  const src = ledgerSource(ctx);
  const since = sinceOf(params);
  const limit = intParam(params, 'limit', 1, 1000, 100);
  const rows = src.status === 'live' ? ctx.ledger[read]({ since, limit }) : null;
  return { sources: [src], data: { since: since === undefined ? null : new Date(since).toISOString(), [read]: rows } };
}

function resourcesNow(ctx) {
  const src = meterSource(ctx);
  const sample = ctx.meter?.latest() ?? null;
  const ids = sample ? { id: 'stack-ids', status: sample.ids.status, reason: sample.ids.reason } : unavailable('stack-ids', 'no sample');
  const parts = sample ? [sample.vm, ...Object.values(sample.containers)] : [];
  const measured = parts.filter((p) => p.state === 'measured' || p.state === 'running').length;
  return {
    sources: [src, ids],
    coverage: { requested: parts.length, measured, unknownFields: parts.length - measured },
    verifiedAtMs: sample ? Date.parse(sample.at) : undefined,
    data: { sample },
  };
}

function resourcesSeries(ctx, params) {
  const src = meterSource(ctx);
  const windowSec = intParam(params, 'window', 1, MAX_WINDOW_SEC, 300);
  return { sources: [src], data: { windowSec, samples: ctx.meter ? ctx.meter.series(windowSec) : null } };
}

export const ROUTES = Object.freeze({
  health: { params: [], run: health },
  'runner/slots': { params: [], run: slots },
  'runner/jobs': { params: ['since', 'limit'], run: (ctx, p) => fromLedger(ctx, p, 'jobs') },
  'runner/decisions': { params: ['since', 'limit'], run: (ctx, p) => fromLedger(ctx, p, 'decisions') },
  'resources/now': { params: [], run: resourcesNow },
  'resources/series': { params: ['window'], run: resourcesSeries },
});

/** Resolve one GET. Throws ApiError for a request that must not become a 200. */
export async function routeStack(pathname, params, ctx) {
  const startedAt = Date.now();
  const tail = pathname.startsWith('/v1/') ? pathname.slice(4) : null;
  if (tail === null || !Object.hasOwn(ROUTES, tail)) {
    throw new ApiError(404, 'NOT_FOUND', `no route ${pathname.slice(0, 120)}`, null, `one of ${Object.keys(ROUTES).map((r) => `/v1/${r}`).join(', ')}`);
  }
  refuseUnknown(params, ROUTES[tail].params);
  const out = await ROUTES[tail].run(ctx, params);
  return { status: 200, payload: envelope({ route: pathname, generator: GEN, startedAt, ...out }) };
}
