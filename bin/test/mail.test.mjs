// lib/mail.mjs — the alert path and the four ways it is allowed to fail (in bin/test/ because the
// test glob does not cover lib/). What is pinned is the ABSENCE of optimism, and the key never
// appearing in any output. NOTHING here touches the network: globalThis.fetch is replaced with a
// detonator for the whole file.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sendMail, mailStatus, selectTransport, normalizeMessage, resolveResendKey, redact,
  recordAttempt, TRANSPORT_NAMES, RESEND_KEY_NAME,
} from '../../lib/mail.mjs';

const KEY = 're_test_000000000000000000000000';   // a shape, not a credential
const FROM = 'monitor@example.invalid';
const TO = 'ops@example.invalid';
const NOW = '2026-08-03T04:05:06.000Z';

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => { throw new Error('NETWORK CALL from a test — no test may reach a real endpoint'); };
});
after(() => { globalThis.fetch = realFetch; });

let dirs = 0;
function scratch() {
  return join(mkdtempSync(join(tmpdir(), 'cw-mail-')), `outbox-${dirs++}.jsonl`);
}
/** A hermetic environment: outbox in a temp dir, and a secrets table that does not exist, so the
 *  keychain is never consulted (loadTable's ENOENT is the legitimate empty). */
function envFor(extra = {}) {
  return {
    CW_NOW: NOW,
    CW_MAIL_OUTBOX: scratch(),
    CW_SECRETS_FILE: join(tmpdir(), `cw-mail-no-such-secrets-${Date.now()}-${dirs}.json`),
    CW_MAIL_RETRY_MS: '0',
    ...extra,
  };
}
const outboxOf = (env) => (existsSync(env.CW_MAIL_OUTBOX)
  ? readFileSync(env.CW_MAIL_OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);
const rawOutbox = (env) => (existsSync(env.CW_MAIL_OUTBOX) ? readFileSync(env.CW_MAIL_OUTBOX, 'utf8') : '');

const MSG = { to: TO, subject: 'deadman: nightly sweep did not run', text: 'no rollup written in 26h' };

/** A fetch stub. Records the calls; returns whatever the script says. Never reaches a socket. */
function stubFetch(script) {
  const calls = [];
  const queue = Array.isArray(script) ? [...script] : [script];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return {
      status: next.status,
      text: async () => (next.body === undefined ? '' : next.body),
    };
  };
  impl.calls = calls;
  return impl;
}

