// bin/deno-dfd.mjs — the sink-to-source walk on synthetic paths (no engine needed), the program
// graph from an inventory, and the annotation it leaves on SARIF results.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hopsOf, sinkClassOf, evaluatePath, programGraph, mermaidProgram, buildReport, markdownOf, collapseProcesses } from '../deno-dfd.mjs';

const hop = (role, line, snippet) => ({ role, file: 'a.ts', line, col: 1, snippet });
const reader = (src) => () => src.split('\n');

describe('evaluatePath — walked from the sink', () => {
  test('passthrough is full control; a template at the sink is substring', () => {
    const src = 'const q = u.searchParams.get("q");\nrun(q);\nrun(`x ${q}`);';
    assert.equal(evaluatePath([hop('source', 1, 'u.searchParams.get("q")'), hop('propagator', 1, 'q'), hop('sink', 2, 'q')], 'command', reader(src)).control, 'full');
    assert.equal(evaluatePath([hop('source', 1, 'u.searchParams.get("q")'), hop('propagator', 1, 'q'), hop('sink', 3, '`x ${q}`')], 'sql', reader(src)).control, 'substring');
  });

  test('the bounding hop is the one nearest the sink, and its line is the evidence', () => {
    const src = 'const raw = r.url;\nconst n = Number(raw);\nq(`LIMIT ${n}`);';
    const e = evaluatePath([hop('source', 1, 'r.url'), hop('propagator', 1, 'raw'), hop('propagator', 2, 'n'), hop('sink', 3, '`LIMIT ${n}`')], 'sql', reader(src));
    assert.equal(e.control, 'numeric');
    assert.equal(e.boundingHop.line, 2);
    assert.equal(e.residual, 'low');
    assert.match(e.remediation, /Bounded at a\.ts:2/);
  });

  test('an encoder is a bound for markup and a mismatch for a shell', () => {
    const src = 'const v = r.url;\nconst e = encodeURIComponent(v);\nsink(e);';
    const hops = [hop('source', 1, 'r.url'), hop('propagator', 1, 'v'), hop('propagator', 2, 'e'), hop('sink', 3, 'e')];
    assert.equal(evaluatePath(hops, 'html', reader(src)).control, 'sanitized');
    assert.equal(evaluatePath(hops, 'command', reader(src)).control, 'mismatched');
    assert.equal(evaluatePath(hops, 'sql', reader(src)).control, 'mismatched');
  });

  test('a literal-set guard that leaves early bounds the value to the set', () => {
    const src = 'const m = r.url;\nif (m !== "a" && m !== "b") return no;\nrun(m);';
    const e = evaluatePath([hop('source', 1, 'r.url'), hop('propagator', 1, 'm'), hop('sink', 3, 'm')], 'command-argument', reader(src));
    assert.equal(e.control, 'allowlisted');
    assert.equal(e.boundingHop.op, 'guard');
  });

  test('a fixed scheme and host at an SSRF sink pins the host and leaves path control', () => {
    const src = 'const id = r.url;\nfetch(`https://api.example.com/u/${id}`);';
    const e = evaluatePath([hop('source', 1, 'r.url'), hop('propagator', 1, 'id'), hop('sink', 2, '`https://api.example.com/u/${id}`')], 'network', reader(src));
    assert.equal(e.control, 'host-pinned');
  });

  test('a replace() is a filter, not a validator', () => {
    const src = 'const p = r.url.replaceAll("../", "");\nread(p);';
    assert.equal(evaluatePath([hop('source', 1, 'r.url'), hop('propagator', 1, 'p'), hop('sink', 2, 'p')], 'file-system', reader(src)).control, 'filtered');
  });

  test('hops record what they judged, so a reader can dispute one step', () => {
    const src = 'const q = r.url;\nrun(q);';
    const e = evaluatePath([hop('source', 1, 'r.url'), hop('propagator', 1, 'q'), hop('sink', 2, 'q')], 'command', reader(src));
    for (const h of e.hops) { assert.ok(h.op); assert.ok(h.control); assert.ok(h.why); }
    assert.equal(e.hops[0].role, 'sink', 'listed sink first — the order the walk ran in');
  });
});

