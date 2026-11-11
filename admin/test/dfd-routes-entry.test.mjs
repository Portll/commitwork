// admin/routes/dfd.mjs through its handlers: the source the environment names, the query as the
// command's flags, and the status each refusal becomes. The login gate is tested over a spawned
// panel in dfd-route.test.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, argvFor, load } from '../routes/dfd.mjs';
import { makeNode, makeEdge, nodeId } from '../../flow/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', '..', 'lib', 'test', 'fixtures', 'dfd-synthetic.json');
const TMP = mkdtempSync(join(tmpdir(), 'cw-dfd-entry-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const handler = (method, path) => routes.find((r) => r.method === method && r.path === path).handle;

function call(path, url, env) {
  const saved = { ...process.env };
  for (const k of ['CW_DFD_FILE', 'CW_HARNESS_STORE']) delete process.env[k];
  Object.assign(process.env, env);
  let out = null;
  try {
    handler('GET', path)({ req: { url }, send: (status, body, ct, headers) => { out = { status, body, ct, headers }; } });
  } finally {
    for (const k of ['CW_DFD_FILE', 'CW_HARNESS_STORE']) delete process.env[k];
    Object.assign(process.env, { ...saved });
  }
  assert.ok(out, 'the handler answered nothing');
  return out;
}

describe('dfd routes — declaration', () => {
  test('the page and the document are declared once each, the page with and without its slash', () => {
    // arrange
    const want = ['GET /dfd/', 'GET /dfd', 'GET /api/dfd'];

    // act
    const got = routes.map((r) => `${r.method} ${r.path}`);

    // assert
    assert.deepEqual(got, want);
    assert.equal(handler('GET', '/dfd'), handler('GET', '/dfd/'));
  });
});

describe('dfd routes — the query is the command line', () => {
  test('a dfd file named by CW_DFD_FILE is the source, and each known query key becomes its flag', () => {
    // arrange
    const url = '/dfd/?prefix=api&focus=x&hops=2&direction=out&collapse=g,h&collapse-all-groups-over=3&orientation=TB&max=9&tests=1&imports=true&title=nope&from=/etc/passwd';

    // act
    const argv = argvFor(url, { CW_DFD_FILE: '/data/model.json' });

    // assert
    assert.deepEqual(argv, ['--from', '/data/model.json', '--prefix', 'api', '--focus', 'x', '--hops', '2', '--direction', 'out',
      '--collapse', 'g,h', '--collapse-all-groups-over', '3', '--orientation', 'TB', '--max', '9', '--tests', '--imports']);
  });

  test('without the drawing keys only the filter reaches the command', () => {
    // arrange
    const url = '/api/dfd?prefix=api&collapse=nope&orientation=XX&max=1';

    // act
    const argv = argvFor(url, {}, { drawing: false });

    // assert
    assert.deepEqual(argv, ['--graph', '--prefix', 'api']);
  });

  test('with no dfd file the source is the flow store, and a flag-shaped value stays a value', () => {
    // arrange
    const url = '/api/dfd?prefix=--graph&tests=0';

    // act
    const argv = argvFor(url, {});
    const got = load(url, { CW_DFD_FILE: FIXTURE });

    // assert
    assert.deepEqual(argv, ['--graph', '--prefix', '--graph']);
    assert.equal(got.status, 422);
    assert.match(got.error, /the filter matched no node \(prefix "--graph"/);
  });
});

describe('GET /dfd/ — the page', () => {
  test('serves the diagram under the page\'s own policy, with served fonts', () => {
    // arrange
    const env = { CW_DFD_FILE: FIXTURE };

    // act
    const r = call('/dfd/', '/dfd/?orientation=LR&collapse=platform', env);

    // assert
    assert.equal(r.status, 200);
    assert.equal(r.ct, 'text/html; charset=utf-8');
    assert.match(r.body, /<svg class="dfd"/);
    assert.match(r.body, /data-id="group:platform"/);
    assert.match(r.body, /ranks left to right/);
    assert.match(r.headers['content-security-policy'], /^default-src 'none'; style-src 'sha256-[^']+'; script-src 'sha256-[^']+'; img-src data:; font-src 'self';.*frame-ancestors 'self'$/);
    assert.equal(r.headers['content-security-policy-report-only'], r.headers['content-security-policy']);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  });

  test('reads the flow store when no dfd file is named', () => {
    // arrange
    const store = join(TMP, 'store');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'flow.json'), JSON.stringify({ v: 1, generatedAt: '2026-11-12T00:00:00.000Z',
      nodes: [makeNode('module', 'bin/a.mjs', { analysis: 'analysed' }), makeNode('store', 'reports/x.json')],
      edges: [makeEdge(nodeId('module', 'bin/a.mjs'), nodeId('store', 'reports/x.json'), 'writes', { evidence: ['bin/a.mjs:1 writeFileSync'] })] }));

    // act
    const r = call('/dfd/', '/dfd/', { CW_HARNESS_STORE: store });

    // assert
    assert.equal(r.status, 200, r.body.slice(0, 300));
    assert.match(r.body, /Producer: <code>flow-graph<\/code>/);
  });

  test('each refusal is a status and an escaped page, never a diagram', () => {
    // arrange
    const bad = join(TMP, 'bad.json');
    writeFileSync(bad, JSON.stringify({ v: 1, kind: 'dfd', nodes: [], flows: [{ from: 'a', to: 'b', mode: 'sync' }] }));

    // act
    const usage = call('/dfd/', '/dfd/?direction=sideways&prefix=a', { CW_DFD_FILE: FIXTURE });
    const absent = call('/dfd/', '/dfd/', { CW_HARNESS_STORE: join(TMP, 'empty') });
    const invalid = call('/dfd/', '/dfd/', { CW_DFD_FILE: bad });
    const nomatch = call('/dfd/', '/dfd/?prefix=<script>', { CW_DFD_FILE: FIXTURE });
    const toobig = call('/dfd/', '/dfd/?max=3', { CW_DFD_FILE: FIXTURE });

    // assert
    assert.deepEqual([usage, absent, invalid, nomatch, toobig].map((r) => r.status), [400, 404, 422, 422, 422]);
    assert.match(absent.body, /flow graph not found at .*flow\.json — run `node flow\/static\.mjs`/);
    assert.match(nomatch.body, /prefix &quot;&lt;script&gt;&quot;/);
    assert.doesNotMatch(nomatch.body, /<script>/);
    assert.match(toobig.body, /16 elements is more than max 3/);
    assert.ok([usage, absent, invalid, nomatch, toobig].every((r) => !/<svg/.test(r.body) && r.headers['cache-control'] === 'no-store'));
  });
});

describe('GET /api/dfd — the document', () => {
  test('returns the filtered dfd@1 document, before any collapse', () => {
    // arrange
    const env = { CW_DFD_FILE: FIXTURE };

    // act
    const r = call('/api/dfd', '/api/dfd?focus=validate&hops=1&collapse=platform', env);

    // assert
    assert.equal(r.status, 200);
    assert.equal(r.body.v, 1);
    assert.equal(r.body.kind, 'dfd');
    assert.ok(r.body.nodes.length < JSON.parse(readFileSync(FIXTURE, 'utf8')).nodes.length);
    assert.ok(r.body.nodes.every((nd) => !nd.collapsed));
    assert.equal(r.body.source.filter.hops, 1);
  });

  test('a refusal is JSON with the reason', () => {
    // arrange
    const env = { CW_DFD_FILE: join(TMP, 'missing.json') };

    // act
    const r = call('/api/dfd', '/api/dfd', env);

    // assert
    assert.equal(r.status, 404);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /dfd document not found/);
  });
});
