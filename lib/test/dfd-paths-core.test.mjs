// lib/dfd-paths-core.mjs: the rules and the layout the paths view runs in the page. These tests
// import the same file the page inlines. The cross-checks hold its path, proof and gap rules equal
// to lib/dfd.mjs threatPaths and lib/dfd-coverage.mjs on real and generated documents, for every
// combination of patches tried: the page and the library cannot drift apart unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDfd, threatPaths } from '../dfd.mjs';
import { coverageGaps, patchProof, GAP_KINDS } from '../dfd-coverage.mjs';
import { createCore } from '../dfd-paths-core.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const COREML = () => load('../../docs/dfd/coremltools-untrusted-model.dfd.json');
const FIXTURE = () => load('./fixtures/dfd-coverage.dfd.json');
const WORD = { live: 'open', grey: 'unevaluated', closed: 'closed' };

/** The page's paths as [node path, state], sorted, with `applied` in force. */
function corePaths(core, applied) {
  core.S.mode = 'combo';
  core.S.combo = new Set(applied);
  return core.pathsOf(core.appliedSet()).map((p) => [[p.flows[0].from, ...p.flows.map((f) => f.to)].join('>'), WORD[p.st]]).sort();
}
const libPaths = (doc, applied) => threatPaths(doc, { applied, maxPaths: 5000 }).paths.map((p) => [p.nodes.join('>'), p.state]).sort();
/** The page's gaps as `kind|where`, sorted. */
function coreGaps(core, applied) {
  core.S.mode = 'combo';
  core.S.combo = new Set(applied);
  const ap = core.appliedSet();
  const paths = core.pathsOf(ap);
  return core.gapsOf(paths, ap).map((g) => {
    const [tag, rest] = [g.key[0], g.key.slice(2)];
    const where = tag === 'a' ? (() => { const fl = rest.split('>').map((id) => core.FB[id]); return [fl[0].from, ...fl.map((f) => f.to)].join('>'); })()
      : 'bcf'.includes(tag) ? String(core.FB[rest].k) : rest;
    return `${GAP_KINDS[g.ord]}|${where}`;
  }).sort();
}
const libGaps = (doc, applied) => coverageGaps(doc, { applied, maxPaths: 5000 }).map((g) => `${g.kind}|${g.kind === 'critical-untouched' ? g.path.join('>') : g.flow !== undefined && g.node === undefined ? g.flow : g.node}`).sort();
/** A deterministic sample of subsets of `ids`: none, all, each alone, each missing, and some mixed. */
function subsets(ids) {
  const out = [[], ids.slice(), ...ids.map((x) => [x]), ...ids.map((x) => ids.filter((y) => y !== x))];
  let seed = 7;
  // the high bits: an LCG's low bits repeat with a short period
  for (let i = 0; i < 12; i++) out.push(ids.filter(() => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % 3 === 0; }));
  return out;
}
/** A generated layered document: sources, two tiers of processes, impacts, patches with every kind of evidence, gates and coverage. */
function generated(seed) {
  let s = seed;
  const rnd = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return Math.floor(s / 65536) % n; };
  const nodes = [{ id: 'src', kind: 'external', subtype: 'actor', label: 'source' }];
  const tier = (name, n, extra) => Array.from({ length: n }, (_, i) => { const node = { id: `${name}${i}`, kind: 'process', label: `${name} ${i}`, ...extra(i) }; nodes.push(node); return node.id; });
  const COVER = [undefined, { lines: { covered: 9, total: 10 } }, { lines: { covered: 2, total: 10 }, branches: { covered: 1, total: 4 } }, { lines: { covered: 0, total: 0 } }];
  const a = tier('a', 3, () => { const coverage = COVER[rnd(4)]; return { group: 'tool', ...(coverage ? { coverage } : {}) }; });
  const b = tier('b', 3, () => ({ group: 'vendor' }));
  const sinks = ['critical', 'high', 'medium', 'low'].map((impact, i) => { nodes.push({ id: `k${i}`, kind: 'external', subtype: 'system', label: `sink ${i}`, impact }); return `k${i}`; });
  nodes.push({ id: 'rej', kind: 'external', subtype: 'system', label: 'reject' });
  const flows = [];
  const flow = (from, to) => {
    if (flows.some((f) => f.from === from && f.to === to)) return;
    const f = { from, to, mode: 'sync', label: `${from} to ${to}` };
    const g = rnd(6);
    if (g === 0) f.gate = { state: 'unevaluated' };
    if (g === 1) f.gate = { state: 'safe', evidence: { level: rnd(2) ? 'runtime' : 'static' } };
    const c = rnd(4);
    if (c === 0) f.coverage = { exercised: true, tests: ['t'] };
    if (c === 1) f.coverage = { exercised: false };
    if (rnd(5) === 0) f.role = 'error';
    flows.push(f);
  };
  for (const x of a) { flow('src', x); for (let i = 0; i < 2; i++) flow(x, sinks[rnd(4)]); if (rnd(2)) flow(x, b[rnd(3)]); }
  for (const x of b) { if (rnd(2)) flow('src', x); flow(x, sinks[rnd(4)]); }
  flow('a0', 'a1');
  const closable = flows.filter((f) => !f.gate && f.from !== 'src');
  const EVIDENCE = [{ level: 'tested' }, { level: 'asserted' }, { level: 'tested', control: { failsWithout: true, passesWith: true } },
    { level: 'tested', control: { kind: 'static-assert', failsWithout: true, passesWith: true } },
    { level: 'tested', control: { failsWithout: true, passesWith: true }, controls: [{ kind: 'dynamic-assert', failsWithout: true, passesWith: true }] },
    { level: 'inspected', control: { kind: 'static-assert', failsWithout: true, passesWith: true } }, undefined];
  const patches = Array.from({ length: 4 }, (_, i) => {
    const f = closable[rnd(closable.length)];
    const g = closable[rnd(closable.length)];
    const evidence = EVIDENCE[rnd(EVIDENCE.length)];
    return { id: `K${i}`, guard: { from: 'src', to: flows.find((x) => x.from === 'src').to }, closes: [{ from: f.from, to: f.to }, ...(g === f ? [] : [{ from: g.from, to: g.to }])], ...(evidence ? { evidence } : {}) };
  });
  flows.push({ from: 'a0', to: 'rej', mode: 'sync', label: 'typed error' });
  patches[0].rejects = [{ from: 'a0', to: 'rej' }];
  return { v: 1, kind: 'dfd', groups: [{ id: 'tool', label: 'tool', boundary: 'system' }, { id: 'vendor', label: 'vendor', boundary: 'trust' }], nodes, flows, patches };
}

