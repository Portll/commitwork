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

// What a sink IS, read from the CodeQL rule id, and how bad reaching it is (`impact`, which
// lib/dfd.mjs pathStates walks to). Ordered: the first match wins. A rule no pattern
// names gets an external `system` marked unknown — the rule id did not say what the sink is.
const SINKS = [
  [/sql|nosql/, { kind: 'store', subtype: 'database', label: 'database query', impact: 'high' }],
  [/log-injection/, { kind: 'store', subtype: 'log', label: 'log', impact: 'low' }],
  [/path-injection|tainted-path|zipslip|file-system|file-access|file-write/, { kind: 'store', subtype: 'file', label: 'file system', impact: 'high' }],
  [/command|shell|exec/, { kind: 'external', subtype: 'binary', label: 'operating-system command', impact: 'critical' }],
  [/request-forgery|ssrf|redirect/, { kind: 'external', subtype: 'endpoint', label: 'outbound request', impact: 'medium' }],
  [/xss|html|(?:^|[/-])dom(?:-|$)/, { kind: 'external', subtype: 'actor', label: 'browser that renders the response', impact: 'medium' }],
  [/code-injection|eval|deserial|prototype|bad-code-sanitization/, { kind: 'external', subtype: 'system', label: 'interpreter', impact: 'critical' }],
  // Rules that match code and trace no value. What is at risk is read from the rule's name, as above.
  [/redos|regex/, { kind: 'external', subtype: 'system', label: 'regular expression engine (availability)', impact: 'medium' }],
  [/certificate|insecure-transport|tls/, { kind: 'external', subtype: 'endpoint', label: 'peer whose identity is not checked', impact: 'high' }],
  [/clear-?text/, { kind: 'store', subtype: 'log', label: 'log or store holding a secret', impact: 'medium' }],
  [/password-hash|weak-crypto|insufficient-key|insecure-randomness|hardcoded-credential/, { kind: 'store', subtype: 'database', label: 'stored secret or credential', impact: 'high' }],
  [/sanitiz|escap|tag-filter/, { kind: 'external', subtype: 'system', label: 'reader of text meant to be escaped', impact: 'medium' }],
];
export const sinkKindOf = (rule) => {
  const hit = SINKS.find(([re]) => re.test(String(rule || '').toLowerCase()));
  return hit ? { ...hit[1], category: hit[1].label } : { kind: 'external', subtype: 'system', label: 'unclassified sink', category: 'unclassified sink', impact: 'medium', unknown: true };
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
 * pathOf. A step in a third file is therefore not drawn — unless the record carries `path.trace`
 * (traceOf: every step) and the caller passes `functionOf(file, line)`: then each step is placed in
 * its function ({ name, kind } , null for module level, undefined when the file could not be read),
 * one process per function, grouped by file, and the trace is drawn hop by hop. A step whose file
 * could not be read falls back to the file's own element and is counted in omitted.noFunction.
 *
 * A record without a path (`reachability_unknown`: the rule traces no value, so the query never
 * looked) is drawn at its place: `input not traced` (an origin marked unknown) -> the element of
 * the record's file, or of the function its line sits in -> the rule's sink. Both flows carry
 * evidence.method `pattern`. Leaving these out drew only what a taint query can say, and a rule
 * about a regular expression, a TLS option or an escape has no taint to report. Only a record with
 * neither a path nor a file draws nothing, and is counted (noPath). Every flow is static, so its
 * existence is unknown: CodeQL proves data CAN reach the sink, and no runtime saw it do so.
 */
export function fromCodeFlows(records, { title, functionOf = null } = {}) {
  const omitted = { noPath: 0, unreadable: 0, ...(functionOf ? { noFunction: 0 } : {}) };
  const nodes = new Map();
  const groups = new Map();
  const flows = new Map();
  const node = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  const flow = (from, to, label, ref, method = 'taint') => {
    const key = JSON.stringify([from, to, label]);
    if (!flows.has(key)) flows.set(key, { from, to, label, mode: 'sync', existence: 'unknown', evidence: { witness: 'static', method, existence: 'unknown', refs: [] } });
    const refs = flows.get(key).evidence.refs;
    if (!refs.includes(ref)) refs.push(ref);
  };
  for (const r of records || []) {
    const p = r?.path;
    if (!r || typeof r.repo !== 'string' || !r.rule) { omitted.unreadable++; continue; }
    const traced = r.reachability === 'reachable' && !!p?.source?.file && !!p?.sink?.file;
    // a result with neither a traced path nor a place has nothing to draw
    if (!traced && !r.file) { omitted.noPath++; continue; }
    const group = `repo:${r.repo}`;
    if (!groups.has(group)) groups.set(group, { id: group, label: r.repo, boundary: 'system' });
    const code = (file) => node({ id: `code:${r.repo}:${file}`, kind: 'process', label: file, group });
    // one process per function; a step whose file cannot be read falls back to the file's element
    const place = (st, fallback) => {
      const fn = st.file ? functionOf(st.file, st.line) : undefined;
      if (fn === undefined) { omitted.noFunction++; return code(st.file || fallback); }
      const fileGroup = `file:${r.repo}:${st.file}`;
      if (!groups.has(fileGroup)) groups.set(fileGroup, { id: fileGroup, label: st.file, boundary: 'system' });
      return node({ id: `fn:${r.repo}:${st.file}#${fn ? fn.name : ''}`, kind: 'process', label: fn ? `${fn.name}()` : `${st.file} (module level)`, group: fileGroup,
        note: fn ? `${fn.kind} in ${st.file}` : `code outside any function in ${st.file}` });
    };
    const sinkOf = () => {
      const s = sinkKindOf(r.rule);
      return node({ id: `sink:${r.repo}:${s.category}`, kind: s.kind, subtype: s.subtype, label: s.label, impact: s.impact,
        ...(s.unknown ? { unknown: true, note: `the rule id ${r.rule} does not say what its sink is` } : { note: `sink of ${r.repo}'s ${s.category} rules` }) });
    };
    if (!traced) {
      // A rule that matches code and traces no value (a regular expression, a TLS option, an
      // escape): it says what is weak and where, and nothing about which input arrives. Drawn at
      // its place, entered from an origin marked unknown, so the result is on the diagram and the
      // missing half of its evidence is too.
      if (!groups.has('untraced')) groups.set('untraced', { id: 'untraced', label: 'Reach not traced', boundary: 'trust' });
      const origin = node({ id: `input:${r.repo}:untraced`, kind: 'external', subtype: 'actor', label: 'input not traced', group: 'untraced', unknown: true,
        note: 'a rule that traces no value reported what sits behind this; which input reaches it was not searched for, so it is unknown, not absent' });
      const where = Number.isInteger(r.line) ? `${r.file}:${r.line}` : r.file;
      const ref = `${r.rule} ${where}`;
      const site = functionOf && Number.isInteger(r.line) ? place({ file: r.file, line: r.line }, r.file) : code(r.file);
      flow(origin, site, 'not traced', ref, 'pattern');
      flow(site, sinkOf(), r.rule, ref, 'pattern');
      continue;
    }
    if (!groups.has('untrusted')) groups.set('untrusted', { id: 'untrusted', label: 'Untrusted input', boundary: 'trust' });
    const input = node({ id: `input:${r.repo}:${at(p.source)}`, kind: 'external', subtype: 'actor', label: p.source.expr ? `${p.source.expr} (${at(p.source)})` : at(p.source), group: 'untrusted',
      note: `a source CodeQL treats as untrusted in ${r.repo}` });
    const ref = `${r.rule} ${at(p.source)} -> ${at(p.sink)}`;
    const trace = functionOf && Array.isArray(p.trace) && p.trace.length ? p.trace : null;
    let last;
    if (trace) {
      // consecutive steps in one function are one visit
      last = place(trace[0], p.source.file);
      flow(input, last, p.source.expr || 'untrusted input', ref);
      for (const st of trace.slice(1)) {
        const here = place(st, p.source.file);
        if (here !== last) { flow(last, here, st.expr || r.rule, ref); last = here; }
      }
    } else {
      const first = code(p.source.file);
      flow(input, first, p.source.expr || 'untrusted input', ref);
      last = first;
      if (p.sink.file !== p.source.file) { last = code(p.sink.file); flow(first, last, `${p.steps} steps (${r.rule})`, ref); }
    }
    flow(last, sinkOf(), p.sink.expr ? `${p.sink.expr} (${r.rule})` : r.rule, ref);
  }
  return {
    v: DFD_VERSION,
    kind: 'dfd',
    title: title || 'code flows',
    source: {
      producer: 'codeql-code-flows',
      note: 'CodeQL results (cra/dataflow-evidence.mjs). A taint trace is a static proof that data can reach a sink, not a runtime observation; a record holds its two ends, so a step in a third file is not drawn. A result of a rule that traces nothing is drawn at its place (evidence.method pattern), entered from an origin marked unknown.',
      omitted,
    },
    // with functions drawn every element sits in its file's group, and a repo group can be left empty
    groups: [...groups.values()].filter((g) => [...nodes.values()].some((n) => n.group === g.id)),
    nodes: [...nodes.values()],
    flows: [...flows.values()],
  };
}

// ── what the static pass could not read ─────────────────────────────────────────────────────────

const MAX_LISTED = 200;

/**
 * A flow graph's summary and modules -> the `source.unknown` block of its dfd@1 model, or null when
 * the graph carries neither (a hand-made graph). Unknown is never clean: every file the pass could
 * not read is counted by state, and named (the first MAX_LISTED, with the count of the rest);
 * languages it does not read are counted; call sites whose target could not be named are counted.
 * The adapter drops a process with no flow, so an unread module would otherwise vanish from the
 * drawing without trace.
 */
export function unknownOf(graph) {
  const s = graph?.summary;
  const mods = Array.isArray(graph?.modules) ? graph.modules : null;
  if (!s && !mods) return null;
  const unread = (mods || []).filter((m) => m.state !== 'analysed');
  const byState = {};
  for (const m of unread) byState[m.state] = (byState[m.state] || 0) + 1;
  return {
    files: s?.filesInput ?? mods.length,
    analysed: s?.analysed ?? (mods.length - unread.length),
    unanalysable: s?.unanalysable ?? unread.length,
    byState: s?.unanalysableByReason ?? byState,
    filesUnread: unread.slice(0, MAX_LISTED).map((m) => `${m.path}: ${m.state}${m.reason ? ` (${String(m.reason).split('\n')[0].slice(0, 200)})` : ''}`),
    filesUnreadNotListed: Math.max(0, unread.length - MAX_LISTED),
    unsupportedLanguages: s?.unsupportedLanguages ?? {},
    computedSites: s?.unanalysableSites ?? 0,
    computedSitesByKind: s?.unanalysableSitesByKind ?? {},
  };
}

// ── findings overlay ────────────────────────────────────────────────────────────────────────────

const SEVERITY_ALIAS = { critical: 'critical', crit: 'critical', high: 'high', medium: 'medium', med: 'medium', low: 'low', undetermined: 'undetermined', undet: 'undetermined' };

/**
 * Merge a findings overlay onto a dfd model.
 * - When `source` already carries anchored findings (items with an `at`), they ARE the overlay and
 *   replace model.findings — the dfd author placed them.
 * - Otherwise `source` is a facts ledger (a commitwork findings.json): the model's existing findings
 *   (each an `id` + an `at` placement, optionally a `status`) are ENRICHED by id with the ledger's
 *   cwe / severity / title. Placement and status stay with the dfd; the facts come from the ledger.
 */
export function fromFindings(model, source) {
  const items = Array.isArray(source) ? source : (source && Array.isArray(source.findings) ? source.findings : []);
  if (items.some((f) => f && f.at)) return { ...model, findings: items.filter((f) => f && f.at) };
  const byId = new Map(items.filter((f) => f && f.id !== undefined).map((f) => [f.id, f]));
  const findings = (model.findings || []).map((fd) => {
    const src = byId.get(fd.id);
    if (!src) return fd;
    const sev = fd.severity ?? SEVERITY_ALIAS[String(src.severity ?? src.sev ?? '').toLowerCase()];
    return { ...fd, cwe: fd.cwe ?? src.cwe, title: fd.title ?? src.title ?? src.name, ...(sev ? { severity: sev } : {}) };
  });
  return { ...model, findings };
}

// ── one drawing from two sources ────────────────────────────────────────────────────────────────

/** A path as a repository-relative POSIX path: no `file://`, no `./`, relative to `root` when inside. */
export function repoRelative(p, root = null) {
  let x = String(p || '').replace(/\\/g, '/');
  if (x.startsWith('file://')) { try { x = decodeURIComponent(new URL(x).pathname); } catch { x = x.slice(7); } }
  const r = root ? String(root).replace(/\\/g, '/').replace(/\/+$/, '') : null;
  // cra/dataflow-evidence.mjs findingFileOf strips `file:///` whole to join the rollup, so an absolute trace path arrives without its leading slash
  const bare = r ? r.replace(/^\/+/, '') : null;
  if (r && x.startsWith(`${r}/`)) x = x.slice(r.length + 1);
  else if (bare && x.startsWith(`${bare}/`)) x = x.slice(bare.length + 1);
  return x.replace(/^(\.\/)+/, '');
}

/**
 * The static pass's model and the CodeQL model of the same repository -> one dfd@1 model.
 *
 * MERGE RULE: a CodeQL process (one per file a trace starts or ends in) and a static process (one
 * per module) are the same element when their repository-relative paths are equal (repoRelative:
 * `file://` and `./` dropped, an absolute path under `root` made relative). The merged element is
 * the static one — its id, label and group — and every CodeQL flow that named the CodeQL process is
 * redirected to it. Every other element of either model is kept as it is; ids do not collide, the
 * two adapters using different prefixes. Flows are the union, each keeping its own evidence.
 * `source.merged` counts what matched.
 */
export function mergeModels(staticModel, codeModel, { root = null, title } = {}) {
  const byPath = new Map(staticModel.nodes.filter((n) => n.kind === 'process').map((n) => [repoRelative(n.label, root), n.id]));
  const redirect = new Map();
  for (const n of codeModel.nodes) {
    if (n.kind !== 'process') continue;
    const hit = byPath.get(repoRelative(n.label, root));
    if (hit) redirect.set(n.id, hit);
  }
  const to = (id) => redirect.get(id) || id;
  // The CodeQL model declares its groups and the static one does not; dfd@1 asks for all or none, so
  // each top-level directory the static adapter grouped by is declared as a system boundary.
  const groups = new Map([...(staticModel.groups || []), ...(codeModel.groups || [])].map((g) => [g.id, g]));
  for (const n of staticModel.nodes) if (n.group !== undefined && !groups.has(n.group)) groups.set(n.group, { id: n.group, label: n.group, boundary: 'system' });
  // a CodeQL repo group left with no element after the redirect is not drawn
  const nodes = [...staticModel.nodes, ...codeModel.nodes.filter((n) => !redirect.has(n.id))];
  const used = new Set(nodes.map((n) => n.group).filter(Boolean));
  return {
    v: DFD_VERSION,
    kind: 'dfd',
    title: title || staticModel.title,
    source: {
      producer: 'flow-graph+codeql-code-flows',
      note: 'The static pass (flow/static.mjs) over the repository, with the CodeQL taint traces of the same repository merged in: a CodeQL file and a static module are one element when their repository-relative paths are equal.',
      ...(staticModel.source?.graph ? { graph: staticModel.source.graph } : {}),
      options: { ...(staticModel.source?.options || {}), merged: { ...(staticModel.source?.options?.merged || {}), codeqlProcessesMatched: redirect.size, codeqlProcessesUnmatched: codeModel.nodes.filter((n) => n.kind === 'process').length - redirect.size } },
      omitted: { ...(staticModel.source?.omitted || {}), ...Object.fromEntries(Object.entries(codeModel.source?.omitted || {}).map(([k, v]) => [`codeql ${k}`, v])) },
      ...(staticModel.source?.unknown ? { unknown: staticModel.source.unknown } : {}),
    },
    ...(staticModel.layers ? { layers: staticModel.layers } : {}),
    ...(groups.size ? { groups: [...groups.values()].filter((g) => used.has(g.id)) } : {}),
    nodes,
    flows: [...staticModel.flows, ...codeModel.flows.map((f) => ({ ...f, from: to(f.from), to: to(f.to) }))],
  };
}

/** A rule's security-severity score in CVSS bands; no score is undetermined, never low. */
export const severityOf = (score) => (!Number.isFinite(score) ? 'undetermined' : score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low');

/**
 * Every scan result as an issue on the element of the file it sits in: -> { model, placed, added,
 * skipped }. The element is the static pass's module, else the code-flow adapter's file element;
 * a file with neither gets a module element of its own (`added`), marked as drawn for the result
 * alone, in the group named after its top directory when the model has one. A record with no rule
 * or no file is `skipped`. Status is undetermined: a result is a scanner's claim, not a verdict.
 */
export function issuesFromRecords(model, records, { prefix = 'CQ' } = {}) {
  const ids = new Set(model.nodes.map((n) => n.id));
  const groups = new Set((model.groups || []).map((g) => g.id));
  const taken = new Set((model.findings || []).map((f) => f.id));
  const nodes = [...model.nodes];
  const findings = [...(model.findings || [])];
  let added = 0;
  let skipped = 0;
  let n = 0;
  for (const r of records || []) {
    if (!r || !r.rule || !r.file) { skipped++; continue; }
    let node = [`node:module:${r.file}`, `code:${r.repo}:${r.file}`].find((id) => ids.has(id));
    if (!node) {
      node = `node:module:${r.file}`;
      const top = String(r.file).split('/')[0];
      nodes.push({ id: node, kind: 'process', label: r.file, ...(groups.has(top) ? { group: top } : {}), note: 'no data flow was found for this module; it is drawn because a scan result sits in it' });
      ids.add(node);
      added++;
    }
    let id;
    do { n++; id = `${prefix}-${String(n).padStart(2, '0')}`; } while (taken.has(id));
    taken.add(id);
    const steps = (r.path && Array.isArray(r.path.trace) ? r.path.trace : []).filter((st) => st.file && Number.isInteger(st.line)).map((st) => ({ file: st.file, line: st.line, ...(st.expr ? { expr: st.expr } : {}) }));
    const source = { tool: 'codeql', rule: r.rule, file: r.file, ...(Number.isInteger(r.line) ? { line: r.line } : {}), ...(r.message ? { message: r.message } : {}), ...(steps.length ? { steps } : {}) };
    findings.push({ id, at: { node }, title: `${r.rule} at ${r.file}${Number.isInteger(r.line) ? `:${r.line}` : ''}`, severity: severityOf(r.securitySeverity), status: 'undetermined', ...(r.cwe ? { cwe: r.cwe } : {}), source });
  }
  return { model: { ...model, nodes, findings }, placed: findings.length - (model.findings || []).length, added, skipped };
}

/** What a remediation verdict makes of an issue's status. Not resolved leaves it as it was. */
const VERDICT_STATUS = { fixed: 'mitigated', hardened: 'dismissed', 'not-a-defect': 'dismissed', 'not a defect': 'dismissed', dismissed: 'dismissed' };
const VERDICT_WORD = { fixed: 'Fixed', hardened: 'Hardened' };
const AXES = ['source', 'flow', 'sink', 'transport', 'privilege', 'containment'];
const CLASSES = ['secret', 'identifier', 'public', 'untrusted-input', 'configuration'];

/**
 * Remediation verdicts onto a model's issues: -> { model, applied, unmatched, ignored }.
 * A verdict is { id | (rule, file[, line]), verdict: fixed | not-a-defect | not-resolved, reason? };
 * one with a reason and no verdict is a dismissal (the shape of a dismissals file). It is matched by
 * issue id, else by the scanner's rule, file and line. `fixed` becomes status mitigated and
 * `not-a-defect` becomes dismissed, the reason kept in the issue's note with the verdict's own
 * word in front; neither is a rescan, and the note says so. A verdict naming no issue is
 * `unmatched`; one with a verdict this does not know, or not-resolved, is `ignored` and changes
 * nothing. A verdict's `controls` ({ axis, what, where?, test? }) and `dataClass` are kept on the
 * issue when they are well formed; a control on no known axis, or with nothing said, is dropped and
 * counted in `ignored`. `hardened` is a dismissal that claims controls: whether they are enough is
 * read from the controls, not from the word. `prs` are pull requests to add to the model (playback
 * steps through them); a verdict's `pr` names the one that carries the ruling and is kept only when
 * it is declared.
 */
export function applyVerdicts(model, verdicts, { prs = null } = {}) {
  const findings = (model.findings || []).map((f) => ({ ...f }));
  // the pull requests a verdict may name: the model's own, then the file's, first id wins
  const prList = [...(model.prs || [])];
  for (const p of Array.isArray(prs) ? prs : []) if (p && typeof p.id === 'string' && p.id && !prList.some((q) => q.id === p.id)) prList.push(p);
  const prIds = new Set(prList.map((p) => p.id));
  const byId = new Map(findings.map((f) => [f.id, f]));
  const bySource = (v) => findings.find((f) => f.source && f.source.rule === v.rule && f.source.file === v.file && (!Number.isInteger(v.line) || f.source.line === v.line));
  let applied = 0;
  const unmatched = [];
  const ignored = [];
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    if (!v || typeof v !== 'object') { ignored.push(v); continue; }
    const word = v.verdict === undefined && v.reason ? 'not-a-defect' : String(v.verdict || '').toLowerCase();
    const status = VERDICT_STATUS[word];
    if (!status) { ignored.push(v.id || `${v.rule} ${v.file}`); continue; }
    const f = (v.id !== undefined && byId.get(v.id)) || (v.rule && v.file ? bySource(v) : undefined);
    if (!f) { unmatched.push(v.id || `${v.rule} ${v.file}`); continue; }
    f.status = status;
    f.note = `${VERDICT_WORD[word] || 'Not a defect'}${v.reason ? `: ${v.reason}` : '.'} (a remediation verdict, not a rescan)`;
    if (typeof v.pr === 'string' && prIds.has(v.pr)) f.pr = v.pr;
    else if (v.pr !== undefined) ignored.push(`${f.id}: names a pull request the file does not declare`);
    if (CLASSES.includes(v.dataClass)) f.dataClass = v.dataClass;
    if (Array.isArray(v.controls)) {
      const good = v.controls.filter((c) => c && AXES.includes(c.axis) && typeof c.what === 'string' && c.what);
      if (good.length < v.controls.length) ignored.push(`${f.id}: ${v.controls.length - good.length} control(s) not well formed`);
      if (good.length) f.controls = good.map((c) => ({ axis: c.axis, what: c.what, ...(typeof c.where === 'string' && c.where ? { where: c.where } : {}), ...(typeof c.test === 'string' && c.test ? { test: c.test } : {}) }));
    }
    applied++;
  }
  return { model: { ...model, ...(prList.length ? { prs: prList } : {}), findings }, applied, unmatched, ignored };
}
