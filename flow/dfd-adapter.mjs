// flow/dfd-adapter.mjs — the adapters that build a dfd@1 model (lib/dfd.mjs) from what this
// repository measures: the flow graph (flow/graph.mjs, with flow-reconcile.json beside it) and the
// CodeQL code-flow records of a scanned repository (cra/dataflow-evidence.mjs).
//
// They live in flow/ and not in lib/: lib/ ships and must stand alone, and the flow-graph adapter
// needs flow/static.mjs's idea of a test module. fromCodeFlows needs nothing from flow/; it is here
// beside its sibling because it consumes cra/dataflow-evidence.mjs's record shape and nothing else,
// so moving it to cra/ the day an installed command must draw a scanned repository is a file move.
//
// Pure functions. Nothing reads the clock, the environment or the disk.

import { DFD_VERSION } from '../lib/dfd.mjs';
import { isTestModule } from './static.mjs';
import { edgeKey } from './graph.mjs';

// ── layer maps ───────────────────────────────────────────────────────────────────────────────────

/**
 * A layer map assigns a maturity layer to a path: { layers: [names, in maturity order], rules:
 * [{ prefix | glob, layer }] }. Rules are tried in order and the first match wins; a path no rule
 * matches has no layer. A glob is `*` (within one segment), `**` (any depth, `**\/` also none) and
 * `?` (one character). -> { ok, errors }, fail-closed: an unknown field is an error, not a skip.
 */
export function validateLayerMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { ok: false, errors: ['layer map: not an object'] };
  for (const k of Object.keys(map)) if (!['$comment', 'v', 'kind', 'layers', 'rules'].includes(k)) errors.push(`layer map: unknown field ${JSON.stringify(k)}`);
  if (map.v !== undefined && map.v !== 1) errors.push('layer map: v must be 1');
  if (map.kind !== undefined && map.kind !== 'dfd-layers') errors.push('layer map: kind must be "dfd-layers"');
  const layers = Array.isArray(map.layers) ? map.layers : null;
  if (!layers || layers.length === 0 || !layers.every((l) => typeof l === 'string' && l.length > 0)) errors.push('layer map: layers must be a non-empty array of names');
  else if (new Set(layers).size !== layers.length) errors.push('layer map: a layer is declared more than once');
  if (!Array.isArray(map.rules) || map.rules.length === 0) errors.push('layer map: rules must be a non-empty array');
  else {
    map.rules.forEach((r, i) => {
      const keys = r && typeof r === 'object' ? Object.keys(r) : [];
      const extra = keys.filter((k) => !['prefix', 'glob', 'layer', 'why'].includes(k));
      if (extra.length) errors.push(`layer map: rules[${i}] has unknown field(s) ${extra.join(', ')}`);
      const has = ['prefix', 'glob'].filter((k) => typeof r?.[k] === 'string' && r[k].length > 0);
      if (has.length !== 1) errors.push(`layer map: rules[${i}] needs exactly one of prefix and glob`);
      if (layers && !layers.includes(r?.layer)) errors.push(`layer map: rules[${i}] names layer ${JSON.stringify(r?.layer)}, which "layers" does not declare`);
    });
  }
  return { ok: errors.length === 0, errors };
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const compiled = new WeakMap();
const regexOf = (rule) => { if (!compiled.has(rule)) compiled.set(rule, globToRegExp(rule.glob)); return compiled.get(rule); };

/** -> the layer of `path` under `map`, or undefined. `map` may be a whole layer map or its rules. */
export function layerOf(path, map) {
  const rules = Array.isArray(map) ? map : map.rules;
  const hit = rules.find((r) => (r.prefix !== undefined ? path.startsWith(r.prefix) : regexOf(r).test(path)));
  return hit ? hit.layer : undefined;
}

// ── the flow-graph adapter ───────────────────────────────────────────────────────────────────────

// A spawn target the static pass captured is the first argument of exec/spawn AS WRITTEN. `exec` is
// also a database method, so SQL text arrives here as a "process". Only a single token that reads as
// a command name is drawn as an external entity; the rest are counted and left out.
const COMMAND_NAME = /^[A-Za-z0-9_@.+/-]+$/;
const SYNC_VERB = /Sync$/;
const verbOf = (ref) => String(ref).split(' ').pop();
const SCHEDULERS = { launchd: 'launchd agent', workflow: 'workflow schedule', cron: 'crontab', timer: 'in-process timer', watch: 'file watcher' };
const RESOLVED = { reads: 'reads', read: 'reads', writes: 'writes', write: 'writes', both: 'both' };