describe('reading SARIF and inventory', () => {
  const result = {
    ruleId: 'manifests.semgrep-deno-security.cw-deno-sql-injection', level: 'error',
    codeFlows: [{ threadFlows: [{ locations: [
      { location: { message: { text: "Source: 'c.req.query(\"id\")' @ 'a.ts:1'" }, physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: 1, snippet: { text: 'c.req.query("id")' } } } } },
      { location: { message: { text: "Propagator : 'id' @ 'a.ts:1'" }, physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: 1, snippet: { text: 'id' } } } } },
      { location: { message: { text: "Sink: '...' @ 'a.ts:2'" }, physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: 2, snippet: { text: '`SELECT ${id}`' } } } } },
    ] }] }],
    locations: [{ physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: 2 } } }],
  };

  test('hops carry the engine role words; the sink class comes from the rule id when undeclared', () => {
    assert.deepEqual(hopsOf(result).map((h) => h.role), ['source', 'propagator', 'sink']);
    assert.equal(sinkClassOf(result.ruleId, null), 'sql');
    assert.equal(sinkClassOf('js/request-forgery', null), 'network');
    assert.equal(hopsOf({ ruleId: 'x' }), null, 'a result with no codeFlows has no path, and is not evaluated');
  });

  test('buildReport annotates the SARIF result in place and counts by control', () => {
    const doc = { runs: [{ tool: { driver: { rules: [] } }, results: [JSON.parse(JSON.stringify(result))] }] };
    const report = buildReport({ root: '/nonexistent', sarifDocs: [{ path: 'x.sarif', doc }], inventory: null });
    assert.equal(report.summary.paths, 1);
    assert.equal(doc.runs[0].results[0].properties.cwMutability.control, 'substring');
    assert.match(markdownOf(report), /```mermaid/);
  });

  test('the program graph puts entries outside the process and stores beside it', () => {
    const inv = { results: [
      { check_id: 'x.cw-deno-inv-http-server', path: 'server.ts', start: { line: 3 }, extra: { metadata: { dfd: { role: 'entry', kind: 'http', trust: 'external', label: 'HTTP request' } } } },
      { check_id: 'x.cw-deno-inv-kv', path: 'server.ts', start: { line: 1 }, extra: { metadata: { dfd: { role: 'store', kind: 'kv', label: 'Deno KV' } } } },
      { check_id: 'x.cw-deno-inv-subprocess', path: 'jobs.ts', start: { line: 9 }, extra: { metadata: { dfd: { role: 'exec', kind: 'subprocess', label: 'Child process' } } } },
    ] };
    const g = programGraph(inv);
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));
    assert.equal(kinds['ext:http'], 'external');
    assert.equal(kinds['proc:server.ts'], 'process');
    assert.equal(kinds['store:kv'], 'store');
    assert.equal(kinds['out:subprocess'], 'exec');
    assert.ok(g.edges.some((e) => e.from === 'ext:http' && e.to === 'proc:server.ts'));
    const m = mermaidProgram(g);
    assert.match(m, /subgraph TB_external/);
    assert.match(m, /subgraph DENO/);
  });
});

test('a large program is drawn by directory, and the edges survive the collapse', () => {
  const results = [];
  for (let i = 0; i < 60; i++) {
    results.push({ check_id: 'x.http', path: `apps/a${i % 3}/mod${i}.ts`, start: { line: 1 }, extra: { metadata: { dfd: { role: 'entry', kind: 'http', trust: 'external', label: 'HTTP request' } } } });
    results.push({ check_id: 'x.kv', path: `apps/a${i % 3}/mod${i}.ts`, start: { line: 2 }, extra: { metadata: { dfd: { role: 'store', kind: 'kv', label: 'Deno KV' } } } });
  }
  const g = programGraph({ results });
  assert.equal(g.nodes.filter((n) => n.kind === 'process').length, 60);
  const { graph, depth } = collapseProcesses(g, 40);
  assert.equal(depth, 2);
  assert.deepEqual(graph.nodes.filter((n) => n.kind === 'process').map((n) => n.id).sort(), ['proc:apps/a0/', 'proc:apps/a1/', 'proc:apps/a2/']);
  assert.equal(graph.edges.filter((e) => e.from === 'ext:http').reduce((n, e) => n + e.count, 0), 60, 'counts are summed, not dropped');
  const small = programGraph({ results: results.slice(0, 4) });
  assert.equal(collapseProcesses(small).depth, null, 'a small program is drawn module by module');
});
