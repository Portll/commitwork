// deploy-core.mjs — the deploy verbs as importable functions (verify() today).
// Contract: importing this module must not write, print, or exit. generate()/stage() stay in
// bin/deploy.mjs deliberately; the shared comparison lives in monitor/deploy-state.mjs.

import http from 'node:http';
import https from 'node:https';
import { explainDrift, resolveDeployState, NON_DRIFT_STATES } from '../monitor/deploy-state.mjs';
import { verdictFor, loadEvidence } from './offbox-evidence.mjs';

// ── THE ATTESTATION VERDICT ─────────────────────────────────────────────────────────────────────
// A refusal only attests protection when it is about IDENTITY — "nobody can log in" must never
// pass, and the body (not just the status) carries that fact. Four values; only one is silence:
//   protected     refused, and the refusal was about who is asking
//   unprotected   answered 2xx unauthenticated — the claim is false
//   unusable      refused because NOBODY can authenticate; not a pass
//   unverifiable  no answer, or authAt:'edge' (a loopback probe bypasses it by construction)
export const ATTEST = Object.freeze({
  PROTECTED: 'protected',
  UNPROTECTED: 'unprotected',
  UNUSABLE: 'unusable',
  UNVERIFIABLE: 'unverifiable',
});

// Verdicts that gate. unverifiable gates too — "could not tell" must not pass; 'edge' (unverifiable
// by design) is handled at the call site.
export const ATTEST_DRIFT = Object.freeze(new Set([ATTEST.UNPROTECTED, ATTEST.UNUSABLE, ATTEST.UNVERIFIABLE]));

// Real "nobody can authenticate" refusal phrases from admin/serve.mjs, matched against the BODY
// at any status — the same condition has been emitted as 503 and as 401.
const UNUSABLE_RE = /unbootstrapped|no operator account|no users exist|no account exists|no account yet|create the root user/i;

/**
 * status + body -> a verdict on an `authAt` claim. Pure; the transport is separate.
 * @param {{status?: number|null, body?: string, error?: string|null}} obs
 * @returns {{verdict: string, why: string}}
 */
export function classifyAttestation({ status = null, body = '', error = null } = {}) {
  const text = String(body || '');
  if (error) return { verdict: ATTEST.UNVERIFIABLE, why: `the origin gave no usable answer (${error}), so the claim was not tested` };
  if (typeof status !== 'number') return { verdict: ATTEST.UNVERIFIABLE, why: 'no status was observed, so the claim was not tested' };
  // Body check runs BEFORE the status rules: a 401 whose body says the store is empty is
  // unusable, not protected.
  if (UNUSABLE_RE.test(text)) {
    return { verdict: ATTEST.UNUSABLE, why: `the origin refused with HTTP ${status}, but its own answer says no operator account exists — nobody can authenticate, so the refusal is unusability, not protection` };
  }
  if (status >= 200 && status < 300) {
    return { verdict: ATTEST.UNPROTECTED, why: `the origin answered HTTP ${status} to an unauthenticated request` };
  }
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    return { verdict: ATTEST.PROTECTED, why: `the origin refused an unauthenticated request with HTTP ${status}` };
  }
  if (status >= 500) {
    return { verdict: ATTEST.UNVERIFIABLE, why: `the origin answered HTTP ${status} — a server fault, which says nothing either way about whether it authenticates` };
  }
  return { verdict: ATTEST.UNPROTECTED, why: `the origin answered HTTP ${status}, which is neither a refusal about identity nor a fault — the claim is not backed` };
}

/**
 * GET the origin with an explicit Host header; return status + a BOUNDED body prefix.
 * node:http, not fetch — fetch silently drops a Host header. The body is capped and the socket
 * destroyed at the cap. rejectUnauthorized:false is deliberate and per-request: this asks an
 * HTTP-status question; certificate trust is cloudflared's caPool handshake, a separate axis.
 */
