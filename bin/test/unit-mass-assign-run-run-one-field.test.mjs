// Mass-assignment probe outcome for one field: finding, teardown failure and error (bin/mass-assign-run.mjs runOneField).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOneField } from '../mass-assign-run.mjs';

const D = '\u2014';
const base = { createPath: '/api/users', readPath: '/api/users/{id}', teardownPath: '/api/users/{id}', idPath: 'id' };
const admin = { name: 'role', value: 'admin', expectRejected: true };

function setup(responses) {
  const calls = [];
  const reqFn = async (path, opts) => {
    calls.push({ path, ...opts });
    const r = responses[opts.method];
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, reqFn };
}

test('a create status of 199 returns an error and makes no further requests', async () => {
  const { calls, reqFn } = setup({ POST: { status: 199, text: '{"id":1}' } });
  const r = await runOneField({ ...base, actor: { name: 'alice' }, field: admin, reqFn });
  assert.deepEqual(r, { finding: null, teardownFailed: null, error: `create POST /api/users returned HTTP 199 ${D} cannot probe "role" without a created object` });
  assert.equal(calls.length, 1);
});

test('a create status of 300 returns an error and makes no further requests', async () => {
  const { calls, reqFn } = setup({ POST: { status: 300, text: '{"id":1}' } });
  const r = await runOneField({ ...base, actor: { name: 'alice' }, field: admin, reqFn });
  assert.deepEqual(r, { finding: null, teardownFailed: null, error: `create POST /api/users returned HTTP 300 ${D} cannot probe "role" without a created object` });
  assert.equal(calls.length, 1);
});

test('a create status of 200 with a persisted rejected field reports a critical finding and sends the expected requests', async () => {
  const text = '{"id":42,"role":"admin"}';
  const { calls, reqFn } = setup({ POST: { status: 200, text }, GET: { status: 200, text }, DELETE: { status: 299, text: '' } });
  const actor = { name: 'alice', headers: { 'X-Auth': 'tok' } };
  const r = await runOneField({ ...base, actor, field: admin, reqFn });
  assert.deepEqual(r, {
    finding: {
      type: 'mass-assignment', severity: 'critical',
      detail: `alice set "role" to "admin" on create and it was PERSISTED (re-read confirms, id=42) ${D} the server accepted a client-controlled field it should own itself`,
      field: 'role', createdId: 42,
    },
    teardownFailed: null, error: null,
  });
  assert.deepEqual(calls, [
    { path: '/api/users', method: 'POST', headers: { 'X-Auth': 'tok', 'Content-Type': 'application/json' }, body: '{"role":"admin","_probe":true}' },
    { path: '/api/users/42', method: 'GET', headers: { 'X-Auth': 'tok' } },
    { path: '/api/users/42', method: 'DELETE', headers: { 'X-Auth': 'tok' } },
  ]);
});

test('a settable field that is not persisted reports a probe-broken finding and a DELETE of 200 is a clean teardown', async () => {
  const { calls, reqFn } = setup({ POST: { status: 201, text: '{"id":7}' }, GET: { status: 200, text: '{"id":7,"name":"y"}' }, DELETE: { status: 200, text: '' } });
  const r = await runOneField({ ...base, actor: { name: 'carol' }, field: { name: 'name', value: 'x', expectRejected: false }, reqFn });
  assert.deepEqual(r, {
    finding: {
      type: 'mass-assignment-probe-broken', severity: 'medium',
      detail: `carol set "name" (declared expectRejected:false, i.e. legitimately settable) and it was NOT persisted ${D} either this probe's own create/reread mechanism is broken, or the field silently no-ops; worth checking either way`,
      field: 'name', createdId: 7,
    },
    teardownFailed: null, error: null,
  });
  assert.deepEqual(calls, [
    { path: '/api/users', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x","_probe":true}' },
    { path: '/api/users/7', method: 'GET', headers: {} },
    { path: '/api/users/7', method: 'DELETE', headers: {} },
  ]);
});

test('a settable field that is persisted with no idPath returns a clean result and skips teardown', async () => {
  const { calls, reqFn } = setup({ POST: { status: 201, text: '{"id":9}' }, GET: { status: 200, text: '{"title":"t"}' }, DELETE: { status: 200, text: '' } });
  const r = await runOneField({ ...base, idPath: undefined, readPath: '/api/things', actor: { name: 'dave' }, field: { name: 'title', value: 't', expectRejected: false }, reqFn });
  assert.deepEqual(r, { finding: null, teardownFailed: null, error: null });
  assert.deepEqual(calls.map((c) => c.path), ['/api/users', '/api/things']);
});

test('a rejected field that is not persisted gives no finding and a DELETE of 300 is a teardown failure', async () => {
  const { reqFn } = setup({ POST: { status: 201, text: '{"id":11}' }, GET: { status: 200, text: '{"id":11,"role":"user"}' }, DELETE: { status: 300, text: '' } });
  const r = await runOneField({ ...base, actor: { name: 'hank' }, field: admin, reqFn });
  assert.deepEqual(r, { finding: null, teardownFailed: `DELETE /api/users/11 returned HTTP 300 ${D} the probe object (id=11) may still exist in the target`, error: null });
});

test('a DELETE that throws records the thrown message as a teardown failure', async () => {
  const text = '{"id":3,"role":"admin"}';
  const { reqFn } = setup({ POST: { status: 201, text }, GET: { status: 200, text }, DELETE: new Error('net down') });
  const r = await runOneField({ ...base, actor: { name: 'frank' }, field: admin, reqFn });
  assert.deepEqual(r, {
    finding: {
      type: 'mass-assignment', severity: 'critical',
      detail: `frank set "role" to "admin" on create and it was PERSISTED (re-read confirms, id=3) ${D} the server accepted a client-controlled field it should own itself`,
      field: 'role', createdId: 3,
    },
    teardownFailed: `DELETE for id=3 threw: net down ${D} the probe object may still exist in the target`,
    error: null,
  });
});

test('a create request that throws records its message as the error', async () => {
  const { calls, reqFn } = setup({ POST: new Error('conn refused') });
  const r = await runOneField({ ...base, actor: { name: 'gina' }, field: admin, reqFn });
  assert.deepEqual(r, { finding: null, teardownFailed: null, error: 'conn refused' });
  assert.equal(calls.length, 1);
});

test('a re-read that throws records the error and still tears down the encoded id', async () => {
  const { calls, reqFn } = setup({ POST: { status: 201, text: '{"id":"a b"}' }, GET: new Error('read failed'), DELETE: { status: 204, text: '' } });
  const r = await runOneField({ ...base, actor: { name: 'ivy' }, field: admin, reqFn });
  assert.deepEqual(r, { finding: null, teardownFailed: null, error: 'read failed' });
  assert.deepEqual(calls.map((c) => c.path), ['/api/users', '/api/users/a%20b', '/api/users/a%20b']);
});
