#!/usr/bin/env node
/**
 * commitwork TLS + security-headers scan: headers half grades CW_TARGET_URL, tls half grades
 * CW_TLS_URL or derived https origins (testssl optional).
 * usage: node tls-headers-scan.mjs — writes $CW_REPORT_DIR/tls-headers.json
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readTestsslJson } from './lib/testssl-json.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Per-area output: honour the runner's CW_REPORT_DIR; fixed path is the manual-run fallback.
const OUT = process.env.CW_REPORT_DIR || resolve(HERE, '..', 'reports', 'runtime-latest');
// No default target: grading whatever answers on localhost:8080 describes an unrelated service.
const TARGET = (process.env.CW_TARGET_URL || '').replace(/\/$/, '');
const TLS_URL = process.env.CW_TLS_URL || null; // e.g. https://localhost:8443
const stamp = () => new Date().toISOString();

// security headers to grade (presence = pass)
const WANT = ['strict-transport-security', 'content-security-policy', 'x-content-type-options',
  'x-frame-options', 'referrer-policy', 'permissions-policy'];

async function headers() {
  // No target = visible void, never a silent 'F'
  if (!TARGET) return { ran: false, skipped: true, reason: 'no CW_TARGET_URL — nothing to grade (pass --url / set CW_TARGET_URL; there is no default target)' };
  try {
    const r = await fetch(TARGET + '/actuator/health', { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      .catch(() => fetch(TARGET, { redirect: 'manual', signal: AbortSignal.timeout(5000) }));
    const present = {}; const missing = [];
    for (const h of WANT) { const v = r.headers.get(h); if (v) present[h] = v.slice(0, 80); else missing.push(h); }
    return { ran: true, status: r.status, present: Object.keys(present).length, missing, presentDetail: present,
      grade: missing.length === 0 ? 'A' : missing.length <= 2 ? 'B' : missing.length <= 4 ? 'C' : 'F' };
  } catch (e) { return { ran: false, skipped: true, reason: `target unreachable: ${String(e).slice(0, 60)}` }; }
}

// Targets derive from the tunnel config; edge (public-hostname) probes are opt-in via CW_TLS_EDGE=1.
async function tlsTargets() {
  if (TLS_URL) return [{ url: TLS_URL, kind: 'explicit', servername: null, caFile: null }];
  let cfg, reg, cfgPath;
  try {
    ({ parseIngress: cfg, defaultConfigPath: cfgPath } = await import('../monitor/deploy-state.mjs'));
    ({ loadRegistry: reg } = await import('../monitor/registry.mjs'));
  } catch { return []; }
  let parsed;
  try { parsed = cfg(process.env.CW_TUNNEL_CONFIG || cfgPath()); } catch { return []; }
  if (!parsed || parsed.error) return [];
  const out = [];
  for (const r of parsed.rules || []) {
    if (!r.service || !String(r.service).startsWith('https:')) continue;
    out.push({ url: r.service, kind: 'origin', hostname: r.hostname,
      servername: r.originServerName || r.hostname, caFile: r.caPool || null });
  }
  if (process.env.CW_TLS_EDGE === '1') {
    let registry = null;
    try { registry = reg({ quiet: true }); } catch { /* origins alone are still worth reporting */ }
    for (const a of (registry?.areas || [])) {
      if (!a.deploy?.public) continue;
      for (const h of a.deploy.hostnames || []) {
        out.push({ url: `https://${h}:443`, kind: 'edge', hostname: h, servername: h, caFile: null });
      }
    }
  }
  return out;
}

