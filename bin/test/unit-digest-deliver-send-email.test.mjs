// Computes the delivery result for a digest email (bin/digest-deliver.mjs sendEmail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendEmail } from '../digest-deliver.mjs';

const KEY = 're_fixturekeyfixturekey00';
const TO = ['a@example.invalid', 'b@example.invalid'];
const dest = { to: TO, key: 'email:0123456789abcdef' };
const doc = { digestId: 'd1', status: 'measured', window: { since: 's', until: 'u' }, sections: {} };

function setup(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-send-email-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = {
    CW_MAIL_TRANSPORT: 'resend', CW_MAIL_FROM: 'commitwork <digest@example.invalid>', CW_RESEND_API_KEY: KEY,
    CW_RESEND_API_URL: 'http://127.0.0.1:9/emails', CW_MAIL_ATTEMPTS: '1', CW_NOW: '2026-11-13T00:00:00.000Z',
    CW_MAIL_OUTBOX: join(dir, 'outbox.jsonl'), CW_SECRETS_FILE: join(dir, 'absent-secrets.json'), ...extra,
  };
  const outbox = () => readFileSync(env.CW_MAIL_OUTBOX, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { env, outbox };
}

const respond = (status, body = '') => async () => ({ status, text: async () => body });

test('a 2xx is ok with the HTTP status and no reason, and the attempt is recorded to the configured outbox', async (t) => {
  const { env, outbox } = setup(t);
  const result = await sendEmail(dest, { doc }, { env, fetchImpl: respond(202, '{"id":"fixture-id"}') });
  assert.deepEqual(result, { ok: true, status: 202, reason: null });
  assert.deepEqual(outbox().map((r) => [r.status, r.idempotencyKey]), [['sent', 'commitwork-digest/d1/email:0123456789abcdef']]);
});

test('an HTTP error keeps its status, and every recipient address in the reason becomes (recipient)', async (t) => {
  const { env } = setup(t);
  const result = await sendEmail(dest, { doc }, { env, fetchImpl: respond(422, `{"message":"${TO[0]} and ${TO[1]} and ${TO[0]} are invalid"}`) });
  assert.deepEqual(result, { ok: false, status: 422,
    reason: 'error: http-422 (HTTP 422: {"message":"(recipient) and (recipient) and (recipient) are invalid"})' });
});

test('line breaks in the reason collapse to one space and the reason is cut at 300 characters', async (t) => {
  const { env } = setup(t);
  const result = await sendEmail(dest, { doc }, { env, fetchImpl: respond(400, `first\r\nsecond\n${'x'.repeat(400)}`) });
  assert.equal(result.status, 400);
  assert.equal(result.reason.length, 300);
  assert.ok(result.reason.startsWith('error: http-400 (HTTP 400: first second xxx'), result.reason);
  assert.doesNotMatch(result.reason, /[\r\n]/);
});

test('a network failure has no HTTP status and names the failure', async (t) => {
  const { env } = setup(t);
  const result = await sendEmail(dest, { doc }, { env, fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); } });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.reason, /^error: network \(http:\/\/127\.0\.0\.1:9\/emails: connect ECONNREFUSED\)$/);
});

test('no transport is not-configured with no HTTP status, nothing is fetched, and the attempt is still recorded', async (t) => {
  const { env, outbox } = setup(t, { CW_MAIL_TRANSPORT: '' });
  let fetched = 0;
  const result = await sendEmail(dest, { doc }, { env, fetchImpl: async () => { fetched += 1; return { status: 202, text: async () => '' }; } });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.reason, /^not-configured: no-transport-selected \(/);
  assert.equal(fetched, 0);
  assert.deepEqual(outbox().map((r) => r.status), ['not-configured']);
});

test('the key never reaches the reason or the outbox', async (t) => {
  const { env } = setup(t);
  const result = await sendEmail(dest, { doc }, { env, fetchImpl: respond(401, `bad key ${KEY}`) });
  assert.equal(result.status, 401);
  assert.ok(!result.reason.includes(KEY), result.reason);
  assert.ok(!readFileSync(env.CW_MAIL_OUTBOX, 'utf8').includes(KEY), 'the outbox never carries the key');
});