// ── unconfigured is a KNOWN state, never a success ─────────────────────────────────────────────
describe('unconfigured', () => {
  test('no transport selected -> "not configured", NOT a fake success', async () => {
    const env = envFor();
    const r = await sendMail(MSG, { env });
    assert.equal(r.ok, false, 'an unconfigured box must never report ok');
    assert.equal(r.status, 'not-configured');
    assert.equal(r.transport, 'none');
    assert.equal(r.reason, 'no-transport-selected');
    assert.match(r.detail, /CW_MAIL_TRANSPORT/, 'the remedy must be named, not implied');
    assert.notEqual(r.status, 'sent');
  });

  test('the unconfigured attempt is RECORDED — "we did not send" survives the process', async () => {
    const env = envFor();
    await sendMail(MSG, { env });
    const rows = outboxOf(env);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sent, false, 'the record must not read as a send');
    assert.equal(rows[0].status, 'not-configured');
    assert.equal(rows[0].subject, MSG.subject);
    assert.deepEqual(rows[0].to, [TO]);
    assert.equal(rows[0].at, NOW, 'CW_NOW governs the record (determinism)');
  });

  test('mailStatus reports ready:false and says why, with no value anywhere', () => {
    const s = mailStatus({ env: envFor() });
    assert.equal(s.ready, false);
    assert.equal(s.reason, 'not-configured');
    assert.equal(s.transport, 'none');
    assert.equal(s.selected, false);
    assert.equal(JSON.stringify(s).includes(KEY), false);
  });

  test('a MISSPELT transport is refused, not silently defaulted', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'resnd' });
    const sel = selectTransport({ env });
    assert.equal(sel.bad, 'resnd');
    const r = await sendMail(MSG, { env });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'not-configured');
    assert.equal(r.reason, 'unknown-transport');
    assert.match(r.detail, new RegExp(TRANSPORT_NAMES.join('|')));
    assert.equal(outboxOf(env)[0].sent, false);
  });

  test('resend selected but no key -> "not configured", and the wire is never touched', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: FROM });
    const f = stubFetch({ status: 200, body: '{"id":"x"}' });
    const r = await sendMail(MSG, { env, fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'not-configured');
    assert.equal(r.reason, 'key-undeclared');
    assert.match(r.detail, /bin\/secrets\.mjs set RESEND_API_KEY/);
    assert.equal(f.calls.length, 0, 'a keyless transport must not attempt a request');
  });

  test('resend with a key but no CW_MAIL_FROM -> "not configured", not an error and not a send', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'resend', CW_RESEND_API_KEY: KEY });
    const f = stubFetch({ status: 200, body: '{"id":"x"}' });
    const r = await sendMail(MSG, { env, fetchImpl: f });
    assert.equal(r.status, 'not-configured');
    assert.equal(r.reason, 'no-from');
    assert.equal(f.calls.length, 0);
  });

  test('the smtp seam is a declared not-implemented state, never a quiet no-op success', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'smtp' });
    const r = await sendMail(MSG, { env });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'not-configured');
    assert.equal(r.reason, 'transport-not-implemented');
    assert.equal(mailStatus({ env }).ready, false);
  });
});

// ── the dry transport records and sends nothing ────────────────────────────────────────────────
describe('the dry transport', () => {
  test('records what it WOULD have sent, and sends nothing', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'none', CW_MAIL_FROM: FROM });
    const f = stubFetch({ status: 200, body: '{"id":"nope"}' });
    const r = await sendMail({ ...MSG, html: '<p>no rollup</p>' }, { env, fetchImpl: f });
    assert.equal(f.calls.length, 0, 'the dry transport must not perform a request');
    assert.equal(r.ok, false, 'a dry run is not a send, so it is never ok');
    assert.equal(r.status, 'dry-run');
    assert.equal(r.recorded, true);

    const [row] = outboxOf(env);
    assert.equal(row.sent, false);
    assert.equal(row.status, 'dry-run');
    assert.deepEqual(row.to, [TO]);
    assert.equal(row.from, FROM);
    assert.equal(row.preview.text.text, MSG.text, 'the record must show what would have gone out');
    assert.equal(row.bytes.html, '<p>no rollup</p>'.length);
    assert.ok(row.bodyHash, 'a digest ties the record to the exact body');
  });

  test('an explicit dry run is distinguishable from an unconfigured box', async () => {
    const dry = await sendMail(MSG, { env: envFor({ CW_MAIL_TRANSPORT: 'none' }) });
    const unset = await sendMail(MSG, { env: envFor() });
    assert.equal(dry.status, 'dry-run');
    assert.equal(unset.status, 'not-configured');
    assert.notEqual(dry.reason, unset.reason);
    assert.equal(dry.ok, unset.ok); // …but neither of them sent anything
  });

  test('a dry run whose RECORD fails is an error — its only product is the record', async () => {
    const blocker = join(mkdtempSync(join(tmpdir(), 'cw-mail-')), 'a-file');
    writeFileSync(blocker, 'not a directory');
    const env = envFor({ CW_MAIL_TRANSPORT: 'none', CW_MAIL_OUTBOX: join(blocker, 'nested', 'outbox.jsonl') });
    const r = await sendMail(MSG, { env });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'record-failed');
    assert.equal(r.recorded, false);
  });

  test('appends rather than overwrites: two attempts leave two records', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'none' });
    await sendMail(MSG, { env });
    await sendMail({ ...MSG, subject: 'second' }, { env });
    assert.deepEqual(outboxOf(env).map((r) => r.subject), [MSG.subject, 'second']);
  });
});

