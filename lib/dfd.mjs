// lib/dfd.mjs — dfd@1: a source-independent data flow diagram model, its validation, its analysis
// and the adapter from the flow graph (flow/graph.mjs). Rendering is lib/dfd-render.mjs.
//
// Three element kinds and no fourth. A message broker or queue is a STORE with subtype
// broker|queue|topic|stream: data rests in it between a producer and a consumer, the classic
// notations have no fourth symbol, and asynchrony is carried by the flow's `mode`, so a kind of its
// own would say the same thing twice and let the two disagree.
//
// Everything here is a pure function over the model. Nothing reads the clock, the environment or
// the disk except validateDfd, which opens schema/dfd.schema.json.
//
// What analysis never does: an undirected flow (`directed: false`, the flow graph's `touches`) takes
// no part in ranks, cycles, feedback or paths. Its direction was never determined, and a cycle
// built on a guessed direction is a fabricated feedback loop.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from './json-schema.mjs';
import { isTestModule } from '../flow/static.mjs';

export const DFD_VERSION = 1;
export const NODE_KINDS = Object.freeze(['process', 'store', 'external']);
export const MODES = Object.freeze(['sync', 'async', 'event']);
export const BROKER_SUBTYPES = Object.freeze(['broker', 'queue', 'topic', 'stream']);
export const FLOW_CLASSES = Object.freeze(['forward', 'bidirectional', 'feedback', 'self-loop', 'undirected']);

export const schemaPath = () => join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'dfd.schema.json');

export const isBroker = (node) => !!node && node.kind === 'store' && BROKER_SUBTYPES.includes(node.subtype);
export const isDirected = (flow) => flow.directed !== false;

/** -> { ok, errors }. Schema first; the referential checks run only on a document of the right shape. */
export function validateDfd(doc, { path = schemaPath() } = {}) {
  const errors = validateAgainstSchema(doc, { path }).errors.slice();
  if (errors.length) return { ok: false, errors };
  if (Object.keys(doc)[0] !== 'v') errors.push('dfd: "v" must be the first field of the document — an old-shape record is a silently different meaning, not a parse failure');
  const ids = new Set();
  for (const n of doc.nodes) {
    if (ids.has(n.id)) errors.push(`dfd: node id ${JSON.stringify(n.id)} is declared more than once`);
    ids.add(n.id);
  }
  const layers = doc.layers ? new Set(doc.layers) : null;
  const groups = doc.groups ? new Set(doc.groups.map((g) => g.id)) : null;
  if (groups && groups.size !== doc.groups.length) errors.push('dfd: a group id is declared more than once');
  for (const n of doc.nodes) {
    if (layers && n.layer !== undefined && !layers.has(n.layer)) errors.push(`dfd: node ${JSON.stringify(n.id)} names layer ${JSON.stringify(n.layer)}, which "layers" does not declare`);
    if (groups && n.group !== undefined && !groups.has(n.group)) errors.push(`dfd: node ${JSON.stringify(n.id)} names group ${JSON.stringify(n.group)}, which "groups" does not declare`);
  }
  doc.flows.forEach((f, i) => {
    for (const end of ['from', 'to']) {
      if (!ids.has(f[end])) errors.push(`dfd: flows[${i}].${end} names ${JSON.stringify(f[end])}, which is not a node`);
    }
  });
  return { ok: errors.length === 0, errors };
}

// ── graph primitives (index-based, iterative: the repository's own graph has 11,000 nodes) ────────

/** Tarjan. -> { comp, count }: comp[i] is the component of node i, numbered by first member. */
export function stronglyConnected(out) {
  const n = out.length;
  const index = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const raw = new Array(n).fill(-1);
  const stack = [];
  let next = 0;
  let count = 0;
  const open = (v, work) => { index[v] = low[v] = next++; stack.push(v); onStack[v] = true; work.push([v, 0]); };
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work = [];
    open(s, work);
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] < out[v].length) {
        const w = out[v][top[1]++][0];
        if (index[w] === -1) open(w, work);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1][0]; low[p] = Math.min(low[p], low[v]); }
      if (low[v] !== index[v]) continue;
      let w;
      do { w = stack.pop(); onStack[w] = false; raw[w] = count; } while (w !== v);
      count++;
    }
  }
  const renumber = new Map();
  const comp = raw.map((c) => { if (!renumber.has(c)) renumber.set(c, renumber.size); return renumber.get(c); });
  return { comp, count };
}

