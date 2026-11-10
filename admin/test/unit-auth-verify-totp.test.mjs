// Computes the TOTP step counter matching a 6-digit token within a 1-step window, or null (admin/auth.mjs verifyTotp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTotp } from '../auth.mjs';
import { createHmac } from 'node:crypto';

function b32(buf) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

function totpAt(secretB32, counter) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const key = Buffer.from(Array.from(secretB32.replace(/=+$/, '').toUpperCase()).map(c => A.indexOf(c)).reduce((acc, idx) => {
    let bits = 0, val = 0; const out = [];
    for (const c of secretB32.replace(/=+$/, '').toUpperCase()) {
      const i = A.indexOf(c);
      if (i === -1) continue;
      val = (val << 5) | i; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
  }, []));
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', key).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code = ((mac[off] & 0x7f) << 24 | mac[off + 1] << 16 | mac[off + 2] << 8 | mac[off + 3]) % 10 ** 6;
  return String(code).padStart(6, '0');
}

const SECRET = b32(Buffer.from('0123456789abcdef'));
const NOW = 1000000000000;
const C = Math.floor(NOW / 1000 / 30);

test('returns the current step when the token matches the current counter', () => {
  const token = totpAt(SECRET, C);
  assert.equal(verifyTotp(SECRET, token, NOW), C);
});

test('returns the previous step when the token matches counter minus one', () => {
  const token = totpAt(SECRET, C - 1);
  assert.equal(verifyTotp(SECRET, token, NOW), C - 1);
});

test('returns the next step when the token matches counter plus one', () => {
  const token = totpAt(SECRET, C + 1);
  assert.equal(verifyTotp(SECRET, token, NOW), C + 1);
});

test('returns null when the token matches no step in the window', () => {
  const token = totpAt(SECRET, C + 2);
  assert.equal(verifyTotp(SECRET, token, NOW), null);
});

test('returns null when the token is shorter than six digits', () => {
  assert.equal(verifyTotp(SECRET, '12345', NOW), null);
});

test('returns null when the token is longer than six digits', () => {
  assert.equal(verifyTotp(SECRET, '1234567', NOW), null);
});

test('returns null when the token is empty', () => {
  assert.equal(verifyTotp(SECRET, '', NOW), null);
});

test('returns null when the token is non-numeric', () => {
  assert.equal(verifyTotp(SECRET, 'abcdef', NOW), null);
});

test('strips non-digit characters before comparing', () => {
  const token = totpAt(SECRET, C);
  const spaced = token.split('').join(' ');
  assert.equal(verifyTotp(SECRET, spaced, NOW), C);
});
