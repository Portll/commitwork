#!/usr/bin/env node
/**
 * commitwork BOLA / IDOR / tenant-isolation probe against a RUNNING gateway.
 *
 * Two failure modes it hunts, grounded in the live OpenAPI (/v3/api-docs):
 *   unauth-exposure  an object-level endpoint returns 2xx + a body with NO auth (IDOR/missing authz)
 *   header-trust     the gateway acts on a client-supplied X-Tenant-Id — responses differ (or 2xx)
 *                    when only the forged tenant header changes = the classic multi-tenant BOLA
 *
 * This is the runnable, unauthenticated slice. A full matrix (tenant-A token + X-Tenant-Id=tenant-B)
 * needs working Keycloak realms/tokens; when those exist, pass CW_BEARER_A / CW_BEARER_B and the
 * probe upgrades to the authenticated cross-tenant test.
 *
 * usage: node authz-bola.mjs [baseURL]        (target = argv or $CW_TARGET_URL — there is NO default:
 *                                             a probe that invents its own target attacks whatever
 *                                             happens to be listening, and reports on the wrong app)
 * Emits JSON to stdout.
 */
// Shared with the generic runner so the "did this hand over an object?" judgement cannot drift.
// See bola-run.mjs for why raw body length is the wrong test.
import { disclosesObject } from './bola-run.mjs';
// Cross-cutting oracle discipline (WORKLIST §A): positive control gates every negative verdict, a
// planted canary is the ONLY confirmation of a leak. Shared so a new lane cannot forget them.
import { positiveControl, responseContainsCanary } from './lib/probe-oracle.mjs';

const base = (process.argv[2] || process.env.CW_TARGET_URL || '').replace(/\/$/, '');
const A = process.env.CW_BEARER_A || null;
const B = process.env.CW_BEARER_B || null;
const TA = process.env.CW_TENANT_A || 'aaaaaaaa-0000-0000-0000-000000000001';
const TB = process.env.CW_TENANT_B || 'bbbbbbbb-0000-0000-0000-000000000002';
// A marker planted OUT-OF-BAND in each tenant's object; when set, the leak test upgrades from
// byte-identity (defeatable by a decoy) to "the attacker's response contains B's unique marker".
const CANARY_A = process.env.CW_BOLA_CANARY_A || null;
const CANARY_B = process.env.CW_BOLA_CANARY_B || null;

// A probe that could not run emits a VOID, never a verdict — an empty findings[] must not read
// as clean. Skip shape is repeated inside `summary` because the panel/rollup read summary.verdict.
// Exit 0: a void is not a tool failure.
const skip = (reason) => {
  process.stdout.write(`${JSON.stringify({
    tool: 'authz-bola', ran: false, skipped: true, reason,
    summary: { base: base || null, ran: false, skipped: true, reason, endpointsProbed: 0, findings: 0,
      verdict: `NOT RUN — ${reason}` },
    findings: [], tested: [],
  }, null, 2)}\n`);
  process.exit(0);
};
if (!base) skip('no target: pass a base URL or set CW_TARGET_URL (there is no default — probing localhost would attack an unrelated service and file its posture under this repo)');

