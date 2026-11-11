// C3 — reconcile the two witnesses.
//
// FALSE NEGATIVES AND FALSE POSITIVES ARE REPORTED SEPARATELY AND NEVER SUMMED INTO A CONFIDENCE.
// Only one of them lies to you: an edge the runtime took and C1 never saw is a hole in the static
// pass, and a hole is what lets a dangling dependency through. An edge C1 claims and the runtime did
// not take is noise — costly, but it does not wave anything through.
//
// THE COVERAGE RESTRICTION IS THE WHOLE DESIGN. A static edge in a module this run never entered is
// not a contradiction; it is an unasked question. Scoring it as disagreement produces a divergence
// count proportional to how much code you did NOT exercise, which looks exactly like a crisis and
// grows as the repo grows.
//
// A ZERO MUST BE MEASURED. If the trace is unusable, or nothing was comparable, `divergence` is
// null and `state` is 'unmeasured'. It is never 0.

import { SCHEMA_VERSION, edgeKey } from './graph.mjs';
import { readJson } from './store.mjs';

const MODULE_PREFIX = 'node:module:';
const ENDPOINT_PREFIX = 'node:endpoint:';
const NET_KINDS = new Set(['connects', 'listens']);
const DEFAULT_PORT = { http: 80, https: 443, ws: 80, wss: 443 };

/**
 * An endpoint key -> the identity two witnesses can agree on: host and effective port, or the
 * listening port. C1 reads `https://api.example.com` off a literal; C2 may see the same socket as
 * `https://api.example.com` (https.request) or `tls://api.example.com:443` (a client that dials
 * TLS itself). Those are one edge at two layers, and the scheme is not the claim — the peer is.
 */