// ── resend, entirely on a stub ─────────────────────────────────────────────────────────────────
describe('the resend transport', () => {
  const cfg = (extra = {}) => envFor({
    CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: FROM, CW_RESEND_API_KEY: KEY, ...extra,
  });

  test('a 2xx is the ONLY thing that reports sent', async () => {
    const env = cfg();
    const f = stubFetch({ status: 200, body: '{"id":"01ABCDEF"}' });
    const r = await sendMail(MSG, { env, fetchImpl: f });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'sent');
    assert.equal(r.messageId, '01ABCDEF');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://api.resend.com/emails');
    const body = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(body.to, [TO]);
    assert.equal(body.from, FROM);
    assert.equal(body.subject, MSG.subject);
    assert.equal(outboxOf(env)[0].sent, true);
  });

  test('the endpoint is env-overridable so a test never has to name the real host', async () => {
    const env = cfg({ CW_RESEND_API_URL: 'http://127.0.0.1:1/emails' });
    const f = stubFetch({ status: 200, body: '{"id":"y"}' });
    await sendMail(MSG, { env, fetchImpl: f });
    assert.equal(f.calls[0].url, 'http://127.0.0.1:1/emails');
  });

  test('a 5xx is retried under the SAME idempotency key, then surfaces as an error', async () => {
    const env = cfg();
    const f = stubFetch([{ status: 503, body: 'upstream' }, { status: 503, body: 'upstream' }]);
    const r = await sendMail(MSG, { env, fetchImpl: f, sleep: async () => {} });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'http-503-exhausted');
    assert.match(r.detail, /HTTP 503/);
    assert.equal(f.calls.length, 2);
    const keys = f.calls.map((c) => c.init.headers['Idempotency-Key']);
    assert.equal(keys[0], keys[1], 'a retry must carry the same key or it is a second email');
    assert.equal(outboxOf(env)[0].sent, false);
  });

  test('a 4xx is NOT retried — one rejection must not become several', async () => {
    const env = cfg();
    const f = stubFetch({ status: 422, body: '{"message":"from is not verified"}' });
    const r = await sendMail(MSG, { env, fetchImpl: f, sleep: async () => {} });
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'http-422');
    assert.equal(f.calls.length, 1);
  });

  test('a network failure surfaces as an error and does NOT throw past the caller', async () => {
    const env = cfg({ CW_MAIL_ATTEMPTS: '1' });
    const f = stubFetch(new Error('getaddrinfo ENOTFOUND api.resend.com'));
    const r = await sendMail(MSG, { env, fetchImpl: f, sleep: async () => {} });   // no try/catch
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'network');
    assert.match(r.detail, /ENOTFOUND/);
    assert.equal(outboxOf(env)[0].status, 'error');
  });

  test('the idempotency key is a pure function of the message, and callers can override it', async () => {
    const env = cfg();
    const f = stubFetch({ status: 200, body: '{"id":"z"}' });
    const a = await sendMail(MSG, { env, fetchImpl: f });
    const b = await sendMail(MSG, { env, fetchImpl: f });
    assert.equal(a.idempotencyKey, b.idempotencyKey, 'identical mail dedupes at the provider');
    const c = await sendMail({ ...MSG, idempotencyKey: 'slice-2026-08-03' }, { env, fetchImpl: f });
    assert.equal(c.idempotencyKey, 'slice-2026-08-03');
    const d = await sendMail({ ...MSG, text: 'different body' }, { env, fetchImpl: f });
    assert.notEqual(d.idempotencyKey, a.idempotencyKey);
  });
});

