// Chooses the mail transport name and flags from CW_MAIL_TRANSPORT (lib/mail.mjs selectTransport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTransport } from '../mail.mjs';

test('returns the default none transport when CW_MAIL_TRANSPORT is unset', () => {
  const r = selectTransport({ env: {} });
  assert.deepEqual(r, { name: "none", explicit: false, source: "default" });
});

test('returns the default none transport when CW_MAIL_TRANSPORT is empty after trimming', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: '   ' } });
  assert.deepEqual(r, { name: "none", explicit: false, source: "default" });
});

test('returns the default none transport when CW_MAIL_TRANSPORT is the empty string', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: '' } });
  assert.deepEqual(r, { name: "none", explicit: false, source: "default" });
});

test('returns the selected resend transport when CW_MAIL_TRANSPORT is resend', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: 'resend' } });
  assert.deepEqual(r, { name: "resend", explicit: true, source: "env" });
});

test('returns the selected none transport when CW_MAIL_TRANSPORT is none', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: 'none' } });
  assert.deepEqual(r, { name: "none", explicit: true, source: "env" });
});

test('returns the selected smtp transport when CW_MAIL_TRANSPORT is smtp', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: 'smtp' } });
  assert.deepEqual(r, { name: "smtp", explicit: true, source: "env" });
});

test('returns the default none transport with a bad flag when CW_MAIL_TRANSPORT is unknown', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: 'carrier-pigeon' } });
  assert.deepEqual(r, { name: "none", explicit: false, source: "env", bad: "carrier-pigeon", detail: "CW_MAIL_TRANSPORT=\"carrier-pigeon\" is not a known transport (none, resend, smtp) \u2014 refusing to guess" });
});

test('returns the selected transport when CW_MAIL_TRANSPORT is uppercase', () => {
  const r = selectTransport({ env: { CW_MAIL_TRANSPORT: 'RESEND' } });
  assert.deepEqual(r, { name: "resend", explicit: true, source: "env" });
});
