// lib/panel-session.mjs — boot the panel on throwaway ports with throwaway stores and HOME, bootstrap
// an operator, and return a session cookie. Extracted from bin/panel-smoke.mjs so the theme matrix
// does not hand-write a second copy: two implementations of one flow is G17, and this one has three
// non-obvious steps that would diverge (CSRF, TOTP replay, cookie name).

import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = 'panel-session@example.com';
// Bootstraps the operator in the per-run mkdtemp auth store below. Drawn per process, so no copy of it
// exists in the tree for a secret scanner to flag or a reader to reuse.
const PASSWORD = randomBytes(24).toString('base64url');

export const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

const b32 = (str) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of String(str).replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(c); if (i >= 0) bits += i.toString(2).padStart(5, '0');
  }
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
};

export const totp = (secret, at = Date.now()) => {
  const ctr = Buffer.alloc(8); ctr.writeUInt32BE(Math.floor(at / 1000 / 30), 4);
  const h = createHmac('sha1', b32(secret)).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
};

// contract: every store the booted panel writes, and every credential lookup, resolves inside scratch.
// The auth store alone was not enough: the boot wrote the checkout's .claude/store code stamp, and
// OAuth secrets resolved from the live ~/.commitwork/secrets.json through its keychain refs.
export function sessionEnv(scratch, { port, localPort }, base = process.env) {
  return {
    ...base, HOME: scratch, USERPROFILE: scratch,
    CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
    CW_AUTH_STORE: join(scratch, 'users.json'),
    CW_SESSION_STORE: join(scratch, 'sessions.json'), // the sign-in below persists a session
    CW_PANEL_CODE_STAMP: join(scratch, 'panel-code-stamp.json'),
    CW_SECRETS_FILE: join(scratch, 'secrets.json'),
  };
}

/** Boots the panel and signs in. Returns { cookie, origin, stop } or { unavailable }. `entry` is a test seam. */
export async function startPanel({ timeoutMs = 30000, entry = join(ROOT, 'admin/serve.mjs') } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'cw-panel-session-'));
  const port = await freePort();
  const localPort = await freePort();
  let log = '';
  const srv = spawn(process.execPath, [entry], {
    cwd: ROOT,
    env: sessionEnv(scratch, { port, localPort }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  const stop = () => { try { srv.kill('SIGKILL'); } catch { /* already gone */ } };

  let jar = [];
  const call = (method, path, body, extra = {}) => new Promise((res) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: localPort, path, method, headers: {
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      ...(jar.length ? { cookie: jar.join('; ') } : {}), ...extra } }, (x) => {
      for (const c of (x.headers['set-cookie'] || [])) {
        const kv = c.split(';')[0];
        jar = jar.filter((j) => j.split('=')[0] !== kv.split('=')[0]); jar.push(kv);
      }
      let b = ''; x.on('data', (c) => { b += c; }); x.on('end', () => res({ code: x.statusCode, body: b }));
    });
    r.on('error', (e) => res({ err: e.message })); if (data) r.write(data); r.end();
  });

  const deadline = Date.now() + timeoutMs;
  let up = false;
  while (Date.now() < deadline && !up) {
    const r = await call('GET', '/');
    if (!r.err) up = true; else await new Promise((s) => setTimeout(s, 250));
  }
  if (!up) { stop(); return { unavailable: `panel did not answer within ${timeoutMs}ms`, log: log.slice(-2000) }; }

  const origin = `http://127.0.0.1:${localPort}`;
  const headers = async () => {
    const c = await call('GET', '/api/csrf');
    let token = null; try { token = JSON.parse(c.body).token; } catch { /* handled by caller */ }
    return token ? { 'x-cw-csrf': token, origin, referer: `${origin}/` } : null;
  };

  const h1 = await headers();
  if (!h1) { stop(); return { unavailable: 'no CSRF token' }; }
  const boot = await call('POST', '/auth/bootstrap', { email: EMAIL, password: PASSWORD }, h1);
  let bj = {}; try { bj = JSON.parse(boot.body); } catch { /* handled below */ }
  const secret = bj.secret || bj.totpSecret || (String(bj.otpauth || '').match(/secret=([A-Z2-7]+)/i) || [])[1];
  if (boot.code !== 200 || !secret) { stop(); return { unavailable: `bootstrap failed (${boot.code}) ${boot.body.slice(0, 160)}` }; }

  const confirm = await call('POST', '/auth/totp/confirm', { email: EMAIL, password: PASSWORD, token: totp(secret) }, await headers());
  if (confirm.code !== 200) { stop(); return { unavailable: `totp confirm failed (${confirm.code})` }; }

  // The confirm consumed that code; reusing it inside the same 30s window is refused as a replay.
  const nextWindow = (Math.floor(Date.now() / 1000 / 30) + 1) * 30000;
  await new Promise((r) => setTimeout(r, Math.max(0, nextWindow - Date.now()) + 1200));

  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD, token: totp(secret) }, await headers());
  if (login.code !== 200) { stop(); return { unavailable: `login failed (${login.code}) ${login.body.slice(0, 160)}` }; }

  const sid = jar.find((c) => c.startsWith('cw_admin_sid='));
  if (!sid) { stop(); return { unavailable: 'login returned no session cookie' }; }
  const [name, value] = sid.split('=');
  return { origin, localPort, publishedPort: port, cookie: { name, value: decodeURIComponent(value), domain: '127.0.0.1', path: '/' }, stop };
}
