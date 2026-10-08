// admin/routes/agent-surface.mjs — the Settings tab's Agent-surface section: read the three states
// of every guard/MCP/launch entry, and enable or disable one. A toggle here is the operator's own
// authenticated act — the CLI's exception to declaration-split-from-authority, reached through the
// browser instead of the shell. POST is CSRF-gated by serve.mjs like every state-changing route.

import { sessionWho } from '../../monitor/attribution.mjs';
import { loadManifest, statusOf, toggle } from '../../bin/agent-surface.mjs';

// guard: mirrors routes/settings.mjs — loopback is the operator port, everything else needs a session
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback' };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), session: s };
}

function surfaceView() {
  return {
    ok: true,
    entries: Object.values(loadManifest()).map((e) => {
      const st = statusOf(e);
      return { id: e.id, kind: e.kind, why: e.why || null, registered: st.registered, live: st.live, liveWhy: st.liveWhy, installed: st.installed };
    }),
  };
}

export const routes = [
  { method: 'GET', path: '/api/agent-surface', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, surfaceView()); }
    catch (e) { return ctx.send(500, { ok: false, error: `agent surface unreadable: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/agent-surface', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const id = body && typeof body.id === 'string' ? body.id : null;
      const action = body && (body.action === 'enable' || body.action === 'disable') ? body.action : null;
      if (!id || !action) return ctx.send(400, { ok: false, error: 'body must be {id, action: "enable"|"disable"}' });
      const entry = loadManifest()[id];
      if (!entry) return ctx.send(400, { ok: false, error: `unknown agent-surface id: ${id}` });
      try {
        const r = toggle(entry, action === 'enable');
        return ctx.send(200, { ok: true, id, action, by: g.who, result: r, state: surfaceView() });
      } catch (e) {
        return ctx.send(409, { ok: false, error: e.message, state: surfaceView() });
      }
    });
  } },
];

export default routes;