// ── the key never leaves ───────────────────────────────────────────────────────────────────────
describe('the key never appears in any output', () => {
  test('not in the result, not in the record, not in an error — even when the provider echoes it', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: FROM, CW_RESEND_API_KEY: KEY });
    // the hostile case: a provider that quotes the Authorization header back in its 401 body
    const f = stubFetch({ status: 401, body: `{"message":"invalid api key: Bearer ${KEY}"}` });
    const r = await sendMail(MSG, { env, fetchImpl: f, sleep: async () => {} });
    assert.equal(r.status, 'error');
    assert.match(r.detail, /\[REDACTED\]/);
    assert.equal(JSON.stringify(r).includes(KEY), false, 'the result must not carry the key');
    assert.equal(rawOutbox(env).includes(KEY), false, 'the outbox must not carry the key');
    // …and the header we actually sent DID carry it, so the redaction is load-bearing
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  });

  test('a successful send records no key either', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: FROM, CW_RESEND_API_KEY: KEY });
    const f = stubFetch({ status: 200, body: '{"id":"ok"}' });
    const r = await sendMail(MSG, { env, fetchImpl: f });
    assert.equal(JSON.stringify(r).includes(KEY), false);
    assert.equal(rawOutbox(env).includes(KEY), false);
    assert.equal(r.keySource, 'env', 'the SOURCE is reportable; the value is not');
  });

  test('mailStatus never carries the key, redacted or otherwise', () => {
    const s = mailStatus({ env: envFor({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: FROM, CW_RESEND_API_KEY: KEY }) });
    assert.equal(s.ready, true);
    assert.equal(s.keySource, 'env');
    assert.equal(JSON.stringify(s).includes(KEY), false);
  });

  test('redact() leaves short strings alone so it cannot blank an entire message', () => {
    assert.equal(redact(`a ${KEY} b`, KEY), 'a [REDACTED] b');
    assert.equal(redact('a b c', 'b'), 'a b c');
    assert.equal(redact('a b c', ''), 'a b c');
  });

  test('the key is resolved from env first, and an absent one is a NAMED reason', () => {
    const env = envFor();
    assert.deepEqual(resolveResendKey({ env: { ...env, CW_RESEND_API_KEY: KEY } }), { ok: true, value: KEY, source: 'env' });
    assert.equal(resolveResendKey({ env: { ...env, [RESEND_KEY_NAME]: KEY } }).source, 'env');
    const missing = resolveResendKey({ env });   // no env var, table does not exist -> no keychain call
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'undeclared');
  });

  test('an UNREADABLE secrets table fails closed rather than reading as "no key declared"', () => {
    const bad = join(mkdtempSync(join(tmpdir(), 'cw-mail-')), 'secrets.json');
    writeFileSync(bad, '{ not json');
    const r = resolveResendKey({ env: envFor({ CW_SECRETS_FILE: bad }) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'secrets-unreadable');
  });
});

// ── the seam ───────────────────────────────────────────────────────────────────────────────────
describe('the transport seam', () => {
  test('an injected transport is used verbatim — callers change nothing to swap one in', async () => {
    const env = envFor();
    const seen = [];
    const r = await sendMail(MSG, {
      env,
      transport: { name: 'smtp-prototype', send: async (msg) => { seen.push(msg); return { status: 'sent', messageId: '<id@host>' }; } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.transport, 'smtp-prototype');
    assert.equal(r.messageId, '<id@host>');
    assert.equal(seen[0].subject, MSG.subject);
    assert.equal(seen[0].idempotencyKey, r.idempotencyKey, 'a transport is handed a stable id for de-duplication');
    assert.equal(outboxOf(env)[0].transport, 'smtp-prototype', 'every transport writes the same evidence trail');
  });

  test('a transport that THROWS is reported as an error, never escapes, never reads as sent', async () => {
    const env = envFor();
    const r = await sendMail(MSG, { env, transport: async () => { throw new Error('boom'); } });   // no try/catch
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'transport-threw');
    assert.match(r.detail, /boom/);
    assert.equal(outboxOf(env)[0].sent, false);
  });

  test('a credential registered with ctx.secret is scrubbed even out of a THROW', async () => {
    // a transport never gets to redact a message it did not assemble — register the material once
    const env = envFor();
    const r = await sendMail(MSG, {
      env,
      transport: async (msg, ctx) => { ctx.secret(KEY); throw new Error(`upstream said: Bearer ${KEY}`); },
    });
    assert.equal(r.reason, 'transport-threw');
    assert.match(r.detail, /\[REDACTED\]/);
    assert.equal(JSON.stringify(r).includes(KEY), false);
    assert.equal(rawOutbox(env).includes(KEY), false);
  });

  test('a transport that returns garbage is a contract error, not a success', async () => {
    const r = await sendMail(MSG, { env: envFor(), transport: async () => null });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'transport-contract');
  });
});

