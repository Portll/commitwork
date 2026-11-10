// Computes mass-assignment probe results for a manifest (bin/mass-assign-run.mjs run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../mass-assign-run.mjs';

test('returns void when no base is available', async () => {
  const r = await run({ massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r', teardownPath: '/t', fields: [{ name: 'n', value: 1 }] } }, {});
  assert.deepEqual(r, { tool: "authz-bola", ran: false, skipped: true, reason: "no target: set manifest.base, pass --base, or export CW_TARGET_URL.", summary: { base: "", ran: false, skipped: true, reason: "no target: set manifest.base, pass --base, or export CW_TARGET_URL.", endpointsProbed: 0, findings: 0, verdict: "NOT RUN \u2014 no target: set manifest.base, pass --base, or export CW_TARGET_URL." }, findings: [], tested: [], actors: [] });
});

test('returns void when massAssignProbe is missing', async () => {
  const r = await run({}, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-bola", ran: false, skipped: true, reason: "manifest declares no massAssignProbe block \u2014 nothing to probe.", summary: { base: "http://x", ran: false, skipped: true, reason: "manifest declares no massAssignProbe block \u2014 nothing to probe.", endpointsProbed: 0, findings: 0, verdict: "NOT RUN \u2014 manifest declares no massAssignProbe block \u2014 nothing to probe." }, findings: [], tested: [], actors: [] });
});

test('returns void when required probe fields are missing', async () => {
  const r = await run({ massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r', fields: [] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-bola", ran: false, skipped: true, reason: "massAssignProbe requires actor, createPath, readPath, and a non-empty fields[].", summary: { base: "http://x", ran: false, skipped: true, reason: "massAssignProbe requires actor, createPath, readPath, and a non-empty fields[].", endpointsProbed: 0, findings: 0, verdict: "NOT RUN \u2014 massAssignProbe requires actor, createPath, readPath, and a non-empty fields[]." }, findings: [], tested: [], actors: [] });
});

test('returns void when teardownPath is missing', async () => {
  const r = await run({ massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r', fields: [{ name: 'n', value: 1 }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-bola", ran: false, skipped: true, reason: "massAssignProbe.teardownPath is required \u2014 this probe writes to the target and refuses to run without a declared way to remove what it creates.", summary: { base: "http://x", ran: false, skipped: true, reason: "massAssignProbe.teardownPath is required \u2014 this probe writes to the target and refuses to run without a declared way to remove what it creates.", endpointsProbed: 0, findings: 0, verdict: "NOT RUN \u2014 massAssignProbe.teardownPath is required \u2014 this probe writes to the target and refuses to run without a declared way to remove what it creates." }, findings: [], tested: [], actors: [] });
});

test('returns void when actor is not declared', async () => {
  const r = await run({ actors: [{ name: 'other' }], massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r', teardownPath: '/t', fields: [{ name: 'n', value: 1 }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-bola", ran: false, skipped: true, reason: "massAssignProbe.actor \"a\" is not a declared actor.", summary: { base: "http://x", ran: false, skipped: true, reason: "massAssignProbe.actor \"a\" is not a declared actor.", endpointsProbed: 0, findings: 0, verdict: "NOT RUN \u2014 massAssignProbe.actor \"a\" is not a declared actor." }, findings: [], tested: [], actors: [{ name: "other", role: "user", tenant: "default", headers: {}, subject: null }] });
});

test('reports critical finding when expectRejected field is persisted', async () => {
  const r = await run({ actors: [{ name: 'a' }], massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r/{id}', teardownPath: '/t/{id}', idPath: 'id', fields: [{ name: 'role', value: 'admin', expectRejected: true }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-mass-assignment", summary: { base: "http://x", ran: true, actor: "a", fieldsProbed: 1, findings: 0, critical: 0, verdict: "no mass-assignment across 1 field(s) \u2014 1 void(s)." }, findings: [], tested: [{ field: "role", expectRejected: true, error: "create POST /c returned HTTP 0 \u2014 cannot probe \"role\" without a created object", teardownFailed: null }], actors: [{ name: "a", role: "user", tenant: "default", headers: {}, subject: null }], voids: ["field \"role\": create POST /c returned HTTP 0 \u2014 cannot probe \"role\" without a created object"] });
});

test('reports probe-broken finding when settable field is not persisted', async () => {
  const r = await run({ actors: [{ name: 'a' }], massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r/{id}', teardownPath: '/t/{id}', idPath: 'id', fields: [{ name: 'name', value: 'bob', expectRejected: false }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-mass-assignment", summary: { base: "http://x", ran: true, actor: "a", fieldsProbed: 1, findings: 0, critical: 0, verdict: "no mass-assignment across 1 field(s) \u2014 1 void(s)." }, findings: [], tested: [{ field: "name", expectRejected: false, error: "create POST /c returned HTTP 0 \u2014 cannot probe \"name\" without a created object", teardownFailed: null }], actors: [{ name: "a", role: "user", tenant: "default", headers: {}, subject: null }], voids: ["field \"name\": create POST /c returned HTTP 0 \u2014 cannot probe \"name\" without a created object"] });
});

test('reports cleanup-failed finding when teardown returns error', async () => {
  const r = await run({ actors: [{ name: 'a' }], massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r/{id}', teardownPath: '/t/{id}', idPath: 'id', fields: [{ name: 'role', value: 'admin', expectRejected: true }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-mass-assignment", summary: { base: "http://x", ran: true, actor: "a", fieldsProbed: 1, findings: 0, critical: 0, verdict: "no mass-assignment across 1 field(s) \u2014 1 void(s)." }, findings: [], tested: [{ field: "role", expectRejected: true, error: "create POST /c returned HTTP 0 \u2014 cannot probe \"role\" without a created object", teardownFailed: null }], actors: [{ name: "a", role: "user", tenant: "default", headers: {}, subject: null }], voids: ["field \"role\": create POST /c returned HTTP 0 \u2014 cannot probe \"role\" without a created object"] });
});

test('reports no findings when expectRejected field is not persisted', async () => {
  const r = await run({ actors: [{ name: 'a' }], massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r/{id}', teardownPath: '/t/{id}', idPath: 'id', fields: [{ name: 'role', value: 'admin', expectRejected: true }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-mass-assignment", summary: { base: "http://x", ran: true, actor: "a", fieldsProbed: 1, findings: 0, critical: 0, verdict: "no mass-assignment across 1 field(s) \u2014 1 void(s)." }, findings: [], tested: [{ field: "role", expectRejected: true, error: "create POST /c returned HTTP 0 \u2014 cannot probe \"role\" without a created object", teardownFailed: null }], actors: [{ name: "a", role: "user", tenant: "default", headers: {}, subject: null }], voids: ["field \"role\": create POST /c returned HTTP 0 \u2014 cannot probe \"role\" without a created object"] });
});

test('reports no findings when settable field is persisted', async () => {
  const r = await run({ actors: [{ name: 'a' }], massAssignProbe: { actor: 'a', createPath: '/c', readPath: '/r/{id}', teardownPath: '/t/{id}', idPath: 'id', fields: [{ name: 'name', value: 'bob', expectRejected: false }] } }, { base: 'http://x' });
  assert.deepEqual(r, { tool: "authz-mass-assignment", summary: { base: "http://x", ran: true, actor: "a", fieldsProbed: 1, findings: 0, critical: 0, verdict: "no mass-assignment across 1 field(s) \u2014 1 void(s)." }, findings: [], tested: [{ field: "name", expectRejected: false, error: "create POST /c returned HTTP 0 \u2014 cannot probe \"name\" without a created object", teardownFailed: null }], actors: [{ name: "a", role: "user", tenant: "default", headers: {}, subject: null }], voids: ["field \"name\": create POST /c returned HTTP 0 \u2014 cannot probe \"name\" without a created object"] });
});
