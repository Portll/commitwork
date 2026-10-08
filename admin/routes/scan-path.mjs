// admin/routes/scan-path.mjs — scan a directory the operator names, or every repository on this
// machine, from the Scanners view, and read the remediation briefs those scans wrote.
//
// LOCAL ONLY, by operator ruling 2026-09-28 (admin/SPEC-scan-path.md). A scan runs every lane's
// tool commands against the path, so through the tunnel it would be remote code execution on this
// machine. The published port gets canAct:false and a 403; the client draws no control there. A
// brief names local paths and the findings of private directories, so it is operator-only too.
//
// The route validates and hands over. admin/lib/jobs.mjs builds the argv, owns the one job slot,
// the SSE feed and the post-mortem log.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveScanPath } from '../../bin/lib/scan-target.mjs';
import { jobStatus, scanOutDir } from '../lib/jobs.mjs';

export { resolveScanPath, systemRoot, SYSTEM_PATHS } from '../../bin/lib/scan-target.mjs';

const KIND = 'scan-path';
const BRIEFS_LISTED = 20;
// A run directory's name: the panel stamps `<ISO time>`, the terminal `brief-<ISO time>`.
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Mirrored from serve.mjs (CW_ADMIN_LOCAL_PORT || PORT+1), read at call time.
const operatorPort = () => Number(process.env.CW_ADMIN_LOCAL_PORT || (Number(process.env.CW_ADMIN_PORT || 7878) + 1));

function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, operator: true };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  return s && s.user ? { ok: true, operator: false } : { ok: false };
}

const refuseRemote = (ctx, what = 'scanning a path runs') => ctx.send(403, { ok: false, error: `${what} only on the operator port, http://127.0.0.1:${operatorPort()}; through the tunnel it would be remote code execution on this machine` });

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The briefs under the scan output directory, newest brief.json first. ENOENT is "no brief yet";
 * any other read failure fails closed, and a brief.json that cannot be read or parsed is listed
 * with its error rather than dropped.
 * -> { ok: true, briefs: [{ id, generatedAt, target, counts } | { id, error }], total } | { ok: false, error }
 */
export function listBriefs(dir) {
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && RUN_ID.test(d.name)).map((d) => d.name); }
  catch (e) { return e.code === 'ENOENT' ? { ok: true, briefs: [], total: 0 } : { ok: false, error: `${dir} could not be read (${e.code || e.message})` }; }
  const found = [];
  for (const id of names) {
    try { found.push({ id, mtimeMs: statSync(join(dir, id, 'brief.json')).mtimeMs }); }
    catch (e) { if (e.code !== 'ENOENT') found.push({ id, mtimeMs: 0, error: `brief.json could not be read (${e.code || e.message})` }); }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || cmp(b.id, a.id));
  const briefs = found.slice(0, BRIEFS_LISTED).map(({ id, error }) => {
    if (error) return { id, error };
    let b;
    try { b = JSON.parse(readFileSync(join(dir, id, 'brief.json'), 'utf8')); }
    catch (e) { return { id, error: `brief.json could not be read (${e.code || e.message})` }; }
    return { id, generatedAt: b.generatedAt || null, target: b.target ? { mode: b.target.mode || null, root: b.target.root || null } : null, counts: b.counts || null };
  });
  return { ok: true, briefs, total: found.length };
}

// The brief's own inline scripts, by hash: the page runs those and nothing else.
function briefCsp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script\b[^>]*>/gi)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  return `default-src 'none'; script-src ${hashes.join(' ') || "'none'"}; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'`;
}

function serveBrief(ctx, dir) {
  const id = ctx.query.get('id') || '';
  if (!RUN_ID.test(id)) return ctx.send(400, { ok: false, error: 'id must name a run directory from GET /api/scan-path/briefs' });
  const html = ctx.query.get('format') === 'html';
  const file = join(dir, id, html ? 'brief.html' : 'brief.json');
  let body;
  try { body = readFileSync(file, 'utf8'); }
  catch (e) { return ctx.send(e.code === 'ENOENT' ? 404 : 500, { ok: false, error: e.code === 'ENOENT' ? `no brief in run ${id}` : `the brief for run ${id} could not be read (${e.code || e.message})` }); }
  if (html) return ctx.send(200, body, 'text/html; charset=utf-8', { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': briefCsp(body) });
  return ctx.send(200, body, 'application/json; charset=utf-8', { 'cache-control': 'no-store' });
}

// The brief routes read; they spawn nothing, so an unusable output directory is a 503, not a refusal to scan.
function briefGate(ctx, then) {
  const g = gate(ctx);
  if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
  if (!g.operator) return refuseRemote(ctx, 'a remediation brief names local paths; it is served');
  const out = scanOutDir();
  if (!out.ok) return ctx.send(503, { ok: false, error: out.error });
  return then(out.dir);
}

export const routes = [
  { method: 'GET', path: '/api/scan-path', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.send(200, { ok: true, canAct: g.operator, job: g.operator ? jobStatus(KIND) : null });
  } },

  { method: 'POST', path: '/api/scan-path', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    if (!g.operator) return refuseRemote(ctx);
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      // Checked before the path: a panel with nowhere private to write refuses every scan.
      const out = scanOutDir();
      if (!out.ok) return ctx.send(503, { ok: false, started: false, error: out.error });
      // The whole PC: the CLI discovers and guards each repository itself (discoverPcRepos), and the
      // walk takes too long to run inside a request.
      const pc = !!(body && body.pc === true);
      const r = pc ? { ok: true, path: null } : resolveScanPath(body && body.path, { outBase: out.base });
      if (!r.ok) return ctx.send(400, r);
      const t = ctx.trigger(KIND, null, pc ? { pc: true, label: 'scan: every repository on this machine' } : { path: r.path, label: `scan: ${r.path}` });
      if (t.started === false) {
        const busy = t.reason === 'already running';
        return ctx.send(busy ? 409 : t.refused ? 503 : 500, { ok: false, started: false,
          error: busy ? 'a scan-path job is already running; one at a time' : t.refused ? t.reason : `not started: ${t.reason}`, job: jobStatus(KIND) });
      }
      return ctx.send(202, { ok: true, started: true, ...(pc ? { pc: true } : { path: r.path }), job: jobStatus(KIND) });
    });
  } },

  { method: 'GET', path: '/api/scan-path/briefs', handle: (ctx) => briefGate(ctx, (dir) => {
    const l = listBriefs(dir);
    return l.ok ? ctx.send(200, l) : ctx.send(500, l);
  }) },

  { method: 'GET', path: '/api/scan-path/brief', handle: (ctx) => briefGate(ctx, (dir) => serveBrief(ctx, dir)) },
];

export default routes;
