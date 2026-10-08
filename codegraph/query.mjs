// The answers. Every one of them carries the reason it might be wrong, in its own field.
//
// This is the whole point of the module. "Nothing imports this" and "nothing I could read imports
// this" are different claims, and a query surface that returns the same shape for both has already
// lost the argument — the caller cannot tell them apart, so it will present the second as the
// first. CLAUDE.md records what that costs: four lanes published an unreadable signal as a verdict,
// 1,311 fabricated criticals in one of them.
//
// So: `unknownFrom` on every reachability answer, and `dead` / `undetermined` kept apart in
// deadExports(). A caller that wants one number can add them. A caller that wants the truth cannot
// be made to.

const isKind = (k) => (e) => e.kind === k;

/** Indexes built once per query set. Cheap; the graph is already in memory. */
export function index(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const importsOut = new Map();
  const importsIn = new Map();
  const bindsTo = new Map();
  const callsIn = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const e of graph.edges.filter(isKind('imports'))) {
    push(importsOut, e.from, e);
    push(importsIn, e.to, e);
  }
  for (const e of graph.edges.filter(isKind('binds'))) push(bindsTo, e.to, e);
  for (const e of graph.edges.filter(isKind('calls'))) push(callsIn, e.to, e);
  const reexportsFrom = new Map();
  const reexportsOf = new Map();
  const exportedOf = new Map();
  for (const e of graph.edges.filter(isKind('reexports'))) {
    push(reexportsFrom, e.from, e);
    push(reexportsOf, e.star ? pathOf(e.from) : symPath(e.from), e);
  }
  for (const n of graph.nodes) if (n.kind === 'symbol' && n.exported) push(exportedOf, n.path, n);
  return { byId, importsOut, importsIn, bindsTo, callsIn, reexportsFrom, reexportsOf, exportedOf, graph };
}

const modId = (p) => `mod:${p}`;
const pathOf = (id) => (id.startsWith('mod:') ? id.slice(4) : null);
// '#' is the LAST one: a path may hold one, an exported identifier cannot
const symPath = (id) => id.slice(4, id.lastIndexOf('#'));
const symName = (id) => id.slice(id.lastIndexOf('#') + 1);

/** Files the graph could not read. Every reachability answer is a lower bound while this is not []. */
export function unknownFrom(graph) {
  return (graph.files.unreadable || []).map((u) => ({ path: u.path, reason: u.reason }));
}

/** -> { static: [paths], dynamic: [paths], unknownFrom } */
export function importers(graph, path, ix = index(graph)) {
  const rows = ix.importsIn.get(modId(path)) || [];
  const statics = [];
  const dynamic = [];
  for (const e of rows) {
    const p = pathOf(e.from);
    if (!p) continue;
    (e.dynamic ? dynamic : statics).push(p);
  }
  return { static: [...new Set(statics)].sort(), dynamic: [...new Set(dynamic)].sort(), unknownFrom: unknownFrom(graph) };
}

/**
 * Everything that transitively imports `path` — what a change here can reach.
 *
 * `lowerBound` is true whenever a file could not be read, because an unreadable file may import
 * anything. It is not a caveat in prose; it is a field, so a caller cannot render this as a closed
 * set by accident.
 */
export function blastRadius(graph, path, { maxDepth = Infinity, ix = index(graph) } = {}) {
  const seen = new Map([[modId(path), 0]]);
  const queue = [[modId(path), 0]];
  while (queue.length) {
    const [id, d] = queue.shift();
    if (d >= maxDepth) continue;
    for (const e of ix.importsIn.get(id) || []) {
      if (seen.has(e.from)) continue;
      seen.set(e.from, d + 1);
      queue.push([e.from, d + 1]);
    }
  }
  seen.delete(modId(path));
  const unknown = unknownFrom(graph);
  return {
    root: path,
    reached: [...seen].map(([id, depth]) => ({ path: pathOf(id), depth })).filter((r) => r.path)
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    lowerBound: unknown.length > 0,
    unknownFrom: unknown,
  };
}

/** Modules nothing in the population imports — the roots, plus whatever is merely unreferenced. */
export function entryPoints(graph, ix = index(graph)) {
  return graph.nodes.filter((n) => n.kind === 'module' && !(ix.importsIn.get(n.id) || []).length)
    .map((n) => n.path).sort();
}

/** Who calls this symbol. -> [{ from, evidence }] */
export function callersOf(graph, symbolIdOrPathHash, ix = index(graph)) {
  return (ix.callsIn.get(symbolIdOrPathHash) || [])
    .map((e) => ({ from: e.from, evidence: e.evidence }))
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
}

/**
 * Every use, followed through the re-exports it passes. -> { bound, member }
 *
 *   bound   symbol ids imported by name, directly or at the far end of a re-export chain
 *   member  symbol id -> why, for ids reachable only as members of a namespace or default object a
 *           re-export hands out, or behind a dynamic import of a module that re-exports them
 *
 * A re-export is not itself a use. It passes one on, so a re-exported name nobody binds leaves its
 * target exactly as dead as it was. `seen` ends a cycle, of names or of `export *`.
 */
