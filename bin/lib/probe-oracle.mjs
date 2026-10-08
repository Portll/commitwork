/**
 * Cross-cutting ORACLE DISCIPLINE for the off-box probe lane (WORKLIST §A). Shared, side-effect-free
 * helpers the probes import so the four rules a probe cannot be trusted without live in ONE place,
 * not copied per lane.
 *
 * APPLIED BY: bin/authz-bola.mjs. NOT YET APPLIED BY: bin/bola-run.mjs — the manifest-driven runner
 * imports none of this (measured 2026-08-28: zero references). This header used to name it as an
 * importer, which is the failure this module exists to prevent, one level up: a stated discipline
 * nothing enforces reads as coverage. Until bola-run adopts positiveControl/responseContainsCanary,
 * its verdicts carry no positive control and no canary confirmation, and that is a declared gap
 * rather than a silent one (BACKLOG-commitwork.md).
 *
 *   1. POSITIVE CONTROL   — no negative verdict without a 2xx AUTHORIZED baseline. A 401/403 from an
 *                           edge WAF is indistinguishable from real authorization; a blocked probe
 *                           then reads as "control present" when nothing authorized anything.
 *   2. PLANTED CANARY     — a leak is confirmed ONLY by a unique marker planted in tenant B's object,
 *                           never by a 2xx and never by content-matching (a hostile target returns a
 *                           B-shaped decoy to either side).
 *   3. READ/WRITE SPLIT   — write-class probes (state-replay, mass-assignment) MUTATE a system we do
 *                           not own; they are DEFERRED behind a destructive-probe authorization + a
 *                           dry-run. Read-class ships now.
 *   4. VERIFIED CONSENT   — a non-fleet target needs a published VDP/security.txt authorizing testing
 *                           in scope, bound to the probe origin; self-asserted consent authorises only
 *                           fleet-owned areas.
 *
 * House invariant: unmeasured is neither pass nor finding — a probe that could not run emits a VOID (state
 * 'void'), never a clean pass and never a finding. Fail closed. Determinism: CW_NOW is read at CALL
 * time, never at module load. Zero runtime deps (node:crypto only).
 */
import { randomBytes, createHash } from 'node:crypto';

