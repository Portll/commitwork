// graph_neighbours over MCP: the result is the bin/graph.mjs answer, and an unreadable input is a
// tool error rather than an empty neighbourhood. Env is set after import.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyIssuesDoc, mintIssue } from '../../monitor/issue-store.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-mcp-graph-'));
const KEYS = ['CW_SETTINGS', 'CW_EXPERIMENTAL', 'CW_GRAPH_DB', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_REGISTRY'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];
process.env.CW_SETTINGS = join(TMP, 'settings.json');
const { handleRequest } = await import('../server.mjs');
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const call = (args) => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_neighbours', arguments: args } }, {}).result;

process.env.CW_GRAPH_DB = join(TMP, 'graph.db');
process.env.CW_ISSUES = join(TMP, 'issues.json');
process.env.CW_REGISTRY = join(TMP, 'absent-registry.json');
const doc = emptyIssuesDoc();
const { id } = mintIssue(doc, { area: 'alpha', repo: 'alpha-api', kind: 'code', severity: 'high', title: 'synthetic',
  source: { kind: 'scanner-row', key: 'sc:alpha-api|sastSemgrep|r1|a.js', tool: 'sastSemgrep', rule: 'r1' } }, '2026-10-01T00:00:00.000Z');
writeFileSync(process.env.CW_ISSUES, JSON.stringify(doc));

test('a finding answers with its lane and repository', () => {
  const r = call({ id: `finding:${id}` });
  assert.notEqual(r.isError, true, r.content[0].text);
  const body = JSON.parse(r.content[0].text);
  assert.deepEqual(body.neighbours.map((n) => n.id).sort(), ['lane:sastSemgrep', 'repo:alpha-api']);
  assert.equal(body.graph.status['lane-ran-on-repo'].status, 'not-built');
});

test('the published schema bounds depth', () => {
  assert.equal(call({ id: 'repo:alpha-api', depth: 9 }).isError, true);
});

test('an unreadable input is a tool error', () => {
  writeFileSync(process.env.CW_ISSUES, '{');
  const r = call({ id: 'repo:alpha-api' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not valid JSON/);
});
