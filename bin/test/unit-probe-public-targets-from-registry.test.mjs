// Computes probe targets from a registry file (bin/probe-public.mjs targetsFromRegistry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetsFromRegistry } from '../probe-public.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when registry has no areas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({}));
    assert.deepEqual(targetsFromRegistry(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips areas without a deploy object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a' }] }));
    assert.deepEqual(targetsFromRegistry(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips areas where public is not true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: false, hostnames: ['h1'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes area with public true and no requiresAuth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true, hostnames: ['h1'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), [{ area: "a", hostname: "h1", path: "/", expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes area with public true and requiresAuth true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true, requiresAuth: true, hostnames: ['h1'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), [{ area: "a", hostname: "h1", path: "/", expect: [401, 403], note: "requiresAuth:true \u2014 a denial (401 or 403) is health; a 2xx means the gate is not in front of it" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses probePath when it is a string starting with slash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true, probePath: '/app', hostnames: ['h1'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), [{ area: "a", hostname: "h1", path: "/app", expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to root path when probePath is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true, probePath: 42, hostnames: ['h1'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), [{ area: "a", hostname: "h1", path: "/", expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to root path when probePath does not start with slash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true, probePath: 'app', hostnames: ['h1'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), [{ area: "a", hostname: "h1", path: "/", expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when hostnames is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true } }] }));
    assert.deepEqual(targetsFromRegistry(p), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts output by hostname', () => {
  const dir = mkdtempSync(join(tmpdir(), 'targetsFromRegistry-'));
  try {
    const p = join(dir, 'reg.json');
    writeFileSync(p, JSON.stringify({ areas: [{ slug: 'a', deploy: { public: true, hostnames: ['z.example', 'a.example'] } }] }));
    assert.deepEqual(targetsFromRegistry(p), [{ area: "a", hostname: "a.example", path: "/", expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" }, { area: "a", hostname: "z.example", path: "/", expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
