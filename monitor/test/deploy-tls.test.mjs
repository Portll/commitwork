// monitor/deploy-state.mjs — the TLS axis. Every test makes the probe FAIL against certificates
// minted by mkcert-lite (issuePair can mint an already-expired cert, which no openssl on this
// platform will) — a probe that always returns ok is indistinguishable from the bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { createServer as netServer } from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tlsProbe, CERT_WARN_DAYS } from '../deploy-state.mjs';
import { issuePair } from './fixtures/mkcert-lite.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-tls-'));
let n = 0;
const caPath = (pem) => { const p = join(TMP, `ca-${n++}.pem`); writeFileSync(p, pem); return p; };

// server.close(cb) waits on lingering half-open sockets and hangs the whole file — drop the
// connections first and never await the callback
function shutdown(srv) {
  try { srv.closeAllConnections?.(); } catch { /* older node */ }
  try { srv.close(); } catch { /* already closing */ }
  try { srv.unref(); } catch { /* fine */ }
}

// short timeout — the no-TLS cases would otherwise wait the full default twice
const T = { timeoutMs: 1500 };

// Start a real TLS server on an ephemeral port, run the probe against it, shut it down.
async function withTlsOrigin({ cert, key }, fn) {
  const srv = createServer({ cert, key }, (s) => s.end());
  // deliberately-broken handshakes arrive as tlsClientError — swallow or they kill the run
  srv.on('tlsClientError', () => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(srv.address().port); }
  finally { shutdown(srv); }
}

// ── the happy path, so the failures below mean something ─────────────────────────────────────

test('a valid cert, verified against its OWN CA, is ok', async () => {
  const { leaf, ca } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: 365 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'origin.test', caFile: caPath(ca), ...T }));
  assert.equal(res.ok, true, res.reason || '');
  assert.equal(res.state, 'ok');
  assert.equal(res.chainValid, true);
  assert.equal(res.hostnameMatch, true);
  assert.ok(res.daysLeft > 300 && res.daysLeft <= 365, `daysLeft=${res.daysLeft}`);
  assert.equal(res.expiring, false);
  assert.match(res.notAfter, /\d{4}/, 'notAfter must be reported, not merely fetched');
});

// ── the four ways it must fail ────────────────────────────────────────────────────────────────

test('AN EXPIRED CERT IS NEVER ok — even though the handshake itself succeeds', async () => {
  // the handshake succeeds; the certificate is simply out of date
  const { leaf, ca } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: -5 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'origin.test', caFile: caPath(ca), ...T }));
  assert.equal(res.ok, false);
  assert.equal(res.state, 'expired');
  assert.ok(res.daysLeft < 0, `daysLeft=${res.daysLeft}`);
  assert.match(res.reason, /expired/i);
  // It must still report WHAT expired — that is the read-only second pass earning its place.
  assert.ok(res.notAfter, 'an expired cert must still be described, not merely rejected');
});

test('A HOSTNAME MISMATCH IS NEVER ok, and the cert is still reported', async () => {
  const { leaf, ca } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: 365 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'somewhere-else.test', caFile: caPath(ca), ...T }));
  assert.equal(res.ok, false);
  assert.equal(res.chainValid, false);
  assert.equal(res.hostnameMatch, false, 'the mismatch must be named, not just implied by ok:false');
  assert.ok(res.subject, 'the certificate must still be described');
});

test('AN UNTRUSTED CHAIN IS NEVER ok — a different CA must not verify', async () => {
  // the rejectUnauthorized:false failure mode
  const { leaf } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: 365 });
  const other = issuePair({ cn: 'unrelated.test', san: ['unrelated.test'], days: 365 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'origin.test', caFile: caPath(other.ca), ...T }));
  assert.equal(res.ok, false);
  assert.equal(res.state, 'untrusted');
  assert.equal(res.chainValid, false);
});

test('A PLAIN-TCP LISTENER WITH NO TLS fails as `failed`, not as `closed`', async () => {
  // "answers but no TLS" needs a different fix from "nothing listening"
  const srv = netServer((s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await tlsProbe('127.0.0.1', srv.address().port, { servername: 'origin.test', ...T });
    assert.equal(res.ok, false);
    assert.equal(res.state, 'failed');
    assert.notEqual(res.state, 'closed');
  } finally { shutdown(srv); }
});

test('a CLOSED port is `closed`, distinct from a TLS failure', async () => {
  const srv = netServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  shutdown(srv);                 // free it, then probe it
  const res = await tlsProbe('127.0.0.1', port, { servername: 'origin.test', ...T });
  assert.equal(res.ok, false);
  assert.equal(res.state, 'closed', 'nothing listening must not read as broken TLS');
});

test('an IP target with no servername is probed, not thrown on — SNI cannot carry an address', async () => {
  const srv = netServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  shutdown(srv);
  const res = await tlsProbe('127.0.0.1', port, T);
  assert.equal(res.state, 'closed');
});

// ── the warning horizon ───────────────────────────────────────────────────────────────────────

test('a cert inside the warning horizon is ok BUT flagged expiring', async () => {
  // still ok — valid today; `expiring` is the lead time
  const { leaf, ca } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: CERT_WARN_DAYS - 5 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'origin.test', caFile: caPath(ca), ...T }));
  assert.equal(res.ok, true, res.reason || '');
  assert.equal(res.expiring, true);
  assert.ok(res.daysLeft <= CERT_WARN_DAYS && res.daysLeft >= 0, `daysLeft=${res.daysLeft}`);
});

test('a cert outside the horizon is not flagged', async () => {
  const { leaf, ca } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: CERT_WARN_DAYS + 60 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'origin.test', caFile: caPath(ca), ...T }));
  assert.equal(res.ok, true, res.reason || '');
  assert.equal(res.expiring, false);
});

// ── the declared-CA contract ──────────────────────────────────────────────────────────────────

test('an UNREADABLE declared caPool fails closed — it must never fall back to the system roots', async () => {
  // falling back to system roots would verify against a different trust anchor than cloudflared uses
  const { leaf } = issuePair({ cn: 'origin.test', san: ['origin.test'], days: 365 });
  const res = await withTlsOrigin(leaf, (port) =>
    tlsProbe('127.0.0.1', port, { servername: 'origin.test', caFile: join(TMP, 'does-not-exist.pem'), ...T }));
  assert.equal(res.ok, false);
  assert.match(res.reason, /caPool unreadable/);
});

test('SNI is what gets matched, so one origin can serve several hostnames correctly', async () => {
  // a probe keyed on the service rather than the rule would test one hostname and report all three
  const { leaf, ca } = issuePair({ cn: 'a.test', san: ['a.test', 'b.test'], days: 365 });
  const file = caPath(ca);
  await withTlsOrigin(leaf, async (port) => {
    for (const host of ['a.test', 'b.test']) {
      const r = await tlsProbe('127.0.0.1', port, { servername: host, caFile: file, ...T });
      assert.equal(r.ok, true, `${host}: ${r.reason || ''}`);
    }
    const r = await tlsProbe('127.0.0.1', port, { servername: 'c.test', caFile: file, ...T });
    assert.equal(r.ok, false, 'a hostname the cert does not cover must fail');
  });
});