/**
 * Flow graph (flow/graph.mjs) -> dfd@1. The mapping:
 *
 *   module            -> process    group = first path segment; unanalysable modules marked unknown
 *   artifact, store   -> store      subtype file; subtype log when one module appends to it and
 *                                   another tails it; a bare-filename node is marked unknown unless
 *                                   the reconcile's observedPaths names where it lives. A path that
 *                                   is also a module is that module's process, not a second element
 *   database          -> store      subtype database; table names go into the flow label
 *   env               -> external   subtype env
 *   endpoint          -> external   subtype endpoint (`<scheme>://<host>[:<port>]` or `listen:<port>`)
 *   scheduler         -> external   subtype scheduler (launchd, workflow schedule, cron, timer, watch)
 *   process (spawn)   -> external   subtype binary, when the target reads as a command name;
 *                                   -> the module's own process when the target is a module path;
 *                                   otherwise omitted and counted
 *   reads  M <- X     -> flow X -> M    (tail:true from a log: async, "tails")
 *   writes M -> X     -> flow M -> X    (append:true: "appends"; async into a log)
 *   spawns M -> P     -> flow M -> P, async unless every witness is a *Sync call; to the script's
 *                        process when the spawn names one (`node <script>`), not to `node`; omitted
 *                        and counted when every witness is a bare `exec`
 *   connects M -> E   -> flow M -> E   listens M -- E -> flow E -> M: a listener is fed from outside
 *   triggers S -> M   -> flow S -> M, mode event
 *   touches M -- X    -> flow M -- X, directed:false; with a runtime direction, directed and
 *                        carrying `direction` (both: one flow each way)
 *   reads  M <- M'    -> an import: a code dependency, not a data flow. Omitted and counted unless
 *                        include.imports.
 *
 * `reconcile` is flow-reconcile.json: a reconcile edge for the same from|to|kind replaces the edge's
 * witness and existence, and the flow's `existence` is the adapter's verdict, confirmed only when
 * that existence is. Nodes left with no flow are omitted and counted. `layers` is a layer map (see
 * validateLayerMap) applied to the label of every process and store.
 */
