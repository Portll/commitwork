// admin/routes/offbox.mjs — remote.commitwork.online: where the off-box watcher's pages land.
//
// POST /api/offbox/page   the ingest. Bearer token, dispatched ABOVE the login gate.
// GET  /offbox/           the received pages (also `/` on an offbox hostname — see serve.mjs)
// GET  /api/offbox/pages  the same as JSON
//
// THE INGEST IS ABOVE THE CSRF AND LOGIN GATES ON PURPOSE, and it is the only route here that
// is. The page is sent by bin/offbox-watch-check.mjs from a LaunchAgent with no browser, session
// or CSRF token, and it must land whatever state the panel's own login store is in — a panel that
// has lost its users answers 503 to every session-bearing request, which is exactly the kind of
// local failure the off-box layer exists to survive. So it authenticates itself instead:
//
//   · CW_OFFBOX_PAGE_TOKEN, resolved through lib/secrets.mjs at CALL time.
//   · No declared token means the route REFUSES every request (503). It never falls back to open.
//   · Both sides hashed to a fixed width before timingSafeEqual, so length cannot short-circuit it.
//   · Answered only on a declared offbox hostname; every other Host falls through to both gates.
//
// The received body is not trusted to be the payload we send: it is re-shaped field by field
// before it is stored, so an attacker who obtains the token can write a bounded record and not a
// ledger entry of their choosing.
//
// This hostname resolves to this machine. It is a convenience surface, NOT the tamper route —
// an alarm about this box cannot be trusted to a service on it. The GitHub-issue route in
// bin/offbox-watch-check.mjs is the one that leaves.

import { esc } from '../../lib/html-escape.mjs';
import { THEME_HEAD, THEME_SWITCH } from '../lib/theme-head.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInto, SECRETS_FILE } from '../../lib/secrets.mjs';
import { chainedAppend } from '../../bin/lib/touch-chain.mjs';
import { ALARM_STATES, UNKNOWN_STATES } from '../../bin/offbox-watch-check.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWN_STATES = new Set(['ok', ...ALARM_STATES, ...UNKNOWN_STATES]);
export const TOKEN_ENV = 'CW_OFFBOX_PAGE_TOKEN';

export const offboxHosts = (env = process.env) => new Set(String(env.CW_OFFBOX_PANEL_HOSTS || 'remote.commitwork.online')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

export const pageStorePath = (env = process.env) => env.CW_OFFBOX_PAGE_STORE || join(REPO, '.claude', 'store', 'offbox-pages.jsonl');

export function declaredToken(env = process.env) {
  const r = resolveInto([TOKEN_ENV], { env, file: env.CW_SECRETS_FILE || SECRETS_FILE });
  const t = r.env[TOKEN_ENV];
  return typeof t === 'string' && t.length >= 16 ? t : null;
}

/** ok · no-token-configured (refuse, never open) · unauthorized. */
export function authorize(req, env = process.env) {
  const want = declaredToken(env);
  if (!want) return 'no-token-configured';
  const got = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!got) return 'unauthorized';
  const ha = createHash('sha256').update(got).digest();
  const hb = createHash('sha256').update(want).digest();
  return timingSafeEqual(ha, hb) ? 'ok' : 'unauthorized';
}

/** Re-shaped field by field: what is stored is ours, never the caller's object. */
export function normalisePage(body, receivedAt) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const state = str(b.state, 40);
  return {
    kind: 'offbox-page',
    receivedAt,
    at: str(b.at, 40),
    state: state && KNOWN_STATES.has(state) ? state : 'unrecognised',
    declaredState: state,
    ref: str(b.ref, 64),
    ledgerAgeHours: num(b.ledgerAgeHours),
    witnessAgeHours: num(b.witnessAgeHours),
    alarms: num(b.alarms) ?? 0,
  };
}

export function recordPage(body, { env = process.env, at = new Date().toISOString() } = {}) {
  const rec = normalisePage(body, at);
  const w = chainedAppend(pageStorePath(env), rec);
  return { ...w, record: rec };
}

export function readPages(env = process.env, limit = 200) {
  const p = pageStorePath(env);
  if (!existsSync(p)) return { pages: [], torn: 0, absent: true };
  let text;
  // Only ENOENT is an absence. A permission error must not read as "no pages".
  try { text = readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { pages: [], torn: 0, absent: true }; throw e; }
  const lines = text.split('\n').filter(Boolean);
  const pages = [];
  let torn = 0;
  for (const l of lines.slice(-limit)) {
    try { pages.push(JSON.parse(l)); } catch { torn++; }
  }
  return { pages: pages.reverse(), torn, absent: false, records: lines.length };
}

