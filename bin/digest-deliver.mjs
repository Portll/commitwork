#!/usr/bin/env node
// bin/digest-deliver.mjs — send a written `commitwork.digest/1` to a Slack incoming webhook and/or
// a generic JSON webhook. Describe-only: the Slack message carries text blocks and nothing a reader
// can press, the generic webhook gets the digest file's bytes unchanged, and no response body is
// read — only the HTTP status decides delivered or failed.
//
// Destinations come from the environment, read at call time: CW_DIGEST_SLACK_URL,
// CW_DIGEST_WEBHOOK_URL. A webhook URL is a credential, so it is never written to disk or printed:
// output and the ledger carry the scheme and host only. CW_DIGEST_TIMEOUT_MS bounds each request
// (default 10000, 1000-60000).
//
// The ledger reports/digest/deliveries.json (CW_REPORTS_ROOT) is keyed by digestId and destination;
// a pair already delivered is not posted again. A failure is recorded with its status and reason.
//
// usage: node bin/digest-deliver.mjs [--file <digest.json>] [--dry-run] [--json]
//   --file     the digest to send (default: the newest reports/digest/digest-*.json)
//   --dry-run  print what would be sent and where; post nothing, write nothing
//   --json     print the results as JSON
// Exit 0 every configured destination delivered (now or earlier) · 20 a delivery failed · 21 no
// destination configured · 22 digest or ledger refused · 23 usage.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../lib/clock.mjs';
import { escText } from '../lib/html-escape.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { reportsRootFor } from '../monitor/store-paths.mjs';
import { acquireLockOrReason, writeAtomic } from '../monitor/lockfile.mjs';
import { SCHEMA as DIGEST_SCHEMA } from './digest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_SCHEMA = 'commitwork.digest-deliveries/1';
export const DESTINATIONS = Object.freeze([
  { kind: 'slack', env: 'CW_DIGEST_SLACK_URL' },
  { kind: 'webhook', env: 'CW_DIGEST_WEBHOOK_URL' },
]);
const TIMEOUT = { def: 10_000, min: 1_000, max: 60_000 };
const DIGEST_FILE = /^digest-\d{8}T\d{6}Z\.json$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class Refused extends Error {}

export const digestDir = (root = REPO) => join(reportsRootFor(root), 'digest');
export const ledgerPath = (root = REPO) => join(digestDir(root), 'deliveries.json');

