// Whether this box can deliver mail alerts, and why not (lib/mail.mjs mailStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailStatus } from '../mail.mjs';

const DASH = '\u2014';
const OUT = '/tmp/cw-fixture/outbox.jsonl';
const env = (extra = {}) => ({ CW_MAIL_OUTBOX: OUT, ...extra });
const REMEDY = `${DASH} declare it with: node bin/secrets.mjs set RESEND_API_KEY`;
const base = { from: null, outbox: OUT, ready: false };

test('With no transport set the box reports not-configured', () => {
  const r = mailStatus({ env: env() });
  assert.deepEqual(r, {
    ...base, transport: 'none', selected: false, source: 'default',
    reason: 'not-configured', detail: `no CW_MAIL_TRANSPORT ${DASH} this box cannot deliver an alert`,
  });
});

test('An explicit none transport, in any case and padding, is a dry run', () => {
  const r = mailStatus({ env: env({ CW_MAIL_TRANSPORT: '  None ' }) });
  assert.deepEqual(r, {
    ...base, transport: 'none', selected: true, source: 'env',
    reason: 'dry-run', detail: `CW_MAIL_TRANSPORT=none ${DASH} messages are recorded and never sent`,
  });
});

test('An unknown transport name is refused rather than guessed', () => {
  const r = mailStatus({ env: env({ CW_MAIL_TRANSPORT: 'carrier-pigeon' }) });
  assert.deepEqual(r, {
    ...base, transport: 'none', selected: false, source: 'env',
    reason: 'unknown-transport',
    detail: `CW_MAIL_TRANSPORT="carrier-pigeon" is not a known transport (none, resend, smtp) ${DASH} refusing to guess`,
  });
});

test('The smtp transport is reported as not implemented', () => {
  const r = mailStatus({ env: env({ CW_MAIL_TRANSPORT: 'smtp', CW_MAIL_FROM: 'a@example.com' }) });
  assert.deepEqual(r, {
    ...base, transport: 'smtp', selected: true, source: 'env', from: 'a@example.com',
    reason: 'transport-not-implemented', detail: 'the smtp transport is a seam, not an implementation',
  });
});

test('Resend with no key anywhere reports key-undeclared with the remedy', () => {
  const r = mailStatus({
    env: env({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: 'a@example.com' }),
    resolveSecret: () => ({ ok: false, reason: 'undeclared' }),
  });
  assert.deepEqual(r, {
    ...base, transport: 'resend', selected: true, source: 'env', from: 'a@example.com',
    reason: 'key-undeclared',
    detail: `no CW_RESEND_API_KEY in the environment and no keychain ref for RESEND_API_KEY ${REMEDY}`,
  });
});

test('Resend with an unreadable secrets table reports key-secrets-unreadable', () => {
  const r = mailStatus({
    env: env({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: 'a@example.com' }),
    resolveSecret: () => { throw new Error('bad ref table'); },
  });
  assert.deepEqual(r, {
    ...base, transport: 'resend', selected: true, source: 'env', from: 'a@example.com',
    reason: 'key-secrets-unreadable', detail: 'bad ref table',
  });
});

test('Resend with a key but a blank from address reports no-from', () => {
  const r = mailStatus({
    env: env({ CW_MAIL_TRANSPORT: 'resend', CW_RESEND_API_KEY: 'sk_test_12345678', CW_MAIL_FROM: '   ' }),
  });
  assert.deepEqual(r, {
    ...base, transport: 'resend', selected: true, source: 'env', keySource: 'env',
    reason: 'no-from', detail: 'CW_MAIL_FROM is unset',
  });
});

test('Resend with an env key and a from address is ready', () => {
  const r = mailStatus({
    env: env({ CW_MAIL_TRANSPORT: 'resend', CW_RESEND_API_KEY: 'sk_env_12345678', CW_MAIL_FROM: ' ops@example.com ' }),
  });
  assert.deepEqual(r, {
    transport: 'resend', selected: true, source: 'env', from: 'ops@example.com',
    outbox: OUT, ready: true, reason: null, detail: null, keySource: 'env',
  });
});

test('Resend with a keychain key and a from address is ready from the keychain', () => {
  const r = mailStatus({
    env: env({ CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: 'alert@example.com' }),
    resolveSecret: () => ({ ok: true, value: 'sk_chain_12345678' }),
  });
  assert.deepEqual(r, {
    transport: 'resend', selected: true, source: 'env', from: 'alert@example.com',
    outbox: OUT, ready: true, reason: null, detail: null, keySource: 'keychain',
  });
});

test('An empty outbox override is reported as a null outbox', () => {
  const r = mailStatus({ env: { CW_MAIL_OUTBOX: '' } });
  assert.deepEqual(r, {
    transport: 'none', selected: false, source: 'default', from: null, outbox: null,
    ready: false, reason: 'not-configured', detail: `no CW_MAIL_TRANSPORT ${DASH} this box cannot deliver an alert`,
  });
});