// ── the page and the library agree ───────────────────────────────────────────────────────────────

test('paths and their states equal threatPaths for every sampled combination of patches, on both authored documents', () => {
  // arrange
  const docs = [COREML(), FIXTURE()];
  // act
  const pairs = docs.flatMap((doc) => subsets(doc.patches.map((p) => p.id)).map((applied) => [corePaths(createCore(doc), applied), libPaths(doc, applied)]));
  // assert
  assert.equal(pairs.length > 50, true);
  for (const [page, lib] of pairs) assert.deepEqual(page, lib);
});

test('gaps equal coverageGaps, kind by kind and place by place, for every sampled combination', () => {
  // arrange
  const docs = [COREML(), FIXTURE()];
  // act
  const pairs = docs.flatMap((doc) => subsets(doc.patches.map((p) => p.id)).map((applied) => [coreGaps(createCore(doc), applied), libGaps(doc, applied)]));
  // assert
  for (const [page, lib] of pairs) assert.deepEqual(page, lib);
});

test('on 40 generated documents the page and the library give the same paths, proofs and gaps', () => {
  // arrange
  const docs = Array.from({ length: 40 }, (_, i) => generated(101 + i * 17));
  // act
  const checks = docs.map((doc) => {
    const core = createCore(doc);
    const ids = doc.patches.map((p) => p.id);
    return { valid: validateDfd(doc).errors, proofs: [core.PATCHES.map((p) => p.proof), doc.patches.map(patchProof)],
      runs: subsets(ids).slice(0, 10).map((applied) => [corePaths(core, applied), libPaths(doc, applied), coreGaps(core, applied), libGaps(doc, applied)]) };
  });
  // assert
  for (const c of checks) {
    assert.deepEqual(c.valid, []);
    assert.deepEqual(c.proofs[0], c.proofs[1]);
    for (const [pp, lp, pg, lg] of c.runs) { assert.deepEqual(pp, lp); assert.deepEqual(pg, lg); }
  }
});