export function fromFlowGraph(graph, { reconcile = null, layers = null, include = {}, tests, imports, title } = {}) {
  const keepTests = include.tests ?? tests ?? false;
  const keepImports = include.imports ?? imports ?? false;
  // a bare rule list declares its layers in the order the rules first name them
  const layerMap = !layers ? null : Array.isArray(layers) ? { layers: [...new Set(layers.map((r) => r?.layer))], rules: layers } : layers;
  if (layerMap) {
    const v = validateLayerMap(layerMap);
    if (!v.ok) throw new Error(`dfd-adapter: ${v.errors.join('; ')}`);
  }
  const withLayer = (node) => {
    if (!layerMap || node.kind === 'external') return node;
    const layer = layerOf(node.label, layerMap);
    return layer === undefined ? node : { ...node, layer };
  };

  const src = new Map(graph.nodes.map((n) => [n.id, n]));
  const modulePaths = new Set(graph.nodes.filter((n) => n.kind === 'module').map((n) => n.path));
  const recEdges = new Map(((reconcile && reconcile.edges) || []).map((e) => [edgeKey(e.from, e.to, e.kind), e]));
  const observed = (reconcile && reconcile.observedPaths) || {};
  const appended = new Set(graph.edges.filter((e) => e.kind === 'writes' && e.append === true).map((e) => e.to));
  const tailed = new Set(graph.edges.filter((e) => e.kind === 'reads' && e.tail === true).map((e) => e.to));
  const logs = new Set([...appended].filter((id) => tailed.has(id)));

  const omitted = { testModules: 0, importEdges: 0, spawnTargetsNotCommands: 0, ambiguousExecEdges: 0, edgesOfOmittedNodes: 0, isolatedNodes: 0, selfReferences: 0, unknownNodeKinds: 0, unknownEdgeKinds: 0 };
  const merged = { pathsThatAreModules: 0, storesRenamed: 0, storesSplit: 0, directionsResolved: 0, reconcileMatched: 0 };
  const mapped = new Map();   // graph node id -> [dfd node]: a split store maps to several

  const fileStore = (n) => {
    const subtype = logs.has(n.id) ? 'log' : 'file';
    const base = { kind: 'store', subtype };
    const paths = n.composed ? [].concat(observed[n.path] ?? observed[n.id] ?? []) : [];
    if (n.composed && paths.length === 1) {
      merged.storesRenamed++;
      return [{ id: n.id, ...base, label: paths[0], note: `bare filename ${n.path}: the runtime opened it at ${paths[0]}` }];
    }
    if (n.composed && paths.length > 1) {
      merged.storesSplit++;
      return paths.map((p) => ({ id: `${n.id}@${p}`, ...base, label: p,
        note: `bare filename ${n.path}: one of ${paths.length} paths the runtime opened under that name; which module used which path was not observed` }));
    }
    return [{ id: n.id, ...base, label: n.path,
      ...(n.composed ? { unknown: true, note: 'bare filename: a name, not a location — several files may share this node' } : {}) }];
  };

  const mapNode = (n) => {
    switch (n.kind) {
      case 'module': {
        if (!keepTests && isTestModule(n.path)) { omitted.testModules++; return []; }
        const unknown = n.analysis !== undefined && n.analysis !== 'analysed';
        return [{ id: n.id, kind: 'process', label: n.path, group: n.path.includes('/') ? n.path.split('/')[0] : '(root)',
          ...(unknown ? { unknown: true, note: `not analysed (${n.analysis}): its flows are unknown, not absent` } : {}) }];
      }
      case 'artifact':
      case 'store':
        if (modulePaths.has(n.path)) { merged.pathsThatAreModules++; return mapped.get(`node:module:${n.path}`); }
        return fileStore(n);
      case 'database': return [{ id: n.id, kind: 'store', label: n.path, subtype: 'database' }];
      case 'env': return [{ id: n.id, kind: 'external', label: n.path, subtype: 'env' }];
      case 'endpoint': return [{ id: n.id, kind: 'external', label: n.path, subtype: 'endpoint', ...(n.path.startsWith('listen:') ? { note: `a port this tree listens on (${n.path.slice(7)})` } : {}) }];
      case 'scheduler': {
        const how = SCHEDULERS[n.path.split(':')[0]];
        return [{ id: n.id, kind: 'external', label: n.path, subtype: 'scheduler', ...(how ? { note: how } : {}) }];
      }
      case 'process':
        if (modulePaths.has(n.path)) return mapped.get(`node:module:${n.path}`);
        if (COMMAND_NAME.test(n.path)) return [{ id: n.id, kind: 'external', label: n.path, subtype: 'binary' }];
        omitted.spawnTargetsNotCommands++;
        return [];
      default:
        omitted.unknownNodeKinds++;
        return [];
    }
  };
  // modules first: a spawn target or a path literal that names a module resolves to its process
  for (const n of graph.nodes) if (n.kind === 'module') mapped.set(n.id, mapNode(n));
  for (const n of graph.nodes) if (n.kind !== 'module') mapped.set(n.id, mapNode(n));

  const flows = [];
  const add = (from, to, f) => {
    for (const a of from) for (const b of to) {
      if (a.id === b.id) { omitted.selfReferences++; continue; }
      const split = from.length > 1 || to.length > 1;
      flows.push({ from: a.id, to: b.id, ...f, ...(split ? { existence: 'unknown' } : {}) });
    }
  };
  const tables = (e) => (Array.isArray(e.tables) && e.tables.length ? ` ${e.tables.join(', ')}` : '');

  for (const e of graph.edges) {
    let from = mapped.get(e.from);
    let to = mapped.get(e.to);
    if (e.kind === 'spawns' && typeof e.script === 'string' && modulePaths.has(e.script)) to = mapped.get(`node:module:${e.script}`);
    if (!from || !to || from.length === 0 || to.length === 0) { omitted.edgesOfOmittedNodes++; continue; }
    const rec = recEdges.get(edgeKey(e.from, e.to, e.kind));
    if (rec) merged.reconcileMatched++;
    const refs = [].concat(e.evidence || []);
    const evidence = { witness: rec?.witness ?? e.witness, existence: rec?.existence ?? e.existence, refs };
    const base = { evidence, existence: evidence.existence === 'confirmed' ? 'confirmed' : 'unknown' };
    const toKind = src.get(e.to)?.kind;
    if (e.kind === 'reads') {
      if (toKind === 'module') {
        if (!keepImports) { omitted.importEdges++; continue; }
        add(to, from, { label: 'imports', mode: 'sync', ...base });
      } else if (e.tail === true && logs.has(e.to)) add(to, from, { label: 'tails', mode: 'async', ...base });
      else add(to, from, { label: `reads${tables(e)}`, mode: 'sync', ...base });
    } else if (e.kind === 'writes') {
      if (e.append === true) add(from, to, { label: 'appends', mode: logs.has(e.to) ? 'async' : 'sync', ...base });
      else add(from, to, { label: `writes${tables(e)}`, mode: 'sync', ...base });
    } else if (e.kind === 'spawns') {
      // a bare `exec` is child_process.exec or a database handle's exec: the witness cannot say which
      if (refs.length > 0 && refs.every((r) => verbOf(r) === 'exec')) { omitted.ambiguousExecEdges++; continue; }
      const sync = refs.length > 0 && refs.every((r) => SYNC_VERB.test(verbOf(r)));
      const label = typeof e.script === 'string' && !modulePaths.has(e.script) ? `spawns ${e.script}` : 'spawns';
      add(from, to, { label, mode: sync ? 'sync' : 'async', ...base });
    } else if (e.kind === 'connects') add(from, to, { label: 'connects', mode: 'sync', ...base });
    else if (e.kind === 'listens') {
      const moduleFirst = src.get(e.from)?.kind === 'module';
      add(moduleFirst ? to : from, moduleFirst ? from : to, { label: 'listens', mode: 'sync', ...base });
    } else if (e.kind === 'triggers') {
      const schedFirst = src.get(e.from)?.kind === 'scheduler';
      add(schedFirst ? from : to, schedFirst ? to : from, { label: 'triggers', mode: 'event', ...base });
    } else if (e.kind === 'touches') {
      const direction = RESOLVED[rec?.direction];
      if (!direction) { add(from, to, { label: 'touches', mode: 'sync', directed: false, ...base }); continue; }
      merged.directionsResolved++;
      if (direction !== 'writes') add(to, from, { label: 'reads', mode: 'sync', direction, ...base });
      if (direction !== 'reads') add(from, to, { label: 'writes', mode: 'sync', direction, ...base });
    } else omitted.unknownEdgeKinds++;
  }

  const used = new Set(flows.flatMap((f) => [f.from, f.to]));
  const nodes = [];
  const seen = new Set();
  for (const list of mapped.values()) {
    for (const m of list || []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (used.has(m.id)) nodes.push(withLayer(m));
      else omitted.isolatedNodes++;
    }
  }
  return {
    v: DFD_VERSION,
    kind: 'dfd',
    title: title || 'flow graph',
    source: {
      producer: 'flow-graph',
      graph: { v: graph.v ?? null, generatedAt: graph.generatedAt ?? null, nodes: graph.nodes.length, edges: graph.edges.length },
      options: {
        tests: keepTests, imports: keepImports,
        reconcile: reconcile ? { edges: recEdges.size, generatedAt: reconcile.generatedAt ?? null } : null,
        layers: layerMap ? layerMap.rules.length : null,
        merged,
      },
      omitted,
    },
    ...(layerMap ? { layers: [...layerMap.layers] } : {}),
    nodes,
    flows,
  };
}

