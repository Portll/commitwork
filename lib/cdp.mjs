// lib/cdp.mjs — drive a real browser over the DevTools Protocol. Zero dependencies: Node's global
// WebSocket and the Chrome already installed.
//
// The house rule this module exists under: a witness that cannot observe must not look like one that
// observed nothing. Every session proves it can see (selfWitness) before any caller assertion runs,
// and a driver that never proved it is `unusable`, not clean.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

// Absent is its own state, never a pass and never a failure.
export function findChrome({ env = process.env, exists } = {}) {
  const isFile = exists || ((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  if (env.CW_CHROME) return isFile(env.CW_CHROME) ? { path: env.CW_CHROME } : { unavailable: `CW_CHROME=${env.CW_CHROME} is not a file` };
  for (const p of CHROME_CANDIDATES) if (isFile(p)) return { path: p };
  return { unavailable: 'no Chrome/Chromium/Edge found; set CW_CHROME' };
}

export function parseDevToolsUrl(stderr) {
  const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(stderr || ''));
  return m ? m[1] : null;
}

export async function launch({ timeoutMs = 20000, headless = true, env = process.env } = {}) {
  const found = findChrome({ env });
  if (found.unavailable) return { unavailable: found.unavailable };

  const profile = mkdtempSync(join(tmpdir(), 'cw-cdp-'));
  const argv = [
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-extensions', '--disable-background-networking',
    // fix: software GL — without it every WebGL view errors and reads as a defect
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
  ];
  if (headless) argv.unshift('--headless=new');

  const proc = spawn(found.path, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const wsUrl = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    proc.stderr.on('data', (d) => {
      buf += d;
      const u = parseDevToolsUrl(buf);
      if (u) { clearTimeout(t); resolve(u); }
    });
    proc.on('exit', () => { clearTimeout(t); resolve(parseDevToolsUrl(buf)); });
  });

  if (!wsUrl) {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    rmSync(profile, { recursive: true, force: true });
    return { unavailable: `browser did not announce a DevTools endpoint within ${timeoutMs}ms` };
  }
  return { proc, wsUrl, profile, path: found.path };
}

// One connection, request/response by id, events fanned to listeners.
export function connect(wsUrl, { timeoutMs = 45000 } = {}) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  let closed = null;

  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error(`cdp: socket error ${e?.message || ''}`));
  });
  ws.onclose = () => {
    closed = closed || new Error('cdp: socket closed');
    for (const [, p] of pending) p.reject(closed);
    pending.clear();
  };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`cdp: ${msg.method || ''} ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };

  const send = async (method, params = {}, sessionId) => {
    await ready;
    if (closed) throw closed;
    const id = nextId++;
    const p = new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`cdp: ${method} timed out after ${timeoutMs}ms`)); }, timeoutMs);
      pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return p;
  };

  return { send, ready, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, close: () => ws.close() };
}

/** A string as a JS literal for an evaluated expression; `<`, `>` and `/` are escaped so the
 *  literal stays inert if the expression text is ever embedded in markup. */
export const jsString = (s) => JSON.stringify(String(s)).replace(/[<>/]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export async function newPage(conn) {
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const consoleLines = [];
  const errors = [];
  conn.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleLines.push({ type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params?.exceptionDetails?.exception?.description || 'uncaught exception');
    }
  });
  await conn.send('Page.enable', {}, sessionId);
  await conn.send('Runtime.enable', {}, sessionId);
  await conn.send('Network.enable', {}, sessionId);

  const evaluate = async (expression) => {
    const r = await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`cdp: evaluate threw — ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  };

  // fix: prove the driver can observe before any caller assertion. An inert driver otherwise reports
  // an empty console and a blank page as a clean run.
  const selfWitness = async () => {
    const token = `cw-${randomUUID()}`;
    const back = await evaluate(`(${jsString(token)})`);
    if (back !== token) throw new Error('cdp: self-witness failed — the driver cannot read back its own value');
    return true;
  };

  return {
    sessionId,
    evaluate,
    selfWitness,
    // Carry a session obtained out of band. Refuses rather than reporting a silent no-op.
    setCookie: async (c) => {
      const r = await conn.send('Network.setCookie', c, sessionId);
      if (!r?.success) throw new Error(`cdp: Network.setCookie refused ${c.name}`);
      return true;
    },
    setViewport: async ({ width, height, mobile = false }) =>
      conn.send('Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile }, sessionId),
    // '' restores the browser default; 'light'/'dark' drive prefers-color-scheme, and
    // forced-colors is a separate feature the same call carries.
    setMedia: async ({ colorScheme = null, forcedColors = null } = {}) => {
      const features = [];
      if (colorScheme) features.push({ name: 'prefers-color-scheme', value: colorScheme });
      if (forcedColors) features.push({ name: 'forced-colors', value: forcedColors });
      return conn.send('Emulation.setEmulatedMedia', { media: '', features }, sessionId);
    },
    goto: async (url, { waitMs = 8000 } = {}) => {
      const loaded = new Promise((resolve) => {
        const off = conn.on((m) => {
          if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { off(); resolve(true); }
        });
        setTimeout(() => { off(); resolve(false); }, waitMs);
      });
      await conn.send('Page.navigate', { url }, sessionId);
      return { loaded: await loaded };
    },
    status: async () => evaluate('document.readyState'),
    title: async () => evaluate('document.title'),
    text: async (sel) => evaluate(`(document.querySelector(${jsString(sel)})||{}).textContent ?? null`),
    count: async (sel) => evaluate(`document.querySelectorAll(${jsString(sel)}).length`),
    click: async (sel) => evaluate(`(()=>{const e=document.querySelector(${jsString(sel)}); if(!e) return false; e.click(); return true;})()`),
    consoleLines,
    errors,
  };
}

export async function withBrowser(fn, opts = {}) {
  const b = await launch(opts);
  if (b.unavailable) return { unavailable: b.unavailable };
  const conn = connect(b.wsUrl);
  try {
    return { result: await fn(conn) };
  } finally {
    try { conn.close(); } catch { /* closing a closed socket */ }
    try { b.proc.kill('SIGKILL'); } catch { /* already gone */ }
    // fix: the browser is still writing its profile as it dies — ENOTEMPTY here is cleanup, not a
    // result, and must never surface as the caller's failure.
    try { rmSync(b.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch { /* a temp dir left behind is not a finding */ }
  }
}