test('the generated documents reach every proof level and every gap kind, so the agreement is not vacuous', () => {
  // arrange
  const docs = Array.from({ length: 40 }, (_, i) => generated(101 + i * 17));
  // act
  const proofs = new Set(docs.flatMap((d) => d.patches.map(patchProof)));
  const kinds = new Set(docs.flatMap((d) => coverageGaps(d).map((g) => g.kind)));
  // assert
  assert.deepEqual([...proofs].sort(), ['belt-and-braces', 'controlled', 'static', 'tested', 'unproven']);
  assert.deepEqual([...kinds].sort(), [...GAP_KINDS].sort());
});

// ── proof ────────────────────────────────────────────────────────────────────────────────────────

test('proofOf: a compile-time control alone is static, a run-time one controls, two kinds are belt and braces', () => {
  // arrange
  const { proofOf, controlsOf, PROVEN } = createCore(FIXTURE());
  const held = (kind) => ({ ...(kind ? { kind } : {}), failsWithout: true, passesWith: true });
  // act
  const got = [proofOf({ level: 'tested', control: held('static-assert') }), proofOf({ level: 'tested', control: held('dynamic-assert') }),
    proofOf({ level: 'tested', control: held(), controls: [held('static-assert')] }), proofOf({ level: 'tested' }), proofOf({ level: 'asserted', control: held() }), proofOf(undefined)];
  // assert
  assert.deepEqual(got, ['static', 'controlled', 'belt-and-braces', 'tested', 'unproven', 'unproven']);
  assert.deepEqual(PROVEN, ['belt-and-braces', 'controlled']);
  assert.equal(controlsOf({ control: held(), controls: [held('static-assert')] }).length, 2);
  assert.deepEqual(controlsOf(undefined), []);
});

test('a patch row carries its proof, whether it is proven, and what its controls were', () => {
  // arrange
  const doc = COREML();
  // act
  const { PB } = createCore(doc);
  // assert
  assert.deepEqual([PB.K9.proof, PB.K9.proven, PB.K19.proof, PB.K19.proven, PB.K8.proof, PB.K3.proof], ['controlled', true, 'static', false, 'tested', 'unproven']);
  assert.match(PB.K19.proofRef, /^static-assert: static_assert on the return type/);
});

// ── timeline, combinations, filters, focus ───────────────────────────────────────────────────────

test('the timeline applies the first k patches in document order; combinations apply the ticked set', () => {
  // arrange
  const core = createCore(COREML());
  // act
  core.S.k = 2;
  const first = [...core.appliedSet()];
  core.S.mode = 'combo';
  core.S.combo = new Set(['KCC']);
  const ticked = [...core.appliedSet()];
  // assert
  assert.deepEqual(first, ['K3', 'K4']);
  assert.deepEqual(ticked, ['KCC']);
});

test('with no patch applied the coremltools document has 13 open paths; with all, none', () => {
  // arrange
  const core = createCore(COREML());
  // act
  const none = corePaths(core, []).filter(([, st]) => st === 'open').length;
  const all = corePaths(core, core.PATCHES.map((p) => p.id));
  // assert
  assert.equal(none, 13);
  assert.deepEqual([all.filter(([, st]) => st === 'open').length, all.filter(([, st]) => st === 'closed').length, all.filter(([, st]) => st === 'unevaluated').length], [0, 18, 5]);
});

test('a reject flow exists only while a patch that adds it is applied', () => {
  // arrange
  const core = createCore(COREML());
  const reject = core.FLOWS.find((f) => f.when && f.when.includes('K8'));
  // act
  const got = [core.exists(reject, new Set()), core.exists(reject, new Set(['K8'])), core.exists(core.FLOWS[0], new Set())];
  // assert
  assert.deepEqual(got, [false, true, true]);
});

test('build draws three levels from the nested groups, with an impact never folded into a group', () => {
  // arrange
  const core = createCore(COREML());
  // act
  const sizes = [0, 1, 2].map((level) => { core.S.level = level; const B = core.build(); return [Object.keys(B.V).length, B.level, 'E6' in B.V]; });
  // assert
  assert.deepEqual(sizes, [[5, 0, true], [13, 1, true], [27, 2, true]]);
});