const get = async (path, headers = {}) => {
  try {
    const r = await fetch(base + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const body = await r.text().catch(() => '');
    return { status: r.status, len: body.length, ct: r.headers.get('content-type') || '', text: body };
  } catch (e) { return { status: 0, len: 0, text: '', err: String(e).slice(0, 80) }; }
};

async function discover() {
  // The spec is itself auth-gated, so discovery must present the bearer too; no token = no header.
  const specHeaders = A ? { Authorization: `Bearer ${A}` } : {};
  for (const p of ['/v3/api-docs', '/v3/api-docs/swagger-config', '/swagger-resources']) {
    try {
      const r = await fetch(base + p, { headers: specHeaders, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const spec = await r.json();
      if (spec.paths) {
        const obj = [], coll = [];
        for (const [path, ops] of Object.entries(spec.paths)) {
          if (!ops.get) continue;
          const concrete = path.replace(/\{[^}]+\}/g, '1'); // substitute a probe id
          (/\{[^}]+\}/.test(path) ? obj : coll).push(concrete);
        }
        return { specAt: p, object: obj, collection: coll };
      }
    } catch { /* next */ }
  }
  return { specAt: null, object: [], collection: [] };
}

// Same token for both tenants makes every "cross-tenant" request a same-tenant one, fabricating a
// CRITICAL finding — so SAME_IDENTITY suppresses the matrix at the point the finding is created.
const AUTHED = Boolean(A && B);
const SAME_IDENTITY = AUTHED && A === B;
const findings = [];
const tested = [];

const spec = await discover();
// prefer object-level endpoints (the BOLA surface); fall back to collections
let candidates = [...spec.object, ...spec.collection].slice(0, 20);
// Never guess a path list — a guessed path 404s and reports false clean. Name paths via
// CW_BOLA_PATHS, or record a coverage void.
if (!candidates.length) {
  const named = (process.env.CW_BOLA_PATHS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!named.length) {
    skip(`no object-level endpoints to probe — ${spec.specAt
      ? `the OpenAPI at ${base}${spec.specAt} declares no GET paths`
      : `no OpenAPI reachable at ${base} (tried /v3/api-docs, /v3/api-docs/swagger-config, /swagger-resources)${A ? '' : '; the spec may be auth-gated — set CW_BEARER_A'}`
    }. Set CW_BOLA_PATHS=/a,/b/{id} to name this app's object paths; the probe will not guess them.`);
  }
  candidates = named;
}

const ok = (s) => s >= 200 && s < 300;
for (const path of candidates) {
  const noAuth = await get(path);
  // Legitimate baselines: each identity uses its own token + tenant.
  const hdrA = await get(path, AUTHED ? { Authorization: `Bearer ${A}`, 'X-Tenant-Id': TA } : { 'X-Tenant-Id': TA });
  const hdrB = await get(path, AUTHED ? { Authorization: `Bearer ${B}`, 'X-Tenant-Id': TB } : { 'X-Tenant-Id': TB });
  // CROSS probe: A's token reaching for B's tenant, and B's for A's — the real BOLA test.
  const crossAB = AUTHED ? await get(path, { Authorization: `Bearer ${A}`, 'X-Tenant-Id': TB }) : { status: 0, len: 0 };
  const crossBA = AUTHED ? await get(path, { Authorization: `Bearer ${B}`, 'X-Tenant-Id': TA }) : { status: 0, len: 0 };
  tested.push({ path, noAuth: noAuth.status, tenantA: hdrA.status, tenantB: hdrB.status, lenA: hdrA.len, lenB: hdrB.len,
    ...(AUTHED && { crossAB: crossAB.status, crossBA: crossBA.status, crossABLen: crossAB.len, crossBALen: crossBA.len }) });

  if (disclosesObject(noAuth))
    findings.push({ type: 'unauth-exposure', severity: 'high', path, detail: `2xx (${noAuth.len}B) with no authentication` });
  // Cross-tenant read: WHOSE body came back, not merely whether one did. A leak requires the
  // attacker to have received the OWNER's body and NOT its own — "answered" is not "leaked".
  const norm = (r) => String(r && r.text || '').replace(/\s+/g, ' ').trim();
  // Byte-identical baselines make a leak indistinguishable from correct behaviour: a VOID, not a pass.
  const baselinesDiffer = norm(hdrA) !== norm(hdrB);
  const leaked = (attacker, owner, self) =>
    disclosesObject(attacker) && disclosesObject(owner)
    && baselinesDiffer
    && norm(attacker) === norm(owner)     // the attacker received the OWNER's body
    && norm(attacker) !== norm(self);     // ...and not a copy of its own
  // A planted canary is decisive where byte-identity is not: a hostile target can serve a B-shaped
  // decoy, but it cannot fabricate B's UNIQUE marker in A's response. Preferred when the operator
  // planted one (CW_BOLA_CANARY_*); byte-identity remains the fallback so behaviour is unchanged when
  // no canary is set. The attacker's request never carries the marker, so a substring test is sound.
  const canaryAB = Boolean(CANARY_B) && responseContainsCanary(crossAB, CANARY_B);
  const canaryBA = Boolean(CANARY_A) && responseContainsCanary(crossBA, CANARY_A);
  if (AUTHED && !SAME_IDENTITY && (canaryAB || leaked(crossAB, hdrB, hdrA)))
    findings.push({ type: 'cross-tenant-read', severity: 'critical', path, direction: 'A->B', detail: canaryAB
      ? `tenant A's token returned tenant B's PLANTED CANARY (${crossAB.len}B, HTTP ${crossAB.status}) — confirmed cross-tenant read (canary oracle)`
      : `tenant A's token returned tenant B's OWN body byte-for-byte (${crossAB.len}B, HTTP ${crossAB.status}) — BOLA` });
  if (AUTHED && !SAME_IDENTITY && (canaryBA || leaked(crossBA, hdrA, hdrB)))
    findings.push({ type: 'cross-tenant-read', severity: 'critical', path, direction: 'B->A', detail: canaryBA
      ? `tenant B's token returned tenant A's PLANTED CANARY (${crossBA.len}B, HTTP ${crossBA.status}) — confirmed cross-tenant read (canary oracle)`
      : `tenant B's token returned tenant A's OWN body byte-for-byte (${crossBA.len}B, HTTP ${crossBA.status}) — BOLA` });
  // Void emitted only where the matrix could otherwise have fired.
  if (AUTHED && !SAME_IDENTITY && !baselinesDiffer && disclosesObject(hdrA) && disclosesObject(crossAB))
    findings.push({ type: 'cross-tenant-indeterminate', severity: 'medium', path,
      detail: `tenants A and B receive IDENTICAL content at this path (${hdrA.len}B), so a cross-tenant read cannot be distinguished from correct behaviour here — this is a coverage void, not a pass. Point CW_BOLA_PATHS at an object-level path whose content differs per tenant.` });
  // header-trust: only the forged X-Tenant-Id differs; a data difference or a 2xx-on-forged-header is the signal
  if (!AUTHED && ok(hdrA.status) && ok(hdrB.status) && hdrA.len !== hdrB.len)
    findings.push({ type: 'header-trust', severity: 'high', path, detail: `response body differs by tenant header only (A=${hdrA.len}B vs B=${hdrB.len}B) — unauthenticated` });
  else if (!AUTHED && ok(hdrA.status) && noAuth.status === 401)
    findings.push({ type: 'header-trust', severity: 'high', path, detail: `unauthenticated request becomes 2xx once X-Tenant-Id is supplied (gateway trusts the header)` });
}

// Positive control (WORKLIST §A, RPN 320): an AUTHED "no leak" verdict is only honest if at least one
// endpoint's AUTHORIZED baseline returned 2xx. If every legitimate request was itself blocked (an edge
// WAF 401 is indistinguishable from real authz), "no cross-tenant leak" is unsupported finding — emit
// the void. The shared oracle owns the 2xx bar so it cannot drift per lane.
const baselineOkFor = (t) => positiveControl({ status: t.tenantA }).ok || positiveControl({ status: t.tenantB }).ok;
const authedBaselineOk = AUTHED && tested.some(baselineOkFor);
// pathSource makes the verdict auditable: 'openapi' (enumerated) or 'CW_BOLA_PATHS' (operator-named).
const summary = {
  base, ran: true, specAt: spec.specAt, pathSource: spec.specAt ? 'openapi' : 'CW_BOLA_PATHS',
  mode: SAME_IDENTITY ? 'authenticated, but CW_BEARER_A and CW_BEARER_B are IDENTICAL — cross-tenant matrix cannot run'
    : AUTHED ? 'authenticated cross-tenant' : 'unauthenticated (forged-header) — set CW_BEARER_A/B for full matrix',
  endpointsProbed: tested.length, findings: findings.length,
  positiveControl: AUTHED ? authedBaselineOk : null,
  bySeverity: ['critical', 'high', 'medium'].reduce((a, s) => (a[s] = findings.filter((f) => f.severity === s).length, a), {}),
  // SAME_IDENTITY gets its own verdict: a "no leak" claim about a matrix that could not run is false-clean.
  verdict: findings.length ? 'POTENTIAL BOLA/IDOR — review'
    : SAME_IDENTITY ? 'cross-tenant matrix DID NOT MEANINGFULLY RUN: CW_BEARER_A and CW_BEARER_B are the same token — set two DISTINCT tenant tokens (BOLA_USER_A != BOLA_USER_B) to actually test isolation'
    : AUTHED && !authedBaselineOk ? 'NOT RUN — no-positive-control: no authorized baseline returned 2xx across the probed endpoint(s), so "no cross-tenant leak" cannot be distinguished from an edge WAF blocking every request (explicit uncertainty). Verify CW_BEARER_A/B are valid and the probed paths are reachable.'
    : AUTHED ? 'no cross-tenant leak on probed endpoints (authenticated matrix: each tenant\'s token cannot read the other\'s resources; unauth=401)'
      : `no unauth exposure on the ${tested.length} probed endpoint(s) (${spec.specAt ? `enumerated from ${spec.specAt}` : 'named via CW_BOLA_PATHS'}) — set CW_BEARER_A/B for the authenticated cross-tenant matrix`,
};
process.stdout.write(`${JSON.stringify({ tool: 'authz-bola', summary, findings, tested }, null, 2)}\n`);