export function endpointIdentity(key) {
  const k = String(key);
  if (k.startsWith('listen:')) return k;
  const m = /^([a-z][a-z0-9+.-]*):\/\/(\[[^\]]+\]|[^/:?#]*)(?::(\d+))?/i.exec(k);
  if (!m) return k;
  const scheme = m[1].toLowerCase();
  if (scheme === 'unix') return k;
  const port = m[3] ? Number(m[3]) : (DEFAULT_PORT[scheme] ?? null);
  return `${m[2].toLowerCase()}:${port ?? ''}`;
}

/** A store key C1 holds as a NAME rather than a location: `rollup.json`, `./x.json`, `../y/z.json`. */
export function isNameKey(key) {
  const k = String(key);
  if (k.startsWith('/')) return false;
  return !k.includes('/') || k.startsWith('./') || k.startsWith('../');
}

/** Does a concrete observed path answer to a name key? */
export function nameMatches(key, observed) {
  const k = String(key);
  const t = String(observed);
  if (!k.includes('/')) return t === k || t.endsWith(`/${k}`);
  const rest = k.replace(/^(?:\.\.?\/)+/, '');
  return rest !== '' && (t === rest || t.endsWith(`/${rest}`));
}

/** access values (read | write | append | readwrite) -> 'reads' | 'writes' | 'both' | null */
export function directionOf(accesses) {
  let r = false;
  let w = false;
  for (const a of accesses) {
    if (a === 'read' || a === 'readwrite') r = true;
    if (a === 'write' || a === 'append' || a === 'readwrite') w = true;
  }
  if (r && w) return 'both';
  if (r) return 'reads';
  if (w) return 'writes';
  return null;
}

function pathOf(id) {
  return id.replace(/^node:[a-z]+:/, '');
}

/** Runtime observations -> the same identity shape the static edges use. */
function runtimeKeys(observations) {
  const set = new Set();
  for (const o of observations) set.add(JSON.stringify([o.from, o.to, o.kind]));
  return set;
}

/**
 * -> the reconciliation report. `edges` carries every static edge with `witness` and `existence`
 * resolved; the two axes stay separate (provenance vs verdict) so "unvisited" has somewhere to live.
 */
export function reconcile(graph, runtime) {
  const base = { v: SCHEMA_VERSION, generatedAt: graph.generatedAt || null };

  if (!runtime || runtime.state !== 'usable') {
    return {
      ...base,
      state: 'unmeasured',
      divergence: null,
      reason: runtime ? runtime.reason || `runtime trace ${runtime.state}` : 'no runtime pass supplied',
      comparable: 0,
      falseNegatives: [],
      unconfirmed: [],
      confirmed: [],
      outOfScope: [],
      coverage: [],
      observedPaths: {},
      network: runtime && runtime.network ? runtime.network : { state: 'unusable', reason: 'no runtime pass supplied' },
      edges: (graph.edges || []).map((e) => ({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'unvisited' })),
    };
  }

  const coverage = new Set(runtime.coverage || []);
  const observed = runtimeKeys(runtime.observations || []);
  const staticKeys = new Set();
  // Absence of a network observation means something only when every traced process proved it can
  // see the network. A runtime summary without a `network` block (an older one, or a union that
  // dropped it) is treated as unwitnessed: a connect it saw still confirms, a connect it did not
  // see refutes nothing.
  const netWitnessed = Boolean(runtime.network && runtime.network.state === 'usable');
  const netObserved = new Set();
  const fsByActor = new Map();
  for (const o of runtime.observations || []) {
    if (NET_KINDS.has(o.kind)) netObserved.add(JSON.stringify([o.from, endpointIdentity(o.to), o.kind]));
    else if (o.kind === 'reads' || o.kind === 'writes') {
      if (!fsByActor.has(o.from)) fsByActor.set(o.from, []);
      fsByActor.get(o.from).push(o);
    }
  }
  // Every access this actor's opens of `to` carried: exactly, or by name for a name key.
  const accessesFor = (actor, to, byName) => {
    const exact = [];
    const named = [];
    for (const o of fsByActor.get(actor) || []) {
      if (!o.access) continue;
      if (o.to === to) exact.push(...o.access);
      else if (byName && nameMatches(to, o.to)) named.push(...o.access);
    }
    return { exact, named };
  };

  const confirmed = [];
  // C1 claimed it, the run entered that module, the edge was not observed.
  //
  // NOT called `falsePositives`, and the rename is a finding rather than a preference. Coverage here
  // is MODULE granularity, so this bucket is the union of two things it cannot separate: a wrong
  // static claim, and a correct claim on a branch this run did not take. An edge in a module that
  // was imported but whose function was never called is an unexercised branch, not a wrong claim,
  // and publishing it as `contradicted` would be an unknown wearing a verdict. Separating the two
  // needs statement coverage, which module coverage cannot supply.
  const unconfirmed = [];
  const outOfScope = [];          // module never entered — unknown, NOT a finding
  const edges = [];

  for (const e of graph.edges || []) {
    if (!e.from.startsWith(MODULE_PREFIX)) { edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'unvisited' }); continue; }
    const from = pathOf(e.from);
    const to = pathOf(e.to);
    const key = JSON.stringify([from, to, e.kind]);
    staticKeys.add(key);

    if (!coverage.has(from)) {
      outOfScope.push({ from, to, kind: e.kind });
      edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'unvisited' });
      continue;
    }
    if (observed.has(key)) {
      confirmed.push({ from, to, kind: e.kind });
      edges.push({ ...e, witness: 'both', existence: 'confirmed', runtimeCoverage: 'visited' });
      continue;
    }
    if (NET_KINDS.has(e.kind) && e.to.startsWith(ENDPOINT_PREFIX)) {
      if (netObserved.has(JSON.stringify([from, endpointIdentity(to), e.kind]))) {
        confirmed.push({ from, to, kind: e.kind });
        edges.push({ ...e, witness: 'both', existence: 'confirmed', runtimeCoverage: 'visited' });
        continue;
      }
      if (!netWitnessed) {
        edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'visited', unfalsifiable: true, networkUnwitnessed: true });
        continue;
      }
    }
    // A `touches` edge gets a direction from the opens the runtime saw: read-only, for write, or
    // both. An exact-path open also CONFIRMS the edge — the module did open that file. An open
    // matched only by name gives the direction and confirms nothing, because the name is several
    // files (the composed-node rule).
    if (e.kind === 'touches') {
      const { exact, named } = accessesFor(from, to, isNameKey(to));
      const direction = directionOf(exact.length ? exact : named);
      if (exact.length) {
        confirmed.push({ from, to, kind: e.kind, direction });
        edges.push({ ...e, witness: 'both', existence: 'confirmed', runtimeCoverage: 'visited', direction });
        continue;
      }
      if (direction) {
        edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'visited', unfalsifiable: true, direction, directionBy: 'name' });
        continue;
      }
    }
    // A `touches` edge never claimed a direction, so nothing about it can be contradicted. Same for
    // a module edge the loader satisfies from cache, for a dynamic import that did not fire, and —
    // the one that matters most — for an ENV edge: C2 patches fs and child_process, not
    // process.env, so it cannot witness an env read in either direction. Scoring those as
    // contradicted made every CW_* edge in a traced module a false positive.
    const unfalsifiable = e.kind === 'touches'
      || e.to.startsWith('node:module:')
      || e.to.startsWith('node:env:')
      || [].concat(e.evidence || []).some((x) => String(x).includes('dynamic-import'));
    if (unfalsifiable) {
      edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'visited', unfalsifiable: true });
      continue;
    }
    unconfirmed.push({ from, to, kind: e.kind, evidence: [].concat(e.evidence || [])[0] || null });
    edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'visited', unconfirmed: true });
  }

  // The direction that lies: the run did it, C1 never saw it.
  //
  // BUT ONLY WHERE C1 COULD HAVE SEEN IT. A path built by a directory walk, or joined out of
  // variables, or taken from argv, is not a literal and never was — C1 makes no claim about it, so
  // scoring it as a miss is a finding manufactured out of a category difference. One traced
  // recursive walk opens thousands of paths that appear as a literal nowhere in the module that
  // opened them.
  const literalIndex = new Map(
    (graph.modules || []).filter((m) => m.pathLiterals).map((m) => [m.path, m.pathLiterals]),
  );
  const moduleIndex = new Map((graph.modules || []).map((m) => [m.path, m]));
  const couldHaveSeen = (actor, target) => {
    const lits = literalIndex.get(actor);
    if (!lits || !lits.length) return false;
    const base = String(target).slice(String(target).lastIndexOf('/') + 1);
    return lits.some((l) => l === target || String(target).endsWith(`/${l}`) || l === base);
  };

  // What C1 actually emitted, per actor, so a NAME/LOCATION mismatch is not scored as a miss.
  // C1's node for `join(dir, 'rollup.json')` is the literal `rollup.json`; C2 observes
  // `reports/<area>/rollup.json`. Those are the same edge seen at two resolutions, and calling the
  // difference a false negative is the composed-node problem wearing a verdict.
  const emittedByActor = new Map();
  for (const e of graph.edges || []) {
    if (!e.from.startsWith(MODULE_PREFIX)) continue;
    const a = pathOf(e.from);
    if (!emittedByActor.has(a)) emittedByActor.set(a, []);
    emittedByActor.get(a).push({ to: pathOf(e.to), kind: e.kind });
  }
  const matchesByName = (actor, target, kind) => {
    const t = String(target);
    const base = t.slice(t.lastIndexOf('/') + 1);
    return (emittedByActor.get(actor) || []).some((e) => (e.kind === kind || e.kind === 'touches')
      && (e.to === t || e.to === base || t.endsWith(`/${e.to}`)));
  };

  const falseNegatives = [];
  const dynamicPaths = [];
  const matchedByName = [];
  const staticNet = new Set();
  for (const e of graph.edges || []) {
    if (e.from.startsWith(MODULE_PREFIX) && NET_KINDS.has(e.kind)) staticNet.add(JSON.stringify([pathOf(e.from), endpointIdentity(pathOf(e.to)), e.kind]));
  }
  // An endpoint is within C1's reach when the module carries a literal naming its host or port.
  // An ephemeral listen (port 0) and a host taken from config are never literals.
  const couldHaveSeenEndpoint = (actor, key, o) => {
    if (o.ephemeral) return false;
    const lits = [...(literalIndex.get(actor) || []), ...((moduleIndex.get(actor) || {}).urlLiterals || [])];
    const id = endpointIdentity(key);
    const host = id.startsWith('listen:') ? null : id.slice(0, id.lastIndexOf(':'));
    const port = id.slice(id.lastIndexOf(':') + 1);
    return lits.some((l) => (host && host !== 'localhost' && String(l).toLowerCase().includes(host))
      || (id.startsWith('listen:') && String(l) === port));
  };
  for (const o of runtime.observations || []) {
    if (!coverage.has(o.from)) continue;                 // an actor outside the analysed set
    if (NET_KINDS.has(o.kind)) {
      if (staticNet.has(JSON.stringify([o.from, endpointIdentity(o.to), o.kind]))) continue;
      const row = { from: o.from, to: o.to, kind: o.kind, via: o.via };
      (couldHaveSeenEndpoint(o.from, o.to, o) ? falseNegatives : dynamicPaths).push(row);
      continue;
    }
    if (staticKeys.has(JSON.stringify([o.from, o.to, o.kind]))) continue;
    const row = { from: o.from, to: o.to, kind: o.kind, via: o.via };
    if (matchesByName(o.from, o.to, o.kind)) { matchedByName.push(row); continue; }
    (couldHaveSeen(o.from, o.to) ? falseNegatives : dynamicPaths).push(row);
  }

  // Where each NAME C1 holds was actually found. `rollup.json` is several files; the run says which
  // ones this module opened. Only actors that C1 says use the name are asked, so a second module
  // opening an unrelated `config.json` does not resolve this one's.
  const observedPaths = {};
  for (const e of graph.edges || []) {
    if (!e.from.startsWith(MODULE_PREFIX) || !/^node:(artifact|store):/.test(e.to)) continue;
    const key = pathOf(e.to);
    if (!isNameKey(key)) continue;
    const actor = pathOf(e.from);
    for (const o of fsByActor.get(actor) || []) {
      if (!nameMatches(key, o.to)) continue;
      const set = observedPaths[key] || (observedPaths[key] = []);
      if (!set.includes(o.to)) set.push(o.to);
    }
  }
  for (const k of Object.keys(observedPaths)) observedPaths[k].sort();

  const comparable = confirmed.length + unconfirmed.length + falseNegatives.length;
  return {
    ...base,
    state: comparable === 0 ? 'unmeasured' : 'measured',
    reason: comparable === 0 ? 'no edge fell inside the runtime coverage set — nothing was compared' : null,
    divergence: comparable === 0 ? null : falseNegatives.length + unconfirmed.length,
    comparable,
    coverageModules: coverage.size,
    coverage: [...coverage].sort(),
    network: { ...(runtime.network || { state: 'unusable', reason: 'runtime summary carries no network witness' }), witnessed: netWitnessed },
    directed: edges.filter((e) => e.direction).length,
    observedPaths,
    falseNegatives,
    unconfirmed,
    dynamicPaths,          // observed, and outside C1's reach BY CONSTRUCTION — not a finding
    matchedByName,         // same edge at two resolutions (bare literal vs resolved path)
    confirmed,
    outOfScope,
    edges,
  };
}

