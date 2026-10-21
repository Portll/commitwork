// The WordPress lanes' network sources, behind one door. Every base URL is overridable by a CW_*
// variable read at call time, every answer is cached in a private store outside every repository,
// and every failure comes back as a stated reason, never as an empty answer.
//
// env, read at call time:
//   CW_WP_API_URL        api.wordpress.org: core checksums and the core release status list
//   CW_WP_DOWNLOADS_URL  downloads.wordpress.org: plugin checksums
//   CW_WPVULN_URL        www.wpvulnerability.net: core, plugin and theme advisories
//     Each takes an http(s) base or a file:// directory laid out as `core/checksums/1.0/<v>-<locale>.json`,
//     `core/stable-check/1.0.json`, `plugin-checksums/<slug>/<version>.json` and `<type>/<key>.json`.
//     A file:// base is how the tests and the canary run with no network; it is never cached.
//   CW_WP_CACHE          the cache directory (default ~/.commitwork/cache/wordpress; `off` disables)
//   CW_WP_OFFLINE        `1`: never open a connection; answer from the cache or say why not
//   CW_WP_TIMEOUT_MS     per request (default 20000)
//   CW_WPVULN_TTL_HOURS  how long advisory and release-status answers are reused (default 24)
//   CW_NOW               the clock cache ages are measured against
//
// The cache is private because its keys are an inventory: which plugins, at which versions, the
// scanned sites run. It lives under the operator's home (0700 directory, 0600 files), never in a
// tree. Checksums for a published version do not change, so a hit is reused indefinitely; a
// "not published" answer is reused for a week; advisories expire after CW_WPVULN_TTL_HOURS. When the
// network fails, an expired entry is used and marked stale rather than dropped.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../../lib/clock.mjs';

const UA = 'commitwork (WordPress integrity and advisory lanes)';
const MAX_BODY = 32 * 1024 * 1024;
const NOT_FOUND_TTL_H = 24 * 7;

const classifyStatus = (status) => (status === 404 ? 'not-found' : null);
export const KINDS = Object.freeze({
  'core-checksums': {
    env: 'CW_WP_API_URL', base: 'https://api.wordpress.org', ttl: 'immutable',
    path: (p) => `/core/checksums/1.0/?version=${encodeURIComponent(p.version)}&locale=${encodeURIComponent(p.locale)}`,
    file: (p) => `core/checksums/1.0/${p.version}-${p.locale}.json`,
    // api.wordpress.org answers 200 {"checksums":false} for a version it never released.
    classify: (status, body) => classifyStatus(status)
      || (status === 200 && body && body.checksums && typeof body.checksums === 'object' ? 'ok'
        : status === 200 && body && body.checksums === false ? 'not-found' : 'error'),
  },
  'core-stable-check': {
    env: 'CW_WP_API_URL', base: 'https://api.wordpress.org', ttl: 'advisory',
    path: () => '/core/stable-check/1.0/',
    file: () => 'core/stable-check/1.0.json',
    classify: (status, body) => (status === 200 && body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length ? 'ok' : 'error'),
  },
  'plugin-checksums': {
    env: 'CW_WP_DOWNLOADS_URL', base: 'https://downloads.wordpress.org', ttl: 'immutable',
    path: (p) => `/plugin-checksums/${encodeURIComponent(p.slug)}/${encodeURIComponent(p.version)}.json`,
    file: (p) => `plugin-checksums/${p.slug}/${p.version}.json`,
    classify: (status, body) => classifyStatus(status)
      || (status === 200 && body && body.files && typeof body.files === 'object' ? 'ok' : 'error'),
  },
  advisories: {
    env: 'CW_WPVULN_URL', base: 'https://www.wpvulnerability.net', ttl: 'advisory',
    path: (p) => `/${p.type}/${encodeURIComponent(p.key)}/`,
    file: (p) => `${p.type}/${p.key}.json`,
    classify: (status, body) => classifyStatus(status)
      || (status === 200 && body && body.error === 0 && body.data && typeof body.data === 'object' ? 'ok' : 'error'),
  },
});

const env = (k) => process.env[k];
export const offline = () => env('CW_WP_OFFLINE') === '1';
const timeoutMs = () => { const n = Number(env('CW_WP_TIMEOUT_MS')); return Number.isFinite(n) && n > 0 ? n : 20000; };
const advisoryTtlH = () => { const n = Number(env('CW_WPVULN_TTL_HOURS')); return Number.isFinite(n) && n >= 0 ? n : 24; };

/** The cache directory, or null when CW_WP_CACHE=off. */
export const cacheDir = () => {
  const v = env('CW_WP_CACHE');
  if (v === 'off' || v === '0') return null;
  return v ? resolve(v) : join(homedir(), '.commitwork', 'cache', 'wordpress');
};
/** How the cache was chosen, for a report: never the path, which names the operator's home. */
export const cacheLabel = () => {
  const v = env('CW_WP_CACHE');
  return v === 'off' || v === '0' ? 'off' : v ? 'CW_WP_CACHE' : 'default';
};