// fix: read CW_NOW at CALL time so a test that sets it after import still overrides the clock.
export function now() {
  const raw = process.env.CW_NOW;
  if (raw) {
    const iso = Date.parse(raw);
    if (Number.isFinite(iso)) return iso;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

const is2xx = (s) => Number(s) >= 200 && Number(s) < 300;

// fix: unmeasured is neither pass nor finding — the ONE void constructor. state:'void' is neither a finding nor
// a clean pass; `code` is a stable machine token; `reason` is a full sentence a reader can act on.
export function probeVoid(code, reason, extra = {}) {
  return { state: 'void', ok: false, code, reason, ...extra };
}

// ── Rule 1 · positive control ────────────────────────────────────────────────────────────────────
// fix: confirm the AUTHORIZED baseline is 2xx before any "no leak / control present" verdict.
export function positiveControl(baseline) {
  const status = (baseline && baseline.status) || 0;
  if (is2xx(status)) return { state: 'ok', ok: true, status };
  return probeVoid('no-positive-control',
    `authorized baseline did not succeed (HTTP ${status || 'unreachable'}) — a 401/403 here is indistinguishable from an edge WAF blocking the request, so any "no leak" or "control present" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.`,
    { status });
}

// ── Rule 2 · planted canary ──────────────────────────────────────────────────────────────────────
// fix: the marker planted in tenant B's object. Deterministic from a seed (tests / re-runs are
// byte-identical); unpredictable otherwise — a guessable canary is one the target can pre-echo.
export function plantCanary(seed) {
  const token = seed != null
    ? createHash('sha256').update(String(seed)).digest('hex').slice(0, 24)
    : randomBytes(12).toString('hex');
  return `cw-canary-${token}`;
}

// fix: the oracle — does the response LITERALLY contain the planted marker? Not a 2xx, not a content
// match. The canary lives in the owner's object and is absent from the attacker's request, so a bare
// substring test cannot be fooled by a reflected echo.
export function responseContainsCanary(resp, canary) {
  if (!canary) return false;
  const body = resp && (typeof resp.text === 'string' ? resp.text
    : typeof resp.body === 'string' ? resp.body : '');
  return typeof body === 'string' && body.includes(canary);
}

// fix: the composed cross-read verdict — positive control gates the negative, the canary is the ONLY
// confirmation of a leak. Returns leak | clean | void, never a bare boolean.
export function judgeCanaryLeak({ baseline, attackerResp, canary } = {}) {
  const pc = positiveControl(baseline);
  if (pc.state !== 'ok') return pc; // no positive control ⇒ void, never clean
  if (responseContainsCanary(attackerResp, canary))
    return { state: 'leak', ok: true, canary, status: (attackerResp && attackerResp.status) || 0 };
  return { state: 'clean', ok: true, status: pc.status };
}

// ── Rule 3 · read/write split ────────────────────────────────────────────────────────────────────
// fix: which lanes MUTATE the target. Read-class ships now; write-class is deferred behind
// destructive-probe authorization. Unlisted ⇒ 'unknown' ⇒ fail closed (never silently run).
export const PROBE_CLASS = {
  'unauth-exposure': 'read', 'header-trust': 'read', 'cross-tenant-read': 'read',
  'cross-tenant-indeterminate': 'read', bola: 'read', bfla: 'read', 'broken-auth': 'read',
  'cross-tenant': 'read', 'forced-browsing': 'read', 'contract-differential': 'read',
  enumeration: 'read', 'token-lifecycle': 'read', 'scope-confinement': 'read',
  'state-replay': 'write', 'mass-assignment': 'write',
};

export function probeClass(lane) {
  return PROBE_CLASS[lane] || 'unknown';
}

// fix: REFUSE write-class unless a destructive-probe authorization AND a dry-run are BOTH present.
// A read consent authorizes reading; it does not authorize corrupting a system commitwork does not
// own. An unclassified lane is refused too — fail closed.
export function authorizeProbeClass(lane, auth = {}) {
  const cls = probeClass(lane);
  if (cls === 'read') return { state: 'ok', ok: true, cls };
  if (cls === 'unknown')
    return probeVoid('unclassified-lane',
      `lane "${lane}" is not classified read/write — fail closed: an unclassified probe is not run. Add it to PROBE_CLASS.`,
      { cls });
  const authorized = auth.destructiveAuthorized === true;
  const dryRun = auth.dryRun === true;
  if (authorized && dryRun) return { state: 'ok', ok: true, cls, dryRun: true };
  const missing = !authorized && !dryRun ? 'both a destructive-probe authorization and a dry-run'
    : !authorized ? 'a destructive-probe authorization (destructiveAuthorized:true)'
      : 'a dry-run (dryRun:true)';
  return probeVoid('write-class-unauthorized',
    `lane "${lane}" is write-class — it MUTATES the target — and is DEFERRED: it needs ${missing}. Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.`,
    { cls });
}

// ── Rule 4 · verified consent ────────────────────────────────────────────────────────────────────
// fix: fleet ownership is a POSITIVE registry fact — a RESOLVED area whose thirdParty flag is not
// set. A null area (target not in the registry) is a stranger — non-fleet, fail closed.
export function isFleetOwned(area) {
  return !!area && typeof area === 'object' && area.thirdParty !== true;
}

function hostnameOf(u) {
  if (!u) return null;
  const s = String(u).trim();
  try { return new URL(s).hostname.toLowerCase(); } catch { /* not a full URL */ }
  try { return new URL('http://' + s.replace(/^\/+/, '')).hostname.toLowerCase(); } catch { return null; }
}

function scopeToPattern(entry) {
  const t = String(entry || '').trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith('*.')) return t; // wildcard host pattern, kept verbatim
  return hostnameOf(t);
}

function hostMatchesPattern(pattern, host) {
  if (!pattern || !host) return false;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return pattern === host; // exact-match otherwise (rebreaker N1)
}

// fix: parse an RFC 9116 security.txt / VDP. Fields are "Name: value", '#' comments, repeats allowed.
// We read Expires (TTL), Contact (a real VDP has one), Canonical (the host it governs) and Scope (the
// non-standard-but-common in-scope host/URL list).
export function parseSecurityTxt(text) {
  const fields = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z-]*):\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    (fields[key] ||= []).push(m[2].trim());
  }
  const expiresRaw = fields.expires && fields.expires[0];
  const expires = expiresRaw ? Date.parse(expiresRaw) : null;
  return {
    fields,
    contact: fields.contact || [],
    canonical: fields.canonical || [],
    scope: fields.scope || [],
    expires: Number.isFinite(expires) ? expires : null,
    expiresRaw: expiresRaw || null,
  };
}