export function reexportReach(graph, ix = index(graph)) {
  const bound = new Set();
  const member = new Map();
  const seen = new Set();
  const work = [];
  const name = (path, n, how, why) => work.push({ path, n, how, why });
  const surface = (path, why, noDefault) => work.push({ path, why, noDefault, surface: true });
  const starsOf = (path) => (ix.reexportsFrom.get(modId(path)) || []).filter((e) => e.star);

  for (const e of graph.edges) if (e.kind === 'binds') name(symPath(e.to), symName(e.to), 'bound', null);
  for (const p of graph.namespaceImported || []) surface(p, `${p} is bound as a namespace or default object`, false);
  for (const p of graph.dynamicallyImported || []) surface(p, `${p} is reached by a dynamic import, which names no bindings`, false);

  while (work.length) {
    const w = work.pop();
    if (w.surface) {
      const key = `surface|${w.noDefault}|${w.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const names = new Set((ix.exportedOf.get(w.path) || []).map((s) => s.name));
      for (const e of ix.reexportsOf.get(w.path) || []) if (!e.star) names.add(symName(e.from));
      // a star never carries `default`
      for (const n of names) if (!(w.noDefault && n === 'default')) name(w.path, n, 'member', w.why);
      for (const e of starsOf(w.path)) surface(pathOf(e.to), w.why, true);
      continue;
    }
    const id = `sym:${w.path}#${w.n}`;
    const key = `${w.how}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (w.how === 'bound') bound.add(id);
    else if (!member.has(id)) member.set(id, w.why);
    const out = ix.reexportsFrom.get(id);
    if (out) {
      for (const e of out) {
        if (e.namespace) surface(pathOf(e.to), `${w.path}#${w.n} hands out ${pathOf(e.to)} as a namespace object`, false);
        else name(symPath(e.to), symName(e.to), w.how, w.why);
      }
    } else if (!ix.byId.has(id) && w.n !== 'default') {
      // no declaration of it here, so only an `export *` can have put it on this surface
      for (const e of starsOf(w.path)) name(pathOf(e.to), w.n, w.how, w.why);
    }
    if (w.n === 'default' && ix.byId.get(modId(w.path))?.defaultObjectLiteral) {
      surface(w.path, `${w.path}'s default export is an object literal`, false);
    }
  }
  return { bound, member };
}

/**
 * Exported symbols no other module binds — by name, or through any chain of re-exports.
 *
 * THREE outcomes, not two. `dead` is only ever populated when the graph read every file it was
 * given: one unreadable file is one file that may import the symbol, and a claim of "nothing uses
 * this" made over a population with holes in it is the fabricated-finding shape this repository
 * exists to refuse. Everything that would have been dead moves to `undetermined` with the reason,
 * where it is still actionable — a human can read it — and is not a finding.
 */
export function deadExports(graph, ix = index(graph)) {
  const holes = unknownFrom(graph);
  const dynamic = new Set(graph.dynamicallyImported || []);
  const namespaced = new Set(graph.namespaceImported || []);
  const { bound, member } = reexportReach(graph, ix);
  const dead = [];
  const undetermined = [];

  for (const n of graph.nodes) {
    if (n.kind !== 'symbol' || !n.exported) continue;
    if (bound.has(n.id)) continue;                                  // somebody imports it by name
    const mod = ix.byId.get(modId(n.path));
    const row = { id: n.id, path: n.path, name: n.name, symbolKind: n.symbolKind, line: n.line };
    if (mod && mod.surfaceComplete === false) {
      undetermined.push({ ...row, why: `module re-exports ${mod.starReexports.join(', ')} with export *; its surface is not fully knowable here` });
    } else if (namespaced.has(n.path)) {
      undetermined.push({ ...row, why: 'module is bound as a namespace or default object; member access is not tracked' });
    } else if (dynamic.has(n.path)) {
      undetermined.push({ ...row, why: 'module is reached by a dynamic import, which names no bindings' });
    } else if (member.has(n.id)) {
      undetermined.push({ ...row, why: `reached through a re-export: ${member.get(n.id)}; member access is not tracked` });
    } else if (holes.length) {
      undetermined.push({ ...row, why: `${holes.length} file(s) could not be analysed and may import it` });
    } else {
      dead.push(row);
    }
  }
  const by = (a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name);
  return { dead: dead.sort(by), undetermined: undetermined.sort(by), unknownFrom: holes };
}

/** One screen about one file — what an agent wants before editing it. */
export function neighbourhood(graph, path, ix = index(graph)) {
  const mod = ix.byId.get(modId(path));
  if (!mod) {
    const hole = (graph.files.unreadable || []).find((u) => u.path === path);
    return hole
      ? { path, state: 'unreadable', reason: hole.reason }
      : { path, state: 'absent', reason: 'not in the analysed population' };
  }
  const out = (ix.importsOut.get(mod.id) || []).map((e) => ({ to: e.to, dynamic: !!e.dynamic, existence: e.existence }));
  const defines = graph.nodes.filter((n) => n.kind === 'symbol' && n.path === path)
    .map((n) => ({ name: n.name, kind: n.symbolKind, line: n.line, exported: n.exported, witness: n.witness }))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.name.localeCompare(b.name));
  const reexports = (ix.reexportsOf.get(path) || []).map((e) => ({
    name: e.star ? '*' : symName(e.from),
    to: e.to,
    how: e.star ? 'star' : e.namespace ? 'namespace' : 'named',
    existence: e.existence,
  })).sort((a, b) => a.name.localeCompare(b.name) || a.to.localeCompare(b.to));
  return {
    path,
    state: 'analysed',
    exports: mod.exports,
    surfaceComplete: mod.surfaceComplete,
    imports: out.sort((a, b) => a.to.localeCompare(b.to)),
    importedBy: importers(graph, path, ix),
    reexports,
    defines,
  };
}
