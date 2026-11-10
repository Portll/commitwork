// Which declared hosts are switched on, with their reach and block status (monitor/llm-runtime.mjs switchedOnHosts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchedOnHosts } from '../llm-runtime.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'switchedOnHosts-'));
try {
  const decl = { hosts: [
    { id: 'h1', url: 'http://localhost:1' },
    { id: 'h2', url: 'http://192.168.1.1:2' },
    { id: 'h3', url: 'http://example.com:3' },
    { id: 'h4', url: 'http://10.0.0.1:4' },
  ] };
  const posture = {
    enabled: true,
    hosts: { h1: { enabled: true, model: 'm1' }, h2: { enabled: false }, h3: { enabled: true, model: 'm3' } },
    roles: { a: null, b: null, adjudicator: null },
    allowNonLoopback: { h2: 'http://192.168.1.1:2' },
  };

  test('excludes hosts whose posture entry is missing or disabled', () => {
    const p = { ...posture, hosts: { h1: { enabled: true, model: 'm1' }, h2: { enabled: false }, h3: { enabled: true, model: 'm3' } } };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h1", url: undefined, reach: null, model: "m1", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h3", url: undefined, reach: null, model: "m3", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('includes hosts whose posture entry is present and enabled', () => {
    const p = { ...posture, hosts: { h1: { enabled: true, model: 'm1' }, h2: { enabled: true }, h3: { enabled: true, model: 'm3' }, h4: { enabled: true, model: 'm4' } } };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h1", url: undefined, reach: null, model: "m1", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h2", url: undefined, reach: null, model: null, blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h3", url: undefined, reach: null, model: "m3", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h4", url: undefined, reach: null, model: "m4", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('marks a local host as unblocked', () => {
    const p = { ...posture, hosts: { h1: { enabled: true, model: 'm1' } } };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h1", url: undefined, reach: null, model: "m1", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('marks a lan host without allowNonLoopback as blocked', () => {
    const p = { ...posture, hosts: { h2: { enabled: true } }, allowNonLoopback: {} };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h2", url: undefined, reach: null, model: null, blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('marks a lan host with matching allowNonLoopback as unblocked', () => {
    const p = { ...posture, hosts: { h2: { enabled: true } }, allowNonLoopback: { h2: 'http://192.168.1.1:2' } };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h2", url: undefined, reach: null, model: null, blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('marks a hosted host as blocked', () => {
    const p = { ...posture, hosts: { h3: { enabled: true, model: 'm3' } }, allowNonLoopback: {} };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h3", url: undefined, reach: null, model: "m3", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('marks a lan host with mismatched allowNonLoopback as blocked', () => {
    const p = { ...posture, hosts: { h2: { enabled: true } }, allowNonLoopback: { h2: 'http://192.168.1.99:2' } };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h2", url: undefined, reach: null, model: null, blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });

  test('uses the posture model when present and null otherwise', () => {
    const p = { ...posture, hosts: { h1: { enabled: true, model: 'm1' }, h2: { enabled: true } } };
    const r = switchedOnHosts(p, decl);
    assert.deepEqual(r, [{ id: "h1", url: undefined, reach: null, model: "m1", blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h2", url: undefined, reach: null, model: null, blocked: true, blockedReason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }]);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
