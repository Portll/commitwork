// The scrubbed send result and outbox record for one mail attempt (lib/mail.mjs sendMail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMail } from '../mail.mjs';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const h = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const key = (to, subject, text, html) => `cw-${h(`${to.join(',')}\0${subject}\0${h(`${text}\0${html ?? ''}`)}`).slice(0, 32)}`;
const K = key(['a@b.co'], 's', 't', null);
const msg = (o = {}) => ({ to: 'a@b.co', subject: 's', text: 't', ...o });
const lines = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const base = (r, extra) => ({ ok: false, transport: 'inj', to: ['a@b.co'], subject: 's', at: r.at, idempotencyKey: K, recorded: true, ...extra });
const ioError = (p) => {
  try { appendFileSync(p, 'x\n', { mode: 0o600 }); } catch (e) { return `outbox write failed (${e.code}: ${p}: ${e.message})`; }
  return null;
};
const inDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'sendMail-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('an object transport that sends gives an ok result and writes the full record', () => inDir(async (dir) => {
  const outbox = join(dir, 'o.jsonl');
  const transport = { name: 'inj', send: async () => ({ status: 'sent', messageId: 'm1', httpStatus: 202 }) };
  const r = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox }, transport });
  assert.deepEqual(r, base(r, { status: 'sent', messageId: 'm1', httpStatus: 202, ok: true, outbox }));
  assert.deepEqual(lines(outbox), [{
    at: r.at, transport: 'inj', transportSource: 'injected', status: 'sent', sent: true, reason: null, detail: null,
    to: ['a@b.co'], subject: 's', from: null, idempotencyKey: K, bodyHash: h('t\0'), bytes: { text: 1, html: 0 },
    preview: { text: { text: 't', truncated: 0 }, html: null }, messageId: 'm1', httpStatus: 202, attempts: null,
  }]);
}));

test('a named function transport is attributed by its name and an html-only body records zero text bytes', () => inDir(async (dir) => {
  const outbox = join(dir, 'o.jsonl');
  const fn = async () => ({ status: 'sent' });
  const message = { to: 'a@b.co, c@d.co', subject: ' s2 ', html: '<p>h</p>', from: ' f@g.co ' };
  const r = await sendMail(message, { env: { CW_MAIL_OUTBOX: outbox }, transport: fn });
  const to = ['a@b.co', 'c@d.co'];
  const k = key(to, 's2', '', '<p>h</p>');
  assert.deepEqual(r, base(r, { status: 'sent', ok: true, transport: 'fn', to, subject: 's2', idempotencyKey: k, outbox }));
  assert.deepEqual(lines(outbox), [{
    at: r.at, transport: 'fn', transportSource: 'injected', status: 'sent', sent: true, reason: null, detail: null,
    to, subject: 's2', from: 'f@g.co', idempotencyKey: k, bodyHash: h('\0<p>h</p>'), bytes: { text: 0, html: 8 },
    preview: { text: null, html: { bytes: 8 } }, messageId: null, httpStatus: null, attempts: null,
  }]);
}));

test('an invalid message is refused without calling the transport and a blank outbox path records nothing', async () => {
  let calls = 0;
  const transport = { name: 'inj', send: async () => { calls += 1; return { status: 'sent' }; } };
  const r = await sendMail({ to: 'nope', subject: 'a\nb', text: 't' }, { env: { CW_MAIL_OUTBOX: '' }, transport });
  assert.equal(calls, 0);
  assert.deepEqual(r, base(r, {
    status: 'error', reason: 'invalid-message', detail: 'recipient "nope" is not an address; the subject contains a newline (header injection)',
    to: ['nope'], subject: 'a\nb', idempotencyKey: key(['nope'], 'a\nb', 't', null), recorded: false, outbox: null,
  }));
});

test('an unknown transport name is a configuration fault attributed to none', () => inDir(async (dir) => {
  const outbox = join(dir, 'o.jsonl');
  const r = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox }, transport: 'bogus' });
  assert.deepEqual(r, base(r, { status: 'not-configured', reason: 'unknown-transport', detail: 'unknown transport "bogus" (none, resend, smtp)', transport: 'none', outbox }));
  assert.deepEqual(lines(outbox).map((l) => [l.transportSource, l.sent, l.reason]), [['arg', false, 'unknown-transport']]);
}));

