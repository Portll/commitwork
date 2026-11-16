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
// A finding overlay sits over the data flow. `status` is the dimension the diagram shows: a live CWE
// is unremediated and reachable, a mitigated one has a landed fix, an undetermined one's reach is unproven.
export const FINDING_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'undetermined']);
// A dismissed one was judged not a defect, with the reason in its note. That is a judgement by a reader, not
// a measurement: the paths view shows the reason and does not count the result closed.
// The axes a control on an issue can sit on, and the classes of value that can flow to it (schema: findings[].controls, dataClass).
export const CONTROL_AXES = Object.freeze(['source', 'flow', 'sink', 'transport', 'privilege', 'containment']);
export const DATA_CLASSES = Object.freeze(['secret', 'identifier', 'public', 'untrusted-input', 'configuration']);
export const FINDING_STATUSES = Object.freeze(['live', 'mitigated', 'dismissed', 'undetermined']);
// The patch overlay. A node with an `impact` is where a path ends in harm. A flow's `gate` is a verdict
// no patch produced. A path is closed when any step on it is fixed or safe: state belongs to paths,
// because one element can be guarded on one path and open on another.
export const IMPACTS = Object.freeze(['critical', 'high', 'medium', 'low']);
export const GATE_STATES = Object.freeze(['safe', 'unevaluated']);
export const PATCH_EVIDENCE = Object.freeze(['tested', 'inspected', 'rescanned', 'asserted']);
export const STEP_STATES = Object.freeze(['open', 'fixed', 'safe', 'unevaluated']);
export const PATH_STATES = Object.freeze(['open', 'unevaluated', 'closed']);

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
  if (groups) {
    const parentOf = new Map(doc.groups.map((g) => [g.id, g.parent]));
    for (const g of doc.groups) {
      if (g.parent === undefined) continue;
      if (!groups.has(g.parent)) { errors.push(`dfd: group ${JSON.stringify(g.id)} names parent ${JSON.stringify(g.parent)}, which "groups" does not declare`); continue; }
      const seen = new Set([g.id]);
      for (let at = g.parent; at !== undefined && groups.has(at); at = parentOf.get(at)) {
        if (seen.has(at)) { errors.push(`dfd: group ${JSON.stringify(g.id)} is its own ancestor through "parent"`); break; }
        seen.add(at);
      }
    }
  }
  for (const n of doc.nodes) {
    if (layers && n.layer !== undefined && !layers.has(n.layer)) errors.push(`dfd: node ${JSON.stringify(n.id)} names layer ${JSON.stringify(n.layer)}, which "layers" does not declare`);
    if (groups && n.group !== undefined && !groups.has(n.group)) errors.push(`dfd: node ${JSON.stringify(n.id)} names group ${JSON.stringify(n.group)}, which "groups" does not declare`);
    // a count of covered lines above the count of lines is a report read wrongly, not a high figure
    for (const part of ['lines', 'branches']) {
      const c = n.coverage && n.coverage[part];
      if (c && c.covered > c.total) errors.push(`dfd: node ${JSON.stringify(n.id)} carries coverage.${part} with ${c.covered} covered of ${c.total}: more covered than there are`);
    }
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
  // pull requests: ids are unique, and an issue or a patch names only one that is declared
  const prIds = new Set();
  (doc.prs || []).forEach((p, i) => { if (prIds.has(p.id)) errors.push(`dfd: prs[${i}] repeats the id ${JSON.stringify(p.id)}`); prIds.add(p.id); });
  for (const [what, list] of [['findings', doc.findings || []], ['patches', doc.patches || []]]) {
    list.forEach((x, i) => { if (x.pr !== undefined && !prIds.has(x.pr)) errors.push(`dfd: ${what}[${i}] (${JSON.stringify(x.id)}) names the pull request ${JSON.stringify(x.pr)}, which "prs" does not declare`); });
  }
  if (doc.findings) {
    const flowKey = new Set(doc.flows.map((f) => `${f.from}\u0000${f.to}`));
    const findingIds = new Set();
    doc.findings.forEach((fd, i) => {
      if (findingIds.has(fd.id)) errors.push(`dfd: finding id ${JSON.stringify(fd.id)} is declared more than once`);
      findingIds.add(fd.id);
      const at = fd.at || {};
      if (at.node !== undefined && !ids.has(at.node)) errors.push(`dfd: findings[${i}] (${JSON.stringify(fd.id)}) is anchored to node ${JSON.stringify(at.node)}, which is not a node`);
      if (at.flow !== undefined) {
        for (const end of ['from', 'to']) {
          if (!ids.has(at.flow[end])) errors.push(`dfd: findings[${i}] (${JSON.stringify(fd.id)}) is anchored to a flow whose ${end} ${JSON.stringify(at.flow[end])} is not a node`);
        }
        if (ids.has(at.flow.from) && ids.has(at.flow.to) && !flowKey.has(`${at.flow.from}\u0000${at.flow.to}`)) {
          errors.push(`dfd: findings[${i}] (${JSON.stringify(fd.id)}) is anchored to a flow ${JSON.stringify(at.flow.from)} -> ${JSON.stringify(at.flow.to)} that the document does not carry`);
        }
      }
    });
  }
  const pairs = new Set(doc.flows.map((f) => `${f.from}\u0000${f.to}`));
  const findingIds = doc.findings ? new Set(doc.findings.map((fd) => fd.id)) : null;
  doc.flows.forEach((f, i) => {
    if (f.gate && f.gate.finding !== undefined && findingIds && !findingIds.has(f.gate.finding)) errors.push(`dfd: flows[${i}].gate names finding ${JSON.stringify(f.gate.finding)}, which "findings" does not declare`);
  });
  if (doc.patches) {
    const patchIds = new Set();
    doc.patches.forEach((p, i) => {
      if (patchIds.has(p.id)) errors.push(`dfd: patch id ${JSON.stringify(p.id)} is declared more than once`);
      patchIds.add(p.id);
      const named = [['guard', p.guard ? [p.guard] : []], ['closes', p.closes], ['rejects', p.rejects || []]];
      for (const [field, list] of named) {
        for (const pr of list) {
          if (!pairs.has(`${pr.from}\u0000${pr.to}`)) errors.push(`dfd: patches[${i}] (${JSON.stringify(p.id)}) ${field} names a flow ${JSON.stringify(pr.from)} -> ${JSON.stringify(pr.to)} that the document does not carry`);
        }
      }
      for (const fid of p.findings || []) {
        if (findingIds && !findingIds.has(fid)) errors.push(`dfd: patches[${i}] (${JSON.stringify(p.id)}) names finding ${JSON.stringify(fid)}, which "findings" does not declare`);
      }
    });
  }
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

// ── patches and threat paths ─────────────────────────────────────────────────────────────────────

const pairKey = (f) => `${f.from}\u0000${f.to}`;

/** The ids of the patches in force: `applied` when given (an iterable of ids), else every patch not marked applied:false. */
export function appliedPatches(model, applied) {
  if (applied !== undefined) return new Set(applied);
  return new Set((model.patches || []).filter((p) => p.applied !== false).map((p) => p.id));
}

/**
 * One verdict per flow, by index: { state, by, proven, exists }.
 *   fixed        every patch that names the flow in `closes` is in force; proven when all are `tested`
 *   safe         gate.state safe; proven only on runtime evidence
 *   unevaluated  gate.state unevaluated
 *   open         everything else, including a flow whose patches are not all in force
 * A flow a patch lists in `rejects` exists only while that patch is in force. `known`, when given, is
 * the set of flow indexes whose dated verdict (gate.commit) has been reached; an undated one always counts.
 */
export function stepStates(model, { applied, known } = {}) {
  const on = appliedPatches(model, applied);
  const closers = new Map();
  const rejecters = new Map();
  for (const p of model.patches || []) {
    for (const pr of p.closes) { const k = pairKey(pr); if (!closers.has(k)) closers.set(k, []); closers.get(k).push(p); }
    for (const pr of p.rejects || []) { const k = pairKey(pr); if (!rejecters.has(k)) rejecters.set(k, []); rejecters.get(k).push(p); }
  }
  return model.flows.map((f, i) => {
    const k = pairKey(f);
    const rj = rejecters.get(k);
    const exists = !rj || rj.some((p) => on.has(p.id));
    const by = closers.get(k) || [];
    if (by.length && by.every((p) => on.has(p.id))) return { state: 'fixed', by: by.map((p) => p.id), proven: by.every((p) => p.evidence && p.evidence.level === 'tested'), exists };
    // on a timeline a verdict measured at a later commit is not yet known: the step is unevaluated
    if (f.gate && f.gate.commit !== undefined && known && !known.has(i)) return { state: 'unevaluated', by: [], proven: false, exists };
    if (f.gate && f.gate.state === 'safe') return { state: 'safe', by: [], proven: !!f.gate.evidence && f.gate.evidence.level === 'runtime', exists };
    if (f.gate && f.gate.state === 'unevaluated') return { state: 'unevaluated', by: [], proven: false, exists };
    return { state: 'open', by: by.map((p) => p.id), proven: false, exists };
  });
}

const PATH_RANK = { open: 0, unevaluated: 1, closed: 2 };

/**
 * Every path from a source (an element nothing flows into) to an element with an `impact`, over
 * the directed flows that exist. A path is closed when any step on it is fixed or safe, decided by
 * the first such step; else unevaluated when any step is; else open. `byFlow[k]` is the worst state
 * of the paths through flow k, null when none runs through it. A walk never revisits an element,
 * so a cycle cannot lengthen a path. `truncated` is true when maxPaths cut the list: a count that
 * was cut is not a count.
 */
export function threatPaths(model, { applied, known, maxPaths = 500 } = {}) {
  const steps = stepStates(model, { applied, known });
  const out = new Map(model.nodes.map((n) => [n.id, []]));
  const fedInto = new Set();
  model.flows.forEach((f, k) => {
    if (!isDirected(f) || f.from === f.to || !steps[k].exists) return;
    out.get(f.from).push(k);
    fedInto.add(f.to);
  });
  const impact = new Map(model.nodes.filter((n) => n.impact).map((n) => [n.id, n.impact]));
  const paths = [];
  let truncated = false;
  const walk = (node, trail, seen) => {
    if (impact.has(node) && trail.length) {
      if (paths.length >= maxPaths) { truncated = true; return; }
      const closing = trail.find((k) => steps[k].state === 'fixed' || steps[k].state === 'safe');
      const unmeasured = trail.find((k) => steps[k].state === 'unevaluated');
      const decidedBy = closing !== undefined ? closing : unmeasured !== undefined ? unmeasured : null;
      paths.push({
        nodes: [model.flows[trail[0]].from, ...trail.map((k) => model.flows[k].to)],
        flows: trail.slice(),
        impact: impact.get(node),
        state: closing !== undefined ? 'closed' : unmeasured !== undefined ? 'unevaluated' : 'open',
        decidedBy,
        proven: closing !== undefined && steps[closing].proven,
      });
    }
    for (const k of out.get(node)) {
      const to = model.flows[k].to;
      if (seen.has(to) || truncated) continue;
      seen.add(to);
      trail.push(k);
      walk(to, trail, seen);
      trail.pop();
      seen.delete(to);
    }
  };
  for (const n of model.nodes) if (!fedInto.has(n.id) && out.get(n.id).length) walk(n.id, [], new Set([n.id]));
  const byFlow = model.flows.map(() => null);
  for (const p of paths) for (const k of p.flows) if (byFlow[k] === null || PATH_RANK[p.state] < PATH_RANK[byFlow[k]]) byFlow[k] = p.state;
  return { steps, paths, byFlow, truncated };
}

/**
 * The same verdicts as threatPaths without listing paths, for a model too large to enumerate: every
 * search is one pass over the flows. A source is an element nothing flows into; an end is an element
 * with an `impact`.
 *
 *   byFlow[k]   open when flow k lies on a source-to-impact route made only of open steps;
 *               unevaluated when it lies on one made of open and unevaluated steps; closed when it
 *               lies on a route at all; null when no route runs through it
 *   impacts[]   one row per impact element a source can reach: its state (the worst route into it),
 *               `proven` (closed, and still unreachable when every unproven fixed or safe step is
 *               treated as open), and one shortest witness route in that state
 *
 * It agrees with threatPaths on every flow and impact; threatPaths adds the list of paths.
 * `via(flow, index)`, when given, says which flows the search may use at all: taintOnly keeps the
 * flows a value was traced along, so a module-level call site cannot stand in for a trace.
 */
export function pathStates(model, { applied, known, via } = {}) {
  const steps = stepStates(model, { applied, known });
  const n = model.nodes.length;
  const ix = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  const fwd = Array.from({ length: n }, () => []);
  const back = Array.from({ length: n }, () => []);
  const fed = new Array(n).fill(false);
  const usable = (f, k) => isDirected(f) && f.from !== f.to && steps[k].exists && (!via || via(f, k));
  model.flows.forEach((f, k) => {
    if (!usable(f, k)) return;
    const a = ix.get(f.from);
    const b = ix.get(f.to);
    fwd[a].push([b, k]);
    back[b].push([a, k]);
    fed[b] = true;
  });
  const sources = [];
  const ends = [];
  model.nodes.forEach((nd, i) => { if (!fed[i] && fwd[i].length) sources.push(i); if (nd.impact) ends.push(i); });
  // which steps a search may cross, loosest last
  const LEVELS = [
    ['open', (st) => st.state === 'open'],
    ['unevaluated', (st) => st.state === 'open' || st.state === 'unevaluated'],
    ['unproven', (st) => st.state === 'open' || st.state === 'unevaluated' || !st.proven],
    ['closed', () => true],
  ];
  const reach = (starts, adj, pass) => {
    const seen = new Array(n).fill(false);
    const via = new Array(n).fill(-1);
    const queue = [];
    for (const s of starts) { seen[s] = true; queue.push(s); }
    for (let q = 0; q < queue.length; q++) {
      for (const [w, k] of adj[queue[q]]) {
        if (seen[w] || !pass(steps[k])) continue;
        seen[w] = true;
        via[w] = k;
        queue.push(w);
      }
    }
    return { seen, via };
  };
  const F = LEVELS.map(([, pass]) => reach(sources, fwd, pass));
  const B = LEVELS.map(([, pass]) => reach(ends, back, pass));
  const stateAt = (level) => (level === 0 ? 'open' : level === 1 ? 'unevaluated' : 'closed');
  const byFlow = model.flows.map((f, k) => {
    if (!usable(f, k)) return null;
    const a = ix.get(f.from);
    const b = ix.get(f.to);
    for (const level of [0, 1, 3]) if (LEVELS[level][1](steps[k]) && F[level].seen[a] && B[level].seen[b]) return stateAt(level);
    return null;
  });
  const isSource = new Array(n).fill(false);
  for (const s of sources) isSource[s] = true;
  const impacts = [];
  for (const t of ends) {
    const level = [0, 1, 3].find((l) => F[l].seen[t] && !isSource[t]);
    if (level === undefined) continue;
    const flows = [];
    for (let v = t; F[level].via[v] !== -1; v = ix.get(model.flows[F[level].via[v]].from)) flows.unshift(F[level].via[v]);
    impacts.push({
      node: model.nodes[t].id,
      impact: model.nodes[t].impact,
      state: stateAt(level),
      proven: level === 3 && !F[2].seen[t],
      witness: { nodes: [model.flows[flows[0]].from, ...flows.map((k) => model.flows[k].to)], flows },
    });
  }
  return { steps, byFlow, impacts, sources: sources.map((i) => model.nodes[i].id) };
}

// ── timeline ─────────────────────────────────────────────────────────────────────────────────────

const shaMatches = (a, b) => a.startsWith(b) || b.startsWith(a);

/**
 * A commit order (oldest first, as `git rev-list --reverse` prints it) -> the frames at which the
 * overlay changes. Frame 0 is the state before the first of them: no dated patch in force, no dated
 * verdict known. A patch is in force from the LAST of its commits; a verdict counts from gate.commit.
 * A patch or verdict with no commit is in force in every frame (it was never dated, so no frame can
 * place it), and one whose commit the order does not hold is listed in `unplaced` and left out of
 * every frame: a guess at where it landed would draw a history that did not happen.
 * Each frame: { commit, index, applied: [patch ids], known: [flow indexes], landed: { patches, verdicts } }.
 */
export function timeline(model, order) {
  const at = (sha) => order.findIndex((c) => shaMatches(c, sha));
  const patchAt = new Map();
  const gateAt = new Map();
  const always = { patches: [], verdicts: [] };
  const unplaced = { patches: [], verdicts: [] };
  for (const p of model.patches || []) {
    if (p.applied === false) continue;
    if (!p.commits || !p.commits.length) { always.patches.push(p.id); continue; }
    const where = p.commits.map(at);
    if (where.includes(-1)) unplaced.patches.push(p.id);
    else patchAt.set(p.id, Math.max(...where));
  }
  model.flows.forEach((f, k) => {
    if (!f.gate || f.gate.commit === undefined) return;
    const where = at(f.gate.commit);
    if (where === -1) unplaced.verdicts.push(k);
    else gateAt.set(k, where);
  });
  const stops = [...new Set([...patchAt.values(), ...gateAt.values()])].sort((a, b) => a - b);
  const frames = [{ commit: null, index: -1, applied: always.patches.slice(), known: [], landed: { patches: [], verdicts: [] } }];
  for (const stop of stops) {
    const landed = { patches: [...patchAt].filter(([, w]) => w === stop).map(([id]) => id), verdicts: [...gateAt].filter(([, w]) => w === stop).map(([k]) => k) };
    frames.push({
      commit: order[stop],
      index: stop,
      applied: [...always.patches, ...[...patchAt].filter(([, w]) => w <= stop).map(([id]) => id)],
      known: [...gateAt].filter(([, w]) => w <= stop).map(([k]) => k),
      landed,
    });
  }
  return { frames, unplaced };
}

/** One frame's verdicts: pathStates with that frame's patches in force and its dated verdicts known. */
export const frameStates = (model, frame) => pathStates(model, { applied: frame.applied, known: new Set(frame.known) });

/** A `via` for pathStates: only flows found by tracing a value (evidence.method taint). */
export const taintOnly = (flow) => !!flow.evidence && flow.evidence.method === 'taint';

/**
 * A `via` for everything a scanner reported: a value it traced (taint) or a rule it matched at a
 * place (pattern). The static pass's call sites (site) are left out.
 */
export const scannerOnly = (flow) => !!flow.evidence && (flow.evidence.method === 'taint' || flow.evidence.method === 'pattern');

/** A group's chain of ancestors, outermost first, ending with the group itself. For a VALID document. */
export function groupPath(model, groupId) {
  const parentOf = new Map((model.groups || []).map((g) => [g.id, g.parent]));
  const out = [];
  for (let at = groupId; at !== undefined && parentOf.has(at); at = parentOf.get(at)) out.unshift(at);
  return out;
}

/**
 * The flows `via(flow, index)` keeps and the elements they join, as a document of its own: the
 * taint-only view of a merged model is subgraph(model, taintOnly). Groups, findings and patches
 * that name nothing left in it are dropped, so the result still validates, and what was left out is
 * counted in source.omitted: a subset that does not say so reads as the whole system.
 */
export function subgraph(model, via) {
  const flows = model.flows.filter((f, k) => via(f, k));
  const used = new Set(flows.flatMap((f) => [f.from, f.to]));
  const nodes = model.nodes.filter((n) => used.has(n.id));
  const pairs = new Set(flows.map((f) => `${f.from}\u0000${f.to}`));
  const has = (pr) => pairs.has(`${pr.from}\u0000${pr.to}`);
  const groupsUsed = new Set();
  const parentOf = new Map((model.groups || []).map((g) => [g.id, g.parent]));
  for (const n of nodes) for (let at = n.group; at !== undefined && !groupsUsed.has(at); at = parentOf.get(at)) groupsUsed.add(at);
  const findings = (model.findings || []).filter((fd) => (fd.at.node !== undefined ? used.has(fd.at.node) : has(fd.at.flow)));
  const findingIds = new Set(findings.map((fd) => fd.id));
  const patches = (model.patches || []).filter((p) => p.closes.some(has)).map((p) => ({ ...p, closes: p.closes.filter(has),
    ...(p.guard && !has(p.guard) ? { guard: undefined } : {}), ...(p.rejects ? { rejects: p.rejects.filter(has) } : {}),
    ...(p.findings ? { findings: p.findings.filter((id) => !model.findings || findingIds.has(id)) } : {}) }));
  for (const p of patches) { if (p.guard === undefined) delete p.guard; }
  const { v, kind, title, source, ...rest } = model;
  return {
    v, kind, ...(title === undefined ? {} : { title }),
    source: { ...(source || { producer: 'authored' }),
      omitted: { ...((source && source.omitted) || {}), 'flows outside the subset': model.flows.length - flows.length, 'elements outside the subset': model.nodes.length - nodes.length } },
    ...rest,
    ...(model.findings ? { findings } : {}),
    ...(model.patches ? { patches } : {}),
    ...(model.groups ? { groups: model.groups.filter((g) => groupsUsed.has(g.id)) } : {}),
    nodes,
    flows,
  };
}
