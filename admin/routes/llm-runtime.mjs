// admin/routes/llm-runtime.mjs — read/write which local runners are switched on, which model each
// is pinned to, and which host+model fills each evaluation role.
//
// Enabling a runner is an ESCALATION and this route treats it as one, in two different ways
// depending on what is being escalated.
//
// LOOPBACK IS ENFORCED, NOT WARNED ABOUT. A host whose resolved address is not loopback is REFUSED
// at the door unless the operator has allowed that exact address, and the refusal names it. Storing
// an enable that will never take effect would be the worst of both: the toggle reads as set, the
// panel shows the host on, and nothing ever calls it.
//
// EXPOSURE IS WARNED ABOUT, NOT REFUSED. Three of the seven declared hosts bind 0.0.0.0 by default
// and four fetch a model on demand, so turning one on can publish an unauthenticated endpoint to
// the LAN or turn a request into egress. Per-host selection is the operator's to make, so the route
// accepts it and NAMES what was authorised rather than blocking it.
//
// The split is deliberate: the first is about where this fleet sends traffic, which is ours to
// constrain; the second is about what the operator chooses to run on their own machine, which is
// not.
//
// Same 400/401/409/503 ladder as remediation-policy, and the same read-hash-compare-write lock:
// writeJSONAtomic prevents a torn file, not a lost update.

import { requireSession } from '../lib/route-auth.mjs';
import { existsSync, readFileSync } from 'node:fs';
import {
  posturePath, loadPosture, validatePosture, resolveRoles, postureOf, reachOf, blockedReason,
  ROLES, REACH_ORDER,
} from '../../monitor/llm-runtime.mjs';
import { loadLlmHosts, baseUrlFor } from '../../monitor/llm-hosts.mjs';
import { writeJSONAtomic, sha256 } from '../../cra/lib.mjs';
import { acquireLock } from '../../monitor/lockfile.mjs';

function withPostureLock(path, fn) {
  const held = acquireLock(`${path}.lock`, {
    staleMs: 30_000, label: 'llm-runtime', attempts: 50, spinMs: 20,
    onStale: (ageMs) => console.warn(`[llm-runtime] breaking a stale lock (${Math.round(ageMs / 1000)}s old)`),
  });
  if (!held.ok) return { locked: true };
  try { return { locked: false, value: fn() }; } finally { held.release(); }
}

/** Declared hosts with the facts the operator needs to decide, including the live reach. */
function hostCatalogue() {
  const decl = loadLlmHosts();
  return decl.hosts.map((h) => {
    const url = baseUrlFor(h.id, decl);
    return {
      id: h.id,
      label: h.label,
      url,
      // Computed, never declared: the same binary is `local` on loopback and `lan` once the
      // override points at another machine, and a role that claims to prefer local must not be
      // preferring a network hop.
      reach: reachOf(url),
      capabilities: h.capabilities,
      licence: h.licence,
      openSource: h.openSource,
      portIsShared: h.portIsShared,
      bindsAllInterfacesByDefault: h.bindsAllInterfacesByDefault,
      fetchesModelsOnDemand: h.fetchesModelsOnDemand,
      exposureNote: h.exposureNote || null,
    };
  });
}

