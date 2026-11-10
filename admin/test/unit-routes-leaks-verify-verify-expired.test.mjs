// Decodes a JWT from a matched line and reports whether its exp claim is in the past (admin/routes/leaks-verify.mjs verifyExpired).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyExpired } from '../routes/leaks-verify.mjs';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeJwt(payload) {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const body = b64url(payload);
  const sig = b64url({});
  return `${header}.${body}.${sig}`;
}

test('returns weak none when the line has no decodable JWT', () => {
  const out = verifyExpired({ matched: 'not a jwt', now: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(out, {
    tier: 'weak',
    verdict: 'none',
    detail: 'no decodable JWT on the line; expiry is not checkable locally',
    checks: [{ name: 'jwt-decode', result: 'unavailable', detail: 'the line carries no three-part JWT' }],
  });
});

test('returns weak none when the decoded payload has no numeric exp', () => {
  const token = makeJwt({ sub: 'user1' });
  const out = verifyExpired({ matched: token, now: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(out, {
    tier: 'weak',
    verdict: 'none',
    detail: 'the token decoded but carries no numeric exp claim',
    checks: [
      { name: 'jwt-decode', result: 'pass', detail: 'payload decoded' },
      { name: 'exp-claim', result: 'unavailable', detail: 'no numeric exp claim' },
    ],
  });
});

test('returns strong supports when exp is before now', () => {
  const exp = 1700000000;
  const token = makeJwt({ exp });
  const now = '2024-01-01T00:00:00.000Z';
  const out = verifyExpired({ matched: token, now });
  const expIso = new Date(exp * 1000).toISOString();
  assert.equal(out.tier, 'strong');
  assert.equal(out.verdict, 'supports');
  assert.equal(out.detail, `exp ${expIso} is before ${now}`);
  assert.equal(out.checks[0].name, 'jwt-decode');
  assert.equal(out.checks[0].result, 'pass');
  assert.equal(out.checks[1].name, 'exp-claim');
  assert.equal(out.checks[1].result, 'pass');
  assert.equal(out.checks[1].detail, `exp ${expIso} vs ${now}`);
});

test('returns strong contradicts when exp is after now', () => {
  const exp = 1800000000;
  const token = makeJwt({ exp });
  const now = '2024-01-01T00:00:00.000Z';
  const out = verifyExpired({ matched: token, now });
  const expIso = new Date(exp * 1000).toISOString();
  assert.equal(out.tier, 'strong');
  assert.equal(out.verdict, 'contradicts');
  assert.equal(out.detail, `exp ${expIso} is not before ${now} \u2014 the token is still within its validity window`);
  assert.equal(out.checks[1].result, 'fail');
});

test('returns strong contradicts when exp equals now exactly', () => {
  const now = '2024-01-01T00:00:00.000Z';
  const exp = Date.parse(now) / 1000;
  const token = makeJwt({ exp });
  const out = verifyExpired({ matched: token, now });
  const expIso = new Date(exp * 1000).toISOString();
  assert.equal(out.tier, 'strong');
  assert.equal(out.verdict, 'contradicts');
  assert.equal(out.detail, `exp ${expIso} is not before ${now} \u2014 the token is still within its validity window`);
  assert.equal(out.checks[1].result, 'fail');
});

test('returns strong supports when exp is one second before now', () => {
  const now = '2024-01-01T00:00:00.000Z';
  const exp = Date.parse(now) / 1000 - 1;
  const token = makeJwt({ exp });
  const out = verifyExpired({ matched: token, now });
  const expIso = new Date(exp * 1000).toISOString();
  assert.equal(out.tier, 'strong');
  assert.equal(out.verdict, 'supports');
  assert.equal(out.detail, `exp ${expIso} is before ${now}`);
  assert.equal(out.checks[1].result, 'pass');
});

test('returns weak none when exp is not finite', () => {
  const token = makeJwt({ exp: Infinity });
  const out = verifyExpired({ matched: token, now: '2024-01-01T00:00:00.000Z' });
  assert.equal(out.tier, 'weak');
  assert.equal(out.verdict, 'none');
  assert.equal(out.detail, 'the token decoded but carries no numeric exp claim');
  assert.equal(out.checks[1].result, 'unavailable');
});

test('returns weak none when matched is empty string', () => {
  const out = verifyExpired({ matched: '', now: '2024-01-01T00:00:00.000Z' });
  assert.equal(out.tier, 'weak');
  assert.equal(out.verdict, 'none');
  assert.equal(out.checks[0].result, 'unavailable');
});