// ── the code-flow adapter ────────────────────────────────────────────────────────────────────────

// What a sink IS, read from the CodeQL rule id. Ordered: the first match wins. A rule no pattern
// names gets an external `system` marked unknown — the rule id did not say what the sink is.
const SINKS = [
  [/sql|nosql/, { kind: 'store', subtype: 'database', label: 'database query' }],
  [/log-injection/, { kind: 'store', subtype: 'log', label: 'log' }],
  [/path-injection|tainted-path|zipslip|file-system|file-access|file-write/, { kind: 'store', subtype: 'file', label: 'file system' }],
  [/command|shell|exec/, { kind: 'external', subtype: 'binary', label: 'operating-system command' }],
  [/request-forgery|ssrf|redirect/, { kind: 'external', subtype: 'endpoint', label: 'outbound request' }],
  [/xss|html|dom/, { kind: 'external', subtype: 'actor', label: 'browser that renders the response' }],
  [/code-injection|eval|deserial|prototype/, { kind: 'external', subtype: 'system', label: 'interpreter' }],
];
export const sinkKindOf = (rule) => {
  const hit = SINKS.find(([re]) => re.test(String(rule || '').toLowerCase()));
  return hit ? { ...hit[1], category: hit[1].label } : { kind: 'external', subtype: 'system', label: 'unclassified sink', category: 'unclassified sink', unknown: true };
};
const at = (end) => `${end.file}:${end.line}`;