test('a throwing transport is an error whose detail is the thrown value with registered secrets redacted', () => inDir(async (dir) => {
  const env = { CW_MAIL_OUTBOX: join(dir, 'o.jsonl') };
  const r1 = await sendMail(msg(), { env, transport: { name: 'inj', send: async () => { throw 'boom-str'; } } });
  assert.deepEqual(r1, base(r1, { status: 'error', reason: 'transport-threw', detail: 'boom-str', outbox: env.CW_MAIL_OUTBOX }));
  const send = async (m, c) => { c.secret('topsecret1'); throw new Error('bad topsecret1'); };
  const r2 = await sendMail(msg(), { env, transport: { name: 'inj', send } });
  assert.deepEqual(r2, base(r2, { status: 'error', reason: 'transport-threw', detail: 'bad [REDACTED]', outbox: env.CW_MAIL_OUTBOX }));
}));

test('only string secrets of at least eight characters are redacted from a returned detail', () => inDir(async (dir) => {
  const outbox = join(dir, 'o.jsonl');
  const send = async (m, c) => {
    c.secret('ABCDEFGH'); c.secret('xyzuvwq'); c.secret(123456789);
    return { status: 'error', reason: 'x', detail: 'a ABCDEFGH b xyzuvwq c 123456789' };
  };
  const r = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox }, transport: { name: 'inj', send } });
  assert.deepEqual(r, base(r, { status: 'error', reason: 'x', detail: 'a [REDACTED] b xyzuvwq c 123456789', outbox }));
  assert.equal(lines(outbox)[0].detail, 'a [REDACTED] b xyzuvwq c 123456789');
}));

test('the none transport is a dry run when chosen and not-configured by default, with the preview capped at 2000', () => inDir(async (dir) => {
  const outbox = join(dir, 'o.jsonl');
  const env = { CW_MAIL_OUTBOX: outbox };
  const [t0, t1] = ['x'.repeat(2000), 'x'.repeat(2001)];
  const r1 = await sendMail(msg({ text: t0 }), { env, transport: 'none' });
  assert.deepEqual(r1, base(r1, {
    status: 'dry-run', reason: 'transport-none', detail: 'CW_MAIL_TRANSPORT=none: the message was recorded to the outbox and NOT sent',
    transport: 'none', idempotencyKey: key(['a@b.co'], 's', t0, null), outbox,
  }));
  const r2 = await sendMail(msg({ text: t1 }), { env });
  assert.deepEqual(r2, base(r2, {
    status: 'not-configured', reason: 'no-transport-selected',
    detail: 'no mail transport is configured: set CW_MAIL_TRANSPORT=resend (plus CW_MAIL_FROM and a RESEND_API_KEY secret). The message was recorded to the outbox and NOT sent.',
    transport: 'none', idempotencyKey: key(['a@b.co'], 's', t1, null), outbox,
  }));
  assert.deepEqual(lines(outbox).map((l) => [l.transportSource, l.bytes, l.preview]), [
    ['arg', { text: 2000, html: 0 }, { text: { text: t0, truncated: 0 }, html: null }],
    ['default', { text: 2001, html: 0 }, { text: { text: t0, truncated: 1 }, html: null }],
  ]);
}));

test('a dry run whose outbox write fails becomes a record-failed error', () => inDir(async (dir) => {
  const outbox = join(dir, 'box');
  mkdirSync(outbox);
  const recordError = ioError(outbox);
  const r = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox, CW_MAIL_TRANSPORT: 'none' } });
  assert.deepEqual(r, base(r, { status: 'error', reason: 'record-failed', detail: recordError, transport: 'none', recorded: false, outbox, recordError }));
}));

test('a transport returning null is a contract error and a failed write only adds recordError', () => inDir(async (dir) => {
  const outbox = join(dir, 'box');
  mkdirSync(outbox);
  const recordError = ioError(outbox);
  const r = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox }, transport: { name: 'inj', send: async () => null } });
  assert.deepEqual(r, base(r, { status: 'error', reason: 'transport-contract', detail: 'transport inj returned null instead of a result with a status', recorded: false, outbox, recordError }));
}));

test('the env picks smtp case-insensitively and a misspelt env transport is refused', () => inDir(async (dir) => {
  const outbox = join(dir, 'o.jsonl');
  const r1 = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox, CW_MAIL_TRANSPORT: ' SMTP ' } });
  assert.deepEqual(r1, base(r1, {
    status: 'not-configured', reason: 'transport-not-implemented', transport: 'smtp', outbox,
    detail: 'the smtp transport is a declared seam and is not built yet \u2014 nothing was sent. Use CW_MAIL_TRANSPORT=resend, or none for a dry run.',
  }));
  const r2 = await sendMail(msg(), { env: { CW_MAIL_OUTBOX: outbox, CW_MAIL_TRANSPORT: 'smpt' } });
  assert.deepEqual(r2, base(r2, {
    status: 'not-configured', reason: 'unknown-transport', transport: 'none', outbox,
    detail: 'CW_MAIL_TRANSPORT="smpt" is not a known transport (none, resend, smtp) \u2014 refusing to guess',
  }));
}));
