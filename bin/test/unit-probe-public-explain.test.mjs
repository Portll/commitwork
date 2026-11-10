// Human-readable incident explanation for a probe status and expected codes (bin/probe-public.mjs explain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../probe-public.mjs';

test('returns the session gate warning when 401 is expected and status is 200', () => {
  const r = explain(200, [401]);
  assert.equal(r, "answered 200 where 401 was expected \u2014 the published surface is serving WITHOUT its session gate. This is a WORSE incident than an outage and every generic uptime monitor renders it green");
});

test('returns the session gate warning when 401 is expected and status is 299', () => {
  const r = explain(299, [401]);
  assert.equal(r, "answered 299 where 401 was expected \u2014 the published surface is serving WITHOUT its session gate. This is a WORSE incident than an outage and every generic uptime monitor renders it green");
});

test('returns the session gate warning when 401 is expected and status is 300', () => {
  const r = explain(300, [401]);
  assert.equal(r, "answered 300; expected 401");
});

test('returns the 5xx ambiguity message when status is 500', () => {
  const r = explain(500, [200]);
  assert.equal(r, "answered 500; expected 200. From outside, a 5xx cannot distinguish the origin being down from the tunnel being down \u2014 check both, and do not assume which");
});

test('returns the 5xx ambiguity message when status is 501', () => {
  const r = explain(501, [200]);
  assert.equal(r, "answered 501; expected 200. From outside, a 5xx cannot distinguish the origin being down from the tunnel being down \u2014 check both, and do not assume which");
});

test('returns the routing or policy message when status is 403', () => {
  const r = explain(403, [200]);
  assert.equal(r, "answered 403; expected 200. The edge answered, so this is a ROUTING or POLICY answer rather than an outage: the hostname resolves and something served it. Check the ingress rule and the declaration before looking at the origin");
});

test('returns the routing or policy message when status is 404', () => {
  const r = explain(404, [200]);
  assert.equal(r, "answered 404; expected 200. The edge answered, so this is a ROUTING or POLICY answer rather than an outage: the hostname resolves and something served it. Check the ingress rule and the declaration before looking at the origin");
});

test('returns the plain head when status is 200 and 401 is not expected', () => {
  const r = explain(200, [200]);
  assert.equal(r, "answered 200; expected 200");
});
