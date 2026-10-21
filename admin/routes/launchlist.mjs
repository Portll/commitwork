// admin/routes/launchlist.mjs — the launch checklist behind the panel login.
//
// GET  /launchlist/            the page (also `/` on a launchlist hostname — see serve.mjs)
// GET  /api/launchlist         the evaluated model as JSON
// POST /api/launchlist/tick    {project, item, state: done|na|open, note} — session-attributed
//
// Dispatched below the login gate, so every route here already has a session; ticks still resolve
// the identity themselves because a tick is worth exactly the identity behind it.

import { sessionWho } from '../../monitor/attribution.mjs';
import { buildModel, loadSpec, loadConfig, withState, recordTick } from '../../lib/launchlist.mjs';
import { renderPage } from '../../lib/launchlist-render.mjs';

export const launchlistHosts = () => new Set(String(process.env.CW_LAUNCHLIST_HOSTS || 'launchlist.commitwork.online')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

function page(ctx) {
  let model;
  try { model = buildModel(); } catch (e) {
    return ctx.send(503, `<!doctype html><title>launchlist unavailable</title><p>launchlist store unavailable: ${String(e.message).replace(/[<>&]/g, '')}</p>`, 'text/html; charset=utf-8');
  }
  const { html, csp } = renderPage(model, { interactive: true });
  return ctx.send(200, html, 'text/html; charset=utf-8', {
    'content-security-policy': csp,
    'content-security-policy-report-only': csp,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });
}

export const routes = [
  { method: 'GET', path: '/launchlist/', handle: page },
  { method: 'GET', path: '/launchlist', handle: page },

  { method: 'GET', path: '/api/launchlist', handle: (ctx) => {
    try { return ctx.send(200, { ok: true, ...buildModel() }); }
    catch (e) { return ctx.send(503, { ok: false, error: `launchlist store unavailable: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/launchlist/tick', handle: (ctx) => {
    const s = ctx.adminSession(ctx.req);
    const by = s ? sessionWho(s) : '';
    if (!by) return ctx.send(401, { ok: false, error: 'authentication required — a tick is worth exactly the identity behind it' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const { project, item, state, note } = body || {};
      if (typeof project !== 'string' || typeof item !== 'string') return ctx.send(400, { ok: false, error: 'project and item are required strings' });
      let out;
      try {
        const spec = loadSpec();
        const config = loadConfig();
        out = withState((st) => recordTick(st, project, item, { state: state || 'done', note: note || '', by, spec, config }), { label: 'launchlist-panel' });
      } catch (e) { return ctx.send(e.message && e.message.includes('not a project slug') ? 400 : 503, { ok: false, error: e.message }); }
      if (!out.ok) {
        const code = out.refused === 'busy' || out.refused === 'unavailable' ? 503 : out.refused === 'no-subject' ? 404 : out.refused === 'no-identity' ? 401 : 400;
        return ctx.send(code, { ok: false, refused: out.refused, error: out.error, errors: out.errors });
      }
      return ctx.send(200, { ok: true, tick: out.tick });
    });
  } },
];