/**
 * The arcs that close a cycle, chosen deterministically: inside each component, a depth-first walk
 * from its ENTRY (the first member something outside the component flows into, else its first
 * member) marks every arc that returns to a node still being walked. An arc between components is
 * never one. -> Set of arc keys.
 */
export function backArcs(out, comp, count) {
  const members = Array.from({ length: count }, () => []);
  comp.forEach((c, i) => members[c].push(i));
  const entered = new Array(out.length).fill(false);
  out.forEach((arcs, v) => { for (const [w] of arcs) if (comp[w] !== comp[v]) entered[w] = true; });
  const back = new Set();
  const state = new Array(out.length).fill(0);
  for (const ms of members) {
    if (ms.length < 2) continue;
    const root = ms.find((m) => entered[m]) ?? ms[0];
    const work = [[root, 0]];
    state[root] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] >= out[v].length) { state[v] = 2; work.pop(); continue; }
      const [w, key] = out[v][top[1]++];
      if (comp[w] !== comp[v]) continue;
      if (state[w] === 1) back.add(key);
      else if (state[w] === 0) { state[w] = 1; work.push([w, 0]); }
    }
  }
  return back;
}

/** Longest-path layering of an acyclic arc list. -> { rank, order }. Throws on a cycle. */
export function longestPathRanks(n, arcs) {
  const out = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (const [a, b] of arcs) { out[a].push(b); indeg[b]++; }
  const rank = new Array(n).fill(0);
  const order = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) order.push(i);
  for (let q = 0; q < order.length; q++) {
    const a = order[q];
    for (const b of out[a]) {
      if (rank[b] < rank[a] + 1) rank[b] = rank[a] + 1;
      if (--indeg[b] === 0) order.push(b);
    }
  }
  if (order.length !== n) throw new Error('dfd: longestPathRanks was given a cyclic arc list');
  return { rank, order };
}

// ── analysis ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure analysis of a VALID dfd@1 model. Flow references are indexes into model.flows.
 *
 * Classification, in priority order — every flow takes exactly one class:
 *   undirected     directed:false; excluded from everything below
 *   self-loop      from === to (a retry on the same process)
 *   bidirectional  the pair A->B and B->A both exist; collapses to one two-headed flow
 *   feedback       a back arc inside a strongly connected component (see backArcs)
 *   forward        everything else
 */
