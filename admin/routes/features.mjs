// admin/routes/features.mjs — the experimental feature flags: read every flag's effective state,
// and switch one. Declarations live in manifests/feature-charter.json; resolution in
// lib/feature-flags.mjs; the store is the experimentalFeatures setting (monitor/settings.mjs).
//
// fact: this route is never gated by a flag itself (http.config, core) / the switch that turns a group back on cannot be one of the things switched off (expiry: never, prev: not built)
// fact: a write shadowed by CW_FEATURE_<ID> or CW_EXPERIMENTAL is refused 409 / the env wins at read time, so a 200 would change nothing anyone can see (expiry: never, prev: not built)
import { getSetting, setSettings } from '../../monitor/settings.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { featureState, flagEnvVar } from '../../lib/feature-flags.mjs';

/** The panel's view of the flags: state plus which nav groups and views each one hides. */
export function featuresPayload() {
  const st = featureState();
  return {
    ...st,
    // ok is "the answer is complete"; an unreadable store still answers, flagged by storeError.
    ok: !st.charterError,
    flags: st.flags.map((f) => ({
      ...f,
      navGroups: [...(f.surfaces['ui-view'] || [])],
      views: [...(f.surfaces.view || [])],
    })),
  };
}

// Same gate as admin/routes/learning.mjs, perf.mjs and settings.mjs: operator port or a session
// with a user. `who` is stamped on the write.
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback' };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), session: s };
}

export const routes = [
  { method: 'GET', path: '/api/features', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try {
      const p = featuresPayload();
      return ctx.send(p.charterError ? 500 : 200, p.charterError ? { ...p, error: p.charterError } : p);
    } catch (e) { return ctx.send(500, { ok: false, error: `feature flags could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/features', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    // fact: a body arrives only through ctx.readJsonBody / the dispatcher passes no `ctx.body` (f2f21d8) (expiry: never, prev: broken)
    const { body: parsed, err } = await new Promise((done) => ctx.readJsonBody(ctx.req, (b, e) => done({ body: b, err: e })));
    if (err) return ctx.send(400, { ok: false, error: err });
    const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    if (!body) return ctx.send(400, { ok: false, error: 'send {"flag": "<id>", "on": true|false}' });
    const extra = Object.keys(body).filter((k) => k !== 'flag' && k !== 'on');
    if (extra.length) return ctx.send(400, { ok: false, error: `unknown field(s): ${extra.join(', ')} — send only flag and on` });
    if (typeof body.flag !== 'string') return ctx.send(400, { ok: false, error: '`flag` must be a flag id' });
    if (typeof body.on !== 'boolean') return ctx.send(400, { ok: false, error: '`on` must be true or false' });

    const st = featureState();
    if (st.charterError) return ctx.send(500, { ok: false, error: st.charterError });
    const f = st.flags.find((x) => x.id === body.flag);
    if (!f) return ctx.send(400, { ok: false, error: `"${body.flag}" is not a flag in manifests/feature-charter.json — known: ${st.flags.map((x) => x.id).join(', ')}` });
    const own = process.env[flagEnvVar(f.id)];
    if (own !== undefined && String(own).trim() !== '') {
      return ctx.send(409, { ok: false, error: `${f.id} is set by ${flagEnvVar(f.id)}=${JSON.stringify(String(own))} — the env wins at read time, so writing the store would change nothing. Unset it first.` });
    }

    const cur = getSetting('experimentalFeatures');
    const base = cur.source === 'store' && cur.value ? cur.value : {};
    const next = { ...base, [f.id]: body.on ? 'on' : 'off' };
    // Sorted, so the same switches produce a byte-identical store.
    const ordered = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
    const r = setSettings({ experimentalFeatures: ordered }, { who: g.who });
    if (!r.ok) return ctx.send(r.code || 400, { ok: false, error: (r.errors || []).join('; ') || 'write refused' });
    return ctx.send(200, { ...featuresPayload(), written: { flag: f.id, state: ordered[f.id], at: r.at, by: r.who } });
  } },
];
