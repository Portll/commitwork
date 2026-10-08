// lib/mail.mjs — outbound mail for the monitor, transport-agnostic.
// Contract: nothing returns 'sent' unless a transport accepted it; no send path throws; every
// attempt is recorded to the outbox. Keys come by reference (lib/secrets.mjs) and are never logged.

import { nowISO } from './clock.mjs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { resolveInto } from './secrets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// Every input path is env-overridable so tests run entirely on fixtures.
export const OUTBOX_DEFAULT = join(CW, 'reports', 'mail', 'outbox.jsonl');
const RESEND_URL_DEFAULT = 'https://api.resend.com/emails';

// Vendor-standard name; CW_RESEND_API_KEY is accepted as a one-off env override.
export const RESEND_KEY_NAME = 'RESEND_API_KEY';

const outboxPath = (env) => (env.CW_MAIL_OUTBOX !== undefined ? env.CW_MAIL_OUTBOX : OUTBOX_DEFAULT);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Strip secret material from outbound strings. Sub-8-char "keys" are ignored. */
export function redact(text, ...secrets) {
  let s = String(text ?? '');
  for (const sec of secrets) {
    if (typeof sec !== 'string' || sec.length < 8) continue;
    s = s.split(sec).join('[REDACTED]');
  }
  return s;
}

// ── the message ────────────────────────────────────────────────────────────────────────────────
// CR/LF in a recipient or subject is header injection; a bad message is never handed to a transport.
const HEADER_UNSAFE = /[\r\n\0]/;
const ADDR_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function normalizeMessage(message = {}, { env = process.env } = {}) {
  const errs = [];
  const to = (Array.isArray(message.to) ? message.to : [message.to])
    .flatMap((a) => (typeof a === 'string' ? a.split(',') : [a]))
    .map((a) => (typeof a === 'string' ? a.trim() : a))
    .filter((a) => a !== undefined && a !== null && a !== '');
  if (!to.length) errs.push('no recipient');
  for (const a of to) {
    if (typeof a !== 'string') errs.push(`recipient ${JSON.stringify(a)} is not a string`);
    else if (HEADER_UNSAFE.test(a)) errs.push('a recipient contains a newline (header injection)');
    else if (!ADDR_RE.test(a)) errs.push(`recipient ${JSON.stringify(a)} is not an address`);
  }
  const subject = typeof message.subject === 'string' ? message.subject.trim() : '';
  if (!subject) errs.push('no subject');
  else if (HEADER_UNSAFE.test(subject)) errs.push('the subject contains a newline (header injection)');
  const text = typeof message.text === 'string' ? message.text : '';
  const html = message.html === undefined || message.html === null ? null : String(message.html);
  if (!text && !html) errs.push('no body (text or html)');
  // `from` is a configuration fact, not a per-message one, but a caller may override it.
  const from = (message.from || env.CW_MAIL_FROM || '').trim();
  if (from && HEADER_UNSAFE.test(from)) errs.push('the from address contains a newline (header injection)');

  const bodyHash = sha256(`${text}\0${html ?? ''}`);
  return {
    ok: errs.length === 0,
    errs,
    msg: {
      to, subject, text: text || null, html, from: from || null,
      replyTo: (message.replyTo || env.CW_MAIL_REPLY_TO || '').trim() || null,
      bodyHash,
      // Default key is a pure function of the message so retries dedupe at the provider;
      // a caller that needs each send distinct passes idempotencyKey explicitly.
      idempotencyKey: message.idempotencyKey
        || `cw-${sha256(`${to.join(',')}\0${subject}\0${bodyHash}`).slice(0, 32)}`,
    },
  };
}

// ── the key ────────────────────────────────────────────────────────────────────────────────────
/**
 * Resolve the Resend key: env, then keychain ref. The value never appears in reason/detail/source.
 * Hermetic tests: point CW_SECRETS_FILE at a missing path, or inject resolveSecret.
 */