test('focusing a patch, a finding, a path or a gap drops to L2 and names what is related', () => {
  // arrange
  const core = createCore(FIXTURE());
  core.S.level = 0;
  const first = core.build();
  // act
  const byKind = [{ patch: core.PATCHES[0].id }, { fin: core.FINDINGS[0].id }, { path: first.paths[0].id }, { gap: first.gaps[0].key }, { path: 'no-such-path' }, { gap: 'no-such-gap' }].map((focus) => {
    core.S.focus = focus;
    const B = core.build();
    return [B.level, B.rel.fl.size > 0, B.rel.nd.size > 0, B.E.some((e) => e.on), B.E.every((e) => e.on)];
  });
  core.S.focus = null;
  // assert
  for (const row of byKind.slice(0, 4)) assert.deepEqual(row, [2, true, true, true, false]);
  assert.deepEqual(byKind[4].slice(0, 2), [2, false]);
  assert.deepEqual(byKind[5].slice(0, 2), [2, false]);
  assert.equal(core.build().rel, null);
});

test('the path filter keeps only edges on a path in that state', () => {
  // arrange
  const core = createCore(FIXTURE());
  core.S.level = 2;
  // act
  const counts = ['all', 'live', 'grey', 'closed'].map((flt) => { core.S.flt = flt; return core.build().E.filter((e) => e.on).length; });
  // assert
  assert.equal(counts[0] > counts[1] && counts[1] > 0 && counts[2] > 0 && counts[3] > 0, true);
});

// ── layout ───────────────────────────────────────────────────────────────────────────────────────

test('no two elements overlap and every edge is a drawable route, at every level of both documents', () => {
  // arrange
  const cores = [createCore(COREML()), createCore(FIXTURE()), createCore(generated(5))];
  // act
  const problems = [];
  for (const core of cores) for (const level of [0, 1, 2]) for (const cov of [true, false]) {
    core.S.level = level; core.S.cov = cov;
    const B = core.build();
    const boxes = Object.values(B.V);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + core.NW && b.x < a.x + core.NW && a.y < b.y + b.h && b.y < a.y + a.h) problems.push(`overlap ${a.id} ${b.id} at L${level}`);
    }
    for (const e of B.E) if (!/^M[-\d.]+,[-\d.]+( [LQ][-\d., ]+)+$/.test(e.d) || e.pts.length < 2) problems.push(`route ${e.from}>${e.to}`);
    if (!(B.H > Math.max(...boxes.map((v) => v.y + v.h)))) problems.push(`height at L${level}`);
  }
  // assert
  assert.deepEqual(problems, []);
});

test('the coverage layer adds a strip to every element only while it is on and the document carries coverage', () => {
  // arrange
  const withCov = createCore(FIXTURE());
  const without = createCore({ ...COREML(), patches: COREML().patches.map((p) => ({ ...p, evidence: { level: p.evidence.level } })) });
  // act
  withCov.S.cov = true; const on = withCov.build().pad;
  withCov.S.cov = false; const off = withCov.build().pad;
  // assert
  assert.deepEqual([on, off, withCov.HAS_COV, without.HAS_COV, without.build().pad, without.build().gaps], [7, 0, true, false, 0, []]);
});

test('a document with no groups, patches, findings or impacts still builds, with generated references and no path', () => {
  // arrange
  const doc = { v: 1, kind: 'dfd', nodes: [{ id: 'node:a', kind: 'external', subtype: 'actor', label: 'a' }, { id: 'node:p', kind: 'process', label: 'p' },
    { id: 'node:s', kind: 'store', subtype: 'file', label: 'a store with quite a long name' }, { id: 'node:q', kind: 'store', subtype: 'queue', label: 'q' }],
    flows: [{ from: 'node:a', to: 'node:p', mode: 'sync' }, { from: 'node:p', to: 'node:s', mode: 'sync' }, { from: 'node:p', to: 'node:q', mode: 'async' }, { from: 'node:p', to: 'node:p', mode: 'sync' },
      { from: 'node:s', to: 'node:q', mode: 'sync', directed: false }] };
  // act
  const core = createCore(doc);
  const B = core.build();
  // assert
  assert.deepEqual(core.NODES.map((n) => n.ref), ['E1', 'P1', 'D1', 'Q1']);
  assert.deepEqual([B.paths.length, core.PATCHES.length, core.FLOWS.length, core.REF('node:p'), core.REF('absent')], [0, 0, 3, 'P1', 'absent']);
});

