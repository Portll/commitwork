// Validates and normalizes a mail message object into a safe, deduped envelope (lib/mail.mjs normalizeMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage } from '../mail.mjs';

test('splits comma-separated recipient strings and trims whitespace', () => {
  const r = normalizeMessage({ to: 'a@b.com, c@d.com', subject: 's', text: 't' });
  assert.deepEqual(r, { ok: true, errs: [], msg: { to: ["a@b.com", "c@d.com"], subject: "s", text: "t", html: null, from: null, replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-2e94e27e92d30948369172e5897a9e0f" } });
});

test('rejects non-string recipients with a specific error', () => {
  const r = normalizeMessage({ to: [123, 'a@b.com'], subject: 's', text: 't' });
  assert.deepEqual(r, { ok: false, errs: ["recipient 123 is not a string"], msg: { to: [123, "a@b.com"], subject: "s", text: "t", html: null, from: null, replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-d716ca81b07b04c62c6d98ed7d11760b" } });
});

test('rejects recipients containing newlines as header injection', () => {
  const r = normalizeMessage({ to: 'a@b.com\r\nX-Injected: 1', subject: 's', text: 't' });
  assert.deepEqual(r, { ok: false, errs: ["a recipient contains a newline (header injection)"], msg: { to: ["a@b.com\r\nX-Injected: 1"], subject: "s", text: "t", html: null, from: null, replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-13609c02a2f31c87ce9f70673e383db2" } });
});

test('rejects recipients that do not match the address pattern', () => {
  const r = normalizeMessage({ to: 'not-an-email', subject: 's', text: 't' });
  assert.deepEqual(r, { ok: false, errs: ["recipient \"not-an-email\" is not an address"], msg: { to: ["not-an-email"], subject: "s", text: "t", html: null, from: null, replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-eb8140ab5bf1da8aa0393dbd212bb05b" } });
});

test('rejects empty subject with a specific error', () => {
  const r = normalizeMessage({ to: 'a@b.com', subject: '   ', text: 't' });
  assert.deepEqual(r, { ok: false, errs: ["no subject"], msg: { to: ["a@b.com"], subject: "", text: "t", html: null, from: null, replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-4c296778656cece024f123c1b06abead" } });
});

test('rejects subjects containing newlines as header injection', () => {
  const r = normalizeMessage({ to: 'a@b.com', subject: 's\nX-Injected: 1', text: 't' });
  assert.deepEqual(r, { ok: false, errs: ["the subject contains a newline (header injection)"], msg: { to: ["a@b.com"], subject: "s\nX-Injected: 1", text: "t", html: null, from: null, replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-ecb6857b384c02d8a1223e1ea81d9d2e" } });
});

test('rejects messages with no text and no html body', () => {
  const r = normalizeMessage({ to: 'a@b.com', subject: 's' });
  assert.deepEqual(r, { ok: false, errs: ["no body (text or html)"], msg: { to: ["a@b.com"], subject: "s", text: null, html: null, from: null, replyTo: null, bodyHash: "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d", idempotencyKey: "cw-c75a44f79016fb9ccd0dac3607af23b0" } });
});

test('rejects from addresses containing newlines as header injection', () => {
  const r = normalizeMessage({ to: 'a@b.com', subject: 's', text: 't', from: 'a@b.com\nX-Injected: 1' });
  assert.deepEqual(r, { ok: false, errs: ["the from address contains a newline (header injection)"], msg: { to: ["a@b.com"], subject: "s", text: "t", html: null, from: "a@b.com\nX-Injected: 1", replyTo: null, bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-02a4c09bfae506a58f54a90f479c2d95" } });
});

test('returns ok true with normalized fields and computed idempotency key for valid input', () => {
  const r = normalizeMessage({ to: 'a@b.com', subject: 's', text: 't', from: 'f@b.com', replyTo: 'r@b.com' });
  assert.deepEqual(r, { ok: true, errs: [], msg: { to: ["a@b.com"], subject: "s", text: "t", html: null, from: "f@b.com", replyTo: "r@b.com", bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-02a4c09bfae506a58f54a90f479c2d95" } });
});

test('uses environment variables for from and replyTo when message fields are absent', () => {
  const r = normalizeMessage({ to: 'a@b.com', subject: 's', text: 't' }, { env: { CW_MAIL_FROM: 'env@b.com', CW_MAIL_REPLY_TO: 'env-reply@b.com' } });
  assert.deepEqual(r, { ok: true, errs: [], msg: { to: ["a@b.com"], subject: "s", text: "t", html: null, from: "env@b.com", replyTo: "env-reply@b.com", bodyHash: "3776096e9733584bd622e7e6417b65ba6640f8a8b809f475cd15ed5923cce3f6", idempotencyKey: "cw-02a4c09bfae506a58f54a90f479c2d95" } });
});
