// lib/dfd.mjs — dfd@1: a source-independent data flow diagram model, its validation and its
// analysis. Rendering is lib/dfd-render.mjs. The adapters that build a model from the flow graph or
// from CodeQL code-flow records are flow/dfd-adapter.mjs: lib/ ships and flow/ does not, so nothing
// here imports from flow/.
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

export const DFD_VERSION = 1;
export const NODE_KINDS = Object.freeze(['process', 'store', 'external']);
export const MODES = Object.freeze(['sync', 'async', 'event']);
// `log` is a broker: an append-only file one process appends to and another tails holds data
// between them exactly as a topic does, and the reader is decoupled from the writer in time.
export const BROKER_SUBTYPES = Object.freeze(['broker', 'queue', 'topic', 'stream', 'log']);
export const STORE_SUBTYPES = Object.freeze([...BROKER_SUBTYPES, 'database', 'file']);
export const EXTERNAL_SUBTYPES = Object.freeze(['endpoint', 'scheduler', 'actor', 'system', 'env', 'binary']);
// A flow's role says what it carries back. Only `data` takes part in the two-way collapse: a
// feedback, error or retry flow is a return path even when its pair is adjacent.
export const ROLES = Object.freeze(['data', 'feedback', 'error', 'retry']);
// flow.direction: what the runtime saw a module do across a static `touches`, which never had one
export const FLOW_DIRECTIONS = Object.freeze(['reads', 'writes', 'both']);
// filterModel's walk: forward along flows, backward against them, or both
export const FILTER_DIRECTIONS = Object.freeze(['in', 'out', 'both']);
export const FLOW_CLASSES = Object.freeze(['forward', 'bidirectional', 'feedback', 'self-loop', 'undirected']);

export const schemaPath = () => join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'dfd.schema.json');

export const isBroker = (node) => !!node && node.kind === 'store' && BROKER_SUBTYPES.includes(node.subtype);
export const isDirected = (flow) => flow.directed !== false;
export const roleOf = (flow) => flow.role || 'data';
const SUBTYPES_BY_KIND = { store: STORE_SUBTYPES, external: EXTERNAL_SUBTYPES };

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
    // the schema admits the union of the subtypes; which kind may carry which is checked here
    if (n.subtype !== undefined) {
      const allowed = SUBTYPES_BY_KIND[n.kind];
      if (!allowed) errors.push(`dfd: node ${JSON.stringify(n.id)} is a process and carries subtype ${JSON.stringify(n.subtype)}: only a store or an external has one`);
      else if (!allowed.includes(n.subtype)) errors.push(`dfd: node ${JSON.stringify(n.id)} is a ${n.kind} and carries subtype ${JSON.stringify(n.subtype)}, which is a subtype of the other kind (${n.kind} takes ${allowed.join('|')})`);
    }
  }
  doc.flows.forEach((f, i) => {
    for (const end of ['from', 'to']) {
      if (!ids.has(f[end])) errors.push(`dfd: flows[${i}].${end} names ${JSON.stringify(f[end])}, which is not a node`);
    }
    // a resolved direction on a flow that still says it has none is two answers to one question
    if (f.direction !== undefined && !isDirected(f)) errors.push(`dfd: flows[${i}] carries direction ${JSON.stringify(f.direction)} and directed:false — a resolved touch is directed`);
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
 *   feedback       role feedback|error|retry: a declared return path, even when its pair is
 *                  adjacent — A->B data with B->A error is a loop, not a synchronised pair
 *   bidirectional  role data both ways: A->B and B->A; collapses to one two-headed flow
 *   feedback       a back arc inside a strongly connected component of the data flows (backArcs)
 *   forward        everything else
 *
 * Ranks and paths run over the data flows less their back arcs; a declared return path is set
 * aside as a back arc is. Cycles are the components of every directed flow, declared returns
 * included, so a loop closed only by an error flow is still reported as a cycle.
 */
export function analyse(model, { maxPaths = 200 } = {}) {
  const ids = model.nodes.map((n) => n.id);
  const ix = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const flows = model.flows;
  const flowClass = flows.map(() => 'forward');
  const arcs = [];
  const data = [];
  flows.forEach((f, k) => {
    if (!isDirected(f)) flowClass[k] = 'undirected';
    else if (f.from === f.to) flowClass[k] = 'self-loop';
    else {
      const arc = { a: ix.get(f.from), b: ix.get(f.to), k };
      arcs.push(arc);
      if (roleOf(f) === 'data') data.push(arc);
      else flowClass[k] = 'feedback';
    }
  });

  const adjacency = (list) => {
    const out = Array.from({ length: n }, () => []);
    for (const { a, b, k } of list) out[a].push([b, k]);
    return out;
  };
  const dataOut = adjacency(data);
  const dataScc = stronglyConnected(dataOut);
  const back = backArcs(dataOut, dataScc.comp, dataScc.count);
  for (const { k } of arcs) if (flowClass[k] === 'feedback') back.add(k);
  const { comp, count } = stronglyConnected(adjacency(arcs));

  const byPair = new Map();
  for (const { a, b, k } of data) {
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
    feedback: flows.map((f, k) => ({ flow: k, from: f.from, to: f.to, role: roleOf(f) })).filter((_, k) => flowClass[k] === 'feedback'),
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

// ── filter ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Keep the seeds and everything within `hops` flows of them. Seeds are the nodes whose label or id
 * starts with `prefix`, plus the node whose id or label is `around` (`focus` is its older name and
 * is still read). `direction` chooses the walk: 'out' follows flows forward from the seeds (what
 * they feed), 'in' follows them backward (what feeds them), 'both' (the default) ignores direction.
 * An undirected flow is walked in every direction: which way it runs was never determined, so
 * neither walk may drop it. With no seed criterion the model is returned as it is; when nothing
 * matches, null — never an empty diagram. What was cut is counted in source.filter: a filtered
 * diagram that does not say so reads as the whole system.
 */
export function filterModel(model, { prefix, around, focus, hops = 1, direction = 'both' } = {}) {
  const centre = around ?? focus;
  if (!FILTER_DIRECTIONS.includes(direction)) throw new Error(`dfd: filterModel direction must be one of ${FILTER_DIRECTIONS.join(', ')}, got ${JSON.stringify(direction)}`);
  if (prefix === undefined && centre === undefined) return model;
  const seeds = new Set();
  for (const n of model.nodes) {
    if (prefix !== undefined && (n.label.startsWith(prefix) || n.id.startsWith(prefix))) seeds.add(n.id);
    if (centre !== undefined && (n.id === centre || n.label === centre)) seeds.add(n.id);
  }
  if (seeds.size === 0) return null;
  const near = new Map(model.nodes.map((n) => [n.id, []]));
  for (const f of model.flows) {
    const both = direction === 'both' || !isDirected(f);
    if (both || direction === 'out') near.get(f.from).push(f.to);
    if (both || direction === 'in') near.get(f.to).push(f.from);
  }
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
      filter: { prefix: prefix ?? null, focus: centre ?? null, hops, direction, seeds: seeds.size,
        nodesKept: nodes.length, nodesOmitted: model.nodes.length - nodes.length, flowsOmitted: model.flows.length - flows.length },
    },
    ...rest,
    nodes,
    flows,
  };
}
