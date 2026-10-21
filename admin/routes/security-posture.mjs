// admin/routes/security-posture.mjs — the agent-security settings as switches: read each one's
// effective value, and set one. Declarations live in monitor/settings.mjs (POSTURE_KEYS); resolution
// in lib/security-posture.mjs.
//
// fact: mounted through admin/routes/features.mjs's `routes`, not MODULAR_ROUTES / moving the spread into admin/serve.mjs is one import (expiry: when serve.mjs registers it, prev: not built)
// fact: a write shadowed by the key's env var is refused 409 / the env wins at read time, so a 200 would change nothing anyone can see (expiry: never, prev: not built)
import { setSettings, SETTING_KEYS } from '../../monitor/settings.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { POSTURE_KEYS, securitySettings, readRefusals, runChecksRootsReview } from '../../lib/security-posture.mjs';

/**
 * WHAT ENFORCES EACH SETTING. A null value means a consumer reads it and acts on it; a string is the
 * reason it does not, and the panel shows that string. bin/hooks/guard-destructive.mjs runs every ask
 * through askOutcome, which reads the first three; mcp/server.mjs reads the run_checks keys.
 * admin/test/security-posture-route.test.mjs asserts this map against the tree, so a consumer that
 * stops calling in cannot leave an "enforced" claim behind.
 */
export const NOT_ENFORCED = Object.freeze({
  unattendedPosture: null,
  bypassCountsAsUnattended: null,
  missingModeIsUnattended: null,
  humanCommitMessagesOnly: null,
  runChecksRoots: null,
  runChecksRepoCode: null,
  runChecksRepoCodeRepos: null,
  runChecksRootsReviewDays: null,
});

/** The guard writes the queue under B and C only. Under off or A an empty list means nothing. */
export const QUEUE_WRITER = Object.freeze({
  wired: true,
  by: 'bin/hooks/guard-destructive.mjs',
  recordsUnder: Object.freeze(['B', 'C']),
  why: 'the guard appends a row for an ask it refuses under posture C and for an unattended ask it lets through under B; under off or A nothing is recorded, so an empty list then does NOT mean nothing was refused or allowed',
});

/** The panel's view: each setting's effective value and source, its declaration, and the C queue's size. */
export function securityPosturePayload({ env = process.env } = {}) {
  const st = securitySettings({ env });
  const q = readRefusals();
  return {
    ok: true,
    storeError: st.storeError,
    settings: st.settings,
    keys: Object.fromEntries(POSTURE_KEYS.map((k) => {
      const s = SETTING_KEYS[k];
      return [k, { label: s.label, description: s.description, unit: s.unit, envVar: s.envVar, default: s.default, options: s.options || null }];
    })),
    queue: {
      path: q.path,
      count: q.entries.length,
      refused: q.entries.filter((e) => e.state === 'refused').length,
      allowed: q.entries.filter((e) => e.state === 'allowed').length,
      error: q.error,
      writer: QUEUE_WRITER,
      recording: QUEUE_WRITER.recordsUnder.includes(st.settings.unattendedPosture.value),
    },
    notEnforced: NOT_ENFORCED,
    rootsReview: runChecksRootsReview(env),
  };
}

// Reading: the operator port or a session with a user, as admin/routes/features.mjs and settings.mjs.
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback' };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), session: s };
}

// Writing: a signed-in person on either port. The posture decides what the guard refuses, and the
// operator port is evidence of origin, not identity: while no account exists the login gate admits
// any local process, so a loopback write would let a session grant its own exceptions.
function writer(ctx) {
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  return s && s.user ? { ok: true, who: sessionWho(s) } : { ok: false };
}
export const WRITE_NEEDS_SESSION = 'changing an agent-security setting needs a signed-in session, on either port; on a box with no operator account, create one first at the operator port';

export const securityPostureRoutes = [
  { method: 'GET', path: '/api/security-posture', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, securityPosturePayload()); }
    catch (e) { return ctx.send(500, { ok: false, error: `security settings could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/security-posture', handle: async (ctx) => {
    const g = writer(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: WRITE_NEEDS_SESSION });
    const { body: parsed, err } = await new Promise((done) => ctx.readJsonBody(ctx.req, (b, e) => done({ body: b, err: e })));
    if (err) return ctx.send(400, { ok: false, error: err });
    const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    if (!body) return ctx.send(400, { ok: false, error: 'send {"key": "<setting>", "value": <value>}' });
    const extra = Object.keys(body).filter((k) => k !== 'key' && k !== 'value');
    if (extra.length) return ctx.send(400, { ok: false, error: `unknown field(s): ${extra.join(', ')} — send only key and value` });
    if (!POSTURE_KEYS.includes(body.key)) return ctx.send(400, { ok: false, error: `"${body.key}" is not a security setting — known: ${POSTURE_KEYS.join(', ')}` });
    if (!Object.prototype.hasOwnProperty.call(body, 'value')) return ctx.send(400, { ok: false, error: '`value` is required' });
    const envVar = SETTING_KEYS[body.key].envVar;
    const own = process.env[envVar];
    if (own !== undefined && String(own).trim() !== '') {
      return ctx.send(409, { ok: false, error: `${body.key} is set by ${envVar}=${JSON.stringify(String(own))} — the env wins at read time, so writing the store would change nothing. Unset it first.` });
    }
    const r = setSettings({ [body.key]: body.value }, { who: g.who });
    if (!r.ok) return ctx.send(r.code || 400, { ok: false, error: (r.errors || []).join('; ') || 'write refused' });
    return ctx.send(200, { ...securityPosturePayload(), written: { key: body.key, value: r.written[body.key], at: r.at, by: r.who } });
  } },
];