export function analyse(model, { maxPaths = 200 } = {}) {
  const ids = model.nodes.map((n) => n.id);
  const ix = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const flows = model.flows;
  const flowClass = flows.map(() => 'forward');
  const arcs = [];
  flows.forEach((f, k) => {
    if (!isDirected(f)) flowClass[k] = 'undirected';
    else if (f.from === f.to) flowClass[k] = 'self-loop';
    else arcs.push({ a: ix.get(f.from), b: ix.get(f.to), k });
  });

  const out = Array.from({ length: n }, () => []);
  for (const { a, b, k } of arcs) out[a].push([b, k]);
  const { comp, count } = stronglyConnected(out);
  const back = backArcs(out, comp, count);

  const byPair = new Map();
  for (const { a, b, k } of arcs) {
    const key = `${a}>${b}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(k);
  }
  const bidirectional = [];
  for (const [key, ks] of byPair) {
    const [a, b] = key.split('>').map(Number);
    const reverse = byPair.get(`${b}>${a}`);
    if (!reverse || a > b) continue;
    const all = [...ks, ...reverse].sort((x, y) => x - y);
    for (const k of all) flowClass[k] = 'bidirectional';
    bidirectional.push({ a: ids[a], b: ids[b], flows: all, modes: [...new Set(all.map((k) => flows[k].mode))] });
  }
  for (const k of back) if (flowClass[k] === 'forward') flowClass[k] = 'feedback';

  const dag = arcs.filter(({ k }) => !back.has(k));
  const { rank, order } = longestPathRanks(n, dag.map(({ a, b }) => [a, b]));
  const condensed = new Set(arcs.filter(({ a, b }) => comp[a] !== comp[b]).map(({ a, b }) => `${comp[a]}>${comp[b]}`));
  const sccRank = longestPathRanks(count, [...condensed].map((s) => s.split('>').map(Number))).rank;

  const succ = Array.from({ length: n }, () => new Set());
  const pred = Array.from({ length: n }, () => new Set());
  for (const { a, b } of arcs) { succ[a].add(b); pred[b].add(a); }
  const dagSucc = Array.from({ length: n }, () => new Set());
  const dagIn = new Array(n).fill(0);
  for (const { a, b } of dag) if (!dagSucc[a].has(b)) { dagSucc[a].add(b); dagIn[b]++; }

  const sizes = new Array(count).fill(0);
  comp.forEach((c) => { sizes[c]++; });
  const cycles = [];
  for (let c = 0; c < count; c++) {
    if (sizes[c] < 2) continue;
    const inside = arcs.filter(({ a, b }) => comp[a] === c && comp[b] === c).map(({ k }) => k);
    const fb = inside.filter((k) => flowClass[k] === 'feedback');
    cycles.push({
      members: ids.filter((_, i) => comp[i] === c),
      feedback: fb,
      // every arc in the component belongs to a two-way pair: a synchronised pair, not a loop
      bidirectionalOnly: inside.every((k) => flowClass[k] === 'bidirectional'),
      // a cycle through an element the producer could not vouch for may not exist
      uncertain: model.nodes.some((nd, i) => comp[i] === c && nd.unknown === true),
    });
  }

  const sources = [];
  const sinks = [];
  for (let i = 0; i < n; i++) {
    if (dagIn[i] === 0 && dagSucc[i].size > 0) sources.push(i);
    if (dagIn[i] > 0 && dagSucc[i].size === 0) sinks.push(i);
  }
  const ways = new Array(n).fill(0);
  for (let q = order.length - 1; q >= 0; q--) {
    const v = order[q];
    ways[v] = dagSucc[v].size === 0 ? 1 : [...dagSucc[v]].reduce((s, w) => s + ways[w], 0);
  }
  const total = sources.reduce((s, v) => s + ways[v], 0);
  const listed = [];
  for (const s of sources) {
    const work = [[s, [...dagSucc[s]], 0]];
    const trail = [s];
    while (work.length && listed.length < maxPaths) {
      const top = work[work.length - 1];
      if (top[2] >= top[1].length) { work.pop(); trail.pop(); continue; }
      const w = top[1][top[2]++];
      trail.push(w);
      if (dagSucc[w].size === 0) { listed.push(trail.map((i) => ids[i])); trail.pop(); continue; }
      work.push([w, [...dagSucc[w]], 0]);
    }
  }

  const node = (id) => model.nodes[ix.get(id)];
  const asyncHops = [];
  flows.forEach((f, k) => {
    const byMode = f.mode !== 'sync';
    const byBroker = isBroker(node(f.from)) || isBroker(node(f.to));
    if (byMode || byBroker) asyncHops.push({ flow: k, from: f.from, to: f.to, reason: byMode && byBroker ? 'mode+broker' : byMode ? 'mode' : 'broker' });
  });
  const brokered = [];
  model.nodes.forEach((b, bi) => {
    if (!isBroker(b)) return;
    for (const p of pred[bi]) for (const c of succ[bi]) brokered.push({ from: ids[p], via: b.id, to: ids[c] });
  });

  return {
    v: DFD_VERSION,
    flowClass,
    nodes: ids.map((id, i) => ({ id, rank: rank[i], sccRank: sccRank[comp[i]], cyclic: sizes[comp[i]] > 1, fanOut: succ[i].size, fanIn: pred[i].size })),
    bidirectional,
    selfLoops: flows.map((f, k) => ({ node: f.from, flow: k })).filter((_, k) => flowClass[k] === 'self-loop'),
    feedback: flows.map((f, k) => ({ flow: k, from: f.from, to: f.to })).filter((_, k) => flowClass[k] === 'feedback'),
    undirected: flowClass.map((c, k) => (c === 'undirected' ? k : -1)).filter((k) => k >= 0),
    cycles,
    branches: ids.map((id, i) => ({ node: id, to: [...succ[i]].map((j) => ids[j]) })).filter((b) => b.to.length > 1),
    merges: ids.map((id, i) => ({ node: id, from: [...pred[i]].map((j) => ids[j]) })).filter((m) => m.from.length > 1),
    sources: sources.map((i) => ids[i]),
    sinks: sinks.map((i) => ids[i]),
    // total is exact while it is a safe integer and null beyond: a rounded count is not a count
    paths: {
      total: Number.isSafeInteger(total) ? total : null,
      listed,
      truncated: listed.length !== total,
      multiHop: listed.filter((p) => p.length > 2).length,
    },
    asyncHops,
    brokered,
  };
}

// ── the flow-graph adapter ───────────────────────────────────────────────────────────────────────

// A spawn target the static pass captured is the first argument of exec/spawn AS WRITTEN. `exec` is
// also a database method, so SQL text arrives here as a "process". Only a single token that reads as
// a command name is drawn as an external entity; the rest are counted and left out.
const COMMAND_NAME = /^[A-Za-z0-9_@.+/-]+$/;
const SYNC_VERB = /Sync$/;
const verbOf = (ref) => String(ref).split(' ').pop();

/**
 * Flow graph (flow/graph.mjs) -> dfd@1. The mapping:
 *
 *   module            -> process    group = first path segment; unanalysable modules marked unknown
 *   artifact, store   -> store      subtype file; a bare-filename node is marked unknown
 *   env               -> external   subtype env: configuration supplied from outside the boundary
 *   process (spawn)   -> external   subtype binary, when the target reads as a command name;
 *                                   -> the module's own process when the target is a module path;
 *                                   otherwise omitted and counted
 *   reads  M <- X     -> flow X -> M     writes M -> X -> flow M -> X
 *   spawns M -> P     -> flow M -> P, async unless every witness is a *Sync call; omitted and
 *                        counted when every witness is a bare `exec`, which a database handle
 *                        also has
 *   touches M -- X    -> flow M -- X, directed:false
 *   reads  M <- M'    -> a static or dynamic import: a code dependency, not a data flow. Omitted and
 *                        counted unless { imports: true }.
 *
 * File reads and writes are `sync`: the mode says whether the two ends are coupled in time, and the
 * static pass has no evidence that any of them is not. Every flow carries the edge's own witness and
 * existence, unchanged. Nodes left with no flow are omitted and counted.
 */
export function fromFlowGraph(graph, { tests = false, imports = false, title } = {}) {
  const src = new Map(graph.nodes.map((n) => [n.id, n]));
  const modulePaths = new Set(graph.nodes.filter((n) => n.kind === 'module').map((n) => n.path));
  const omitted = { testModules: 0, importEdges: 0, spawnTargetsNotCommands: 0, ambiguousExecEdges: 0, edgesOfOmittedNodes: 0, isolatedNodes: 0 };
  const mapped = new Map();

  const mapNode = (n) => {
    if (n.kind === 'module') {
      if (!tests && isTestModule(n.path)) { omitted.testModules++; return null; }
      const unknown = n.analysis !== undefined && n.analysis !== 'analysed';
      return { id: n.id, kind: 'process', label: n.path, group: n.path.includes('/') ? n.path.split('/')[0] : '(root)',
        ...(unknown ? { unknown: true, note: `not analysed (${n.analysis}): its flows are unknown, not absent` } : {}) };
    }
    if (n.kind === 'artifact' || n.kind === 'store') {
      return { id: n.id, kind: 'store', label: n.path, subtype: 'file',
        ...(n.composed ? { unknown: true, note: 'bare filename: a name, not a location — several files may share this node' } : {}) };
    }
    if (n.kind === 'env') return { id: n.id, kind: 'external', label: n.path, subtype: 'env' };
    if (modulePaths.has(n.path)) return mapped.get(`node:module:${n.path}`);
    if (COMMAND_NAME.test(n.path)) return { id: n.id, kind: 'external', label: n.path, subtype: 'binary' };
    omitted.spawnTargetsNotCommands++;
    return null;
  };
  // modules first: a spawn target that names a module resolves to that module's process
  for (const n of graph.nodes) if (n.kind === 'module') mapped.set(n.id, mapNode(n));
  for (const n of graph.nodes) if (n.kind !== 'module') mapped.set(n.id, mapNode(n));

  const flows = [];
  for (const e of graph.edges) {
    const from = mapped.get(e.from);
    const to = mapped.get(e.to);
    if (!from || !to) { omitted.edgesOfOmittedNodes++; continue; }
    const refs = [].concat(e.evidence || []);
    const evidence = { witness: e.witness, existence: e.existence, refs };
    if (e.kind === 'reads') {
      if (src.get(e.to).kind === 'module') {
        if (!imports) { omitted.importEdges++; continue; }
        flows.push({ from: to.id, to: from.id, label: 'imports', mode: 'sync', evidence });
      } else flows.push({ from: to.id, to: from.id, label: 'reads', mode: 'sync', evidence });
    } else if (e.kind === 'writes') flows.push({ from: from.id, to: to.id, label: 'writes', mode: 'sync', evidence });
    else if (e.kind === 'spawns') {
      // a bare `exec` is child_process.exec or a database handle's exec: the witness cannot say which
      if (refs.length > 0 && refs.every((r) => verbOf(r) === 'exec')) { omitted.ambiguousExecEdges++; continue; }
      const sync = refs.length > 0 && refs.every((r) => SYNC_VERB.test(verbOf(r)));
      flows.push({ from: from.id, to: to.id, label: 'spawns', mode: sync ? 'sync' : 'async', evidence });
    } else flows.push({ from: from.id, to: to.id, label: 'touches', mode: 'sync', directed: false, evidence });
  }

  const used = new Set(flows.flatMap((f) => [f.from, f.to]));
  const nodes = [];
  const seen = new Set();
  for (const m of mapped.values()) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    if (used.has(m.id)) nodes.push(m);
    else omitted.isolatedNodes++;
  }
  return {
    v: DFD_VERSION,
    kind: 'dfd',
    title: title || 'flow graph',
    source: {
      producer: 'flow-graph',
      graph: { v: graph.v ?? null, generatedAt: graph.generatedAt ?? null, nodes: graph.nodes.length, edges: graph.edges.length },
      options: { tests, imports },
      omitted,
    },
    nodes,
    flows,
  };
}

// ── filter ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Keep the seeds and everything within `hops` flows of them, in either direction. Seeds are the
 * nodes whose label or id starts with `prefix`, plus the node whose id or label is `focus`. With
 * neither, the model is returned as it is; when nothing matches, null — never an empty diagram.
 * What was cut is counted in source.filter: a filtered diagram that does not say so reads as the
 * whole system.
 */
export function filterModel(model, { prefix, focus, hops = 1 } = {}) {
  if (prefix === undefined && focus === undefined) return model;
  const seeds = new Set();
  for (const n of model.nodes) {
    if (prefix !== undefined && (n.label.startsWith(prefix) || n.id.startsWith(prefix))) seeds.add(n.id);
    if (focus !== undefined && (n.id === focus || n.label === focus)) seeds.add(n.id);
  }
  if (seeds.size === 0) return null;
  const near = new Map(model.nodes.map((n) => [n.id, []]));
  for (const f of model.flows) { near.get(f.from).push(f.to); near.get(f.to).push(f.from); }
  const keep = new Set(seeds);
  let edge = [...seeds];
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const id of edge) for (const other of near.get(id)) if (!keep.has(other)) { keep.add(other); next.push(other); }
    edge = next;
  }
  const nodes = model.nodes.filter((n) => keep.has(n.id));
  const flows = model.flows.filter((f) => keep.has(f.from) && keep.has(f.to));
  const { v, kind, title, source, ...rest } = model;
  return {
    v, kind, ...(title === undefined ? {} : { title }),
    source: {
      ...(source || { producer: 'authored' }),
      filter: { prefix: prefix ?? null, focus: focus ?? null, hops, seeds: seeds.size,
        nodesKept: nodes.length, nodesOmitted: model.nodes.length - nodes.length, flowsOmitted: model.flows.length - flows.length },
    },
    ...rest,
    nodes,
    flows,
  };
}