function probeUnauthenticated(serviceUrl, hostHeader, { timeoutMs = 4000, maxBytes = 2048 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(serviceUrl); } catch { return resolve({ status: null, body: '', error: 'unparseable service URL' }); }
    const mod = u.protocol === 'https:' ? https : http;
    // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification -- per-request probe, not process-global; justification in the comment on rejectUnauthorized below
    const req = mod.request({
      host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/api/state',
      method: 'GET', headers: { host: hostHeader, accept: 'application/json' },
      // codeql[js/disabling-certificate-validation] — deliberate, and scoped to
      // THIS request object only (not NODE_TLS_REJECT_UNAUTHORIZED, which would be process-global).
      // Probes the origin directly (bypassing the tunnel) to classify its HTTP-level auth behaviour,
      // a read-only declaration check — the routed path's cert trust is cloudflared's own
      // caPool-verified handshake, not this probe's. See the function doc comment above for why this
      // cannot contaminate the certificate-grading path.
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        if (body.length < maxBytes) body += d;
        if (body.length >= maxBytes) { body = body.slice(0, maxBytes); res.destroy(); }
      });
      const done = () => resolve({ status: res.statusCode, body, error: null });
      res.on('end', done);
      res.on('close', done);
      res.on('error', done);
    });
    req.on('error', () => resolve({ status: null, body: '', error: 'unreachable' }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: null, body: '', error: 'timeout' }); });
    req.end();
  });
}

/**
 * Attach `row.attest = {verdict, why, status}` to every row carrying an `authAt` claim, and bring
 * `row.authAttested` into agreement with it. Probes itself because deploy-state's request discards
 * the body, and the body is the evidence.
 */
export async function attestRows(rows, { probe = probeUnauthenticated, timeoutMs, offBox = null } = {}) {
  await Promise.all((rows || []).map(async (r) => {
    if (!r.authAt) return;
    if (r.authAt !== 'origin') {
      // A layer in front of the tunnel is only attestable by off-box evidence (DECISIONS.md D5);
      // with none, the row stays UNVERIFIABLE byDesign.
      const ev = offBox && offBox.byHost ? verdictFor(offBox.byHost.get(r.hostname)) : null;
      if (!ev) {
        r.attest = { verdict: ATTEST.UNVERIFIABLE, byDesign: true, status: null,
          why: `authAt:'${r.authAt}' sits in FRONT of the tunnel, so a probe from the origin box bypasses it by construction and a pass would prove nothing` };
        return;
      }
      const rec = offBox.byHost.get(r.hostname);
      r.attest = {
        verdict: ev.attested ? ATTEST.PROTECTED : ATTEST.UNPROTECTED,
        byDesign: false,
        status: rec.status ?? null,
        offBox: { vantage: rec.vantage, observedAt: rec.started ?? null, ageMs: rec.ageMs },
        why: ev.why,
      };
      r.authProbe = rec.status ?? rec.verdict;
      r.authAttested = ev.attested;
      return;
    }
    if (!r.service || r.origin !== true) {
      r.attest = { verdict: ATTEST.UNVERIFIABLE, byDesign: false, status: null,
        why: r.service ? 'nothing is listening on the origin, so the claim could not be tested' : 'no ingress rule routes this hostname, so there was no origin to ask' };
      r.authAttested = false;
      return;
    }
    const obs = await probe(r.service, r.hostname, timeoutMs ? { timeoutMs } : undefined);
    const { verdict, why } = classifyAttestation(obs);
    r.attest = { verdict, why, status: obs.status, byDesign: false };
    r.authProbe = obs.status ?? obs.error;
    r.authAttested = verdict === ATTEST.PROTECTED;
  }));
  return rows;
}

/**
 * DECLARATION vs REALITY. Read-only: reads config, resolves DNS, probes origins; writes nothing.
 * Returns { code, stdout: string[], stderr: string[], state } — 0 no drift, 1 drift (gateable),
 * 2 config unreadable (never a clean bill). Lines are returned so the caller owns the streams.
 */