/**
 * cra/dataflow-evidence.mjs records (dataflowFromResult rows: { repo, rule, file, reachability, path:
 * { steps, flows, source: { file, line, expr }, sink: { file, line, expr } } }) -> dfd@1.
 *
 *   source            -> external actor, one per repo and source location: the untrusted input
 *   source file       -> process (group: the repo)
 *   sink file         -> process, when it is not the source file
 *   sink              -> store or external by what the rule says the sink is (sinkKindOf), one per
 *                        repo and kind
 *   flows             -> input -> source file -> sink file -> sink; the source-to-sink hop carries
 *                        the step count and the rule
 *
 * A record carries the trace's two ends and its length, not the steps between: those are dropped by
 * pathOf. A step in a third file is therefore not drawn. A record without a path (`reachability_
 * unknown`: the query never looked) draws nothing and is counted. Every flow is a static trace, so
 * its existence is unknown: CodeQL proves data CAN reach the sink, and no runtime saw it do so.
 */
export function fromCodeFlows(records, { title } = {}) {
  const omitted = { noPath: 0, unreadable: 0 };
  const nodes = new Map();
  const groups = new Map();
  const flows = new Map();
  const node = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  const flow = (from, to, label, ref) => {
    const key = JSON.stringify([from, to, label]);
    if (!flows.has(key)) flows.set(key, { from, to, label, mode: 'sync', existence: 'unknown', evidence: { witness: 'static', existence: 'unknown', refs: [] } });
    const refs = flows.get(key).evidence.refs;
    if (!refs.includes(ref)) refs.push(ref);
  };
  for (const r of records || []) {
    const p = r?.path;
    if (!r || typeof r.repo !== 'string' || !r.rule) { omitted.unreadable++; continue; }
    if (r.reachability !== 'reachable' || !p?.source?.file || !p?.sink?.file) { omitted.noPath++; continue; }
    const group = `repo:${r.repo}`;
    if (!groups.has(group)) groups.set(group, { id: group, label: r.repo, boundary: 'system' });
    if (!groups.has('untrusted')) groups.set('untrusted', { id: 'untrusted', label: 'Untrusted input', boundary: 'trust' });
    const input = node({ id: `input:${r.repo}:${at(p.source)}`, kind: 'external', subtype: 'actor', label: p.source.expr ? `${p.source.expr} (${at(p.source)})` : at(p.source), group: 'untrusted',
      note: `a source CodeQL treats as untrusted in ${r.repo}` });
    const code = (file) => node({ id: `code:${r.repo}:${file}`, kind: 'process', label: file, group });
    const s = sinkKindOf(r.rule);
    const sink = node({ id: `sink:${r.repo}:${s.category}`, kind: s.kind, subtype: s.subtype, label: s.label,
      ...(s.unknown ? { unknown: true, note: `the rule id ${r.rule} does not say what its sink is` } : { note: `sink of ${r.repo}'s ${s.category} rules` }) });
    const ref = `${r.rule} ${at(p.source)} -> ${at(p.sink)}`;
    const first = code(p.source.file);
    flow(input, first, p.source.expr || 'untrusted input', ref);
    let last = first;
    if (p.sink.file !== p.source.file) { last = code(p.sink.file); flow(first, last, `${p.steps} steps (${r.rule})`, ref); }
    flow(last, sink, p.sink.expr ? `${p.sink.expr} (${r.rule})` : r.rule, ref);
  }
  return {
    v: DFD_VERSION,
    kind: 'dfd',
    title: title || 'code flows',
    source: {
      producer: 'codeql-code-flows',
      note: 'CodeQL taint traces (cra/dataflow-evidence.mjs): static proofs that data can reach a sink, not runtime observations. A record holds its two ends, so a step in a third file is not drawn.',
      omitted,
    },
    groups: [...groups.values()],
    nodes: [...nodes.values()],
    flows: [...flows.values()],
  };
}
