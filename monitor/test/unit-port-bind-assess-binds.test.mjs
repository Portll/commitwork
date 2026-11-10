// Computes per-port bind verdicts, stdio violations, and overall state (monitor/port-bind.mjs assessBinds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessBinds } from '../port-bind.mjs';

test('returns ok state when no binds are declared', () => {
  assert.deepEqual(assessBinds({}, []), { rows: [], stdioFindings: [], findings: [], state: "ok" });
});

test('marks a declared port absent when no listener matches', () => {
  assert.deepEqual(assessBinds({ binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'loopback' }] }, []), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "absent" }], stdioFindings: [], findings: [], state: "ok" });
});

test('marks a port mismatch when observed interface is wider than declared', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'loopback' }] },
    [{ port: 8080, addr: '0.0.0.0' }]
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "loopback", observed: "any", addrs: ["0.0.0.0"], ok: false } }], stdioFindings: [], findings: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "loopback", observed: "any", addrs: ["0.0.0.0"], ok: false } }], state: "findings" });
});

test('marks a port match when observed interface is narrower than declared', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'any' }] },
    [{ port: 8080, addr: '127.0.0.1' }]
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "match", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true } }], stdioFindings: [], findings: [], state: "ok" });
});

test('marks a port mismatch when process entry match is not found in command line', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'any', entryMatch: 'server.js' }] },
    [{ port: 8080, addr: '127.0.0.1', command: 'node', args: 'app.js' }]
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true }, process: { declared: "server.js", observed: ["app.js"], ok: false } }], stdioFindings: [], findings: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true }, process: { declared: "server.js", observed: ["app.js"], ok: false } }], state: "findings" });
});

test('marks a port undetermined when auth probe did not run', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'any', auth: 'token' }] },
    [{ port: 8080, addr: '127.0.0.1' }],
    {}
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "undetermined", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true }, auth: { declared: "token", observed: null, ok: null, unknown: true, unknownReason: "not-run", unknownDetail: "auth probe did not run" } }], stdioFindings: [], findings: [], state: "undetermined" });
});

test('marks a port mismatch when auth probe observed value differs from declared', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'any', auth: 'token' }] },
    [{ port: 8080, addr: '127.0.0.1' }],
    { 8080: { observed: 'none' } }
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true }, auth: { declared: "token", observed: "none", ok: false } }], stdioFindings: [], findings: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true }, auth: { declared: "token", observed: "none", ok: false } }], state: "findings" });
});

test('marks a port match when auth probe observed value equals declared', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'any', auth: 'token' }] },
    [{ port: 8080, addr: '127.0.0.1' }],
    { 8080: { observed: 'token' } }
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "match", iface: { declared: "any", observed: "loopback", addrs: ["127.0.0.1"], ok: true }, auth: { declared: "token", observed: "token", ok: true } }], stdioFindings: [], findings: [], state: "ok" });
});

test('reports stdio violation when a listener command line names the entry', () => {
  assert.deepEqual(assessBinds(
    { stdio: [{ purpose: 'debug', entryMatch: 'debugger' }] },
    [{ port: 9999, addr: '127.0.0.1', args: 'node debugger.js', pid: 123 }]
  ), { rows: [], stdioFindings: [{ verdict: "stdio-violation", purpose: "debug", entryMatch: "debugger", pid: 123, addr: "127.0.0.1", port: 9999 }], findings: [{ verdict: "stdio-violation", purpose: "debug", entryMatch: "debugger", pid: 123, addr: "127.0.0.1", port: 9999 }], state: "findings" });
});

test('chooses the worst interface among multiple listeners on the same port', () => {
  assert.deepEqual(assessBinds(
    { binds: [{ port: 8080, purpose: 'api', owner: 'svc', iface: 'loopback' }] },
    [{ port: 8080, addr: '127.0.0.1' }, { port: 8080, addr: '0.0.0.0' }]
  ), { rows: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "loopback", observed: "any", addrs: ["0.0.0.0", "127.0.0.1"], ok: false } }], stdioFindings: [], findings: [{ port: 8080, purpose: "api", owner: "svc", verdict: "mismatch", iface: { declared: "loopback", observed: "any", addrs: ["0.0.0.0", "127.0.0.1"], ok: false } }], state: "findings" });
});
