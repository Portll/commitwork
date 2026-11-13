// Outbound endpoints and listening servers (flow/static.mjs extractEndpoints).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lexer.mjs';
import { maskFrom } from '../verify.mjs';
import { valueContext, endpointKey, endpointFromHead, extractEndpoints } from '../static.mjs';

const run = (src, opts = {}) => {
  const lex = classify(src);
  const ctx = valueContext('bin/x.mjs', maskFrom(src, lex.spans).masked, lex.spans);
  return extractEndpoints(ctx, { line: lex.lineOf, ...opts });
};
const targets = (r) => r.edges.map((e) => `${e.kind} ${e.target}`);

test('endpointKey keeps scheme, host and an explicit port, and refuses what names no host', () => {
  // arrange
  const vs = ['https://api.osv.dev/v1/query', 'http://localhost:8080/x', 'wss://h.dev', '/api/csrf', 'file:///etc/x', 'ftp-x', 'http://', 'http://[::'];
  // act
  const got = vs.map((v) => endpointKey(v).key || endpointKey(v).reason);
  // assert
  assert.deepEqual(got, ['https://api.osv.dev', 'http://localhost:8080', 'wss://h.dev', 'relative URL (no host)', 'unsupported scheme file', 'not a URL', 'unparseable URL', 'unparseable URL']);
});

test('endpointFromHead needs the host to end inside the literal head', () => {
  // arrange
  const heads = ['https://api.first.org/data/v1/', 'http://127.0.0.1:', 'https://', 'https://api.x', '', null];
  // act
  const got = heads.map((h) => endpointFromHead(h).key || endpointFromHead(h).reason);
  // assert
  assert.deepEqual(got, ['https://api.first.org', 'computed port', 'computed host', 'computed host', 'computed URL', 'computed URL']);
});

test('fetch, WebSocket and new URL(...) passed to fetch become connects edges', () => {
  // arrange
  const src = [
    "const OSV = 'https://api.osv.dev/v1/querybatch';",
    'await fetch(OSV, {});',
    "fetch(`https://api.first.org/data/v1/epss?cve=${x}`);",
    "fetch(new URL('/v2/x', 'https://api.deps.dev/'));",
    "const ws = new WebSocket('ws://127.0.0.1:9222/devtools');",
  ].join('\n');
  // act
  const r = run(src);
  // assert
  assert.deepEqual(targets(r), ['connects https://api.osv.dev', 'connects https://api.first.org', 'connects https://api.deps.dev', 'connects ws://127.0.0.1:9222']);
  assert.deepEqual(r.edges.map((e) => e.evidence), ['bin/x.mjs:2 fetch', 'bin/x.mjs:3 fetch', 'bin/x.mjs:4 fetch', 'bin/x.mjs:5 WebSocket']);
  assert.deepEqual(r.sites, []);
});

test('http(s).request/get with an options object, and named imports of request/get', () => {
  // arrange
  const src = [
    "https.request({ hostname: 'registry.npmjs.org', path: '/x' });",
    "http.get({ host: '127.0.0.1', port: 7878 });",
    "http.request({ protocol: 'https:', host: 'h.dev', port: '8443' });",
    "hget('https://api.github.com/user');",
    "obj.fetch('https://not.this/');",
  ].join('\n');
  // act
  const r = run(src, { httpNamed: new Map([['hget', 'get']]) });
  // assert
  assert.deepEqual(targets(r), ['connects https://registry.npmjs.org', 'connects http://127.0.0.1:7878', 'connects https://h.dev:8443', 'connects https://api.github.com']);
});

test('net/tls connect: port+host, an options object, an IPC path', () => {
  // arrange
  const src = [
    "net.connect(5432, 'db.local');",
    "tls.connect({ host: 'h.dev', port: 443 });",
    'net.createConnection(6379);',
    "net.connect('/tmp/sock');",
  ].join('\n');
  // act
  const r = run(src);
  // assert
  assert.deepEqual(targets(r), ['connects tcp://db.local:5432', 'connects tls://h.dev:443', 'connects tcp://localhost:6379']);
  assert.deepEqual(r.sites.map((s) => s.reason), ['IPC path, not a network endpoint']);
});

test('a computed host, port, protocol or URL is an unanalysable site, never a placeholder endpoint', () => {
  // arrange
  const src = [
    'fetch(url);',
    'fetch(`${base}/v1/models`);',
    'fetch(`http://127.0.0.1:${port}/x`);',
    'http.get({ host: h });',
    "http.get({ host: 'a', port: p });",
    "http.get({ host: 'a', protocol: proto });",
    'fetch();',
    "fetch('/api/csrf');",
  ].join('\n');
  // act
  const r = run(src);
  // assert
  assert.deepEqual(r.edges, []);
  assert.deepEqual(r.sites.map((s) => s.reason), ['unresolved url', 'computed URL', 'computed port', 'computed host', 'computed port', 'computed protocol', 'no target', 'relative URL (no host)']);
  assert.ok(r.sites.every((s) => s.kind === 'connects' && /^bin\/x\.mjs:\d+$/.test(s.at)));
});

test('a resolved directory path handed to fetch is not a URL', () => {
  // arrange
  const src = "fetch(join(__dirname, 'x'));";
  // act
  const r = run(src);
  // assert
  assert.deepEqual(r.sites.map((s) => s.reason), ['not a URL']);
});

test('.listen(port) in a server module: literal, const, options object, unknown', () => {
  // arrange
  const src = [
    'const PORT = 7090;',
    'server.listen(7878);',
    'server.listen(PORT);',
    'createServer().listen({ port: 9000 });',
    'server.listen(Number(process.env.P || 1));',
    'server.listen();',
  ].join('\n');
  // act
  const on = run(src, { serverish: true });
  const off = run(src, { serverish: false });
  // assert
  assert.deepEqual(targets(on), ['listens listen:7878', 'listens listen:7090', 'listens listen:9000', 'listens listen:unknown', 'listens listen:unknown']);
  assert.deepEqual(off.edges, []);
});