/** The report leads with the divergence count, and says so when there is not one. */
export function formatReport(r) {
  const head = r.state === 'measured'
    ? `divergence ${r.divergence}  (false negatives ${r.falseNegatives.length}, unconfirmed ${r.unconfirmed.length}) over ${r.comparable} comparable edges`
    : `divergence UNMEASURED — ${r.reason}`;
  return [
    `flow/reconcile: ${head}`,
    `  confirmed by both  ${r.confirmed.length}`,
    `  out of scope (module never entered, NOT a finding)     ${r.outOfScope.length}`,
    `  dynamic paths (never a literal, NOT a finding)         ${(r.dynamicPaths || []).length}`,
    `  matched by name only (bare literal vs resolved path)   ${(r.matchedByName || []).length}`,
    `  runtime coverage   ${r.coverageModules || 0} modules`,
    `  touches given a direction by observed opens            ${r.directed || 0}`,
    `  bare-name stores resolved to observed paths            ${Object.keys(r.observedPaths || {}).length}`,
    `  network            ${r.network ? r.network.state : 'unusable'}${r.network && r.network.reason ? ` (${r.network.reason})` : ''}`,
  ].join('\n');
}

const WITNESS = new Set(['static', 'runtime', 'both']);
const EXISTENCE = new Set(['confirmed', 'contradicted', 'unknown']);
const COVERAGE = new Set(['visited', 'unvisited']);
const DIRECTION = new Set(['reads', 'writes', 'both']);