test('a cycle does not lengthen a path, and past the cap the list stops', () => {
  // arrange: a ladder of 12 rungs has 2^12 routes to its sink
  const nodes = [{ id: 'S0', kind: 'external', subtype: 'actor', label: 's' }, { id: 'T0', kind: 'external', subtype: 'system', label: 't', impact: 'high' }];
  const flows = [];
  let prev = ['S0'];
  for (let i = 1; i <= 12; i++) {
    const pair = [`A${i}`, `B${i}`];
    for (const id of pair) nodes.push({ id, kind: 'process', label: id });
    for (const p of prev) for (const id of pair) flows.push({ from: p, to: id, mode: 'sync' });
    prev = pair;
  }
  for (const p of prev) flows.push({ from: p, to: 'T0', mode: 'sync' });
  flows.push({ from: 'A2', to: 'A1', mode: 'sync' });
  const core = createCore({ v: 1, kind: 'dfd', nodes, flows });
  // act
  const paths = core.pathsOf(new Set());
  // assert
  assert.equal(paths.length, core.MAX_PATHS);
  assert.equal(paths.every((p) => new Set(p.flows.map((f) => f.to)).size === p.flows.length), true);
});

test('wrapL breaks on spaces and cuts a word longer than the line; roundedPath drops repeated and collinear points', () => {
  // arrange
  const { wrapL, roundedPath, shortLabel, num } = createCore(FIXTURE());
  // act
  const lines = wrapL('MMapFileReader::ReadDataWithAVeryLongName (thunk) x', 12);
  const route = roundedPath([[0, 0], [0, 0], [10, 0], [20, 0], [20, 10]], 6);
  // assert
  assert.deepEqual(lines, ['MMapFileRead', 'er::ReadData', 'WithAVeryLon', 'gName', '(thunk) x']);
  assert.deepEqual(route.pts, [[0, 0], [20, 0], [20, 10]]);
  assert.equal(route.d, 'M0,0 L15,0 Q20,0 20,5 L20,10');
  assert.deepEqual([shortLabel("g_os: Apple's frameworks. Source patches stop here."), shortLabel('Validators'), num(1.26)], ["Apple's frameworks", 'Validators', '1.3']);
});

// ── chips and verdicts ───────────────────────────────────────────────────────────────────────────

test('a finding chip follows its patches, then the gate on its element, then its recorded status', () => {
  // arrange
  const core = createCore(COREML());
  const all = new Set(core.PATCHES.map((p) => p.id));
  // act
  const got = [core.chipState('P8', 'F8', all).g, core.chipState('P8', 'F8', new Set()).g, core.chipState('E4', 'F8@E4', all).g, core.chipState('E8', 'F19@E8', all).g,
    core.chipState('E12', 'F17@E12', all).g, core.chipState('P15', 'F6', all).g];
  // assert
  assert.deepEqual(got, ['fixed', 'open', 'safe', 'safe', 'uneval', 'fixed']);
});

test('gateOf reads a fixed step as tested only when every patch on it is, and words every verdict', () => {
  // arrange
  const core = createCore(COREML());
  const all = new Set(core.PATCHES.map((p) => p.id));
  const flowTo = (from, to) => core.FLOWS.find((f) => f.from === from && f.to === to);
  // act
  const gates = [core.gateOf(flowTo('P12', 'E2'), all), core.gateOf(flowTo('P11', 'E3'), all), core.gateOf(flowTo('P13', 'Q1'), new Set(['K18'])), core.gateOf(flowTo('E4', 'E6'), all), core.gateOf(flowTo('E12', 'E6'), all), core.gateOf(flowTo('E1', 'P8'), all)];
  // assert
  assert.deepEqual(gates.map((g) => [g.g, g.ev || null]), [['fixed', 'tested'], ['fixed', 'asserted'], ['open', null], ['safe', 'static'], ['uneval', null], ['open', null]]);
  assert.deepEqual(gates.map(core.gateCls), ['fixed', 'fixed weak', 'live', 'safe weak', 'grey', 'live']);
  assert.match(core.chipWord(gates[3]), /^measured non-exploitable \(static analysis only\)$/);
  assert.deepEqual([core.chipWord(gates[0]), core.chipWord(gates[2]), core.chipWord(gates[4])], ['fixed (tested)', 'open', 'not evaluated']);
});

// ── SARIF ────────────────────────────────────────────────────────────────────────────────────────

const sarif = (results) => JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'lab' } }, results }] });
const at = (name) => [{ logicalLocations: [{ name }] }];

