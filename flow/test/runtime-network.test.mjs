// C2 on the network: connects and listens are observed through every import form, keyed the way C1
// keys an endpoint, and refused when the hook cannot prove it saw its own probe. No test here
// leaves 127.0.0.1 or a unix socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookPath, observe, readTrace, summarise } from '../runtime.mjs';

function fixtureRepo() {
  const d = mkdtempSync(join(tmpdir(), 'flow-net-'));
  mkdirSync(join(d, 'bin'), { recursive: true });
  return d;
}

// A local server answering HTTP, then one call per client entry point. Each import form is the one
// that matters for that builtin: NAMED for http (the form an --import hook misses), namespace for
// net, default for https and tls.
const CLIENT = `
import { request, get } from 'node:http';
import * as net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
const quiet = (x) => { x.on('error', () => {}); return x; };
const s = net.createServer((c) => { c.on('error', () => {}); c.end('HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n'); });
s.listen(0, '127.0.0.1', async () => {
  const port = s.address().port;
  await new Promise((ok) => quiet(request({ host: '127.0.0.1', port, path: '/' }, (r) => { r.resume(); r.on('end', ok); })).end());
  await new Promise((ok) => quiet(get('http://127.0.0.1:' + port + '/x', (r) => { r.resume(); r.on('end', ok); })));
  await fetch('http://127.0.0.1:' + port + '/f').then((r) => r.text());
  quiet(https.request({ host: '127.0.0.1', port, path: '/' })).destroy();
  quiet(tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })).destroy();
  quiet(net.connect(port, '127.0.0.1')).destroy();
  quiet(new net.Socket().connect(port, '127.0.0.1')).destroy();
  s.close();
  console.log(port);
});
`;

