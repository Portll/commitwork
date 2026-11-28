#!/usr/bin/env node
// bin/wp-dynamic-witness.mjs — a DYNAMIC witness for WordPress broken access control.
//
// WHAT IT DOES. Installs a plugin in a disposable WordPress (WordPress Playground, PHP compiled to
// WASM — no Docker, no MySQL), enumerates its entry points (REST routes from the live /wp-json
// index, and admin-ajax / admin-post actions from a static route list), then calls each entry as
// (a) anonymous and (b) a freshly created subscriber. The ORACLE is state change: a trusted
// mu-plugin (bin/wp-witness/cw-oracle.php) snapshots options, user meta, posts, post meta, the
// plugin's own tables and wp-content files INSIDE WordPress, before and after each request. A request
// by a role that must not mutate privileged state, that DID, is a confirmed finding — and the
// request is its reproduction. The classifier is lib/wp-witness-oracle.mjs, unit-tested without
// Playground.
//
// WHAT IT IS NOT. A 200 is not a pass and a request that changed nothing is not a pass: it is
// `exercised-no-effect` (the endpoint ran but our guessed parameters may not have driven the
// mutating branch), held apart from `not-exercised` and `could-not-install`. Only a measured,
// role-inappropriate state change confirms. This oracle witnesses STATE-CHANGING access control; it
// does not witness information disclosure or SSRF (no persisted delta), which need a response/egress
// oracle — nuclei is run separately and labelled as such when present.
//
// TRUST. Installing and activating a plugin RUNS the plugin's PHP (activation hooks, every request).
// That is repo code executed by the scanner, so the lane refuses without the operator's consent
// (CW_REPO_TRUSTED=1, set by --trust-repo-manifest) and emits an UNSCANNED reason rather than a
// pass — the same gate the psalm full-mode lane uses. Declaration is split from authority: the tool
// reports the exact request; applying or acting on it stays a human act.
//
// EGRESS. Playground downloads a WordPress build from playground.wordpress.net / wordpress.org on
// first use (declared on the lane), into a lane-private HOME (CW_WP_HOME to persist it).
//
// Determinism: pinned WP/PHP versions, sorted output, CW_NOW honoured, atomic write. Finding
// identity excludes line numbers (see lib/wp-witness-oracle.mjs).
//
// usage: node bin/wp-dynamic-witness.mjs <plugin-dir> [--out DIR] [--routes wpaudit.json]
//                                        [--max-entries N] [--nuclei]
// exit: 0 every trial measured (findings or no-confirmed-change) · 1 crashed (uncaught exception)
//       · 2 usage · 3 noscan, no consent · 4 could-not-install · 5 error
//       · 6 undetermined (unattributed changes or failed snapshots)
// env (read at call time): CW_REPO_TRUSTED, CW_REPORT_DIR, CW_WP_ROUTES, CW_WP_VERSION,
//     CW_WP_PHP_VERSION, CW_WP_PLAYGROUND_CMD, CW_WP_PORT, CW_WP_MAX_ENTRIES, CW_WP_HOME, CW_WP_ONLY,
//     CW_WP_BOOT_MS, CW_WP_NUCLEI, CW_WP_NUCLEI_BIN, CW_WP_NUCLEI_MS, CW_WP_TMP, CW_NOW
//
// Zero runtime dependencies.

import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { diffSnapshots, subtractControl, snapshotUsable, classify, findingKey, VERDICT, CATEGORIES } from '../lib/wp-witness-oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MU_PLUGIN = join(HERE, 'wp-witness', 'cw-oracle.php');
// Exact pin (no scan-time fetch of a moving tag); the version every 2026-11-13 measurement ran on.
export const PLAYGROUND_PKG = '@wp-playground/cli@3.1.64';

export const UNSCANNED_REASON =
  'wp-dynamic-witness installs and ACTIVATES the plugin, which runs its PHP. Refused without '
  + 'CW_REPO_TRUSTED=1 (--trust-repo-manifest): UNSCANNED for dynamic access control, not clean.';

// Only the runner-derived marker. The operator switch (COMMITWORK_TRUST_REPO_MANIFEST) is stripped
// from lane envs on purpose and CW_REPO_TRUSTED is set after the base env, so a scanned tree cannot
// grant itself consent; standalone, --trust-repo-manifest sets CW_REPO_TRUSTED.
export function repoTrusted(env = process.env) {
  return env.CW_REPO_TRUSTED === '1';
}

