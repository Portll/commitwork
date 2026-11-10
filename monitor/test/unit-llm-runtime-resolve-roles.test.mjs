// Host, model and reach for each role, pinned or defaulted (monitor/llm-runtime.mjs resolveRoles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoles } from '../llm-runtime.mjs';

const LOOPBACK = 'http://127.0.0.1:11434';
const NO_PINS = Object.freeze({ a: null, b: null, adjudicator: null });

const declared = (id, url) =>
  new Proxy({ id }, {
    get: (host, key) => {
      if (key in host) return host[key];
      return /url|base|endpoint|address/i.test(String(key)) ? url : undefined;
    },
  });

const posture = (fields) => ({
  enabled: true,
  hosts: {},
  roles: NO_PINS,
  allowNonLoopback: {},
  ...fields,
});

test('every role is null when the posture is off and nothing is pinned', () => {
  const r = resolveRoles(posture({ enabled: false }), { hosts: [] });
  assert.deepEqual(r, { a: null, b: null, adjudicator: null });
});

test('every role is null when the posture is on but no host is declared', () => {
  const r = resolveRoles(posture({}), { hosts: [] });
  assert.deepEqual(r, { a: null, b: null, adjudicator: null });
});

test('every role is null when the only declared host is switched off', () => {
  const p = posture({ hosts: { h1: { enabled: false, model: 'm1' } } });
  const r = resolveRoles(p, { hosts: [declared('h1', LOOPBACK)] });
  assert.deepEqual(r, { a: null, b: null, adjudicator: null });
});

test('a posture that is off gives no default even with a host switched on', () => {
  const p = posture({ enabled: false, hosts: { h1: { enabled: true, model: 'm1' } } });
  const r = resolveRoles(p, { hosts: [declared('h1', LOOPBACK)] });
  assert.deepEqual(r, { a: null, b: null, adjudicator: null });
});

test('a posture without a roles map throws while reading the first role', () => {
  assert.throws(() => resolveRoles({ enabled: false }, { hosts: [] }), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'a')",
  });
});

test('a null posture throws while reading enabled', () => {
  assert.throws(() => resolveRoles(null, { hosts: [] }), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'enabled')",
  });
});

test('a pin to an unparseable address keeps its fields and replaces stale reach and source', () => {
  const pin = { host: 'h1', model: 'm1', reach: 'hosted', source: 'default', note: 'kept' };
  const p = posture({ enabled: false, roles: { a: pin, b: null, adjudicator: null } });
  const r = resolveRoles(p, { hosts: [declared('h1', 'not a url')] });
  assert.deepEqual(r, {
    a: { host: 'h1', model: 'm1', reach: null, source: 'pinned', note: 'kept' },
    b: null,
    adjudicator: null,
  });
  assert.equal(pin.source, 'default');
});

test('each pinned role reports the reach of its own address', () => {
  const p = posture({
    enabled: false,
    roles: {
      a: { host: 'near', model: 'm1' },
      b: { host: 'office', model: 'm2' },
      adjudicator: { host: 'remote', model: 'm3' },
    },
  });
  const decl = {
    hosts: [
      declared('near', LOOPBACK),
      declared('office', 'http://192.168.1.10:8080'),
      declared('remote', 'https://api.example.com/v1'),
    ],
  };
  assert.deepEqual(resolveRoles(p, decl), {
    a: { host: 'near', model: 'm1', reach: 'local', source: 'pinned' },
    b: { host: 'office', model: 'm2', reach: 'lan', source: 'pinned' },
    adjudicator: { host: 'remote', model: 'm3', reach: 'hosted', source: 'pinned' },
  });
});

test('every unpinned role takes the default host and is marked as default', () => {
  const p = posture({ hosts: { h1: { enabled: true, model: 'm1' } } });
  const r = resolveRoles(p, { hosts: [declared('h1', LOOPBACK)] });
  const expected = { host: 'h1', model: 'm1', reach: 'local', source: 'default' };
  assert.deepEqual(r, { a: expected, b: expected, adjudicator: expected });
});

test('a pin beats the default, which goes to the lowest id among equally near hosts', () => {
  const p = posture({
    hosts: {
      alpha: { enabled: true, model: 'ma' },
      beta: { enabled: true, model: 'mb' },
      remote: { enabled: false, model: 'mr' },
    },
    roles: { a: { host: 'remote', model: 'mr' }, b: null, adjudicator: null },
  });
  const decl = {
    hosts: [
      declared('beta', 'http://localhost:8081'),
      declared('alpha', LOOPBACK),
      declared('remote', 'https://api.example.com/v1'),
    ],
  };
  const fallback = { host: 'alpha', model: 'ma', reach: 'local', source: 'default' };
  assert.deepEqual(resolveRoles(p, decl), {
    a: { host: 'remote', model: 'mr', reach: 'hosted', source: 'pinned' },
    b: fallback,
    adjudicator: fallback,
  });
});