export const routes = [
  // GET — the catalogue, the current posture, resolved roles, and the content hash to write back
  { method: 'GET', path: '/api/llm/runtime', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    let posture;
    try { posture = loadPosture(); } catch (e) { return send(503, { ok: false, error: e.message }); }
    const p = posturePath();
    return send(200, {
      ok: true,
      posture,
      state: postureOf(posture),
      roles: resolveRoles(posture),
      hosts: hostCatalogue(),
      reachOrder: REACH_ORDER,
      roleNames: ROLES,
      hash: existsSync(p) ? sha256(readFileSync(p, 'utf8')) : null,
    });
  } },

  // PUT — replace the posture. Requires the hash the client read, so two panels cannot clobber.
  { method: 'PUT', path: '/api/llm/runtime', handle: async (ctx) => {
    const { send, readJsonBody } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });

    let body;
    try { body = await readJsonBody(); } catch { return send(400, { ok: false, error: 'body is not JSON' }); }
    if (!body || typeof body !== 'object') return send(400, { ok: false, error: 'body must be an object' });

    const decl = loadLlmHosts();
    const next = {
      enabled: body.enabled === true,
      hosts: body.hosts && typeof body.hosts === 'object' ? body.hosts : {},
      roles: body.roles && typeof body.roles === 'object' ? body.roles : {},
      allowNonLoopback: body.allowNonLoopback && typeof body.allowNonLoopback === 'object' ? body.allowNonLoopback : {},
    };
    const { errors } = validatePosture(next, decl);
    if (errors.length) return send(400, { ok: false, error: errors.join('; ') });

    // REFUSE the write rather than accept it and quietly refuse to use the host. Storing an enable
    // that will never take effect is the worst of both: the operator sees their toggle set, the
    // panel shows the host on, and nothing ever calls it. Say no at the door, and say why.
    const refused = decl.hosts
      .filter((h) => next.hosts[h.id] && next.hosts[h.id].enabled)
      .map((h) => ({ h, why: blockedReason({ ...h, url: baseUrlFor(h.id, decl) }, next) }))
      .filter((r) => r.why);
    if (next.enabled && refused.length) {
      return send(400, {
        ok: false,
        error: `refused: ${refused.map((r) => `${r.h.label} cannot be enabled because ${r.why}`).join('; ')}`,
        // The client needs the exact string to offer a one-click allow, and offering the URL the
        // server resolved (not the one the client guessed) is what keeps consent and enforcement
        // talking about the same address.
        allowable: refused.map((r) => ({ id: r.h.id, url: baseUrlFor(r.h.id, decl) })),
      });
    }

    const p = posturePath();
    const res = withPostureLock(p, () => {
      const current = existsSync(p) ? readFileSync(p, 'utf8') : null;
      const currentHash = current ? sha256(current) : null;
      if ((body.hash ?? null) !== currentHash) {
        return { conflict: true, currentHash };
      }
      writeJSONAtomic(p, next);
      return { conflict: false };
    });
    if (res.locked) return send(409, { ok: false, error: 'another write is in progress' });
    if (res.value.conflict) {
      return send(409, {
        ok: false,
        error: 'the posture changed since you read it — reload and reapply',
        hash: res.value.currentHash,
      });
    }

    // Name what was just authorised. A per-host switch that turns on a 0.0.0.0-binding server or
    // one that fetches weights on demand is a different act from turning on a loopback-only one,
    // and the operator should see which they did — after the fact at minimum.
    const turnedOn = decl.hosts.filter((h) => next.hosts[h.id] && next.hosts[h.id].enabled);
    const warnings = [];
    if (next.enabled) {
      for (const h of turnedOn) {
        const allowedUrl = (next.allowNonLoopback || {})[h.id];
        if (allowedUrl) {
          warnings.push(`${h.label} is allowed OFF LOOPBACK at ${allowedUrl} — traffic leaves this machine, and the consent is pinned to that exact address`);
        }
        if (h.bindsAllInterfacesByDefault) {
          warnings.push(`${h.label} binds all interfaces by default — starting it publishes an unauthenticated endpoint to the LAN`);
        }
        if (h.fetchesModelsOnDemand) {
          warnings.push(`${h.label} fetches models on demand — a request naming an unknown model id can cause a download`);
        }
      }
    }

    const saved = loadPosture(p, decl);
    return send(200, {
      ok: true,
      posture: saved,
      state: postureOf(saved, decl),
      roles: resolveRoles(saved, decl),
      warnings,
      hash: sha256(readFileSync(p, 'utf8')),
    });
  } },
];
