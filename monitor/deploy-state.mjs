// monitor/deploy-state.mjs — declaration vs reality for every published hostname, shared by the
// CLI (`deploy --verify`) and the panel's /api/exposure so they can never disagree. Read-only by
// construction. Five axes: declared / routed / dns / origin / tls — for an https service,
// origin:true requires a completed, verified handshake, and the TLS failure modes stay separate.

import { readFileSync } from 'node:fs';
import { connect, isIP } from 'node:net';
import { X509Certificate } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dns from 'node:dns/promises';
import { NOT_A_CLEAN_RESULT } from './exposure-verdict.mjs';

// Read per call, never at load: CW_CLOUDFLARED_CONFIG is what admin/serve.mjs's port check reads, and
// a load-time path left /api/exposure reporting on a different tunnel config than the server checked.
export const defaultConfigPath = () => process.env.CW_CLOUDFLARED_CONFIG || join(homedir(), '.cloudflared', 'config.yml');

// Parse active ingress rules out of a cloudflared config. A line parser on purpose (zero-dep);
// commented lines are skipped — a commented-out rule routes nothing. caPool/originServerName are
// captured because the TLS probe must reproduce the daemon's own trust decision.
// -> {rules: [{hostname, service, caPool, originServerName}]} | {error}
export function parseIngress(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (e) { return { error: `${path}: ${e.code || e.message}` }; }
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*#/.test(line)) continue;
    const h = line.match(/^\s*-\s*hostname:\s*["']?([^"'\s#]+)/);
    if (h) { current = { hostname: h[1], service: null, caPool: null, originServerName: null }; rules.push(current); continue; }
    const s = line.match(/^\s*service:\s*["']?([^"'\s#]+)/);
    if (s) { if (current && !current.service) current.service = s[1]; else current = null; continue; }
    // Only after a service line, so these cannot be picked up from an unrelated block.
    const ca = line.match(/^\s*caPool:\s*["']?([^"'#]+?)\s*$/);
    if (ca && current && current.service) { current.caPool = ca[1]; continue; }
    const sni = line.match(/^\s*originServerName:\s*["']?([^"'\s#]+)/);
    if (sni && current && current.service) current.originServerName = sni[1];
  }
  return { rules: rules.filter((r) => r.hostname) };
}

// GET the origin with an explicit Host header, returning the status code. node:http, not fetch —
// fetch silently drops the Host header. rejectUnauthorized:false is scoped to this one request
// (an HTTP-status question); callers must not reach this probe on a row whose handshake failed.
function probeStatus(serviceUrl, hostHeader, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(serviceUrl); } catch { return reject(new Error('unreachable')); }
    const mod = u.protocol === 'https:' ? https : http;
    // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification -- per-request probe, not process-global; justification in the comment on rejectUnauthorized below
    const req = mod.request({
      host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/api/state',
      method: 'GET', headers: { host: hostHeader, accept: 'application/json' },
      // codeql[js/disabling-certificate-validation] — deliberate, and scoped to
      // THIS request object only (not NODE_TLS_REJECT_UNAUTHORIZED, which would be process-global).
      // This probe answers an HTTP-status question only; tlsProbe() below (and cloudflared itself)
      // does the real caPool-verified handshake, and callers must not reach this probe on a row
      // whose handshake failed — see the function doc comment above for the enforced ordering.
      rejectUnauthorized: false,
    }, (res) => {
      // The body is captured (bounded): the refusal's own words tell a real 401 from an empty-store one.
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (buf.length < 2048) buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf.slice(0, 2048) }));
      res.on('error', () => resolve({ status: res.statusCode, body: buf.slice(0, 2048) }));
    });
    req.on('error', () => reject(new Error('unreachable')));
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// "something answers on that port" is the whole question; a handshake is not needed.
export function listening(host, port, timeoutMs = 600) {
  return new Promise((res) => {
    const sock = connect({ host, port });
    const done = (ok) => { sock.destroy(); res(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

// ── THE TLS AXIS ────────────────────────────────────────────────────────────────────────────────
// 30 days ~ the edge certificate's own renewal horizon.
export const CERT_WARN_DAYS = 30;

// Complete a real TLS handshake and report what the certificate says. Two passes: verify properly
// first; on failure re-connect unverified ONLY to read the certificate — the unverified pass never
// sets ok:true.
export function tlsProbe(host, port, { servername = null, caFile = null, timeoutMs = 4000 } = {}) {
  const sni = servername || host;
  const blank = {
    ok: false, state: 'not-tried', reason: null, subject: null, issuer: null,
    notBefore: null, notAfter: null, daysLeft: null, san: [], hostnameMatch: null,
    chainValid: false, expiring: false,
  };

  const attempt = (rejectUnauthorized) => new Promise((resolve) => {
    let ca = null;
    if (caFile && rejectUnauthorized) {
      try { ca = readFileSync(caFile); }
      // An unreadable declared CA must not fall back to the system roots.
      catch { return resolve({ ...blank, state: 'failed', reason: `declared caPool unreadable: ${caFile}` }); }
    }
    // Node throws synchronously on an IP servername (SNI carries hostnames only), so an IP target omits it.
    const sock = tls.connect({
      host, port, ...(isIP(sni) ? {} : { servername: sni }), rejectUnauthorized, ...(ca ? { ca } : {}),
      // The key must be OMITTED, not undefined (Node validates presence). The read-only pass
      // suppresses identity checking so a mismatch still yields a certificate to report.
      ...(rejectUnauthorized ? {} : { checkServerIdentity: () => undefined }),
    });
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; try { sock.destroy(); } catch { /* gone */ } resolve(r); };

    sock.once('secureConnect', () => {
      const peer = sock.getPeerCertificate(true) || {};
      const authorized = sock.authorized === true;
      let x = null;
      try { if (peer.raw) x = new X509Certificate(peer.raw); } catch { /* fall back to peer fields */ }
      const notAfter = peer.valid_to || (x ? x.validTo : null);
      const notBefore = peer.valid_from || (x ? x.validFrom : null);
      const naMs = notAfter ? new Date(notAfter).getTime() : NaN;
      const daysLeft = Number.isFinite(naMs) ? Math.floor((naMs - Date.now()) / 864e5) : null;
      const san = String(peer.subjectaltname || (x ? x.subjectAltName : '') || '')
        .split(',').map((s) => s.trim().replace(/^DNS:/, '')).filter(Boolean);
      const hostnameMatch = x ? (isIP(sni) ? x.checkIP(sni) : x.checkHost(sni)) != null : null;
      const expired = daysLeft !== null && daysLeft < 0;
      finish({
        ok: authorized && !expired,
        state: authorized ? (expired ? 'expired' : 'ok') : (expired ? 'expired' : 'untrusted'),
        reason: authorized
          ? (expired ? `certificate expired ${Math.abs(daysLeft)}d ago` : null)
          : (sock.authorizationError ? String(sock.authorizationError) : 'chain did not verify'),
        subject: peer.subject?.CN || (x ? x.subject : null) || null,
        issuer: peer.issuer?.CN || (x ? x.issuer : null) || null,
        notBefore: notBefore || null, notAfter: notAfter || null, daysLeft, san,
        hostnameMatch, chainValid: authorized,
        expiring: daysLeft !== null && daysLeft >= 0 && daysLeft <= CERT_WARN_DAYS,
      });
    });
    sock.once('error', (e) => finish({ ...blank,
      // ECONNREFUSED is "nothing is listening" — a different finding from "TLS is broken".
      state: e.code === 'ECONNREFUSED' ? 'closed' : 'failed',
      reason: `${e.code || 'error'}: ${String(e.message || e).slice(0, 120)}` }));
    sock.setTimeout(timeoutMs, () => finish({ ...blank, state: 'timeout', reason: `no handshake within ${timeoutMs}ms` }));
  });

  return attempt(true).then((verified) => {
    if (verified.ok || verified.state === 'closed' || verified.state === 'timeout') return verified;
    // Re-connect unverified only to read the certificate; ok stays false regardless.
    return attempt(false).then((detail) => ({
      ...detail,
      ok: false,
      chainValid: false,
      state: detail.state === 'ok' ? verified.state : detail.state,
      reason: verified.reason || detail.reason,
    })).catch(() => verified);
  });
}

/**
 * @param {object} opts
 * @param {object} opts.registry   a loaded registry (loadRegistry() result)
 * @param {string} [opts.configPath]
 * @param {boolean} [opts.probeDns=true]     resolve DNS (set false for offline callers)
 * @param {boolean} [opts.probeOrigin=true]  TCP-probe origins
 * @returns {Promise<{rows: Array, drift: Array, declaredCount: number, routedCount: number, configPath: string, error?: string}>}
 */
// fact: the states that are NOT drift live here and are imported by every caller / lib/deploy-core.mjs
// kept its own copy of the same two-string test, so adding a state meant editing two filters and one
// of them would have been missed (expiry: never, prev: duplicated)
export const NON_DRIFT_STATES = Object.freeze(new Set(['ok', 'withheld (correct)', 'pages (correct)']));

export async function resolveDeployState({ registry, configPath = defaultConfigPath(), probeDns = true, probeOrigin = true } = {}) {
  const declared = (registry.areas || []).filter((a) => a.deploy);
  const cfg = parseIngress(configPath);
  if (cfg.error) return { error: cfg.error, rows: [], drift: [], declaredCount: 0, routedCount: 0, configPath };

  const declaredHosts = new Map();
  for (const a of declared) for (const h of a.deploy.hostnames) declaredHosts.set(h, a);
  const routedHosts = new Map(cfg.rules.map((r) => [r.hostname, r]));
  const allHosts = [...new Set([...declaredHosts.keys(), ...routedHosts.keys()])].sort();

  const resolved = new Map();
  if (probeDns) {
    await Promise.all(allHosts.map(async (h) => {
      try { resolved.set(h, (await dns.resolve4(h)).length > 0); }
      catch { try { resolved.set(h, (await dns.resolveCname(h)).length > 0); } catch { resolved.set(h, false); } }
    }));
  }

  const originUp = new Map();
  const originTls = new Map();   // keyed by hostname, not service: SNI differs per rule
  if (probeOrigin) {
    await Promise.all([...new Set(cfg.rules.map((r) => r.service).filter(Boolean))].map(async (svc) => {
      let u; try { u = new URL(svc); } catch { originUp.set(svc, null); return; }
      const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      originUp.set(svc, await listening(u.hostname, port));
    }));
    // Probed per RULE, not per service: hostnames sharing one origin carry different SNI, and SNI
    // is exactly what the certificate must match.
    await Promise.all(cfg.rules.filter((r) => r.service && String(r.service).startsWith('https:')).map(async (r) => {
      let u; try { u = new URL(r.service); } catch { return; }
      originTls.set(r.hostname, await tlsProbe(u.hostname, Number(u.port || 443), {
        servername: r.originServerName || r.hostname,
        caFile: r.caPool || null,
      }));
    }));
  }

  const rows = allHosts.map((hostname) => {
    const area = declaredHosts.get(hostname);
    const rule = routedHosts.get(hostname);
    const dnsOk = probeDns ? resolved.get(hostname) === true : null;
    const tcpUp = rule && rule.service && probeOrigin ? originUp.get(rule.service) : null;
    const tlsInfo = originTls.get(hostname) || null;
    // For an https origin, "up" requires the handshake — reachable-but-untrusted serves 502.
    const up = tlsInfo ? (tcpUp === false ? false : tlsInfo.ok) : tcpUp;
    let state;
    if (!area) state = 'ROUTED-NOT-DECLARED';
    else if (!area.deploy.public) state = rule ? 'ROUTED-BUT-DECLARED-PRIVATE' : 'withheld (correct)';
    // A pages-hosted area is served by Cloudflare, not this tunnel, so its absence from the config
    // is correct and its PRESENCE is the defect. bin/deploy.mjs already filters these when
    // emitting; verify did not, so a correct configuration reported drift and exited 1.
    else if (area.deploy.hosting === 'pages') state = rule ? 'PAGES-BUT-ROUTED' : 'pages (correct)';
    else if (!rule) state = 'DECLARED-NOT-ROUTED';
    else if (dnsOk === false) state = 'ROUTED-NO-DNS';
    else if (tcpUp === false) state = 'ORIGIN-DOWN';
    // Distinct from ORIGIN-DOWN: "port answers but TLS does not hold up" needs a different fix.
    else if (tlsInfo && !tlsInfo.ok) state = `ORIGIN-TLS-${String(tlsInfo.state).toUpperCase()}`;
    else if (tlsInfo && tlsInfo.expiring) state = 'CERT-EXPIRING';
    else state = 'ok';
    if (state === 'withheld (correct)' && dnsOk === true) state = 'PRIVATE-BUT-RESOLVES';
    return {
      hostname,
      area: area ? area.slug : null,
      declared: area ? (area.deploy.public ? 'public' : 'private') : 'undeclared',
      requiresAuth: area ? !!area.deploy.requiresAuth : null,
      authAt: area && area.deploy.authAt ? area.deploy.authAt : null,
      service: rule ? (rule.service || null) : null,
      dns: dnsOk, origin: up, state,
      // `origin` is a judgement that folds TLS in; the raw TCP answer stays visible beside it.
      originTcp: tcpUp,
      tls: tlsInfo,
    };
  });

  // Attestation check: ask the origin, unauthenticated, whether it actually refuses. Only
  // authAt:'origin' is checkable from here — a loopback probe bypasses 'edge' auth by construction,
  // so that stays unverifiable.
  if (probeOrigin) {
    // Dynamic import: deploy-core imports this module statically, and a static import back cycles.
    let classify = null;
    try { ({ classifyAttestation: classify } = await import('../lib/deploy-core.mjs')); }
    catch { /* handled per row below — fail closed, never guess from the status */ }
    await Promise.all(rows.map(async (r) => {
      if (r.authAt !== 'origin' || !r.service || r.origin !== true) return;
      // An unverified channel cannot carry an attestation: if the handshake did not hold up, the
      // claim is UNVERIFIABLE — not refuted, not confirmed.
      if (r.tls && !r.tls.ok) {
        r.authVerdict = 'unverifiable';
        r.authWhy = `the origin's TLS did not verify (${r.tls.state}: ${r.tls.reason || 'no detail'}), so nothing observed over that connection can attest to anything`;
        r.authAttested = null;
        return;
      }
      try {
        const { status, body } = await probeStatus(r.service, r.hostname);
        r.authProbe = status;
        if (classify) {
          const { verdict, why } = classify({ status, body });
          r.authVerdict = verdict;
          r.authWhy = why;
          // Derived from the verdict, not the status; `unusable` is explicitly not attested.
          r.authAttested = verdict === 'protected';
        } else {
          // Fail closed if the rule could not be loaded — never guess from the status.
          r.authVerdict = 'unverifiable';
          r.authWhy = 'the attestation rule could not be loaded, so the claim was not tested';
          r.authAttested = null;
        }
      } catch (e) {
        r.authAttested = null;
        r.authProbe = e.message === 'timeout' ? 'timeout' : 'unreachable';
        r.authVerdict = 'unverifiable';
        r.authWhy = `the origin gave no usable answer (${r.authProbe}), so the claim was not tested`;
      }
    }))
  }

  const drift = rows.filter((r) => !NON_DRIFT_STATES.has(r.state));
  // A false attestation is drift even when routing, DNS and liveness are all correct.
  const brokenAttestation = rows.filter((r) => r.authAt === 'origin' && r.authAttested === false);
  for (const r of brokenAttestation) if (!drift.includes(r)) drift.push(r);
  return { rows, drift, brokenAttestation, declaredCount: declaredHosts.size, routedCount: routedHosts.size, configPath };
}

// One sentence per drift class, shared by the CLI and the panel so the wording cannot diverge.
export function explainDrift(r) {
  // the attestation failure is reported first: routing can be perfect while the claim is false
  if (r.authAt === 'origin' && r.authAttested === false) {
    return `declares authAt:'origin' but the origin answered HTTP ${r.authProbe} to an unauthenticated request — the registry is asserting protection the service does not provide.`;
  }
  switch (r.state) {
    case 'ROUTED-NOT-DECLARED': return `served by the tunnel (${r.service}) but NO area declares it. The registry does not describe this box.`;
    case 'ROUTED-BUT-DECLARED-PRIVATE': return `declared private for area '${r.area}', but the tunnel routes it to ${r.service}.`;
    case 'PAGES-BUT-ROUTED': return `declared hosting:'pages' for area '${r.area}' — Cloudflare serves it — but the tunnel also routes it to ${r.service}: two origins answer one hostname.`;
    case 'DECLARED-NOT-ROUTED': return `declared public for area '${r.area}' but absent from the tunnel config: it serves nothing.`;
    case 'ROUTED-NO-DNS': return `routed to ${r.service} but has no DNS record, so the rule is dead.`;
    case 'ORIGIN-DOWN': return `declared, routed and resolving, but nothing is listening on ${r.service}: the hostname is public and serving 502.`;
    case 'PRIVATE-BUT-RESOLVES': return 'declared private and unrouted here, yet DNS resolves. Something else may answer for it.';
    default: return '';
  }
}
