// monitor/llm-runtime.mjs — the operator's LLM runtime posture: which declared hosts are turned
// ON, which model each is pinned to, and which host+model fills each evaluation role.
//
// EVERY RUNNER IS OFF UNTIL SWITCHED ON, host by host. Operator ruling 2026-08-27, security-first.
// The argument lives in manifests/llm-hosts.json rather than here: `localai`, `vllm` and `sglang`
// bind 0.0.0.0 by DEFAULT, so merely starting one publishes an unauthenticated generation endpoint
// to the LAN, and four of the seven declared hosts will fetch a model when asked for an id they do
// not have. Auto-probing and auto-selecting whatever answers turns "I started a server to try
// something" into "the panel is talking to it".
//
// The display corollary is a rule, not a preference, and it is the reason this module returns a
// distinct state rather than an empty list: **DISABLED must never render as "no local LLM
// detected"**. Those are the same two things this repo refuses to conflate everywhere else — an
// absence of evidence and a measured negative.
//
// Loaded FAIL-CLOSED: a corrupt or invalid store throws. Only a genuinely absent file resolves to
// the safe baseline, which is everything off.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLlmHosts, baseUrlFor } from './llm-hosts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Read at CALL time. A `const` populated at import defeats any test override set afterwards.
export const posturePath = () =>
  process.env.CW_LLM_RUNTIME || join(HERE, 'llm-runtime.json');

/** The safe baseline: nothing on, nothing selected, no role filled, nothing off-loopback. */
export const DEFAULT_POSTURE = Object.freeze({
  enabled: false,
  hosts: Object.freeze({}),
  roles: Object.freeze({ a: null, b: null, adjudicator: null }),
  allowNonLoopback: Object.freeze({}),
});

export const ROLES = ['a', 'b', 'adjudicator'];

// ── reach ──────────────────────────────────────────────────────────────────────────────────────
// Operator ruling 2026-08-27: local first, LAN second, hosted third.
//
// Reach is COMPUTED from the resolved URL, never declared per host, because it is not a property of
// the software. The same llama.cpp is `local` on 127.0.0.1 and `lan` on 192.168.1.5; a declared
// field would keep saying `local` after someone pointed the override at another machine, and the
// role that says "prefer local" would then be preferring a network hop while claiming otherwise.
export const REACH_ORDER = ['local', 'lan', 'hosted'];

const PRIVATE_V4 =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** `local` | `lan` | `hosted` for a base URL. */
export function reachOf(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // An unparseable URL is not quietly "hosted" — it is unknown, and unknown must not sort as if
    // it were the least-preferred known thing. Callers treat null as unusable.
    return null;
  }
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.startsWith('127.')) return 'local';
  if (h.endsWith('.local') || h.endsWith('.internal')) return 'lan';
  if (PRIVATE_V4.test(h)) return h.startsWith('127.') ? 'local' : 'lan';
  // fc00::/7 — unique local addresses
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return 'lan';
  if (/^fe80:/i.test(h)) return 'lan';
  return 'hosted';
}