// --- plugin shape ---------------------------------------------------------

/** The plugin's main file (the one with a `Plugin Name:` header), relative to the plugin dir, or
 *  null when the tree carries no plugin header — a non-plugin PHP repo is could-not-install, never
 *  a silent activation of the wrong file. */
export function findEntryFile(dir) {
  const php = readdirSync(dir).filter((f) => f.endsWith('.php'));
  for (const f of php) {
    try { if (/Plugin Name:/i.test(readFileSync(join(dir, f), 'utf8').slice(0, 8192))) return f; } catch { /* unreadable */ }
  }
  return null;
}

/** The directory holding the plugin header: the repo root, else one level down (a repo that keeps
 *  the plugin in src/ or a slug-named folder). Null when neither carries one. */
export function findPluginRoot(dir) {
  if (findEntryFile(dir)) return dir;
  let subs = [];
  try { subs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(\.|node_modules$|vendor$|tests?$)/.test(e.name)).map((e) => e.name).sort(); } catch { return null; }
  for (const s of subs) if (findEntryFile(join(dir, s))) return join(dir, s);
  return null;
}

// Dot-directories (.git, .claude/worktrees — nested checkouts of something else) and dependency trees
// are not the plugin's own surface.
export const skipDir = (name) => name.startsWith('.') || name === 'node_modules' || name === 'vendor';

/** Request keys the plugin reads from superglobals — used to enrich the parameter bag. */
export function scanSuperglobalKeys(dir, { limit = 400 } = {}) {
  const keys = new Set();
  const nonceActions = new Set();
  const walk = (d, depth) => {
    if (depth > 6) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!skipDir(e.name)) walk(p, depth + 1); continue; }
      if (!e.name.endsWith('.php')) continue;
      let src = '';
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      for (const m of src.matchAll(/\$_(?:GET|POST|REQUEST|COOKIE|FILES)\s*\[\s*['"]([^'"]{1,64})['"]\s*\]/g)) keys.add(m[1]);
      // REST handlers read through the request object, not superglobals
      for (const m of src.matchAll(/->get_param\s*\(\s*['"]([^'"]{1,64})['"]/g)) keys.add(m[1]);
      for (const m of src.matchAll(/\$request\s*\[\s*['"]([^'"]{1,64})['"]\s*\]/g)) keys.add(m[1]);
      for (const m of src.matchAll(/(?:check_ajax_referer|wp_create_nonce|wp_verify_nonce)\s*\([^)]*?['"]([^'"]{1,64})['"]/g)) nonceActions.add(m[1]);
    }
  };
  walk(dir, 0);
  return { keys: [...keys].slice(0, limit), nonceActions: [...nonceActions].slice(0, limit) };
}

/** admin-ajax / admin-post actions the plugin registers in its OWN source — so the tool needs no
 *  external route list. `add_action('wp_ajax_nopriv_x', ...)`, `wp_ajax_x`, `admin_post[_nopriv]_x`. */
export function scanActionRegistrations(dir, { limit = 200 } = {}) {
  const found = new Map(); // id -> entry
  const walk = (d, depth) => {
    if (depth > 6) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!skipDir(e.name)) walk(p, depth + 1); continue; }
      if (!e.name.endsWith('.php')) continue;
      let src = '';
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      for (const m of src.matchAll(/add_action\s*\(\s*['"](wp_ajax_nopriv_|wp_ajax_|admin_post_nopriv_|admin_post_)([A-Za-z0-9_\-]{1,80})['"]/g)) {
        const nopriv = /nopriv/.test(m[1]);
        const entryKind = m[1].startsWith('admin_post') ? (nopriv ? 'admin-post-nopriv' : 'admin-post') : (nopriv ? 'ajax-nopriv' : 'ajax');
        const selector = m[2];
        const id = `${entryKind}:${selector}`;
        if (!found.has(id)) found.set(id, { entryKind, selector, nopriv, fromSource: true });
      }
    }
  };
  walk(dir, 0);
  return [...found.values()].sort((a, b) => a.selector.localeCompare(b.selector)).slice(0, limit);
}

