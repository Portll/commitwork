// positiveControl computes whether an authorized baseline returned 2xx (bin/lib/probe-oracle.mjs positiveControl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positiveControl } from '../lib/probe-oracle.mjs';

test('returns ok state with status 200 when baseline status is 200', () => {
  const r = positiveControl({ status: 200 });
  assert.deepEqual(r, { state: "ok", ok: true, status: 200 });
});

test('returns ok state with status 299 when baseline status is 299', () => {
  const r = positiveControl({ status: 299 });
  assert.deepEqual(r, { state: "ok", ok: true, status: 299 });
});

test('returns void state with status 199 when baseline status is 199', () => {
  const r = positiveControl({ status: 199 });
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP 199) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 199 });
});

test('returns void state with status 300 when baseline status is 300', () => {
  const r = positiveControl({ status: 300 });
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP 300) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 300 });
});

test('returns void state with status 0 when baseline is null', () => {
  const r = positiveControl(null);
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP unreachable) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 0 });
});

test('returns void state with status 0 when baseline is undefined', () => {
  const r = positiveControl(undefined);
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP unreachable) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 0 });
});

test('returns void state with status 0 when baseline status is 0', () => {
  const r = positiveControl({ status: 0 });
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP unreachable) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 0 });
});

test('returns void state with status 403 when baseline status is 403', () => {
  const r = positiveControl({ status: 403 });
  assert.deepEqual(r, { state: "void", ok: false, code: "no-positive-control", reason: "authorized baseline did not succeed (HTTP 403) \u2014 a 401/403 here is indistinguishable from an edge WAF blocking the request, so any \"no leak\" or \"control present\" verdict would be unsupported finding. Confirm the legitimate request returns 2xx before trusting a negative.", status: 403 });
});