test('every client entry point is observed under its import form, keyed as C1 keys an endpoint', () => {
  // Arrange
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'client.mjs'), CLIENT);
    // Act
    const r = observe(['bin/client.mjs'], { root: d });
    // Assert
    assert.equal(r.status, 0, r.stderr);
    const port = Number(r.stdout ? r.stdout.trim() : NaN) || Number(/listen:(\d+)/.exec(JSON.stringify(r.observations))[1]);
    const seen = (to, via) => r.observations.some((o) => o.from === 'bin/client.mjs' && o.kind === 'connects' && o.to === to && o.via === via);
    assert.equal(r.network.state, 'usable');
    assert.ok(seen(`http://127.0.0.1:${port}`, 'http.request'), 'named import { request }');
    assert.ok(r.observations.some((o) => o.to === `http://127.0.0.1:${port}` && o.kind === 'connects'), 'get and fetch share the key');
    assert.ok(seen(`https://127.0.0.1:${port}`, 'https.request'));
    assert.ok(seen(`tls://127.0.0.1:${port}`, 'tls.connect'));
    assert.ok(seen(`tcp://127.0.0.1:${port}`, 'net.connect'));
    assert.ok(r.observations.some((o) => o.kind === 'listens' && o.to === `listen:${port}` && o.ephemeral === true),
      'a port-0 listen is recorded at the port the kernel chose, and marked ephemeral');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('fetch and http.get are each observed, and a nested call is one edge, not three', () => {
  // Arrange
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'client.mjs'), CLIENT);
    // Act
    const r = observe(['bin/client.mjs'], { root: d, keep: true });
    const rows = readTrace(r.tracePath).rows.filter((x) => !x.probe && x.actor === 'bin/client.mjs' && x.t === 'connect');
    rmSync(r.tracePath, { force: true });
    // Assert
    const vias = rows.map((x) => x.via).sort();
    assert.deepEqual(vias, ['fetch', 'http.get', 'http.request', 'https.request', 'net.Socket.connect', 'net.connect', 'tls.connect'],
      'http.request reaches net.createConnection and Socket#connect synchronously; only the outer call is a row');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the hook witnesses its own network probe, and marks the probe rows so they are never edges', () => {
  // Arrange
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'noop.mjs'), 'export const a = 1;\n');
    // Act
    const r = observe(['bin/noop.mjs'], { root: d, keep: true });
    const t = readTrace(r.tracePath);
    rmSync(r.tracePath, { force: true });
    // Assert
    const installed = t.rows.find((x) => x.t === 'installed');
    assert.equal(installed.netWitness, true);
    assert.equal(installed.netReason, null);
    assert.deepEqual(t.rows.filter((x) => x.probe && x.t !== 'read').map((x) => x.via), ['listen', 'net.connect', 'http.request']);
    assert.equal(r.observations.length, 0, 'probe rows are not observations');
    assert.equal(r.network.observed, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('NEGATIVE CONTROL — a patch that cannot take leaves the network UNWITNESSED, and its rows are refused', () => {
  // Arrange: a preload ahead of the hook freezes net.connect, so the hook's assignment is a silent
  // no-op — the inert-patch shape, produced for real rather than hand-written into a trace.
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'freeze.cjs'),
      "const net = require('node:net'); Object.defineProperty(net, 'connect', { value: net.connect, writable: false, configurable: false });\n");
    writeFileSync(join(d, 'bin', 'c.mjs'),
      "import * as net from 'node:net';\nconst s = net.createServer().listen(0, '127.0.0.1', () => { const c = net.createConnection(s.address().port, '127.0.0.1'); c.on('error', () => {}); c.destroy(); s.close(); });\n");
    const trace = join(d, 'trace.jsonl');
    // Act
    spawnSync(process.execPath, ['-r', join(d, 'freeze.cjs'), '-r', hookPath(), 'bin/c.mjs'],
      { cwd: d, encoding: 'utf8', env: { ...process.env, CW_FLOW_TRACE: trace, CW_FLOW_ROOT: d } });
    const read = readTrace(trace);
    const s = summarise(read);
    // Assert
    assert.equal(read.state, 'usable', 'fs is still witnessed');
    assert.equal(read.rows.find((x) => x.t === 'installed').netWitness, false);
    assert.match(read.network.reason, /not patched: net\.connect/);
    assert.equal(s.network.state, 'unusable');
    assert.ok(s.network.refused >= 2, 'the listen and the connect the hook did see are refused, not reported');
    assert.ok(!s.observations.some((o) => o.kind === 'connects' || o.kind === 'listens'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an explicit listen port is recorded at once, as listen:<port>, not ephemeral', () => {
  // Arrange: a port the kernel just freed — the only way to name a free port without guessing.
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'srv.mjs'),
      "import http from 'node:http';\nimport net from 'node:net';\n"
      + "const p = net.createServer().listen(0, '127.0.0.1', function () { const port = this.address().port; this.close(() => {\n"
      + "  const s = http.createServer(); s.on('error', () => {}); s.listen({ port, host: '127.0.0.1' }, () => s.close()); console.log(port); }); });\n");
    // Act
    const r = observe(['bin/srv.mjs'], { root: d, keep: true });
    const rows = readTrace(r.tracePath).rows.filter((x) => !x.probe && x.t === 'listen');
    rmSync(r.tracePath, { force: true });
    // Assert
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ephemeral, true, 'the kernel chose the first port');
    assert.equal(rows[1].ephemeral, undefined, 'the second was named');
    assert.equal(rows[0].key, rows[1].key);
    const listens = r.observations.filter((o) => o.kind === 'listens');
    assert.equal(listens.length, 1, 'one from|to|kind is one observation');
    assert.equal(listens[0].ephemeral, undefined, 'named once is named: a literal could have matched it');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a wrapped builtin keeps its name and length — tracing must not change what code can inspect', () => {
  // Arrange
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'shape.mjs'),
      "import * as fs from 'node:fs';\nimport http from 'node:http';\nimport net from 'node:net';\nimport cp from 'node:child_process';\n"
      + "const fns = { readFileSync: fs.readFileSync, openSync: fs.openSync, request: http.request, connect: net.connect, listen: net.Server.prototype.listen, spawnSync: cp.spawnSync, fetch: globalThis.fetch };\n"
      + "console.log(JSON.stringify(Object.fromEntries(Object.entries(fns).map(([k, f]) => [k, [f.name, f.length]]))));\n");
    // Act
    const plain = spawnSync(process.execPath, ['bin/shape.mjs'], { cwd: d, encoding: 'utf8' });
    const traced = spawnSync(process.execPath, ['-r', hookPath(), 'bin/shape.mjs'],
      { cwd: d, encoding: 'utf8', env: { ...process.env, CW_FLOW_TRACE: join(d, 't.jsonl'), CW_FLOW_ROOT: d } });
    // Assert
    assert.ok(readTrace(join(d, 't.jsonl')).state === 'usable', 'the hook was really on');
    assert.deepEqual(JSON.parse(traced.stdout), JSON.parse(plain.stdout));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