const COMMON_PARAM_KEYS = [
  'v', 'val', 'value', 'data', 'content', 'text', 'body', 'message', 'title', 'name', 'label',
  'key', 'k', 'option', 'option_name', 'field', 'meta_key', 'setting', 'slug', 'id', 'post_id',
  'user_id', 'order', 'orderby', 'type', 'status', 'mode', 'tab', 'section', 'url', 'email', 'q', 's',
];

export function valueFor(key) {
  const k = key.toLowerCase();
  if (/url|redirect|link|endpoint|host|callback/.test(k)) return 'http://127.0.0.1:1/cwssrf';
  if (/email|mail/.test(k)) return 'cwwitness@example.invalid';
  if (/(^id$)|_id$|count|limit|number|qty|quantity|page$/.test(k)) return '1';
  if (/(^key$)|option|meta_key|name$|field|slug|setting/.test(k)) return `cwprobe_${k}`.slice(0, 48);
  return 'cwprobe1';
}

/** A broad parameter bag. Over-sending is harmless; endpoints ignore keys they do not read. */
export function paramBag(extraKeys = []) {
  const bag = {};
  for (const k of [...COMMON_PARAM_KEYS, ...extraKeys]) if (!(k in bag)) bag[k] = valueFor(k);
  return bag;
}

// --- route / entry list ---------------------------------------------------

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CORE_REST_NS = /^\/(wp\/v2|wp-site-health|wp-block-editor|oembed|batch|wp\/v2-[^/]+)(\/|$)/;

/** REST entries from the live /wp-json index, minus WordPress core namespaces. */
export function restEntriesFromIndex(index) {
  const out = [];
  const routes = (index && index.routes) || {};
  for (const [route, def] of Object.entries(routes)) {
    if (route === '/' || CORE_REST_NS.test(route)) continue;
    const methods = new Set();
    for (const ep of def.endpoints || []) for (const m of ep.methods || []) methods.add(m);
    const args = def.endpoints && def.endpoints[0] ? Object.keys(def.endpoints[0].args || {}) : [];
    out.push({ entryKind: 'rest', selector: route, methods: [...methods].sort(), args });
  }
  return out.sort((a, b) => a.selector.localeCompare(b.selector));
}

/** admin-ajax / admin-post actions from a wpaudit-style route list. */
export function actionEntriesFromRoutes(routeDoc) {
  const out = [];
  const seen = new Set();
  for (const e of (routeDoc && routeDoc.entrySummaries) || []) {
    let entryKind = null;
    if (e.kind === 'ajax' || e.kind === 'ajax-nopriv') entryKind = e.kind;
    else if (e.kind === 'admin-post' || e.kind === 'admin-post-nopriv') entryKind = e.kind;
    else continue;
    // hook like wp_ajax_nopriv_fx_save / wp_ajax_fx_save / admin_post_x / admin_post_nopriv_x
    const action = String(e.hook || '').replace(/^wp_ajax_(nopriv_)?/, '').replace(/^admin_post_(nopriv_)?/, '');
    if (!action) continue;
    const id = `${entryKind}:${action}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ entryKind, selector: action, nopriv: /nopriv/.test(e.kind), cap: !!e.cap, nonce: !!e.nonce, permMissing: !!e.permMissing });
  }
  return out.sort((a, b) => a.selector.localeCompare(b.selector));
}

/** Mutation-likely first: no cap / permission missing / nopriv rank above gated ones. */
export function prioritize(entries) {
  const score = (e) => {
    let s = 0;
    if (e.permMissing || e.cap === false) s += 2;
    if (e.nopriv) s += 2;
    if (e.entryKind === 'rest' && (e.methods || []).some((m) => MUTATING_METHODS.has(m))) s += 2;
    if (e.nonce) s -= 1;
    return s;
  };
  return [...entries].sort((a, b) => score(b) - score(a) || a.selector.localeCompare(b.selector));
}

// --- tiny cookie jar over fetch -------------------------------------------

class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of sc) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i < 0) continue;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (v === '' || /deleted/i.test(line)) this.c.delete(k); else this.c.set(k, v);
    }
  }
  header() { return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}

// --- the driver -----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(base, token, ms = 120000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/?__cw=ping&__cwtoken=${token}`);
      if (r.ok) { const j = await r.json(); if (j && j.ok) return j; }
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return null;
}