export function resolveResendKey({ env = process.env, resolveSecret = null } = {}) {
  const direct = env.CW_RESEND_API_KEY || env[RESEND_KEY_NAME] || '';
  if (direct) return { ok: true, value: direct, source: 'env' };
  const resolver = resolveSecret || ((name) => {
    const r = resolveInto([name], { env: {}, file: env.CW_SECRETS_FILE || undefined });
    return r.ok ? { ok: true, value: r.env[name] } : { ok: false, ...r.missing[0] };
  });
  let r;
  try { r = resolver(RESEND_KEY_NAME, { env }); }
  catch (e) {
    // Fail closed: a malformed ref table is reported, never read as "no key declared".
    return { ok: false, reason: 'secrets-unreadable', detail: redact(e.message) };
  }
  if (r && r.ok && r.value) return { ok: true, value: r.value, source: 'keychain' };
  // The remedy is always appended, whatever the underlying reason.
  const why = (r && r.detail) || `no CW_RESEND_API_KEY in the environment and no keychain ref for ${RESEND_KEY_NAME}`;
  return {
    ok: false,
    reason: (r && r.reason) || 'undeclared',
    detail: redact(`${why} — declare it with: node bin/secrets.mjs set ${RESEND_KEY_NAME}`),
  };
}

// ── the outbox ─────────────────────────────────────────────────────────────────────────────────
/**
 * Append one record. O_APPEND single-write: concurrent jobs interleave records, never bytes.
 * Carries recipients/subject/digest/capped preview — never the key, never a full body.
 */
export function recordAttempt(record, { env = process.env } = {}) {
  const path = outboxPath(env);
  if (!path) return { recorded: false, reason: 'disabled', outbox: null }; // CW_MAIL_OUTBOX='' opts out
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return { recorded: true, outbox: path };
  } catch (e) {
    return { recorded: false, reason: e.code || 'error', detail: `${path}: ${e.message}`, outbox: path };
  }
}

const PREVIEW_CAP = 2000;
const preview = (s) => (s == null ? null
  : (s.length > PREVIEW_CAP ? { text: s.slice(0, PREVIEW_CAP), truncated: s.length - PREVIEW_CAP } : { text: s, truncated: 0 }));

// ── transports ─────────────────────────────────────────────────────────────────────────────────
// A transport is `async (msg, ctx) => { status, ... }`, status 'sent'|'dry-run'|'not-configured'|
// 'error'; it never throws and never writes the outbox (sendMail does). ctx.secret(value)
// registers credential material for sendMail to scrub from everything it emits.

/** The dry transport: 'not-configured' = nobody chose one; 'dry-run' = `none` chosen on purpose. */
const noneTransport = async (msg, ctx) => (ctx.explicit
  ? { status: 'dry-run', reason: 'transport-none',
      detail: 'CW_MAIL_TRANSPORT=none: the message was recorded to the outbox and NOT sent' }
  : { status: 'not-configured', reason: 'no-transport-selected',
      detail: 'no mail transport is configured: set CW_MAIL_TRANSPORT=resend (plus CW_MAIL_FROM and a RESEND_API_KEY secret). The message was recorded to the outbox and NOT sent.' });