async function tls() {
  const targets = await tlsTargets();
  if (!targets.length) {
    // noscan = coverage hole, distinct from a deliberate skip
    return { ran: false, noscan: true, skipped: true,
      reason: 'no https target could be derived: no CW_TLS_URL, and the tunnel config declares no https origin. This is a COVERAGE VOID, not a clean result.' };
  }
  const { tlsProbe, CERT_WARN_DAYS } = await import('../monitor/deploy-state.mjs');
  const certs = [];
  for (const t of targets) {
    let u; try { u = new URL(t.url); } catch { continue; }
    const p = await tlsProbe(u.hostname, Number(u.port || 443),
      { servername: t.servername || u.hostname, caFile: t.caFile });
    certs.push({ target: t.url, kind: t.kind, hostname: t.hostname || null, ...p });
  }
  // Expired/untrusted is F regardless of any cipher scan
  const bad = certs.filter((c) => !c.ok);
  const expiring = certs.filter((c) => c.ok && c.expiring);

  // testssl is now strictly additive.
  let testssl = { ran: false, skipped: true, reason: 'testssl not installed (brew install testssl) — certificate facts above come from a direct handshake, not from testssl' };
  let bin = process.env.TESTSSL_BIN || '';
  if (!bin) { try { bin = execSync('command -v testssl.sh || command -v testssl', { encoding: 'utf8' }).trim(); } catch { /* not installed */ } }
  let sslFindings = [];
  if (bin) {
    const first = targets[0].url;
    const jf = join(OUT, 'testssl.json');
    try {
      // argv, not a shell string: the target comes from config and is never re-parsed by a shell.
      // --overwrite because testssl refuses to start when the --jsonfile from the last run exists.
      execFileSync(bin, ['--quiet', '--fast', '--overwrite', '--jsonfile', jf, first],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: 180000 });
      const read = readTestsslJson(readFileSync(jf, 'utf8'), first);
      if (read.ok) {
        sslFindings = read.findings;
        testssl = { ran: true, url: first, report: 'testssl.json', rows: read.rows, findings: read.findings.length };
      } else testssl = { ran: false, url: first, error: read.reason };
    } catch (e) {
      const why = e.code === 'ETIMEDOUT' || e.signal ? 'timed out after 180s' : `exited ${e.status ?? e.code}`;
      testssl = { ran: false, url: first, error: `testssl ${why}: ${String(e.stderr || e.message).trim().slice(-300)}` };
    }
  }

  const sslSevere = sslFindings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const sslMedium = sslFindings.some((f) => f.severity === 'medium');
  return {
    ran: true, probed: certs.length, certs, testssl,
    warnDays: CERT_WARN_DAYS,
    grade: bad.length || sslSevere ? 'F' : expiring.length || sslMedium ? 'C' : 'A',
    findings: [
      ...bad.map((c) => ({ severity: 'high', target: c.target, issue: `certificate ${c.state}`, detail: c.reason })),
      ...expiring.map((c) => ({ severity: 'med', target: c.target, issue: 'certificate expiring', detail: `${c.daysLeft}d left (warn at ${CERT_WARN_DAYS}d)` })),
      ...sslFindings,
    ],
  };
}

// Before tls(): testssl writes its --jsonfile into OUT.
mkdirSync(OUT, { recursive: true });
const result = { tool: 'tls-headers', generatedAt: stamp(), target: TARGET || null,
  headers: await headers(), tls: await tls() };
// Top-level ran/skipped/reason so a rollup records a coverage void, not written-therefore-green.
const verdicts = [
  result.headers.ran && `headers ${result.headers.grade} (${result.headers.missing?.length ?? 0} missing)`,
  result.tls.ran && `tls ${result.tls.grade} (${result.tls.findings.length} finding(s))`,
].filter(Boolean);
result.status = verdicts.length ? verdicts.join('; ') : 'skipped';
result.ran = !!(result.headers.ran || result.tls.ran);
// Propagate noscan so rollups see "could not look" without re-deriving it.
if (result.tls.noscan) result.noscan = true;
if (!result.ran) { result.skipped = true; result.reason = result.headers.reason || result.tls.reason || 'nothing ran'; }
writeFileSync(join(OUT, 'tls-headers.json'), JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
