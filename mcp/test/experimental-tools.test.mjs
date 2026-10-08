// The MCP tool list under the experimental flags: an on tool is labelled, an off tool is neither
// advertised nor callable. Env is set after import, so a module-load read would fail here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-mcp-exp-'));
const KEYS = ['CW_SETTINGS', 'CW_EXPERIMENTAL', 'CW_FEATURE_CODEGRAPH_MCP', 'CW_FEATURE_TURNS_MCP'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];
process.env.CW_SETTINGS = join(TMP, 'settings.json');
const { handleRequest } = await import('../server.mjs');
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const list = () => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {}).result.tools;
const call = (name, args = {}) => handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, {}).result;
const CODEGRAPH = ['code_about', 'code_blast_radius', 'code_dead_exports'];

test('ON (the default): the experimental tools are listed and labelled; the rest are not labelled', () => {
  const tools = list();
  for (const n of [...CODEGRAPH, 'turn_efficiency']) {
    const t = tools.find((x) => x.name === n);
    assert.ok(t, `${n} is not advertised`);
    assert.match(t.description, /^Experimental: /, `${n} carries no label`);
  }
  assert.doesNotMatch(tools.find((x) => x.name === 'findings').description, /^Experimental/);
});

test('OFF: the group is not advertised, and a call is refused naming the flag', () => {
  process.env.CW_FEATURE_CODEGRAPH_MCP = 'off';
  try {
    const names = list().map((t) => t.name);
    for (const n of CODEGRAPH) assert.ok(!names.includes(n), `${n} is still advertised`);
    assert.ok(names.includes('turn_efficiency'), 'another group is untouched');
    const r = call('code_about', { path: 'lib/feature-flags.mjs' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /"codegraph-mcp".*switched off.*CW_FEATURE_CODEGRAPH_MCP/);
  } finally { delete process.env.CW_FEATURE_CODEGRAPH_MCP; }
});

test('CW_EXPERIMENTAL=off removes every experimental tool and leaves the core set', () => {
  process.env.CW_EXPERIMENTAL = 'off';
  try {
    const names = list().map((t) => t.name);
    for (const n of [...CODEGRAPH, 'turn_efficiency']) assert.ok(!names.includes(n), n);
    assert.ok(names.includes('findings') && names.includes('issues_ready'));
  } finally { delete process.env.CW_EXPERIMENTAL; }
});
