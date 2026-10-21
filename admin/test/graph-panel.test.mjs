// admin/test/graph-panel.test.mjs — GET /api/graph/path and /search over synthetic stores, and the
// Graph view: its registration, its entry points and what it renders for each non-answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { routes } from '../routes/graph.mjs';
import { emptyIssuesDoc, mintIssue } from '../../monitor/issue-store.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { panelSource, panelScript } from './lib/panel-source.mjs';

const KEYS = ['CW_GRAPH_DB', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_REGISTRY', 'CW_NOW'];

function call(path, qs, { loopback = true } = {}) {
  const route = routes.find((r) => r.path === path);
  let out;
  route.handle({
    req: { url: `${path}?${qs}` }, query: new URLSearchParams(qs),
    isLoopbackReq: loopback, adminSession: () => null,
    send: (status, body) => { out = { status, body }; },
  });
  return out;
}

function withStores(fn, { corrupt = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-graph-panel-'));
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.CW_GRAPH_DB = join(dir, 'graph.db');
  process.env.CW_ISSUES = join(dir, 'issues.json');
  process.env.CW_REGISTRY = join(dir, 'absent-registry.json');
  const doc = emptyIssuesDoc();
  mintIssue(doc, { area: 'alpha', repo: 'alpha-api', kind: 'code', severity: 'high', title: 'synthetic one',
    source: { kind: 'scanner-row', key: 'sc:alpha-api|sastSemgrep|r1|a.js', tool: 'sastSemgrep', rule: 'r1' } }, '2026-10-01T00:00:00.000Z');
  mintIssue(doc, { area: 'beta', repo: 'beta-web', kind: 'code', severity: 'low', title: 'synthetic two',
    source: { kind: 'scanner-row', key: 'sc:beta-web|sastSemgrep|r2|b.js', tool: 'sastSemgrep', rule: 'r2' } }, '2026-10-01T00:00:00.000Z');
  writeFileSync(process.env.CW_ISSUES, corrupt ? '{' : JSON.stringify(doc));
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('path and search are GETs refused off loopback without a session', () => {
  for (const p of ['/api/graph/path', '/api/graph/search']) {
    assert.equal(routes.find((r) => r.path === p)?.method, 'GET');
    assert.equal(call(p, 'a=repo:x&b=repo:y&q=x', { loopback: false }).status, 401);
  }
});

test('path needs both ends and a bounded depth', () => {
  assert.equal(call('/api/graph/path', 'a=repo:alpha-api').status, 400);
  assert.equal(call('/api/graph/path', 'a=repo:alpha-api&b=repo:beta-web&depth=99').status, 400);
});

test('path joins two repositories through the lane that found in both', () => withStores(() => {
  const r = call('/api/graph/path', 'a=repo:alpha-api&b=repo:beta-web');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 4);
  assert.deepEqual(r.body.nodes.map((x) => x.kind), ['repository', 'finding', 'lane', 'finding', 'repository']);
  assert.equal(r.body.nodes[2].id, 'lane:sastSemgrep');
}));

test('a path to an absent node, or beyond the depth, is a 404 with the reason', () => withStores(() => {
  assert.match(call('/api/graph/path', 'a=repo:alpha-api&b=repo:nowhere').body.reason, /no node repo:nowhere/);
  const r = call('/api/graph/path', 'a=repo:alpha-api&b=repo:beta-web&depth=2');
  assert.equal(r.status, 404);
  assert.match(r.body.reason, /no path within 2 hops/);
}));

test('search matches ids and labels, exact id first, and always carries the build status', () => withStores(() => {
  const empty = call('/api/graph/search', '');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.count, 0);
  assert.equal(empty.body.counts.nodes.repository, 2);
  assert.equal(empty.body.graph.status['repo-in-area'].status, 'not-built');
  const byLabel = call('/api/graph/search', 'q=SYNTHETIC');
  assert.deepEqual(byLabel.body.matches.map((m) => m.kind), ['finding', 'finding']);
  const exact = call('/api/graph/search', 'q=repo:alpha-api');
  assert.equal(exact.body.matches[0].id, 'repo:alpha-api');
  assert.equal(call('/api/graph/search', 'q=%25').body.count, 0, 'a LIKE wildcard in the query is literal');
}));

test('an unreadable input is a 500 on path and search, never an empty answer', () => withStores(() => {
  assert.equal(call('/api/graph/path', 'a=repo:alpha-api&b=repo:beta-web').status, 500);
  assert.equal(call('/api/graph/search', 'q=alpha').status, 500);
}, { corrupt: true }));

test('the panel declares the view, its loader, its script and the related entry points', () => {
  const html = panelSource();
  assert.match(html, /id="view-graph"/);
  assert.match(html, /data-v="graph"/);
  assert.match(html, /<script src="\/static\/panel-graph\.js"><\/script>/);
  const js = panelScript();
  assert.match(js, /graph:'view-graph'/);
  assert.match(js, /if\(v==='graph'&&typeof loadGraph==='function'\)loadGraph\(\)/);
  assert.match(js, /graph:'fleet'/);
  assert.match(js, /data-graph-id="'\+esc\('finding:'\+d\.id\)/, 'the finding detail links its node');
  assert.match(js, /data-graph-id="repo:\$\{esc\(n\.name\)\}"/, 'a project row links its repository');
  assert.match(js, /cwGraph\.attach\(n,'lane:'\+t\.key\)/, 'a lane tab links its lane');
});

function client() {
  const src = readFileSync(new URL('../static/panel-graph.js', import.meta.url), 'utf8');
  const sandbox = { esc, URLSearchParams, location: { search: '' }, document: { addEventListener() {}, getElementById() { return null; } } };
  vm.runInNewContext(src, sandbox);
  return sandbox.cwGraph;
}

test('every non-answer renders as itself, and a build failure names the build command', () => {
  const g = client();
  assert.match(g.stateLine({ state: 'not-built', error: '<x>' }), /not built[\s\S]*&lt;x&gt;[\s\S]*node bin\/graph\.mjs build[\s\S]*not an empty graph/);
  assert.match(g.stateLine({ state: 'unreachable', error: 'e' }), /unreachable/);
  assert.match(g.stateLine({ state: 'absent', reason: 'no node <y> in the graph' }), /not in the graph[\s\S]*&lt;y&gt;/);
  assert.match(g.stateLine({ state: 'unauthenticated' }), /not signed in/);
  assert.equal(g.stateLine({ state: 'ok' }), null);
});

test('neighbours render grouped by relation and direction, with counts, each one walkable', () => {
  const g = client();
  const html = g.nodeBody({
    state: 'ok', node: { id: 'repo:a', kind: 'repository', label: 'a<b>' }, depth: 1, count: 3, truncated: false,
    kinds: { finding: 2, area: 1 },
    neighbours: [
      { id: 'finding:ISS-1', kind: 'finding', label: 'f1', rel: 'in-repo', direction: 'in', distance: 1, via: 'repo:a' },
      { id: 'finding:ISS-2', kind: 'finding', label: 'f2', rel: 'in-repo', direction: 'in', distance: 1, via: 'repo:a' },
      { id: 'area:x', kind: 'area', label: 'x', rel: 'in-area', direction: 'out', distance: 1, via: 'repo:a' },
    ],
  });
  assert.match(html, /a&lt;b&gt;/);
  assert.match(html, /<h3>in-area → <span class="mut">1<\/span><\/h3>/);
  assert.match(html, /<h3>← in-repo <span class="mut">2<\/span><\/h3>/);
  assert.equal((html.match(/data-graph-id="finding:ISS-/g) || []).length, 2);
  assert.match(g.nodeBody({ state: 'ok', node: { id: 'n', kind: 'k', label: 'l' }, truncated: true, limit: 500, neighbours: [] }), /more neighbours exist and their number is not known/);
});

test('a not-built edge kind shows its reason, never a zero', () => {
  const html = client().buildStatus({ generated: '2026-10-01T00:00:00Z', fingerprint: 'abc', status: {
    'finding-in-repo': { status: 'built', edges: 3 },
    'repo-in-area': { status: 'not-built', reason: 'the registry is absent' },
  } });
  assert.match(html, /repo-in-area[\s\S]*not built[\s\S]*the registry is absent/);
  assert.doesNotMatch(html, /repo-in-area<\/b><\/td><td><span class="pill unk">not built<\/span><\/td><td class="tnum mut">0/);
});

test('a path renders its nodes in order with the relation between each pair', () => {
  const html = client().pathBody({ state: 'ok', from: 'repo:a', to: 'lane:s', length: 2,
    nodes: [{ id: 'repo:a', label: 'a' }, { id: 'finding:F', label: 'f' }, { id: 'lane:s', label: 's' }],
    edges: [{ src: 'finding:F', rel: 'in-repo', dst: 'repo:a' }, { src: 'finding:F', rel: 'found-by', dst: 'lane:s' }] });
  assert.match(html, /data-graph-id="repo:a"[\s\S]*← in-repo[\s\S]*data-graph-id="finding:F"[\s\S]*found-by →[\s\S]*data-graph-id="lane:s"/);
});