async function cwCall(base, token, op, { jar, extra = '' } = {}) {
  const url = `${base}/?__cw=${op}&__cwtoken=${token}${extra}`;
  const h = {};
  if (jar) h.Cookie = jar.header();
  const r = await fetch(url, { headers: h, redirect: 'manual' });
  if (jar) jar.absorb(r);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
}

async function snapshot(base, token, jar) {
  // snapshots are taken anonymously (no jar) so the oracle reads the same surface every time
  const s = await cwCall(base, token, 'snapshot', { jar: null });
  return s;
}

async function subscriberLogin(base, user, pass) {
  const jar = new Jar();
  jar.c.set('wordpress_test_cookie', 'WP+Cookie+check');
  const form = new URLSearchParams({ log: user, pwd: pass, 'wp-submit': 'Log In', testcookie: '1', redirect_to: `${base}/wp-admin/` });
  const r = await fetch(`${base}/wp-login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
    body: form.toString(),
    redirect: 'manual',
  });
  jar.absorb(r);
  return jar;
}

function buildRequest(base, entry, role, params, nonces) {
  // returns { method, url, headers, body } for one transport
  const p = { ...params };
  // the route's own declared args, typed like every other key — the registry names what it reads
  for (const a of entry.args || []) if (!(a in p)) p[a] = valueFor(a);
  if (role === 'subscriber' && nonces) for (const n of ['_wpnonce', '_ajax_nonce', 'security', 'nonce']) p[n] = nonces;
  if (entry.entryKind === 'rest') {
    const method = (entry.methods || []).find((m) => MUTATING_METHODS.has(m)) || 'POST';
    // Playground serves via a PHP router and does not rewrite /wp-json, so route through ?rest_route=
    const rr = `${base}/?rest_route=${encodeURIComponent(entry.selector)}`;
    if (method === 'GET' || method === 'DELETE') return { method, url: `${rr}&${new URLSearchParams(p)}` };
    return { method, url: rr, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) };
  }
  // ajax / admin-post
  const script = entry.entryKind.startsWith('admin-post') ? 'wp-admin/admin-post.php' : 'wp-admin/admin-ajax.php';
  const q = new URLSearchParams({ action: entry.selector, ...p });
  return { method: 'POST', url: `${base}/${script}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q.toString(), getUrl: `${base}/${script}?${q}` };
}

async function fireAndMeasure({ base, token, entry, role, jar, params, nonce }) {
  const before = await snapshot(base, token, jar);
  const req = buildRequest(base, entry, role, params, nonce);
  let requestIssued = false; let httpStatus = null; let transportErr = null;
  try {
    const headers = { ...(req.headers || {}) };
    if (jar) headers.Cookie = jar.header();
    const res = await fetch(req.url, { method: req.method, headers, body: req.body, redirect: 'manual' });
    requestIssued = true; httpStatus = res.status;
    await res.text();
  } catch (e) { transportErr = String(e && e.message || e); }
  const after = await snapshot(base, token, jar);
  return { before, after, req, requestIssued, httpStatus, transportErr };
}

/** Keys that moved in an idle double-snapshot = ambient core churn, subtracted from every trial. */
export function ambientIgnore(before, after) {
  const d = diffSnapshots(before, after);
  const ig = {};
  for (const cat of CATEGORIES) {
    const set = new Set();
    for (const kind of ['added', 'removed', 'changed']) for (const k of Object.keys(d[cat][kind])) set.add(k);
    ig[cat] = set;
  }
  return ig;
}

function evidenceFrom(delta, privileged) {
  // first few privileged keys with a decoded preview
  const out = [];
  for (const tag of privileged.slice(0, 8)) {
    const [catKind, key] = tag.split(':');
    const [cat, kind] = catKind.split('.');
    const bucket = delta[cat] && delta[cat][kind];
    let val = bucket && bucket[key];
    if (val && typeof val === 'object') val = `${String(val.from).split('\x01')[1] || ''} -> ${String(val.to).split('\x01')[1] || ''}`;
    else if (typeof val === 'string') val = val.split('\x01')[1] || val;
    out.push({ where: catKind, key, preview: val });
  }
  return out;
}