/**
 * The pre-gate ingest. Returns true when it answered, so serve.mjs can fall through for every
 * other path on this hostname rather than shadowing the panel.
 */
export function handleIngest({ req, res, pathname, send, readJsonBody, env = process.env }) {
  if (req.method !== 'POST' || pathname !== '/api/offbox/page') return false;
  const host = String((req.headers && req.headers.host) || '').toLowerCase().replace(/:\d+$/, '');
  if (!offboxHosts(env).has(host)) return false;
  const auth = authorize(req, env);
  if (auth === 'no-token-configured') {
    send(503, { ok: false, error: `${TOKEN_ENV} is not declared — this ingest refuses rather than accepting unauthenticated pages` });
    return true;
  }
  if (auth !== 'ok') {
    res.setHeader('www-authenticate', 'Bearer');
    send(401, { ok: false, error: 'a page must carry the declared bearer token' });
    return true;
  }
  readJsonBody(req, (body, err) => {
    if (err) return send(400, { ok: false, error: err });
    let w;
    try { w = recordPage(body, { env }); }
    catch (e) { return send(503, { ok: false, error: `page store unavailable: ${String(e.message).slice(0, 160)}` }); }
    // mode is reported, not smoothed: an `unlinked` append is a page that landed with a broken
    // chain, and the sender is entitled to know its alarm is on a store that could not link it.
    return send(w.ok ? 200 : 503, { ok: !!w.ok, mode: w.mode || null, state: w.record.state });
  });
  return true;
}


function view(ctx) {
  let store;
  try { store = readPages(process.env); }
  catch (e) { return ctx.send(503, `<!doctype html><title>offbox pages unavailable</title><p>page store unavailable: ${esc(e.message)}</p>`, 'text/html; charset=utf-8'); }
  const alarming = new Set(ALARM_STATES);
  const rows = store.pages.map((p) => `<tr class="${alarming.has(p.state) ? 'alarm' : p.state === 'ok' ? 'ok' : 'unknown'}">
      <td>${esc(p.receivedAt)}</td><td>${esc(p.state)}</td>
      <td>${p.ledgerAgeHours == null ? '—' : esc(p.ledgerAgeHours) + 'h'}</td>
      <td>${p.witnessAgeHours == null ? '—' : esc(p.witnessAgeHours) + 'h'}</td>
      <td>${esc(p.alarms)}</td><td><code>${esc(p.ref)}</code></td></tr>`).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>off-box watch pages</title>
${THEME_HEAD}
<style>
 body{margin:2rem}
 h1{font:600 1.1rem var(--sans);color:var(--head)}
 p.note{color:var(--mut);max-width:60ch}
 table{margin-top:1rem;min-width:0}
 tr.alarm td:nth-child(2){color:var(--crit);font-weight:700}
 tr.ok td:nth-child(2){color:var(--live)}
 tr.unknown td:nth-child(2){color:var(--part)}
 code{color:var(--mut)}
 .theme-switch{position:fixed;top:.75rem;right:.75rem}
</style></head><body>
<h1>off-box watch pages</h1>
<p class="note">Pages posted by <code>bin/offbox-watch-check.mjs</code> on this box. This surface runs
on the machine the witness exists to catch, so it is a convenience view and not the tamper route —
that one is an issue in the witness repository, which leaves.</p>
${store.absent ? '<p class="note">No page has ever been received. That is an absence, not a pass.</p>'
    : `<p class="note">${store.records} record(s)${store.torn ? `, ${store.torn} torn` : ''}.</p>
<table><thead><tr><th>received</th><th>state</th><th>ledger age</th><th>witness age</th><th>alarms</th><th>ref</th></tr></thead>
<tbody>${rows}</tbody></table>`}
${THEME_SWITCH}</body></html>`;
  return ctx.send(200, html, 'text/html; charset=utf-8', {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'",
  });
}

export const routes = [
  { method: 'GET', path: '/offbox/', handle: view },
  { method: 'GET', path: '/offbox', handle: view },
  { method: 'GET', path: '/api/offbox/pages', handle: (ctx) => {
    try { return ctx.send(200, { ok: true, ...readPages(process.env) }); }
    catch (e) { return ctx.send(503, { ok: false, error: `page store unavailable: ${e.message}` }); }
  } },
];
