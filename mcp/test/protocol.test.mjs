// The MCP server's protocol surface, driven as a subprocess over real JSON-RPC on stdio.
//
// WHY THERE WAS NOTHING HERE UNTIL NOW. `npm test` globbed admin, bin, lib, monitor, sitemap, cra,
// map, chunk-diff and flow — never mcp — and no test file existed under mcp/ at all. So the server
// that exposes this repository's tools to other agents, and that holds the untrusted-manifest trust
// boundary, had no coverage in the suite. The glob is fixed in the same change that adds this file;
// a test directory nothing runs is worse than an empty one, because it reads as coverage.
//
// EVERYTHING HERE IS READ-ONLY. No test calls a tool that mutates the issue store or spawns a scan.
// run_checks is exercised only on a path that does not exist, which refuses before it spawns.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSchemaSupport } from '../../monitor/registry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'mcp', 'server.mjs');

/** Speak JSON-RPC over stdio to the real server. Returns frames by id, plus the raw stdout. */
function rpc(messages, env = {}) {
  const input = messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n');
  const out = execFileSync(process.execPath, [SERVER], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024,
  });
  const byId = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    try { const m = JSON.parse(line); if (m && m.id !== undefined) byId.set(m.id, m); } catch { /* not a frame */ }
  }
  return { byId, out };
}

const textOf = (frame) => frame?.result?.content?.[0]?.text ?? '';

describe('handshake', () => {
  test('initialize answers with a protocol version, capabilities and server identity', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }]);
    const r = byId.get(1)?.result;
    assert.ok(r, 'no initialize result');
    assert.ok(r.protocolVersion, 'no protocolVersion');
    assert.ok(r.capabilities && r.capabilities.tools, 'server must advertise tool capability');
    assert.equal(r.serverInfo.name, 'commitwork');
    assert.equal(r.serverInfo.version, JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version,
      'the server reports the version package.json carries, never a literal of its own');
  });

  test('ping answers', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    assert.ok(byId.get(1)?.result, 'ping did not answer');
  });
});

describe('tools/list', () => {
  test('NOT VACUOUS: the server publishes a real toolset', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    const tools = byId.get(1)?.result?.tools || [];
    assert.ok(tools.length >= 10, `only ${tools.length} tools — every assertion below would be near-vacuous`);
  });

  test('every tool carries a name, a description and an inputSchema', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    for (const t of byId.get(1).result.tools) {
      assert.ok(t.name, 'a tool has no name');
      assert.ok(t.description && t.description.length > 20, `${t.name}: description too thin to be useful to a caller`);
      assert.ok(t.inputSchema && t.inputSchema.type === 'object', `${t.name}: no object inputSchema`);
    }
  });

  test('EVERY PUBLISHED SCHEMA IS EVALUABLE — the precondition that makes enforcement safe', () => {
    // The server validates arguments against these schemas. A schema using a keyword the validator
    // does not implement is a validation FAILURE there, never a silent skip — which is correct, and
    // means an unevaluable schema would reject every valid call to that tool. So the evaluability
    // of the published set is a property worth pinning, not an implementation detail.
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    const bad = [];
    for (const t of byId.get(1).result.tools) {
      const errs = [];
      checkSchemaSupport(t.inputSchema, '', errs);
      if (errs.length) bad.push(`${t.name}: ${errs[0]}`);
    }
    assert.deepEqual(bad, [], 'an unevaluable schema would refuse every correct call to its tool');
  });

  test('a tool that declares no additionalProperties bound is named, so the gap stays visible', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    const unbounded = byId.get(1).result.tools
      .filter((t) => t.inputSchema.additionalProperties !== false)
      .map((t) => t.name);
    assert.deepEqual(unbounded, [],
      'a tool without additionalProperties:false accepts misspelled fields silently, giving the caller '
      + 'default behaviour while it believes it set something');
  });
});

describe('the published contract is ENFORCED, not merely declared', () => {
  // Until this was wired, tools/call invoked the handler with params.arguments directly and nothing
  // read the schema. tools/list published required[] and additionalProperties:false to every agent
  // and the server honoured neither.

  test('a MISSPELLED field is refused rather than ignored — the silent case', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'turn_efficiency', arguments: { limitt: 2 } } }]);
    const f = byId.get(1);
    assert.equal(f.result.isError, true, 'an unknown key was accepted; the caller would get defaults and believe it set a limit');
    assert.match(textOf(f), /unknown key 'limitt'/);
  });

  test('a MISSING required field is refused', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_checks', arguments: {} } }]);
    assert.equal(byId.get(1).result.isError, true);
    assert.match(textOf(byId.get(1)), /required key 'repo' is missing/);
  });

  test('a value outside a declared enum is refused', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'coverage', arguments: { product: 'anything', framework: 'bogus' } } }]);
    assert.equal(byId.get(1).result.isError, true);
    assert.match(textOf(byId.get(1)), /is not one of/);
  });

  test('a wrongly-typed value is refused', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'turn_efficiency', arguments: { session: 42 } } }]);
    assert.equal(byId.get(1).result.isError, true);
    assert.match(textOf(byId.get(1)), /expected string/);
  });

  test('NOT VACUOUS: a well-formed call is still accepted', () => {
    // Without this, every assertion above would be satisfied by a server that refuses everything.
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'turn_efficiency', arguments: { limit: 1 } } }]);
    assert.notEqual(byId.get(1).result.isError, true, `a valid call was refused: ${textOf(byId.get(1)).slice(0, 200)}`);
  });

  test('validation runs BEFORE the handler — a bad call cannot reach the work', () => {
    // run_checks with a nonexistent repo throws "repo path not found" from inside the handler. Add
    // an unknown key and the schema error must be what comes back, proving ordering rather than
    // both checks happening to fire.
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_checks', arguments: { repo: '/definitely/not/here', bogus: 1 } } }]);
    const t = textOf(byId.get(1));
    assert.match(t, /unknown key 'bogus'/);
    assert.doesNotMatch(t, /repo path not found/, 'the handler ran despite invalid arguments');
  });
});

describe('bad input does not take the server down', () => {
  test('an unknown method is a protocol error, not a crash', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'no/such/method' }]);
    assert.equal(byId.get(1).error.code, -32601);
  });

  test('an unknown tool is a protocol error naming what was asked for', () => {
    const { byId } = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'not_a_tool' } }]);
    assert.equal(byId.get(1).error.code, -32602);
    assert.match(byId.get(1).error.message, /not_a_tool/);
  });

  test('a MALFORMED line does not kill the loop — the request after it is still answered', () => {
    // A stdio server that dies on one bad frame takes the whole session with it, and the caller sees
    // a closed pipe rather than an error it can act on.
    const { byId } = rpc(['{ this is not json', { jsonrpc: '2.0', id: 7, method: 'ping' }]);
    assert.ok(byId.get(7)?.result, 'the server did not survive a malformed line');
  });

  test('a handler that throws returns isError, and the server keeps serving', () => {
    const { byId } = rpc([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_checks', arguments: { repo: '/definitely/not/here' } } },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]);
    assert.equal(byId.get(1).result.isError, true);
    assert.match(textOf(byId.get(1)), /repo path not found/);
    assert.ok(byId.get(2)?.result, 'the server stopped serving after a handler threw');
  });
});