// fix: a Scope field may list several hosts on one line (comma- or space-separated); flatten first.
function scopeEntries(parsed) {
  const out = [];
  for (const line of parsed.scope) for (const tok of String(line).split(/[\s,]+/).filter(Boolean)) out.push(tok);
  return out;
}

function consentCoversHost(parsed, host, bound) {
  const scopes = scopeEntries(parsed);
  if (scopes.length) return scopes.some((s) => hostMatchesPattern(scopeToPattern(s), host));
  if (parsed.canonical.length) return parsed.canonical.some((c) => hostMatchesPattern(hostnameOf(c), host));
  // No explicit Scope/Canonical: only the served-from-origin binding can vouch for the host (RFC 9116
  // — a security.txt at a host's own well-known governs that host). No binding ⇒ not covered.
  return bound === true;
}

// fix: verified consent (breakers A-BRK-2). Fleet-owned ⇒ self-asserted consent suffices. A non-fleet
// target requires a published VDP/security.txt, IN SCOPE, BOUND to the probe origin (no cross-origin
// redirect — rebreaker N1), NOT EXPIRED (a TTL; sold/expired domains carry stale standing). Else VOID.
//   opts: { area, target, securityTxt, servedFrom }
export function verifyConsent(opts = {}) {
  const { area = null, target = null, securityTxt = null, servedFrom = null } = opts;
  const targetHost = hostnameOf(target);
  if (!targetHost) return probeVoid('consent-no-target', 'no probe target origin to bind consent to.');

  if (isFleetOwned(area))
    return { state: 'ok', ok: true, basis: 'fleet-owned', target: targetHost };

  if (!securityTxt)
    return probeVoid('consent-unverified',
      `target ${targetHost} is not a fleet-owned area, so self-asserted consent does NOT authorize probing it. A non-fleet target requires proof of control: a published security.txt/VDP served at the exact origin and authorizing testing in scope, or an operator co-sign. None supplied — the probe is void.`,
      { target: targetHost });

  // Binding (rebreaker N1): the proof must be SERVED FROM the probe origin. An attacker who controls
  // evil.com must not authorize a probe aimed at victim.com.
  if (servedFrom) {
    const proofHost = hostnameOf(servedFrom);
    if (proofHost && proofHost !== targetHost)
      return probeVoid('consent-cross-origin',
        `the security.txt was served from ${proofHost} but the probe target is ${targetHost} — proof of control must bind to the probe origin (exact host, no cross-origin redirect). Consent for ${proofHost} does not authorize probing ${targetHost}.`,
        { target: targetHost, servedFrom: proofHost });
  }
  const bound = servedFrom ? hostnameOf(servedFrom) === targetHost : false;

  const parsed = parseSecurityTxt(securityTxt);
  if (!parsed.contact.length)
    return probeVoid('consent-no-contact',
      `security.txt at ${targetHost} has no Contact field — it is not a vulnerability-disclosure authorization. Absent an explicit invitation, silence is not consent.`,
      { target: targetHost });

  if (parsed.expires != null && parsed.expires < now())
    return probeVoid('consent-expired',
      `the security.txt authorizing ${targetHost} expired ${parsed.expiresRaw} (now ${new Date(now()).toISOString()}) — consent carries a TTL and re-verifies; stale standing is void.`,
      { target: targetHost, expiresRaw: parsed.expiresRaw });

  if (!consentCoversHost(parsed, targetHost, bound))
    return probeVoid('consent-out-of-scope',
      `target ${targetHost} is not within the scope authorized by its security.txt (scope: ${parsed.scope.join(', ') || '(none declared)'}; canonical: ${parsed.canonical.join(', ') || '(none)'}; served-from binding: ${bound ? 'yes' : 'no'}). An authorization for other hosts does not authorize this one.`,
      { target: targetHost, scope: parsed.scope, canonical: parsed.canonical });

  return { state: 'ok', ok: true, basis: 'verified-vdp', target: targetHost, expiresRaw: parsed.expiresRaw };
}