/** Resend, over the documented https://api.resend.com/emails endpoint. Zero dependencies: fetch. */
const resendTransport = async (msg, ctx) => {
  const { env } = ctx;
  const key = resolveResendKey({ env, resolveSecret: ctx.resolveSecret });
  if (key.ok) ctx.secret(key.value);   // scrub it from anything sendMail emits, including a throw
  if (!key.ok) {
    return { status: 'not-configured', reason: `key-${key.reason}`, detail: key.detail };
  }
  if (!msg.from) {
    return { status: 'not-configured', reason: 'no-from',
      detail: 'CW_MAIL_FROM is unset — Resend refuses a send without a verified sender address' };
  }
  const url = env.CW_RESEND_API_URL || RESEND_URL_DEFAULT;
  const timeoutMs = Math.max(1, Number(env.CW_MAIL_TIMEOUT_MS || 10_000));
  const maxAttempts = Math.max(1, Number(env.CW_MAIL_ATTEMPTS || 2));
  const backoffMs = Math.max(0, Number(env.CW_MAIL_RETRY_MS ?? 500));
  const body = JSON.stringify({
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    ...(msg.text ? { text: msg.text } : {}),
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
  });

  const attempts = [];
  for (let n = 1; n <= maxAttempts; n++) {
    let res, payload = null, netErr = null;
    try {
      res = await ctx.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key.value}`,
          // Same key on every retry — the provider collapses the duplicate.
          'Idempotency-Key': msg.idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) { netErr = e; }

    if (netErr) {
      attempts.push({ n, error: redact(netErr.message, key.value) });
      if (n < maxAttempts) { await ctx.sleep(backoffMs); continue; }
      return { status: 'error', reason: 'network', keySource: key.source, attempts,
        detail: `${url}: ${redact(netErr.message, key.value)}` };
    }
    // Read the body for the reason string, never for the truth of the outcome — status decides.
    try { payload = await res.text(); } catch { payload = null; }
    const status = Number(res.status);
    if (status >= 200 && status < 300) {
      let id = null;
      try { id = JSON.parse(payload || '{}').id || null; } catch { /* a 2xx with an unreadable body still sent */ }
      return { status: 'sent', messageId: id, httpStatus: status, keySource: key.source, attempts };
    }
    const detail = `HTTP ${status}${payload ? `: ${redact(payload, key.value).slice(0, 500)}` : ''}`;
    attempts.push({ n, httpStatus: status });
    // 429/5xx are transient; a 4xx will never be accepted, so don't retry it.
    const transient = status === 429 || status >= 500;
    if (transient && n < maxAttempts) { await ctx.sleep(backoffMs); continue; }
    return { status: 'error', reason: transient ? `http-${status}-exhausted` : `http-${status}`,
      httpStatus: status, keySource: key.source, attempts, detail };
  }
  /* c8 ignore next */
  return { status: 'error', reason: 'unreachable', detail: 'retry loop fell through' };
};

/**
 * SMTP — a declared seam, deliberately not built, so CW_MAIL_TRANSPORT=smtp is a loud known state.
 * A real smtp transport must: keep the four-status contract (never throw, never write the outbox);
 * resolve credentials by reference and register them via ctx.secret; trust normalizeMessage's
 * header checks; use msg.idempotencyKey as the Message-ID; then add 'smtp' to TRANSPORTS.
 */
const smtpTransport = async () => ({
  status: 'not-configured',
  reason: 'transport-not-implemented',
  detail: 'the smtp transport is a declared seam and is not built yet — nothing was sent. Use CW_MAIL_TRANSPORT=resend, or none for a dry run.',
});

export const TRANSPORTS = { none: noneTransport, resend: resendTransport, smtp: smtpTransport };
export const TRANSPORT_NAMES = Object.keys(TRANSPORTS);

/** Which transport, and was it chosen or defaulted? An unrecognised name is refused, not defaulted. */
export function selectTransport({ env = process.env } = {}) {
  const raw = (env.CW_MAIL_TRANSPORT || '').trim();
  if (!raw) return { name: 'none', explicit: false, source: 'default' };
  const name = raw.toLowerCase();
  if (!Object.hasOwn(TRANSPORTS, name)) {
    return { name: 'none', explicit: false, source: 'env', bad: raw,
      detail: `CW_MAIL_TRANSPORT=${JSON.stringify(raw)} is not a known transport (${TRANSPORT_NAMES.join(', ')}) — refusing to guess` };
  }
  return { name, explicit: true, source: 'env' };
}

// ── the interface ──────────────────────────────────────────────────────────────────────────────
/**
 * sendMail({to, subject, text, html?}) — the ONLY entry point, for every transport.
 * Never throws; ok === (status === 'sent'); always records to the outbox.
 * @param {object} message  {to: string|string[], subject, text, html?, from?, replyTo?, idempotencyKey?}
 * @param {object} [opts]   {env, transport (name | {name,send} | fn), fetchImpl, sleep, resolveSecret}
 * @returns {Promise<{ok, status, transport, to, subject, at, recorded, ...}>}
 */
export async function sendMail(message, opts = {}) {
  const env = opts.env || process.env;
  const at = nowISO(env);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // scrub() is the last gate before any string reaches a result or disk.
  const secrets = new Set();
  const scrub = (s) => (s == null ? s : redact(s, ...secrets));

  // Which transport (before validation, so a bad message is still attributed to a real transport).
  let sel;
  if (opts.transport && typeof opts.transport === 'object' && typeof opts.transport.send === 'function') {
    sel = { name: opts.transport.name || 'injected', explicit: true, source: 'injected' };
  } else if (typeof opts.transport === 'function') {
    sel = { name: opts.transport.name || 'injected', explicit: true, source: 'injected' };
  } else if (typeof opts.transport === 'string') {
    sel = Object.hasOwn(TRANSPORTS, opts.transport)
      ? { name: opts.transport, explicit: true, source: 'arg' }
      : { name: 'none', explicit: false, source: 'arg', bad: opts.transport,
          detail: `unknown transport ${JSON.stringify(opts.transport)} (${TRANSPORT_NAMES.join(', ')})` };
  } else sel = selectTransport({ env });

  const norm = normalizeMessage(message, { env });
  const msg = norm.msg;

  let outcome;
  if (!norm.ok) {
    outcome = { status: 'error', reason: 'invalid-message', detail: norm.errs.join('; ') };
  } else if (sel.bad) {
    // A misspelt transport is a configuration fault, not a dry run.
    outcome = { status: 'not-configured', reason: 'unknown-transport', detail: sel.detail };
  } else {
    const send = (opts.transport && typeof opts.transport === 'object' && opts.transport.send)
      || (typeof opts.transport === 'function' ? opts.transport : TRANSPORTS[sel.name]);
    const ctx = {
      env, fetchImpl, sleep, at, explicit: sel.explicit, resolveSecret: opts.resolveSecret,
      secret: (v) => { if (typeof v === 'string' && v.length >= 8) secrets.add(v); },
    };
    try {
      outcome = await send(msg, ctx);
    } catch (e) {
      // A transport that throws is reported as an error, never as a send.
      outcome = { status: 'error', reason: 'transport-threw', detail: scrub(e && e.message ? e.message : String(e)) };
    }
    if (!outcome || typeof outcome.status !== 'string') {
      outcome = { status: 'error', reason: 'transport-contract',
        detail: `transport ${sel.name} returned ${JSON.stringify(outcome)} instead of a result with a status` };
    }
  }

  // detail never leaves here carrying a credential.
  if (outcome.detail) outcome.detail = scrub(outcome.detail);

  const record = {
    at,
    transport: sel.name,
    transportSource: sel.source,
    status: outcome.status,
    sent: outcome.status === 'sent',
    reason: outcome.reason || null,
    detail: outcome.detail || null,
    to: msg.to,
    subject: msg.subject,
    from: msg.from,
    idempotencyKey: msg.idempotencyKey,
    bodyHash: msg.bodyHash,
    bytes: { text: msg.text ? msg.text.length : 0, html: msg.html ? msg.html.length : 0 },
    preview: { text: preview(msg.text), html: msg.html ? { bytes: msg.html.length } : null },
    messageId: outcome.messageId || null,
    httpStatus: outcome.httpStatus || null,
    attempts: outcome.attempts || null,
  };
  const rec = recordAttempt(record, { env });

  const result = {
    ...outcome,
    ok: outcome.status === 'sent',
    transport: sel.name,
    to: msg.to,
    subject: msg.subject,
    at,
    idempotencyKey: msg.idempotencyKey,
    recorded: rec.recorded,
    outbox: rec.outbox,
  };
  if (!rec.recorded && rec.reason !== 'disabled') {
    result.recordError = `outbox write failed (${rec.reason}${rec.detail ? `: ${rec.detail}` : ''})`;
    // A dry run whose only product is the record produced nothing if the record failed.
    if (result.status === 'dry-run') {
      result.status = 'error';
      result.reason = 'record-failed';
      result.detail = result.recordError;
      result.ok = false;
    }
  }
  return result;
}

/** Configuration state WITHOUT values — presence only; ready is never inferred from "no error yet". */
export function mailStatus({ env = process.env, resolveSecret = null } = {}) {
  const sel = selectTransport({ env });
  const from = (env.CW_MAIL_FROM || '').trim() || null;
  const row = {
    transport: sel.name,
    selected: sel.explicit,
    source: sel.source,
    from,
    outbox: outboxPath(env) || null,
    ready: false,
    reason: null,
    detail: null,
  };
  if (sel.bad) { row.reason = 'unknown-transport'; row.detail = sel.detail; return row; }
  if (sel.name === 'none') {
    row.reason = sel.explicit ? 'dry-run' : 'not-configured';
    row.detail = sel.explicit
      ? 'CW_MAIL_TRANSPORT=none — messages are recorded and never sent'
      : 'no CW_MAIL_TRANSPORT — this box cannot deliver an alert';
    return row;
  }
  if (sel.name === 'smtp') { row.reason = 'transport-not-implemented'; row.detail = 'the smtp transport is a seam, not an implementation'; return row; }
  const key = resolveResendKey({ env, resolveSecret });
  if (!key.ok) { row.reason = `key-${key.reason}`; row.detail = key.detail; return row; }
  row.keySource = key.source;
  if (!from) { row.reason = 'no-from'; row.detail = 'CW_MAIL_FROM is unset'; return row; }
  row.ready = true;
  return row;
}
