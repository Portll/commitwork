// Remote veld state from two independent axes, credential and reachability (bin/memory-query.mjs remoteAdapter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteAdapter } from '../memory-query.mjs';

const NO_CRED_REASON = 'VELD_API_KEY unresolvable \u2014 a configuration failure on this box, not the remote being down';

const makeEnv = () => ({
  CW_VELD_URL: 'http://veld.test:1',
  VELD_URL: 'http://veld.test:1',
  CW_VELD_USER: 'u1',
  CW_VELD_PROJECT: 'proj',
  VELD_API_KEY: 'k1',
});

const downFetch = async () => {
  throw new Error('connect ECONNREFUSED');
};

const axes = (r) => ({ state: r.state, credential: r.credential, reachable: r.reachable });

test('the credential lookup receives the env with reporting turned off', async () => {
  const env = makeEnv();
  const seen = [];
  const credentialImpl = (args) => {
    seen.push(args);
    return { ok: true, source: 'env' };
  };
  await remoteAdapter({ env, fetchImpl: downFetch, credentialImpl });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].env, env);
  assert.equal(seen[0].report, false);
});

test('a credential that resolves only without reporting is treated as present', async () => {
  const credentialImpl = ({ report }) => (report === false ? { ok: true, source: 'env' } : { ok: false });
  const r = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl });
  assert.deepEqual(axes(r), {
    state: 'unreachable',
    credential: { present: true, source: 'env' },
    reachable: false,
  });
});

test('a resolved credential with a failing health check is unreachable and not reachable', async () => {
  const credentialImpl = () => ({ ok: true, source: 'env' });
  const r = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl });
  assert.deepEqual(axes(r), {
    state: 'unreachable',
    credential: { present: true, source: 'env' },
    reachable: false,
  });
});

test('the reason for an unreachable remote names the failed health check', async () => {
  const credentialImpl = () => ({ ok: true, source: 'env' });
  const r = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl });
  assert.equal(r.reason.slice(0, 21), 'health check failed: ');
});

test('an unresolved credential is reported as no-credential with the configuration reason', async () => {
  const credentialImpl = () => ({ ok: false });
  const r = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl });
  assert.deepEqual(axes(r), {
    state: 'no-credential',
    credential: { present: false, source: null },
    reachable: false,
  });
  assert.equal(r.reason, NO_CRED_REASON);
});

test('the credential source is copied from the lookup when it resolves', async () => {
  const credentialImpl = () => ({ ok: true, source: 'keychain' });
  const r = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl });
  assert.deepEqual(r.credential, { present: true, source: 'keychain' });
  assert.equal(r.state, 'unreachable');
});

test('a source reported alongside an unresolved credential is dropped', async () => {
  const credentialImpl = () => ({ ok: false, source: 'env' });
  const r = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl });
  assert.deepEqual(r.credential, { present: false, source: null });
  assert.equal(r.state, 'no-credential');
  assert.equal(r.reason, NO_CRED_REASON);
});

test('a falsy ok value counts as unresolved and a truthy one as resolved', async () => {
  const zero = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl: () => ({ ok: 0, source: 'env' }) });
  assert.deepEqual(axes(zero), {
    state: 'no-credential',
    credential: { present: false, source: null },
    reachable: false,
  });
  const one = await remoteAdapter({ env: makeEnv(), fetchImpl: downFetch, credentialImpl: () => ({ ok: 1, source: 'env' }) });
  assert.deepEqual(axes(one), {
    state: 'unreachable',
    credential: { present: true, source: 'env' },
    reachable: false,
  });
});