// ── destinations ────────────────────────────────────────────────────────────────────────────────
export function redactUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}/…`;
  } catch { return '(unparseable URL)'; }
}

// Strip every form the URL could take inside an error message.
const scrub = (text, raw) => {
  let s = String(text ?? '');
  try {
    const u = new URL(raw);
    for (const part of [raw, u.href, u.pathname + u.search, u.pathname]) if (part && part !== '/') s = s.split(part).join('/…');
  } catch { if (raw) s = s.split(raw).join('(url)'); }
  return s.replace(/[\r\n]+/g, ' ').slice(0, 300);
};

export function configuredDestinations(env = process.env) {
  return DESTINATIONS.filter((d) => typeof env[d.env] === 'string' && env[d.env].trim())
    .map((d) => {
      const url = env[d.env].trim();
      return { kind: d.kind, env: d.env, url, target: redactUrl(url), key: `${d.kind}:${createHash('sha256').update(url).digest('hex').slice(0, 16)}` };
    });
}

// Plain http only to loopback: anywhere else it would send the digest and the token in clear.
export function urlProblem(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'not a URL'; }
  if (u.username || u.password) return 'URL carries credentials in its authority';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return null;
  return `scheme ${u.protocol} refused (https required off loopback)`;
}

export function timeoutFrom(env = process.env) {
  const v = env.CW_DIGEST_TIMEOUT_MS;
  if (v == null || v === '') return TIMEOUT.def;
  if (!/^\d+$/.test(String(v))) throw new RangeError(`CW_DIGEST_TIMEOUT_MS is not a whole number of ms: ${JSON.stringify(v)}`);
  return Math.min(TIMEOUT.max, Math.max(TIMEOUT.min, Number(v)));
}

// ── input ───────────────────────────────────────────────────────────────────────────────────────
export function newestDigest(root = REPO) {
  const dir = digestDir(root);
  let names;
  try { names = readdirSync(dir); } catch (e) {
    if (e.code === 'ENOENT') throw new Refused(`no digest written under ${dir} (run: node bin/digest.mjs --write)`);
    throw new Refused(`digest directory unreadable (${e.code || e.message})`);
  }
  const files = names.filter((n) => DIGEST_FILE.test(n)).sort();
  if (!files.length) throw new Refused(`no digest-*.json under ${dir} (run: node bin/digest.mjs --write)`);
  return join(dir, files[files.length - 1]);
}

// The digestId is sha256 over the document with an empty id; recomputing it refuses an edited file.
export function readDigest(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { throw new Refused(`digest unreadable at ${path} (${e.code || e.message})`); }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Refused(`digest is not JSON (${String(e.message).slice(0, 120)})`); }
  if (!doc || doc.schema !== DIGEST_SCHEMA) throw new Refused(`digest schema is ${JSON.stringify(doc?.schema)}, expected ${DIGEST_SCHEMA}`);
  if (!/^[0-9a-f]{64}$/.test(String(doc.digestId))) throw new Refused('digest carries no digestId');
  if (!doc.sections || typeof doc.sections !== 'object' || !Object.keys(doc.sections).length) throw new Refused('digest carries no sections');
  const id = createHash('sha256').update(JSON.stringify({ ...doc, digestId: '' })).digest('hex');
  if (id !== doc.digestId) throw new Refused(`digestId does not verify (file says ${doc.digestId.slice(0, 12)}…, content hashes to ${id.slice(0, 12)}…)`);
  return { raw, doc };
}

// ── payloads ────────────────────────────────────────────────────────────────────────────────────
const slackEsc = escText;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const STATUS_LABEL = { measured: 'measured', partial: 'partly measured', 'not-measured': 'NOT MEASURED' };
const MAX_REASONS = 5;

export function slackPayload(doc) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'commitwork digest' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: slackEsc(`Window ${doc.window?.since} → ${doc.window?.until} · ${STATUS_LABEL[doc.status] || doc.status}`) }] },
  ];
  const fallback = [];
  for (const s of Object.values(doc.sections)) {
    const status = STATUS_LABEL[s.status] || String(s.status ?? 'unknown status');
    const headline = s.headline || `${s.title}: ${status}`;
    fallback.push(headline);
    const lines = [`*${slackEsc(s.title)}* — ${slackEsc(status)}`, slackEsc(headline)];
    const nm = Array.isArray(s.notMeasured) ? s.notMeasured : [];
    if (s.status !== 'measured') {
      for (const r of nm.slice(0, MAX_REASONS)) lines.push(`• not measured: ${slackEsc(r)}`);
      if (nm.length > MAX_REASONS) lines.push(`• …and ${nm.length - MAX_REASONS} more not measured`);
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(lines.join('\n'), 2900) } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `digestId ${slackEsc(doc.digestId)}` }] });
  return { text: clip(`commitwork digest (${doc.window?.until}): ${fallback.join(' · ')}`, 3000), blocks };
}

export function requestFor(dest, { raw, doc }) {
  if (dest.kind === 'slack') return { body: JSON.stringify(slackPayload(doc)), headers: { 'content-type': 'application/json' } };
  return { body: raw, headers: { 'content-type': 'application/json', 'x-commitwork-digest-id': doc.digestId } };
}

// ── ledger ──────────────────────────────────────────────────────────────────────────────────────
export function readLedger(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { schema: LEDGER_SCHEMA, deliveries: {} };
    throw new Refused(`delivery ledger unreadable (${e.code || e.message})`);
  }
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Refused(`delivery ledger at ${path} is not JSON; refusing rather than re-posting`); }
  if (!doc || doc.schema !== LEDGER_SCHEMA || !doc.deliveries || typeof doc.deliveries !== 'object') {
    throw new Refused(`delivery ledger at ${path} is not ${LEDGER_SCHEMA}`);
  }
  return doc;
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const writeLedger = (path, doc) => writeAtomic(path, `${JSON.stringify({ schema: LEDGER_SCHEMA, deliveries: sortKeys(doc.deliveries) }, null, 2)}\n`, { mkdir: true });

// ── sending ─────────────────────────────────────────────────────────────────────────────────────
export async function post(dest, req, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT.def } = {}) {
  let res;
  // A ref'd timer, not AbortSignal.timeout(): that one is unref'd, so a request holding no handle of
  // its own lets the process exit with the bound never firing.
  const abort = new AbortController();
  const bound = setTimeout(() => abort.abort(new DOMException(`timeout after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
  try {
    // manual: a 307/308 would re-send the body to wherever the response points.
    res = await fetchImpl(dest.url, { method: 'POST', headers: req.headers, body: req.body, redirect: 'manual', signal: abort.signal });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { ok: false, status: null, reason: `timeout after ${timeoutMs}ms` };
    const c = e?.cause;
    return { ok: false, status: null, reason: scrub(`network: ${c?.code || c?.message || e?.message || e}`, dest.url) };
  } finally { clearTimeout(bound); }
  try { await res.body?.cancel?.(); } catch { /* the body is never read */ }
  const status = Number(res.status);
  if (status >= 200 && status < 300) return { ok: true, status, reason: null };
  return { ok: false, status, reason: scrub(`HTTP ${status}${res.statusText ? ` ${res.statusText}` : ''}`, dest.url) };
}

