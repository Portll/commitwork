// admin/routes/learning.mjs — Learning mode: the toggle, the explainer text, and the per-item
// dismissals.
//
// fact: an explainer is served from monitor/explainers.json by id, never inlined at a call site / a dismissal remembers an id and an inline string has none, so rewording the text would un-dismiss it for everyone who had already dismissed it (expiry: never, prev: not built)
// fact: dismissing an unknown id is REFUSED by the setting's own validator / an unchecked set accumulates ghosts for explainers that were renamed, and nothing can then tell a real dismissal from a dead one (expiry: never, prev: not built)
// fact: an unreadable explainer registry serves NO explainers and refuses every dismissal / the alternative is a panel that teaches nothing while reporting that learning mode is on (expiry: never, prev: not built)
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSetting, setSettings, explainerIds } from '../../monitor/settings.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registryPath = () => process.env.CW_EXPLAINERS || resolve(CW, 'monitor', 'explainers.json');

export function loadExplainers() {
  try {
    const doc = JSON.parse(readFileSync(registryPath(), 'utf8'));
    if (!Array.isArray(doc.explainers)) throw new Error('explainers[] missing');
    return { ok: true, audience: doc.audience, explainers: doc.explainers };
  } catch (e) {
    return { ok: false, error: `monitor/explainers.json is unreadable (${e.code || e.message}) — no explanation is shown rather than a wrong one`, explainers: [] };
  }
}

/** The whole state a client needs: on/off, what to show, and what has been dismissed. */
export function state() {
  const reg = loadExplainers();
  const on = getSetting('learningMode').value === true;
  const dismissed = getSetting('learningDismissed').value || [];
  const set = new Set(dismissed);
  return {
    ok: true,
    on,
    registryOk: reg.ok,
    registryError: reg.ok ? null : reg.error,
    audience: reg.audience || null,
    dismissed,
    // fact: `visible` is computed here, not in the browser / two copies of "on and not dismissed" drift, and the copy that drifts is the one that decides what a reader sees (expiry: never, prev: duplicated)
    visible: on ? reg.explainers.filter((e) => !set.has(e.id)) : [],
    total: reg.explainers.length,
  };
}

// Same gate as admin/routes/perf.mjs and settings.mjs — the three must not drift on who may change
// panel configuration. `who` is stamped on the write: a setting changed by nobody is unauditable.
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback' };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), session: s };
}

export const routes = [
  { method: 'GET', path: '/api/learning', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, state()); }
    catch (e) { return ctx.send(500, { ok: false, error: `learning state could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/learning', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    // fact: a body arrives only through ctx.readJsonBody / the dispatcher passes no `ctx.body`, so reading it made every change a 400 (expiry: never, prev: broken)
    const { body: parsed, err } = await new Promise((done) => ctx.readJsonBody(ctx.req, (b, e) => done({ body: b, err: e })));
    if (err) return ctx.send(400, { ok: false, error: err });
    const body = parsed || {};
    const patch = {};

    if ('on' in body) {
      if (typeof body.on !== 'boolean') return ctx.send(400, { ok: false, error: '`on` must be true or false' });
      patch.learningMode = body.on;
    }

    if ('dismiss' in body) {
      const id = body.dismiss;
      if (typeof id !== 'string') return ctx.send(400, { ok: false, error: '`dismiss` must be an explainer id' });
      if (!explainerIds().has(id)) {
        return ctx.send(400, { ok: false, error: `"${id}" is not an explainer in monitor/explainers.json` });
      }
      const now = new Set(getSetting('learningDismissed').value || []);
      now.add(id);
      patch.learningDismissed = [...now].sort();
    }

    // fact: restore is all-or-nothing and has no per-id form / un-dismissing one item is a control nobody asked for and every extra control is a state to get wrong (expiry: if someone asks for it, prev: not built)
    if (body.restoreAll === true) patch.learningDismissed = null;

    if (!Object.keys(patch).length) {
      return ctx.send(400, { ok: false, error: 'nothing to change — send `on`, `dismiss` or `restoreAll`' });
    }
    try {
      const r = setSettings(patch, { who: g.who });
      if (r && r.errors && r.errors.length) return ctx.send(400, { ok: false, error: r.errors.join('; ') });
      return ctx.send(200, state());
    } catch (e) {
      return ctx.send(400, { ok: false, error: e.message });
    }
  } },
];
