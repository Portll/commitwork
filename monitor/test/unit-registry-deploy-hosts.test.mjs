// Flattens declared hostnames with area and deploy flags (monitor/registry.mjs deployHosts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployHosts } from '../registry.mjs';

test('returns empty array when registry is null', () => {
  assert.deepEqual(deployHosts(null), []);
});

test('returns empty array when registry has no areas property', () => {
  assert.deepEqual(deployHosts({}), []);
});

test('skips areas without a deploy object', () => {
  const reg = { areas: [{ slug: 'a1' }, { slug: 'a2', deploy: { hostnames: ['h1'] } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a2", service: null, public: false, requiresAuth: false, authAt: null }]);
});

test('skips deploy without hostnames', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { service: 'svc' } }] };
  assert.deepEqual(deployHosts(reg), []);
});

test('maps hostname with all deploy fields present', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { hostnames: ['h1'], service: 'svc', public: true, requiresAuth: true, authAt: 'basic' } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a1", service: "svc", public: true, requiresAuth: true, authAt: "basic" }]);
});

test('maps hostname with missing optional fields as null or false', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { hostnames: ['h1'] } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a1", service: null, public: false, requiresAuth: false, authAt: null }]);
});

test('maps public as false when public is not strictly true', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { hostnames: ['h1'], public: 1, requiresAuth: 1, authAt: 1 } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a1", service: null, public: false, requiresAuth: false, authAt: 1 }]);
});

test('maps requiresAuth as false when requiresAuth is not strictly true', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { hostnames: ['h1'], public: 1, requiresAuth: 1, authAt: 1 } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a1", service: null, public: false, requiresAuth: false, authAt: 1 }]);
});

test('maps authAt as null when authAt is falsy', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { hostnames: ['h1'], public: 1, requiresAuth: 1, authAt: '' } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a1", service: null, public: false, requiresAuth: false, authAt: null }]);
});

test('maps multiple hostnames in declaration order', () => {
  const reg = { areas: [{ slug: 'a1', deploy: { hostnames: ['h1', 'h2'], service: 'svc', public: true, requiresAuth: true, authAt: 'basic' } }] };
  assert.deepEqual(deployHosts(reg), [{ hostname: "h1", area: "a1", service: "svc", public: true, requiresAuth: true, authAt: "basic" }, { hostname: "h2", area: "a1", service: "svc", public: true, requiresAuth: true, authAt: "basic" }]);
});