export async function runWitness(opts) {
  const env = opts.env || process.env;
  let pluginDir = resolve(opts.pluginDir);
  const outDir = opts.outDir || env.CW_REPORT_DIR || join(process.cwd(), 'wp-witness-out');
  const maxEntries = Number(opts.maxEntries || env.CW_WP_MAX_ENTRIES || 40);
  const wpVersion = env.CW_WP_VERSION || '6.8.2';
  const phpVersion = env.CW_WP_PHP_VERSION || '8.3';
  const port = Number(opts.port || env.CW_WP_PORT || (9500 + (process.pid % 400)));
  const base = `http://127.0.0.1:${port}`;
  const token = `cwtok${process.pid}${Date.now().toString(36)}`;
  mkdirSync(outDir, { recursive: true });

  const report = {
    tool: 'wp-dynamic-witness',
    generatedAt: nowISO(env),
    runtime: { kind: 'playground', wp: wpVersion, php: phpVersion },
    plugin: { path: pluginDir, slug: basename(pluginDir) },
    install: { ok: false },
    summary: { confirmed: 0, unattributedChange: 0, exercisedNoEffect: 0, notExercised: 0, notMeasured: 0, couldNotInstall: 0 },
    entries: [],
    findings: [],
  };

  if (!repoTrusted(env)) {
    report.status = 'noscan';
    report.coverage = 'unknown';
    report.reason = UNSCANNED_REASON;
    return report;
  }
  if (!existsSync(pluginDir)) { report.status = 'error'; report.reason = `plugin dir not found: ${pluginDir}`; return report; }

  const root = findPluginRoot(pluginDir);
  if (!root) { report.status = 'could-not-install'; report.coverage = 'unknown'; report.reason = 'no WordPress plugin header (Plugin Name:) at the root or one level down — UNSCANNED, not clean'; report.summary.couldNotInstall = 1; return report; }
  if (root !== pluginDir) report.plugin.subdir = root.slice(pluginDir.length + 1);
  pluginDir = root;
  const entryFile = findEntryFile(pluginDir);
  const slug = report.plugin.slug;
  report.plugin.entryFile = entryFile;

  // stage: a work root with the plugin and our mu-plugin mounted into a wp-content layout
  const work = mkdtempSync(join(env.CW_WP_TMP || tmpdir(), 'cw-wpwitness-'));
  const muDir = join(work, 'mu-plugins');
  const pluginsDir = join(work, 'plugins', slug);
  mkdirSync(muDir, { recursive: true });
  mkdirSync(dirname(pluginsDir), { recursive: true });
  cpSync(MU_PLUGIN, join(muDir, 'cw-oracle.php'));
  cpSync(pluginDir, pluginsDir, { recursive: true, filter: (src) => src === pluginDir || !basename(src).startsWith('.') });

  const t0 = Date.now();
  const cmd = env.CW_WP_PLAYGROUND_CMD || 'npx';
  const cmdArgs = env.CW_WP_PLAYGROUND_CMD
    ? (opts.playgroundArgs || [])
    : ['--yes', PLAYGROUND_PKG, 'server',
      '--port', String(port), '--wp', wpVersion, '--php', phpVersion, '--verbosity', 'quiet',
      '--mount', `${pluginsDir}:/wordpress/wp-content/plugins/${slug}`,
      '--mount', `${muDir}:/wordpress/wp-content/mu-plugins`,
      '--define', 'CW_WITNESS_TOKEN', token,
      '--define', 'CW_WITNESS_PLUGIN', `${slug}/${entryFile}`,
      // cron and its loopback spawn mutate state on a timer, not per request — off in the sandbox
      '--define-bool', 'DISABLE_WP_CRON', 'true'];
  // A lane-private HOME: npx's cache (~/.npm) and Playground's WordPress build cache
  // (~/.wordpress-playground, homedir()-relative) land here, never in the operator's shared caches —
  // a repo-code lane writing a cache other lanes later execute from would be a supply-chain path.
  // Persist it across runs with CW_WP_HOME to skip the download (the cold boot).
  const childHome = env.CW_WP_HOME || join(tmpdir(), 'cw-wp-home');
  mkdirSync(childHome, { recursive: true });
  report.runtime.home = env.CW_WP_HOME ? 'CW_WP_HOME' : 'tmpdir/cw-wp-home';
  const child = spawn(cmd, cmdArgs, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, HOME: childHome, npm_config_cache: join(childHome, '.npm') } });
  const serverLog = [];
  child.stdout.on('data', (d) => serverLog.push(d.toString()));
  child.stderr.on('data', (d) => serverLog.push(d.toString()));

  try {
    const health = await waitForHealth(base, token, Number(env.CW_WP_BOOT_MS || 180000));
    if (!health) {
      report.status = 'could-not-install';
      report.reason = 'WordPress Playground did not become healthy within the boot window';
      report.serverLog = serverLog.join('').slice(-2000);
      report.summary.couldNotInstall = 1;
      return report;
    }
    report.runtime.wpReported = health.wp;
    report.install.boot_ms = Date.now() - t0;

    const setup = await cwCall(base, token, 'setup');
    report.install.setup = setup;
    const subUid = setup && setup.subUid;
    report.install.activate = setup && setup.activate;
    // Fail closed: a plugin that did not activate exposes none of its entry points, so anything
    // measured after this would describe WordPress core, not the plugin.
    report.install.ok = !!(subUid && setup.activate === 'ok');
    if (!report.install.ok) {
      report.status = 'could-not-install';
      report.coverage = 'unknown';
      report.reason = `plugin did not activate (setup http ${setup && setup._status != null ? setup._status : 'ok'}, activate=${String(setup && setup.activate)}) — UNSCANNED, not clean`;
      report.summary.couldNotInstall = 1;
      report.serverLog = serverLog.join('').slice(-2000);
      return report;
    }

    // ambient control: two idle snapshots, the keys that move are subtracted everywhere
    const ia = await snapshot(base, token);
    await sleep(200);
    const ib = await snapshot(base, token);
    const ignore = ambientIgnore(ia, ib);
    report.ambient = Object.fromEntries(CATEGORIES.map((c) => [c, ignore[c].size]));
    report.tablesEnumerated = !!(ib && ib._meta && ib._meta.tablesEnumerated);
    if (!report.tablesEnumerated) report.tablesCaveat = 'plugin custom tables could not be enumerated in this runtime; custom-table writes are NOT witnessed here';

    // subscriber session
    let subJar = null;
    try {
      subJar = await subscriberLogin(base, 'cwsubscriber', 'cwsubscriberpass!23');
      const who = await cwCall(base, token, 'whoami', { jar: subJar });
      report.install.subscriber = who;
      if (!(who && Number(who.uid) > 0)) { subJar = null; report.install.subscriberLoginFailed = true; }
    } catch (e) { report.install.subscriberLoginError = String(e && e.message || e); }

    // entry list
    const sg = scanSuperglobalKeys(pluginDir);
    const bag = paramBag(sg.keys);
    let restEntries = [];
    try {
      const idxRes = await fetch(`${base}/?rest_route=/`);
      const idx = await idxRes.json();
      restEntries = restEntriesFromIndex(idx);
    } catch (e) { report.restDiscoveryError = String(e && e.message || e); }
    let routeDoc = null;
    const routesPath = opts.routes || env.CW_WP_ROUTES;
    if (routesPath && existsSync(routesPath)) { try { routeDoc = JSON.parse(readFileSync(routesPath, 'utf8')); } catch { /* ignore */ } }
    // actions: the plugin's own registrations (self-contained) unioned with any supplied route list
    const actionMap = new Map();
    for (const a of [...scanActionRegistrations(pluginDir), ...actionEntriesFromRoutes(routeDoc)]) {
      const id = `${a.entryKind}:${a.selector}`;
      if (!actionMap.has(id)) actionMap.set(id, a);
    }
    const actionEntries = [...actionMap.values()];
    // CW_WP_ONLY: an optional selector regex for a targeted re-run; the report records it
    const only = opts.only || env.CW_WP_ONLY;
    let pool = [...restEntries, ...actionEntries];
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the operator's own selector regex from --only or CW_WP_ONLY, documented as a regex; it filters this run's entry list
    if (only) { const re = new RegExp(only); pool = pool.filter((e) => re.test(e.selector)); report.selectorFilter = only; }
    const entries = prioritize(pool).slice(0, maxEntries);
    report.entryCounts = { rest: restEntries.length, actions: actionEntries.length, exercised: entries.length };

    for (const entry of entries) {
      const row = { entryKind: entry.entryKind, selector: entry.selector, methods: entry.methods, trials: [] };
      const roles = [{ name: 'anonymous', jar: null }];
      // an anonymous admin-ajax action without a nopriv twin returns 0; still worth measuring.
      if (subJar) roles.push({ name: 'subscriber', jar: subJar });
      for (const role of roles) {
        // a subscriber nonce for this action string, mirroring what the subscriber's own session yields
        let nonce = null;
        if (role.name === 'subscriber') {
          const candidates = [entry.selector, ...sg.nonceActions];
          for (const a of candidates.slice(0, 4)) {
            const n = await cwCall(base, token, 'nonce', { jar: role.jar, extra: `&action=${encodeURIComponent(a)}` });
            if (n && n.nonce) { nonce = n.nonce; break; }
          }
        }
        // differential control: same role + transport aimed at a selector that does not exist
        const ctlEntry = { ...entry, selector: entry.entryKind === 'rest' ? `${entry.selector}/cw-no-such-route` : 'cw_no_such_action' };
        const ctl = await fireAndMeasure({ base, token, entry: ctlEntry, role: role.name, jar: role.jar, params: bag, nonce });
        const ctlDelta = diffSnapshots(ctl.before, ctl.after, { ignore });
        const m = await fireAndMeasure({ base, token, entry, role: role.name, jar: role.jar, params: bag, nonce });
        const measured = [ctl.before, ctl.after, m.before, m.after].every(snapshotUsable);
        const delta = measured ? subtractControl(diffSnapshots(m.before, m.after, { ignore }), ctlDelta) : diffSnapshots({}, {});
        const cls = classify({ role: role.name, selfUid: subUid, requestIssued: m.requestIssued, delta, measured });
        const trial = {
          role: role.name,
          requestIssued: m.requestIssued,
          httpStatus: m.httpStatus,
          transport: m.req.method,
          verdict: cls.verdict,
          changed: cls.changed,
          privileged: cls.privileged,
          unattributed: cls.unattributed,
          reproduction: { method: m.req.method, url: m.req.url.replace(base, '{base}'), withCookies: !!role.jar, withNonce: !!nonce },
        };
        if (m.transportErr) trial.transportErr = m.transportErr;
        if (cls.verdict === VERDICT.CONFIRMED) {
          trial.evidence = evidenceFrom(delta, cls.privileged);
          report.findings.push({
            key: findingKey({ plugin: slug, entryKind: entry.entryKind, selector: entry.selector, role: role.name }),
            plugin: slug, entryKind: entry.entryKind, selector: entry.selector, role: role.name,
            severity: 'high',
            changed: cls.privileged, evidence: trial.evidence, reproduction: trial.reproduction,
          });
        }
        row.trials.push(trial);
      }
      const order = [VERDICT.CONFIRMED, VERDICT.UNATTRIBUTED, VERDICT.NOT_MEASURED, VERDICT.NO_EFFECT, VERDICT.NOT_EXERCISED];
      row.verdict = order.find((v) => row.trials.some((t) => t.verdict === v)) || VERDICT.NOT_EXERCISED;
      report.entries.push(row);
    }

    // Optional nuclei pass against the SAME live site. Its results are a separate, labelled block:
    // a signature match is a different kind of evidence from a measured state change, and it never
    // feeds the witness's verdicts or findings.
    if (opts.nuclei || env.CW_WP_NUCLEI === '1') report.nuclei = await runNuclei(base, env);

    // sort findings/entries for byte-stable output
    report.findings.sort((a, b) => a.key.localeCompare(b.key));
    report.entries.sort((a, b) => `${a.entryKind}${a.selector}`.localeCompare(`${b.entryKind}${b.selector}`));
    for (const r of report.entries) for (const t of r.trials) {
      if (t.verdict === VERDICT.CONFIRMED) report.summary.confirmed++;
      else if (t.verdict === VERDICT.UNATTRIBUTED) report.summary.unattributedChange++;
      else if (t.verdict === VERDICT.NOT_MEASURED) report.summary.notMeasured++;
      else if (t.verdict === VERDICT.NO_EFFECT) report.summary.exercisedNoEffect++;
      else report.summary.notExercised++;
    }
    // Undetermined is its own state: unattributable changes and failed measurements are neither a
    // finding nor a pass, so they keep the run off no-confirmed-change and its exit off 0.
    const undetermined = report.summary.unattributedChange + report.summary.notMeasured;
    report.status = report.findings.length ? 'findings' : undetermined ? 'undetermined' : 'no-confirmed-change';
    report.coverage = report.summary.notMeasured ? 'reduced' : 'full';
  } finally {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return report;
}