test('a SARIF fail opens a step, a pass makes it measured safe with the tool as witness, open leaves it unevaluated', () => {
  // arrange
  const core = createCore(COREML());
  const all = new Set(core.PATCHES.map((p) => p.id));
  const step = (from, to) => core.FLOWS.find((f) => f.from === from && f.to === to);
  // act
  core.applySarif(sarif([{ ruleId: 'f17', kind: 'fail', message: { text: 'reached' }, locations: at('E12') }, { ruleId: 'F8', kind: 'pass', locations: at('E10') },
    { ruleId: 'COREMLCOMPILER', kind: 'open', locations: at('E13') }, { ruleId: 'F99', locations: at('E1') }, { ruleId: 'F16' }]));
  const got = [core.gateOf(step('E12', 'E6'), all), core.gateOf(step('E10', 'E6'), all), core.gateOf(step('E13', 'E2'), all), core.gateOf(step('E11', 'E6'), all)];
  // assert
  assert.deepEqual(got.map((g) => [g.g, g.ev || null, g.tool]), [['open', null, 'lab'], ['safe', 'third-party', 'lab'], ['uneval', null, 'lab'], ['open', null, 'lab']]);
  assert.equal(core.S.sarifMsg, '5 results read: 3 fail, 1 pass, 1 open or review. 4 matched a step in the diagram, 1 matched nothing.');
  assert.equal(core.chipState('E12', 'F17@E12', all).g, 'open');
  assert.equal(corePaths(core, [...all]).filter(([, st]) => st === 'open').length, 2);
});

test('text that is not JSON applies nothing and says so; a document with no runs reads as zero results', () => {
  // arrange
  const core = createCore(COREML());
  // act
  core.applySarif('{ not json');
  const bad = core.S.sarifMsg;
  core.applySarif('{}');
  // assert
  assert.match(bad, /^Not valid JSON: .* Nothing was applied\.$/);
  assert.equal(core.S.sarifMsg, '0 results read: 0 fail, 0 pass, 0 open or review. 0 matched a step in the diagram, 0 matched nothing.');
  assert.deepEqual(core.S.sarif, {});
});

// ── coverage on elements ─────────────────────────────────────────────────────────────────────────

test('an element measured with no line to cover is neither covered nor a gap, and gets no bar', () => {
  // arrange
  const doc = FIXTURE();
  const target = doc.nodes.find((n) => n.coverage && n.kind === 'process');
  target.coverage = { lines: { covered: 0, total: 0 } };
  // act
  const core = createCore(doc);
  const node = core.NB[target.id];
  // assert
  assert.deepEqual([node.cov, node.empty, core.measurable(node)], [null, true, false]);
  assert.equal(coreGaps(core, doc.patches.map((p) => p.id)).some((g) => g.endsWith(`|${target.id}`)), false);
  assert.deepEqual(coreGaps(core, []), libGaps(doc, []));
});

test('a collapsed group aggregates the coverage of its measured members and counts the rest', () => {
  // arrange
  const core = createCore(FIXTURE());
  core.S.level = 0;
  // act
  const groups = Object.values(core.build().V).filter((v) => v.coll && v.cv);
  // assert
  assert.equal(groups.length > 0, true);
  for (const v of groups) {
    const can = v.members.map((m) => core.NB[m]).filter(core.measurable);
    assert.equal(v.cv.measured + v.cv.unmeasured, can.length);
    assert.equal(v.cv.covered, can.filter((n) => n.cov).reduce((s, n) => s + n.cov.lines.covered, 0));
  }
});

test('the render options start on, and the view state starts at boundaries with every patch applied', () => {
  // arrange
  const core = createCore(COREML());
  // act
  const S = core.S;
  // assert
  assert.deepEqual(S.show, { halos: true, pips: true, guards: true, chips: true, labels: true, tiles: true, gaps: true });
  assert.deepEqual([S.level, S.k, S.mode, S.flt, S.focus, S.cov], [1, 12, 'time', 'all', null, true]);
});

test('a flow between later columns or back to an earlier one still bends at a finite x (synthetic document)', () => {
  // arrange
  const doc = load('./fixtures/dfd-synthetic.json');
  doc.flows.push({ id: 'flow:back', from: doc.flows[doc.flows.length - 1].to, to: doc.flows[0].to, label: 'back' });
  const core = createCore(doc);
  // act
  const routes = [];
  for (const level of [0, 1, 2]) { core.S.level = level; for (const e of core.build().E) routes.push(e); }
  // assert
  assert.ok(routes.length > 0);
  assert.deepEqual(routes.filter((e) => !/^M[-\d.]+,[-\d.]+( [LQ][-\d., ]+)+$/.test(e.d) || e.pts.flat().some((v) => !Number.isFinite(v))).map((e) => `${e.from}>${e.to}`), []);
});