export async function verify({ registry, configPath } = {}) {
  // Declined-evidence reasons travel to stderr rather than being dropped.
  const stderrNotes = [];
  const state = await resolveDeployState({ registry, configPath });
  if (state.error) {
    return { code: 2, stdout: [], stderr: [`deploy --verify: cannot read the tunnel config (${state.error})`], state };
  }

  // The authAt verdict overwrites resolveDeployState()'s coarse boolean — one answer per row.
  // Off-box evidence is opt-in via CW_OFFBOX_EVIDENCE and fails closed in lib/offbox-evidence.mjs.
  const offBox = loadEvidence();
  if (offBox.error) stderrNotes.push(`deploy --verify: off-box evidence ignored — ${offBox.error}`);
  for (const rj of offBox.rejected) stderrNotes.push(`deploy --verify: off-box record for ${rj.hostname} ignored — ${rj.why}`);
  await attestRows(state.rows, { offBox });
  const claims = state.rows.filter((r) => r.attest);

  const cell = (r) => [r.hostname, r.area || '—', r.declared, r.service || '—',
    r.dns === null ? '—' : (r.dns ? 'yes' : 'no'),
    r.origin === null ? '—' : (r.origin ? 'up' : 'DOWN'), r.state,
    r.attest ? r.attest.verdict : '—'];
  const head = ['hostname', 'area', 'declared', 'routed to', 'dns', 'origin', 'state', 'authAt'];
  const body = state.rows.map(cell);
  const cols = head.map((c, i) => Math.max(c.length, ...body.map((r) => String(r[i]).length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(cols[i])).join('  ').trimEnd();

  const stdout = [
    `deploy --verify: ${state.declaredCount} declared · ${state.routedCount} routed in ${state.configPath}\n`,
    line(head),
    ...body.map(line),
  ];

  // Passing attestations are reported too — "checked and held" must differ from "never checked".
  if (claims.length) {
    stdout.push('\nATTESTATIONS (authAt is a claim, so it is re-checked, not believed):');
    for (const r of claims) stdout.push(`  ${r.hostname} — authAt:'${r.authAt}' → ${r.attest.verdict.toUpperCase()}: ${r.attest.why}`);
  }

  // Recomputed, not taken from state.drift — the attestation verdict can move a row either way.
  const routingDrift = state.rows.filter((r) => !NON_DRIFT_STATES.has(r.state));
  const attestDrift = claims.filter((r) => !r.attest.byDesign && ATTEST_DRIFT.has(r.attest.verdict));
  const drift = [...routingDrift, ...attestDrift.filter((r) => !routingDrift.includes(r))];
  state.drift = drift;
  state.brokenAttestation = attestDrift;

  if (!drift.length) {
    stdout.push('\nno drift: every declared hostname is routed and resolving, nothing is routed that is not declared, and every authAt claim held.');
    return { code: 0, stdout, stderr: stderrNotes, state };
  }
  stdout.push('\nDRIFT:');
  // The attestation sentence wins where a row has both — the claim is the more serious fact.
  for (const r of drift) stdout.push(`  ${r.hostname} — ${attestDrift.includes(r) ? explainAttestation(r) : explainDrift(r)}`);
  stdout.push(`\n${drift.length} hostname(s) drifted. Exit 1 so this can gate.`);
  return { code: 1, stdout, stderr: stderrNotes, state };
}

// One sentence per non-passing verdict; unprotected delegates to explainDrift so wording stays in
// one place.
export function explainAttestation(r) {
  const a = r.attest || {};
  if (a.verdict === ATTEST.UNPROTECTED) return explainDrift(r);
  if (a.verdict === ATTEST.UNUSABLE) {
    return `declares authAt:'origin' and the origin DID refuse (HTTP ${a.status}) — but its own answer says no operator account exists, so nobody can authenticate and the refusal is unusability, not protection. An attestation must never be satisfied by the failure state it exists to detect: bootstrap an operator (loopback only) and re-run, or drop the authAt claim until one exists.`;
  }
  return `declares authAt:'${r.authAt}' and the claim was NOT verified — ${a.why}. An unverified attestation is not an attestation; it must not pass a gate.`;
}
