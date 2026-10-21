// admin/routes/graph.mjs — the relation graph (bin/graph.mjs), read-only over its sources; the store
// is rebuilt first when they changed. An input that cannot be read is a 500, never an empty answer.
//   GET /api/graph/neighbours?id=&rel=&depth=   the nodes around one node
//   GET /api/graph/path?a=&b=&depth=            a shortest path between two nodes
//   GET /api/graph/search?q=                    nodes by id or label, with node counts and build status

import { withGraph, neighbours, path, search, MAX_DEPTH, MAX_PATH_DEPTH } from '../../bin/graph.mjs';

const authed = (ctx) => !!(ctx.isLoopbackReq || (ctx.adminSession(ctx.req) || {}).user);
const params = (ctx) => ctx.query || new URL(ctx.req.url || '/', 'http://127.0.0.1').searchParams;

function depthOf(q, dflt, max) {
  const raw = q.get('depth');
  const d = raw === null ? dflt : Number(raw);
  return Number.isInteger(d) && d >= 1 && d <= max ? d : null;
}

function answer(ctx, fn, found = (r) => r.found) {
  let r;
  try {
    r = withGraph(fn);
  } catch (e) {
    return ctx.send(500, { ok: false, error: `the graph could not be built: ${e.message}` });
  }
  const ok = found(r);
  return ctx.send(ok ? 200 : 404, { ok, ...r });
}

export const routes = [
  { method: 'GET', path: '/api/graph/neighbours', handle: (ctx) => {
    if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
    const q = params(ctx);
    const id = String(q.get('id') || '');
    if (!id) return ctx.send(400, { ok: false, error: 'id is required, e.g. ?id=repo:<name>' });
    const depth = depthOf(q, 1, MAX_DEPTH);
    if (depth === null) return ctx.send(400, { ok: false, error: `depth must be an integer from 1 to ${MAX_DEPTH}` });
    return answer(ctx, (db) => neighbours(db, id, { rel: q.get('rel') || null, depth }));
  } },
  { method: 'GET', path: '/api/graph/path', handle: (ctx) => {
    if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
    const q = params(ctx);
    const a = String(q.get('a') || '');
    const b = String(q.get('b') || '');
    if (!a || !b) return ctx.send(400, { ok: false, error: 'a and b are required, e.g. ?a=finding:<id>&b=area:<slug>' });
    const depth = depthOf(q, MAX_PATH_DEPTH, MAX_PATH_DEPTH);
    if (depth === null) return ctx.send(400, { ok: false, error: `depth must be an integer from 1 to ${MAX_PATH_DEPTH}` });
    return answer(ctx, (db) => path(db, a, b, { depth }));
  } },
  { method: 'GET', path: '/api/graph/search', handle: (ctx) => {
    if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
    const q = String(params(ctx).get('q') || '').slice(0, 200);
    return answer(ctx, (db) => search(db, q), () => true);
  } },
];

export default routes;
