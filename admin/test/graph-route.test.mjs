// admin/test/graph-route.test.mjs — GET /api/graph/neighbours over synthetic stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/graph.mjs';
import { emptyIssuesDoc, mintIssue } from '../../monitor/issue-store.mjs';

const route = routes.find((r) => r.path === '/api/graph/neighbours');
const KEYS = ['CW_GRAPH_DB', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_REGISTRY', 'CW_NOW'];

function call(qs, { loopback = true } = {}) {
  let out;
  route.handle({
    req: { url: `/api/graph/neighbours?${qs}` }, query: new URLSearchParams(qs),
    isLoopbackReq: loopback, adminSession: () => null,
    send: (status, body) => { out = { status, body }; },
  });
  return out;
}

function withStores(fn, { corrupt = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-graph-route-'));
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.CW_GRAPH_DB = join(dir, 'graph.db');
  process.env.CW_ISSUES = join(dir, 'issues.json');
  process.env.CW_REGISTRY = join(dir, 'absent-registry.json');
  const doc = emptyIssuesDoc();
  mintIssue(doc, { area: 'alpha', repo: 'alpha-api', kind: 'code', severity: 'high', title: 'synthetic',
    source: { kind: 'scanner-row', key: 'sc:alpha-api|sastSemgrep|r1|a.js', tool: 'sastSemgrep', rule: 'r1' } }, '2026-10-01T00:00:00.000Z');
  writeFileSync(process.env.CW_ISSUES, corrupt ? '{' : JSON.stringify(doc));
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('the route is registered as a GET', () => assert.equal(route?.method, 'GET'));

test('an unauthenticated caller off loopback is refused', () => {
  assert.equal(call('id=repo:alpha-api', { loopback: false }).status, 401);
});

test('id is required and depth is bounded', () => {
  assert.equal(call('').status, 400);
  assert.equal(call('id=repo:alpha-api&depth=9').status, 400);
  assert.equal(call('id=repo:alpha-api&depth=x').status, 400);
});

test('a known node answers with its neighbours and the build status', () => withStores(() => {
  const r = call('id=repo:alpha-api');
  assert.equal(r.status, 200);
  assert.equal(r.body.neighbours.length, 1);
  assert.equal(r.body.neighbours[0].kind, 'finding');
  assert.equal(r.body.graph.status['repo-in-area'].status, 'not-built');
}));

test('an absent node is a 404 with the reason, not an empty 200', () => withStores(() => {
  const r = call('id=repo:nowhere');
  assert.equal(r.status, 404);
  assert.match(r.body.reason, /no node/);
}));

test('an unreadable input is a 500, never an empty neighbourhood', () => withStores(() => {
  assert.equal(call('id=repo:alpha-api').status, 500);
}, { corrupt: true }));