// ── the message ────────────────────────────────────────────────────────────────────────────────
describe('message validation', () => {
  test('header injection in a recipient or a subject is refused before any transport sees it', async () => {
    const env = envFor();
    let called = 0;
    const spy = async () => { called++; return { status: 'sent' }; };
    for (const bad of [
      { ...MSG, to: 'ops@example.invalid\nBcc: attacker@example.invalid' },
      { ...MSG, subject: 'ok\r\nBcc: attacker@example.invalid' },
      { ...MSG, from: 'a@b.invalid\nX: y' },
    ]) {
      const r = await sendMail(bad, { env, transport: spy });
      assert.equal(r.status, 'error', JSON.stringify(bad));
      assert.equal(r.reason, 'invalid-message');
      assert.match(r.detail, /newline|address/);
    }
    assert.equal(called, 0, 'a malformed message must never reach a transport');
  });

  test('an empty recipient list, a blank subject and an empty body are each refused', async () => {
    for (const bad of [
      { ...MSG, to: [] }, { ...MSG, to: '  ' }, { ...MSG, subject: '   ' },
      { ...MSG, text: '', html: undefined },
    ]) {
      const r = await sendMail(bad, { env: envFor({ CW_MAIL_TRANSPORT: 'none' }) });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'invalid-message');
    }
  });

  test('recipients normalise: a comma list and an array reach the transport identically', () => {
    const a = normalizeMessage({ ...MSG, to: 'a@x.invalid, b@x.invalid' }, { env: {} });
    const b = normalizeMessage({ ...MSG, to: ['a@x.invalid', ' b@x.invalid'] }, { env: {} });
    assert.deepEqual(a.msg.to, ['a@x.invalid', 'b@x.invalid']);
    assert.deepEqual(a.msg.to, b.msg.to);
    assert.equal(a.msg.idempotencyKey, b.msg.idempotencyKey);
  });
});

// ── determinism / the record itself ────────────────────────────────────────────────────────────
describe('determinism', () => {
  test('same inputs ⇒ same record, byte for byte, under CW_NOW', async () => {
    const one = envFor({ CW_MAIL_TRANSPORT: 'none' });
    const two = envFor({ CW_MAIL_TRANSPORT: 'none' });
    await sendMail(MSG, { env: one });
    await sendMail(MSG, { env: two });
    assert.equal(rawOutbox(one), rawOutbox(two));
  });

  test('a long body is capped in the record and the truncation is declared, not hidden', async () => {
    const env = envFor({ CW_MAIL_TRANSPORT: 'none' });
    await sendMail({ ...MSG, text: 'x'.repeat(2500) }, { env });
    const [row] = outboxOf(env);
    assert.equal(row.preview.text.text.length, 2000);
    assert.equal(row.preview.text.truncated, 500);
    assert.equal(row.bytes.text, 2500);
  });

  test('CW_MAIL_OUTBOX="" opts out of recording and says so rather than pretending', () => {
    const r = recordAttempt({ at: NOW }, { env: { CW_MAIL_OUTBOX: '' } });
    assert.deepEqual(r, { recorded: false, reason: 'disabled', outbox: null });
  });
});
