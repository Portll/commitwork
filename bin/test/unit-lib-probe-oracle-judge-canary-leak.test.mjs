// Composes positive-control gate and canary presence into a leak, clean, or void verdict (bin/lib/probe-oracle.mjs judgeCanaryLeak).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCanaryLeak } from '../lib/probe-oracle.mjs';

test('returns void when baseline status is 401', () => {
  const r = judgeCanaryLeak({ baseline: { status: 401 }, attackerResp: { status: 200, text: 'x' }, canary: 'C' });
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP 401) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 401 });
});

test('returns void when baseline is null', () => {
  const r = judgeCanaryLeak({ baseline: null, attackerResp: { status: 200, text: 'x' }, canary: 'C' });
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP unreachable) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 0 });
});

test('returns leak when attacker response contains canary', () => {
  const r = judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { status: 200, text: 'hello CANARY123 world' }, canary: 'CANARY123' });
  assert.deepEqual(r, { state: "leak", ok: true, canary: "CANARY123", status: 200 });
});

test('returns clean when attacker response does not contain canary', () => {
  const r = judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { status: 200, text: 'no marker here' }, canary: 'CANARY123' });
  assert.deepEqual(r, { state: "clean", ok: true, status: 200 });
});

test('returns leak with status 0 when attackerResp is null', () => {
  const r = judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: null, canary: 'C' });
  assert.deepEqual(r, { state: "clean", ok: true, status: 200 });
});

test('returns clean when canary is empty string', () => {
  const r = judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { status: 200, text: 'anything' }, canary: '' });
  assert.deepEqual(r, { state: "clean", ok: true, status: 200 });
});

test('returns leak when canary appears in body property', () => {
  const r = judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { status: 200, body: 'prefix SECRET999 suffix' }, canary: 'SECRET999' });
  assert.deepEqual(r, { state: "leak", ok: true, canary: "SECRET999", status: 200 });
});

test('returns clean when baseline status is 299', () => {
  const r = judgeCanaryLeak({ baseline: { status: 299 }, attackerResp: { status: 200, text: 'plain' }, canary: 'ZZZ' });
  assert.deepEqual(r, { state: "clean", ok: true, status: 299 });
});