export const reachRank = (reach) => {
  const i = REACH_ORDER.indexOf(reach);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

// ── loopback unless specifically allowed ───────────────────────────────────────────────────────
// Operator ruling 2026-08-27. A declared host is usable only when its RESOLVED url is loopback,
// unless the operator has allowed that host off-loopback explicitly and persistently.
//
// THE ALLOW IS PINNED TO A URL, NOT TO A HOST, and that is the whole point of it. `allowNonLoopback`
// stores the exact url that was agreed to. An override is a moving target — the same host id can be
// pointed at 192.168.1.5 today and a public address tomorrow — so a per-host boolean would silently
// carry consent granted for a machine on your desk over to one on the internet. Changing the url
// revokes the allow and the host is blocked again until it is re-agreed.
//
// This is deliberately NOT a network check. It reasons about the address the fleet was configured
// to call, which is the thing an operator can see and decide about; it cannot know what that address
// resolves to at the far end, and it does not pretend to.

/** Why a host may not be used, or null when it may. */
export function blockedReason(host, posture) {
  const reach = reachOf(host.url);
  if (reach === 'local') return null;
  if (reach === null) {
    return `its configured address (${host.url}) could not be parsed, so it cannot be shown to be loopback`;
  }
  const allowedUrl = (posture.allowNonLoopback || {})[host.id];
  if (!allowedUrl) {
    return `it is configured at a ${reach} address (${host.url}) and has not been allowed off loopback`;
  }
  if (allowedUrl !== host.url) {
    // The case a per-host boolean would have missed.
    return `it was allowed off loopback at ${allowedUrl}, but is now configured at ${host.url} — ` +
      'consent for one address is not consent for another';
  }
  return null;
}

// ── the store ──────────────────────────────────────────────────────────────────────────────────

export function validatePosture(doc, decl = loadLlmHosts()) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push('llm runtime posture is not an object');
    return { errors };
  }
  if (typeof doc.enabled !== 'boolean') errors.push('enabled must be a boolean');

  const declaredIds = new Set(decl.hosts.map((h) => h.id));
  const hosts = doc.hosts || {};
  if (typeof hosts !== 'object' || Array.isArray(hosts)) {
    errors.push('hosts must be an object keyed by host id');
  } else {
    for (const [id, cfg] of Object.entries(hosts)) {
      // A posture naming a host the declaration does not have is not ignorable: it is either a typo
      // that silently leaves a runner off, or a leftover from a host that was removed, and both
      // read as "configured" to whoever wrote it.
      if (!declaredIds.has(id)) errors.push(`hosts.${id} is not a declared host`);
      if (!cfg || typeof cfg !== 'object') { errors.push(`hosts.${id} is not an object`); continue; }
      if (typeof cfg.enabled !== 'boolean') errors.push(`hosts.${id}.enabled must be a boolean`);
      if (cfg.model != null && typeof cfg.model !== 'string') errors.push(`hosts.${id}.model must be a string or null`);
    }
  }

  const allow = doc.allowNonLoopback || {};
  if (typeof allow !== 'object' || Array.isArray(allow)) {
    errors.push('allowNonLoopback must be an object keyed by host id');
  } else {
    for (const [id, url] of Object.entries(allow)) {
      if (!declaredIds.has(id)) errors.push(`allowNonLoopback.${id} is not a declared host`);
      // A boolean here is the shape this deliberately refuses: consent is for an ADDRESS.
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        errors.push(`allowNonLoopback.${id} must be the exact URL that was allowed, not ${JSON.stringify(url)}`);
      }
    }
  }

  const roles = doc.roles || {};
  for (const role of ROLES) {
    const r = roles[role];
    if (r == null) continue;
    if (typeof r !== 'object') { errors.push(`roles.${role} must be an object or null`); continue; }
    if (!declaredIds.has(r.host)) errors.push(`roles.${role}.host "${r.host}" is not a declared host`);
    if (typeof r.model !== 'string' || !r.model) errors.push(`roles.${role}.model must be a non-empty string`);
  }
  for (const key of Object.keys(roles)) {
    if (!ROLES.includes(key)) errors.push(`roles.${key} is not a role (${ROLES.join(', ')})`);
  }
  return { errors };
}

/** The posture. Absent file ⇒ safe baseline. Corrupt or invalid ⇒ throws. */
export function loadPosture(path = posturePath(), decl = loadLlmHosts()) {
  if (!existsSync(path)) return DEFAULT_POSTURE;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    // Not a fall-through to DEFAULT_POSTURE. The baseline is everything-off, so degrading to it on
    // a parse error would look identical to a deliberate all-off posture — the operator would see
    // their configuration silently unapplied and no sign that anything was wrong.
    throw new Error(
      `llm-runtime: ${path} is unreadable (${e.message}) — refusing to fall back to the all-off ` +
        'baseline, which is indistinguishable from a working configuration that is simply off'
    );
  }
  const { errors } = validatePosture(doc, decl);
  if (errors.length) throw new Error(`llm-runtime: ${path} is invalid:\n  ${errors.join('\n  ')}`);
  return Object.freeze({
    enabled: doc.enabled,
    hosts: Object.freeze(doc.hosts || {}),
    roles: Object.freeze({ a: null, b: null, adjudicator: null, ...(doc.roles || {}) }),
    allowNonLoopback: Object.freeze(doc.allowNonLoopback || {}),
  });
}

