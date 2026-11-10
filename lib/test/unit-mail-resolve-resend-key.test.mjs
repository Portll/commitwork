// Resolves the Resend API key from env or keychain (lib/mail.mjs resolveResendKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResendKey } from '../mail.mjs';

test('returns env key when CW_RESEND_API_KEY is set', () => {
  const r = resolveResendKey({ env: { CW_RESEND_API_KEY: 'env-key-12345678' } });
  assert.deepEqual(r, { ok: true, value: "env-key-12345678", source: "env" });
});

test('returns env key when only RESEND_API_KEY is set', () => {
  const r = resolveResendKey({ env: { RESEND_API_KEY: 'env-key-87654321' } });
  assert.deepEqual(r, { ok: true, value: "env-key-87654321", source: "env" });
});

test('returns keychain value when resolver succeeds', () => {
  const r = resolveResendKey({
    env: {},
    resolveSecret: () => ({ ok: true, value: 'kc-key-11111111' }),
  });
  assert.deepEqual(r, { ok: true, value: "kc-key-11111111", source: "keychain" });
});

test('returns undeclared reason when no key found', () => {
  const r = resolveResendKey({
    env: {},
    resolveSecret: () => ({ ok: false, reason: 'not-found', detail: 'no ref' }),
  });
  assert.deepEqual(r, { ok: false, reason: "not-found", detail: "no ref \u2014 declare it with: node bin/secrets.mjs set RESEND_API_KEY" });
});

test('returns secrets-unreadable when resolver throws', () => {
  const r = resolveResendKey({
    env: {},
    resolveSecret: () => { throw new Error('bad ref table'); },
  });
  assert.deepEqual(r, { ok: false, reason: "secrets-unreadable", detail: "bad ref table" });
});

test('returns undeclared when resolver returns null', () => {
  const r = resolveResendKey({
    env: {},
    resolveSecret: () => null,
  });
  assert.deepEqual(r, { ok: false, reason: "undeclared", detail: "no CW_RESEND_API_KEY in the environment and no keychain ref for RESEND_API_KEY \u2014 declare it with: node bin/secrets.mjs set RESEND_API_KEY" });
});

test('returns keychain when resolver returns ok with empty value', () => {
  const r = resolveResendKey({
    env: {},
    resolveSecret: () => ({ ok: true, value: '' }),
  });
  assert.deepEqual(r, { ok: false, reason: "undeclared", detail: "no CW_RESEND_API_KEY in the environment and no keychain ref for RESEND_API_KEY \u2014 declare it with: node bin/secrets.mjs set RESEND_API_KEY" });
});

test('returns env key when both CW_RESEND_API_KEY and RESEND_API_KEY are set', () => {
  const r = resolveResendKey({
    env: { CW_RESEND_API_KEY: 'cw-key-22222222', RESEND_API_KEY: 'rs-key-33333333' },
  });
  assert.deepEqual(r, { ok: true, value: "cw-key-22222222", source: "env" });
});