function invalid(path, why) {
  const err = new Error(`flow-reconcile.json invalid ${path}: ${why}`);
  err.code = 'CW_FLOW_RECONCILE_INVALID';
  return err;
}

/**
 * Read and validate a `flow-reconcile.json`. -> the report, with `edges`, `observedPaths` and
 * `coverage` checked. Throws — it never returns a partial or defaulted report: a reader that
 * fills a missing `edges` with `[]` has turned an unreadable reconciliation into an empty one.
 *   CW_FLOW_RECONCILE_ABSENT   no file
 *   CW_FLOW_RECONCILE_INVALID  wrong `v`, or a record of the wrong shape
 *   CW_FLOW_STORE_CORRUPT / _UNREADABLE  from the store reader
 */
export function readReconcile(path) {
  const { state, data } = readJson(path);
  if (state === 'absent') {
    const err = new Error(`flow-reconcile.json absent ${path}`);
    err.code = 'CW_FLOW_RECONCILE_ABSENT';
    throw err;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid(path, 'not an object');
  if (data.v !== SCHEMA_VERSION) throw invalid(path, `v is ${JSON.stringify(data.v)}, expected ${SCHEMA_VERSION}`);
  if (!Array.isArray(data.edges)) throw invalid(path, 'edges is not an array');
  data.edges.forEach((e, i) => {
    const at = `edges[${i}]`;
    if (!e || typeof e !== 'object') throw invalid(path, `${at} not an object`);
    if (e.v !== SCHEMA_VERSION) throw invalid(path, `${at}.v is ${JSON.stringify(e.v)}`);
    for (const f of ['from', 'to', 'kind']) if (typeof e[f] !== 'string' || !e[f]) throw invalid(path, `${at}.${f} missing`);
    if (!WITNESS.has(e.witness)) throw invalid(path, `${at}.witness ${JSON.stringify(e.witness)}`);
    if (!EXISTENCE.has(e.existence)) throw invalid(path, `${at}.existence ${JSON.stringify(e.existence)}`);
    if (!COVERAGE.has(e.runtimeCoverage)) throw invalid(path, `${at}.runtimeCoverage ${JSON.stringify(e.runtimeCoverage)}`);
    if (e.direction !== undefined && !DIRECTION.has(e.direction)) throw invalid(path, `${at}.direction ${JSON.stringify(e.direction)}`);
  });
  const op = data.observedPaths;
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw invalid(path, 'observedPaths is not an object');
  for (const [k, v] of Object.entries(op)) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw invalid(path, `observedPaths[${JSON.stringify(k)}] is not a list of paths`);
  }
  if (!Array.isArray(data.coverage) || data.coverage.some((x) => typeof x !== 'string')) throw invalid(path, 'coverage is not a list of modules');
  return data;
}

export { edgeKey };