/**
 * Hosts the operator has actually switched on, with their reach and pinned model.
 *
 * Empty when the master switch is off — and the CALLER must say which of the two it is. That is
 * why `postureOf` exists rather than this returning some sentinel: a list is a bad place to carry
 * the difference between "off" and "none".
 */
export function activeHosts(posture = loadPosture(), decl = loadLlmHosts()) {
  if (!posture.enabled) return [];
  return switchedOnHosts(posture, decl).filter((h) => !h.blocked);
}

/**
 * Hosts the operator switched on, INCLUDING ones blocked for being off loopback.
 *
 * Blocked hosts are returned rather than filtered away because "switched on but refused" is a
 * third state, and an operator who turned something on and sees it simply absent will conclude the
 * toggle did not work. `activeHosts` is the usable subset; this is the honest full list.
 */
export function switchedOnHosts(posture = loadPosture(), decl = loadLlmHosts()) {
  return decl.hosts
    .filter((h) => posture.hosts[h.id] && posture.hosts[h.id].enabled)
    .map((h) => {
      const url = baseUrlFor(h.id, decl);
      const row = { ...h, url, reach: reachOf(url), model: posture.hosts[h.id].model || null };
      const why = blockedReason(row, posture);
      return { ...row, blocked: why !== null, blockedReason: why };
    });
}

/** The three-way state a consumer must render distinctly. */
export function postureOf(posture = loadPosture(), decl = loadLlmHosts()) {
  if (!posture.enabled) {
    return {
      state: 'disabled',
      why: 'local model runners are switched off — enable them per host in Settings',
    };
  }
  const all = switchedOnHosts(posture, decl);
  const active = all.filter((h) => !h.blocked);
  const blocked = all.filter((h) => h.blocked);
  if (!all.length) {
    return {
      state: 'none-enabled',
      why: 'runners are allowed, but no individual host has been switched on yet',
      blocked: [],
    };
  }
  if (!active.length) {
    // Switched on and every one refused. Reporting this as `none-enabled` would tell an operator
    // who enabled three hosts that they had enabled nothing.
    return {
      state: 'all-blocked',
      why: `every switched-on host is refused: ${blocked.map((h) => `${h.label} — ${h.blockedReason}`).join('; ')}`,
      blocked: blocked.map((h) => ({ id: h.id, label: h.label, url: h.url, reason: h.blockedReason })),
    };
  }
  return {
    state: 'enabled',
    hosts: active,
    // Carried even on success: a partially-refused set must not look like a whole one.
    blocked: blocked.map((h) => ({ id: h.id, label: h.label, url: h.url, reason: h.blockedReason })),
  };
}

/**
 * The host+model a role should use, preferring local, then LAN, then hosted.
 *
 * Only ever chooses among hosts the operator switched on AND pinned a model for: a default that
 * reaches for something unconfigured is how "off by default" quietly stops being true.
 */
export function defaultForRole(posture = loadPosture(), decl = loadLlmHosts()) {
  const candidates = activeHosts(posture, decl)
    .filter((h) => h.model && h.reach)
    .sort((a, b) => reachRank(a.reach) - reachRank(b.reach) || a.id.localeCompare(b.id));
  if (!candidates.length) return null;
  const pick = candidates[0];
  return { host: pick.id, model: pick.model, reach: pick.reach };
}

/** Resolved role assignments: the explicit pin if set, else the reach-ordered default. */
export function resolveRoles(posture = loadPosture(), decl = loadLlmHosts()) {
  const fallback = defaultForRole(posture, decl);
  const out = {};
  for (const role of ROLES) {
    const pinned = posture.roles[role];
    if (pinned) {
      const url = baseUrlFor(pinned.host, decl);
      out[role] = { ...pinned, reach: reachOf(url), source: 'pinned' };
    } else {
      out[role] = fallback ? { ...fallback, source: 'default' } : null;
    }
  }
  return out;
}
