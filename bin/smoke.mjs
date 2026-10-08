#!/usr/bin/env node
/**
 * commitwork smoke — does the thing actually START?
 *
 * Asserts the pair: operator port → 200 + real HTML; published port → a refusal, never the panel.
 * The auth store is pinned to an absent file (CW_AUTH_STORE), so every machine boots the same
 * unbootstrapped panel and the published port's refusal is the 503 bootstrap answer. A machine with
 * an operator account would answer 401 instead; reading its real store made the smoke's verdict a
 * property of the box it ran on.
 *
 * usage:  node bin/smoke.mjs            (picks free ports)
 *         CW_SMOKE_TIMEOUT_MS=30000 node bin/smoke.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = +(process.env.CW_SMOKE_TIMEOUT_MS || 30000);
// fact: the smoke writes nothing into the checkout; its auth store and code stamp live here
const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'cw-smoke-'));
let srv = null;
// fix: fail() exited past the finally below, orphaning the panel on its port, and SCRATCH was never
// removed on any path. 'exit' is the one hook every path reaches, process.exit() included.
process.on('exit', () => {
  if (srv && srv.exitCode === null && srv.signalCode === null) srv.kill('SIGTERM');
  rmSync(SCRATCH, { recursive: true, force: true });
});
// a signal skips 'exit' unless handled; 128+n keeps the conventional status
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(128 + os.constants.signals[sig]));

const fail = (msg, extra) => { process.stderr.write(`✖ ${msg}\n${extra ? `${extra}\n` : ''}`); process.exit(1); };
const ok = (msg) => process.stdout.write(`✔ ${msg}\n`);

/** Reserve a port by binding it, then release — both ports reserved explicitly, PORT+1 is not assumed free. */
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

/** node:http, never fetch — undici silently drops a Host header. */
const get = (port, p) => new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 5000 }, (r) => {
    let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ code: r.statusCode, body: b }));
  });
  req.on('timeout', () => { req.destroy(); res({ err: 'timeout' }); });
  req.on('error', (e) => res({ err: e.message }));
});

async function waitForPort(port, log) {
  const deadline = Date.now() + TIMEOUT_MS;
  // Bounded — an unbounded wait turns a boot failure into a silent hang.
  while (Date.now() < deadline) {
    const r = await get(port, '/');
    if (!r.err) return r;
    await new Promise((s) => setTimeout(s, 250));
  }
  fail(`panel did not answer on 127.0.0.1:${port} within ${TIMEOUT_MS}ms`, `--- server output ---\n${log().slice(-4000)}`);
}

// ---- 1. the CLI resolves its bundled manifests ---------------------------
{
  const { execFileSync } = await import('node:child_process');
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'bin/commitwork.mjs'), 'list', '--manifest', 'security-baseline'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    if (!/\S/.test(out)) fail('`commitwork list` produced no output');
    ok(`commitwork list --manifest security-baseline → ${out.trim().split('\n').length} line(s)`);
  } catch (e) {
    fail('`commitwork list --manifest security-baseline` did not run', `${e.stdout || ''}${e.stderr || ''}`);
  }
}

// ---- 2. the panel boots and enforces its own auth boundary ---------------
const port = await freePort();
const localPort = await freePort();
let log = '';
srv = spawn(process.execPath, [path.join(ROOT, 'admin/serve.mjs')], {
  cwd: ROOT, env: { ...process.env, CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
    CW_AUTH_STORE: path.join(SCRATCH, 'users.json'), CW_PANEL_CODE_STAMP: path.join(SCRATCH, 'code-stamp.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });
srv.on('exit', (code) => { if (code !== null && code !== 0) fail(`admin/serve.mjs exited ${code} before the smoke finished`, log.slice(-4000)); });

let failed = 0;
try {
  await waitForPort(localPort, () => log);

  const operator = await get(localPort, '/');
  if (operator.code !== 200) { process.stderr.write(`✖ operator port answered ${operator.code}, expected 200\n`); failed++; }
  else if (!/^<!doctype html/i.test(operator.body.trim())) { process.stderr.write('✖ operator port answered 200 but did not serve an HTML document — a 200 error page is not a working panel\n'); failed++; }
  else ok(`operator panel serves ${operator.body.length} bytes of HTML on :${localPort}`);

  const published = await get(port, '/');
  if (published.code !== 503 || !/unbootstrapped/.test(published.body) || /^<!doctype html/i.test(String(published.body).trim())) {
    process.stderr.write(`✖ published port answered ${published.code} to an UNAUTHENTICATED request on an unbootstrapped panel, expected the 503 bootstrap refusal — the tunnel-facing port must not serve the panel without a session\n`);
    failed++;
  } else ok(`published port refuses an unbootstrapped panel on :${port} (503)`);
} finally {
  srv.kill('SIGTERM');
}

if (failed) { process.stderr.write(`\n--- server output ---\n${log.slice(-4000)}\n`); process.exit(1); }
process.stdout.write('\nsmoke: OK\n');