/** {url, label, scheme} for a kind's base, read now. The label never carries a local path. */
export function baseOf(kind) {
  const k = KINDS[kind];
  const raw = (env(k.env) || k.base).replace(/\/+$/, '');
  let scheme = '';
  try { scheme = new URL(raw).protocol.replace(/:$/, ''); } catch { scheme = ''; }
  const overridden = !!env(k.env);
  const label = scheme === 'file' ? `file (${k.env})` : overridden ? `${raw} (${k.env})` : raw;
  return { url: raw, label, scheme };
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const nowMs = () => Date.parse(nowISO());

function readCache(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : { problem: `cache unreadable (${e.code || e.message})` }; }
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j.fetchedAt !== 'string' || !['ok', 'not-found'].includes(j.status)) return { problem: 'cache entry malformed' };
    return { entry: j };
  } catch { return { problem: 'cache entry unparseable' }; }
}

function writeCache(path, entry) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  renameSync(tmp, path);
}

function freshFor(kind, entry, now) {
  const age = (now - Date.parse(entry.fetchedAt)) / 3600000;
  if (!Number.isFinite(age) || age < 0) return { fresh: false, ageHours: null };
  const ttl = entry.status === 'not-found' ? Math.min(NOT_FOUND_TTL_H, KINDS[kind].ttl === 'advisory' ? advisoryTtlH() : NOT_FOUND_TTL_H)
    : KINDS[kind].ttl === 'immutable' ? Infinity : advisoryTtlH();
  return { fresh: age <= ttl, ageHours: Math.floor(age) };
}

const netReason = (e) => {
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return `timed out after ${timeoutMs()} ms`;
  const code = e && e.cause && (e.cause.code || e.cause.name);
  return `network error${code ? ` (${code})` : ''}: ${String((e && e.message) || e).slice(0, 120)}`;
};

async function viaNetwork(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs()), redirect: 'follow' });
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_BODY) throw Object.assign(new Error(`response of ${len} bytes is over the ${MAX_BODY}-byte cap`), { name: 'TooLarge' });
  const text = await res.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('response over the size cap'), { name: 'TooLarge' });
  let body;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: res.status, body };
}

function viaFile(baseUrl, rel) {
  let path;
  try { path = join(fileURLToPath(baseUrl), rel); } catch (e) { return { status: 0, error: `file base unusable: ${e.message}` }; }
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { status: 404 } : { status: 0, error: `read failed (${e.code || e.message})` }; }
  try { return { status: 200, body: JSON.parse(raw) }; } catch { return { status: 0, error: 'not JSON' }; }
}

/**
 * One answer from a source: {status:'ok'|'not-found'|'error', body?, via, reason?, ageHours?}.
 * `via` is network, cache, stale-cache, file or none. `error` always carries a reason.
 */
export async function request(kind, params) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown source kind ${kind}`);
  const base = baseOf(kind);
  const rel = k.file(params);
  if (base.scheme === 'file') {
    const r = viaFile(base.url, rel);
    if (r.error) return { status: 'error', via: 'file', reason: `${base.label}: ${r.error}` };
    const status = k.classify(r.status, r.body);
    return status === 'error' ? { status, via: 'file', reason: `${base.label}: unexpected answer` } : { status, body: r.body, via: 'file' };
  }
  if (base.scheme !== 'http' && base.scheme !== 'https') return { status: 'error', via: 'none', reason: `${k.env} is not an http(s) or file URL` };

  const dir = cacheDir();
  const path = dir ? join(dir, sha(base.url), rel) : null;
  const cached = path ? readCache(path) : null;
  const now = nowMs();
  const age = cached && cached.entry ? freshFor(kind, cached.entry, now) : null;
  if (age && age.fresh) return { status: cached.entry.status, body: cached.entry.body, via: 'cache', ageHours: age.ageHours };
  const stale = (why) => (cached && cached.entry
    ? { status: cached.entry.status, body: cached.entry.body, via: 'stale-cache', ageHours: age ? age.ageHours : null, reason: why }
    : { status: 'error', via: 'none', reason: `${why}; no cached copy${cached && cached.problem ? ` (${cached.problem})` : ''}` });
  if (offline()) return stale('offline (CW_WP_OFFLINE=1)');

  let r;
  try { r = await viaNetwork(`${base.url}${k.path(params)}`); } catch (e) { return stale(`${base.label}: ${netReason(e)}`); }
  const status = k.classify(r.status, r.body);
  if (status === 'error') return stale(`${base.label}: HTTP ${r.status}${r.body === undefined ? ', not JSON' : ', unexpected answer'}`);
  let cacheProblem;
  if (path) {
    try { writeCache(path, { fetchedAt: new Date(now).toISOString(), status, body: status === 'ok' ? r.body : null }); } catch (e) { cacheProblem = `cache write failed (${e.code || e.message})`; }
  }
  return { status, body: status === 'ok' ? r.body : null, via: 'network', ...(cacheProblem ? { cacheProblem } : {}) };
}

/** Runs fn over items with at most n in flight; results in input order. */
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** A tally of where answers came from, for summary.requests. */
export function tally(results) {
  const t = { network: 0, cache: 0, staleCache: 0, file: 0, failed: 0, cacheWriteFailures: 0 };
  for (const r of results) {
    if (!r) continue;
    if (r.status === 'error') t.failed++;
    else if (r.via === 'network') t.network++;
    else if (r.via === 'cache') t.cache++;
    else if (r.via === 'stale-cache') t.staleCache++;
    else if (r.via === 'file') t.file++;
    if (r.cacheProblem) t.cacheWriteFailures++;
  }
  return t;
}
