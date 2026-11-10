// Groups listeners by port, collecting sorted iface classes and commands with a sha256 digest (monitor/listening-ports.mjs aggregateByPort).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByPort } from '../listening-ports.mjs';

test('returns an empty array when given no listeners', () => {
  assert.deepEqual(aggregateByPort([]), []);
});

test('groups listeners on the same port into one entry with sorted ifaces and commands', () => {
  const listeners = [
    { port: 8080, addr: '127.0.0.1', command: 'node server.js' },
    { port: 8080, addr: '0.0.0.0', command: 'python app.py' },
    { port: 8080, addr: '::1', command: 'node server.js' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:8080", kind: "listener", port: 8080, ifaces: ["any", "loopback"], commands: ["node server.js", "python app.py"], sha256: "cd49531e1efa79bbfab38470d33d6dffa66651b396988b6488ed9c326a370e04" }]);
});

test('keeps listeners on different ports as separate entries sorted by port', () => {
  const listeners = [
    { port: 9090, addr: '127.0.0.1', command: 'cmd-b' },
    { port: 8080, addr: '0.0.0.0', command: 'cmd-a' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:8080", kind: "listener", port: 8080, ifaces: ["any"], commands: ["cmd-a"], sha256: "68ef91f259be73cb35677fbbbcb45d3e9ef569588150ca87af52fc79d1d595e1" }, { id: "port:9090", kind: "listener", port: 9090, ifaces: ["loopback"], commands: ["cmd-b"], sha256: "490254f05bff9b67f639b289def3d41f705bceb86a864e1e8d807e2529d627c3" }]);
});

test('omits the commands set entry when a listener has no command', () => {
  const listeners = [
    { port: 3000, addr: '127.0.0.1', command: undefined },
    { port: 3000, addr: '0.0.0.0', command: 'real-cmd' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:3000", kind: "listener", port: 3000, ifaces: ["any", "loopback"], commands: ["real-cmd"], sha256: "0fbdf68940ad93050daeb6276c7a41928306b1815e0f5c031bce959bb0958375" }]);
});

test('deduplicates repeated commands within the same port', () => {
  const listeners = [
    { port: 5000, addr: '127.0.0.1', command: 'dup-cmd' },
    { port: 5000, addr: '127.0.0.1', command: 'dup-cmd' },
    { port: 5000, addr: '0.0.0.0', command: 'other-cmd' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:5000", kind: "listener", port: 5000, ifaces: ["any", "loopback"], commands: ["dup-cmd", "other-cmd"], sha256: "c51bdfc772c26e7eeced16f20dd3c7c61f32a2b0f1bae84fab9b19d5c3ee28f1" }]);
});

test('handles a single listener with a single address and command', () => {
  const listeners = [
    { port: 443, addr: '::', command: 'nginx' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:443", kind: "listener", port: 443, ifaces: ["any"], commands: ["nginx"], sha256: "27d3b9298ea1ad71ef917cfd5b07662198ea63811e9e30c5becd41a8b4e2d3e2" }]);
});

test('preserves all distinct iface classes when multiple addresses map to different classes', () => {
  const listeners = [
    { port: 6000, addr: '192.168.1.1', command: 'svc' },
    { port: 6000, addr: '10.0.0.1', command: 'svc' },
    { port: 6000, addr: '172.16.0.1', command: 'svc' },
    { port: 6000, addr: '8.8.8.8', command: 'svc' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:6000", kind: "listener", port: 6000, ifaces: ["addressed"], commands: ["svc"], sha256: "12bf891b1d533f2bfb8c324e7ded8346046cca0f9557bfed5c95fb472a609ddb" }]);
});

test('sorts multiple ports in ascending numeric order', () => {
  const listeners = [
    { port: 100, addr: '127.0.0.1', command: 'a' },
    { port: 200, addr: '127.0.0.1', command: 'b' },
    { port: 50, addr: '127.0.0.1', command: 'c' },
  ];
  assert.deepEqual(aggregateByPort(listeners), [{ id: "port:50", kind: "listener", port: 50, ifaces: ["loopback"], commands: ["c"], sha256: "f312947a537c2c8a203955d85765fc1d94bd2b73b370143ec118dce035720633" }, { id: "port:100", kind: "listener", port: 100, ifaces: ["loopback"], commands: ["a"], sha256: "a79925f5f4b6bc4d14e46407a42fc7963cc3ef85c7f4cfa6b33b1848dec509af" }, { id: "port:200", kind: "listener", port: 200, ifaces: ["loopback"], commands: ["b"], sha256: "fb2031dc087be5ab48611d2811fedab0b1b4f12d9bfae5a887767cb407ee437c" }]);
});