export async function deliverDigest({ root = REPO, file = null, env = process.env, fetchImpl = globalThis.fetch, timeoutMs, dryRun = false } = {}) {
  const dests = configuredDestinations(env);
  const digestPath = file ? resolve(file) : newestDigest(root);
  const input = readDigest(digestPath);
  const { doc } = input;
  const base = { digestId: doc.digestId, digest: digestPath, results: [] };
  if (!dests.length) return { ...base, outcome: 'not-configured' };
  const ms = timeoutMs ?? timeoutFrom(env);

  if (dryRun) {
    const ledger = readLedger(ledgerPath(root));
    for (const d of dests) {
      const prior = ledger.deliveries[`${doc.digestId}|${d.key}`];
      base.results.push({ kind: d.kind, target: d.target, state: prior?.state === 'delivered' ? 'already-delivered' : 'would-send', problem: urlProblem(d.url), payload: JSON.parse(requestFor(d, input).body) });
    }
    return { ...base, outcome: 'dry-run' };
  }

  const lp = ledgerPath(root);
  const lock = acquireLockOrReason(join(dirname(lp), '.deliveries.lock'), { label: 'digest-deliver' });
  if (!lock.ok) {
    throw new Refused(lock.reason === 'busy' ? 'another delivery holds the ledger lock' : `ledger lock unavailable (${lock.code || lock.message})`);
  }
  try {
    const ledger = readLedger(lp);
    for (const d of dests) {
      const key = `${doc.digestId}|${d.key}`;
      const prior = ledger.deliveries[key];
      if (prior?.state === 'delivered') {
        base.results.push({ kind: d.kind, target: d.target, state: 'already-delivered', status: prior.status, at: prior.at });
        continue;
      }
      const problem = urlProblem(d.url);
      const r = problem ? { ok: false, status: null, reason: `refused: ${problem}` } : await post(d, requestFor(d, input), { fetchImpl, timeoutMs: ms });
      const rec = {
        digestId: doc.digestId, kind: d.kind, destination: d.key, target: d.target,
        state: r.ok ? 'delivered' : 'failed', status: r.status, reason: r.reason,
        at: nowISO(env), attempts: (prior?.attempts || 0) + 1,
      };
      ledger.deliveries[key] = rec;
      // Written per destination: a crash after the first post must not re-post it.
      try { writeLedger(lp, ledger); } catch (e) {
        throw new Refused(`${d.kind} ${d.target} ${rec.state}, but the ledger write failed (${e.code || e.message}); a re-run may send it again`);
      }
      base.results.push({ kind: d.kind, target: d.target, state: rec.state, status: rec.status, reason: rec.reason, at: rec.at });
    }
  } finally { lock.lock.release(); }
  return { ...base, outcome: base.results.every((r) => r.state !== 'failed') ? 'delivered' : 'failed' };
}

export const exitFor = (r) => ({ delivered: 0, 'dry-run': 0, failed: 20, 'not-configured': 21 })[r.outcome] ?? 22;

export function renderText(r) {
  const L = [`digest ${r.digestId.slice(0, 12)}… (${r.digest})`];
  if (r.outcome === 'not-configured') L.push(`  no destination configured: set ${DESTINATIONS.map((d) => d.env).join(' and/or ')}; nothing sent`);
  for (const x of r.results) {
    if (x.state === 'would-send') L.push(`  ${x.kind.padEnd(8)} ${x.target}  would send${x.problem ? ` — but refused: ${x.problem}` : ''}`);
    else if (x.state === 'already-delivered') L.push(`  ${x.kind.padEnd(8)} ${x.target}  already delivered${x.at ? ` ${x.at}` : ''}; not re-sent`);
    else if (x.state === 'delivered') L.push(`  ${x.kind.padEnd(8)} ${x.target}  delivered (HTTP ${x.status})`);
    else L.push(`  ${x.kind.padEnd(8)} ${x.target}  NOT DELIVERED: ${x.reason}`);
  }
  return `${L.join('\n')}\n`;
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const known = new Set(['--file', '--dry-run', '--json']);
  const bad = argv.filter((a, i) => (a.startsWith('--') ? !known.has(a) : argv[i - 1] !== '--file'));
  const fi = argv.indexOf('--file');
  if (bad.length || (fi >= 0 && !argv[fi + 1])) {
    process.stderr.write(`usage: digest-deliver.mjs [--file <digest.json>] [--dry-run] [--json]${bad.length ? ` (unknown: ${bad.join(' ')})` : ''}\n`);
    process.exitCode = 23;
  } else {
    let timeoutMs;
    try { timeoutMs = timeoutFrom(); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 23; }
    if (timeoutMs) {
      try {
        const r = await deliverDigest({ file: fi >= 0 ? argv[fi + 1] : null, dryRun: argv.includes('--dry-run'), timeoutMs });
        process.stdout.write(argv.includes('--json') ? `${JSON.stringify(r, null, 2)}\n` : renderText(r));
        process.exitCode = exitFor(r);
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        process.stderr.write(`refused: ${e.message}\n`);
        process.exitCode = 22;
      }
    }
  }
}