// 0 = measured (clean or findings); non-zero = unmeasured, so coverage reads reduced.
export function exitCodeFor(status) {
  if (status === 'findings' || status === 'no-confirmed-change') return 0;
  if (status === 'noscan') return 3;
  if (status === 'undetermined') return 6;
  if (status === 'could-not-install') return 4;
  return 5; // error / unknown
}

/** nuclei's WordPress templates against the running site. absent / timeout / error / ran. */
export async function runNuclei(base, env = process.env) {
  const bin = env.CW_WP_NUCLEI_BIN || 'nuclei';
  const probe = await new Promise((res) => { const p = spawn(bin, ['-version'], { stdio: 'ignore' }); p.on('error', () => res(false)); p.on('exit', (c) => res(c === 0)); });
  if (!probe) return { label: 'nuclei (signature templates, NOT the state-change oracle)', state: 'absent' };
  const limitMs = Number(env.CW_WP_NUCLEI_MS || 300000);
  return await new Promise((res) => {
    const out = [];
    const p = spawn(bin, ['-u', base, '-tags', 'wordpress,wp-plugin', '-jsonl', '-silent', '-disable-update-check', '-rl', '50', '-timeout', '5'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const t = setTimeout(() => { try { p.kill('SIGTERM'); } catch { /* gone */ } res({ label: 'nuclei (signature templates, NOT the state-change oracle)', state: 'timeout', limitMs }); }, limitMs);
    p.stdout.on('data', (d) => out.push(d.toString()));
    p.on('error', (e) => { clearTimeout(t); res({ label: 'nuclei (signature templates, NOT the state-change oracle)', state: 'error', error: String(e.message) }); });
    p.on('exit', (code) => {
      clearTimeout(t);
      const results = out.join('').split('\n').filter(Boolean).map((l) => { try { const j = JSON.parse(l); return { templateId: j['template-id'], severity: j.info && j.info.severity, matched: String(j['matched-at'] || '').replace(base, '{base}') }; } catch { return null; } }).filter(Boolean)
        .sort((a, b) => `${a.templateId}${a.matched}`.localeCompare(`${b.templateId}${b.matched}`));
      res({ label: 'nuclei (signature templates, NOT the state-change oracle)', state: code === 0 ? 'ran' : 'error', exit: code, results });
    });
  });
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.outDir = argv[++i];
    else if (t === '--routes') a.routes = argv[++i];
    else if (t === '--max-entries') a.maxEntries = Number(argv[++i]);
    else if (t === '--nuclei') a.nuclei = true;
    else if (t === '--trust-repo-manifest') process.env.CW_REPO_TRUSTED = '1';
    else a._.push(t);
  }
  a.pluginDir = a._[0];
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pluginDir) { process.stderr.write('usage: wp-dynamic-witness <plugin-dir> [--out DIR] [--routes wpaudit.json] [--max-entries N]\n'); process.exit(2); }
  const report = await runWitness(a);
  const outDir = report && (a.outDir || process.env.CW_REPORT_DIR || join(process.cwd(), 'wp-witness-out'));
  mkdirSync(outDir, { recursive: true });
  writeAtomic(join(outDir, 'wp-witness.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`wp-dynamic-witness: ${report.status} — confirmed=${report.summary.confirmed} unattributed=${report.summary.unattributedChange || 0} not-measured=${report.summary.notMeasured || 0} no-effect=${report.summary.exercisedNoEffect} not-exercised=${report.summary.notExercised}\n`);
  if (report.reason) process.stdout.write(`  ${report.reason}\n`);
  // Fail closed on any UNMEASURED outcome so the lane's exit sidecar reads reduced coverage rather
  // than a clean pass: measured (findings or no-confirmed-change) is 0; everything else is non-zero.
  process.exit(exitCodeFor(report.status));
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`${(e && e.stack) || e}\n`); process.exit(1); });
}
