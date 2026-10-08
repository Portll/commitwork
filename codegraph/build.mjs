// Joins W1 (codegraph/lexical.mjs) and W2 (codegraph/v8-surface.mjs) into one graph.
//
// WHICH WITNESS DECIDES WHAT, stated once here because getting it backwards is how a floored
// extractor becomes an unfloored one with extra ceremony:
//
//   export surface   -> W2. V8 linked the module; it is not guessing. W1's list is CHECKED against
//                       it and reported in both directions, and is never the basis of a finding.
//   local aliases    -> W1. A namespace has no opinion about what the importer called a binding, so
//                       `import { formatReport as fmtOrphans }` is knowable only by reading syntax.
//                       The half V8 can floor — the EXPORTED name — is floored.
//   declarations     -> W1, floored where they are also exports. An unexported inner function is
//                       W1's word alone and says so: witness 'lexical', never 'both'.
//   call targets     -> W1, resolved through the two above. Unresolved is its OWN bucket, not an
//                       edge and not a silence: see `summary.unresolved`.
//   re-exports       -> W2. V8 resolved each export into a stub; W1's reading is checked against
//                       it exactly, in both directions, and on its own mints no edge.
//
// Symbol nodes are the UNION of W1's declarations and W2's exports. A name V8 exports that W1 never
// found still gets a node, carrying witness 'v8' — dropping it would let a hole in the weaker
// extractor delete a symbol that demonstrably exists, and every "nothing references this" answer
// downstream would inherit that hole as a finding.

import { candidatesFor, relativeSpecifiers, dynamicSpecifiers } from '../bin/lib/tracked-imports.mjs';
import { extract, importBindings } from './lexical.mjs';
import { surfaceOf } from './v8-surface.mjs';
import {
  SCHEMA_VERSION, makeNode, makeEdge, mergeEdges, moduleId, symbolId, externalId,
} from './schema.mjs';
import { now } from './store.mjs';

const RELATIVE = /^\.{1,2}\//;

// Names that resolve outside this repository. Not decoration: without them the unresolved bucket is
// dominated by `Map`, `Error` and `join`, and a bucket that is mostly noise is one nobody reads —
// which is how a real unresolved call hides in plain sight.
const GLOBALS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'ReferenceError',
  'URIError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Promise', 'Proxy',
  'Reflect', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array',
  'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'structuredClone', 'fetch', 'URL', 'URLSearchParams', 'TextEncoder',
  'TextDecoder', 'AbortController', 'AbortSignal', 'Buffer', 'process', 'console', 'globalThis',
  'Intl', 'FinalizationRegistry', 'Response', 'Request', 'Headers', 'Blob', 'Event', 'EventTarget',
  'performance', 'require', 'Function', 'Atomics', 'escape', 'unescape',
]);

/** One comparable form per re-export, so the two witnesses are held against each other exactly. */
export function reexportKey(r) {
  return r.kind === 'star' ? `* <- ${r.spec}` : `${r.exported} <- ${r.spec}#${r.imported}`;
}

/** W2's re-exports in W1's shape: V8's resolved names plus the specifiers its probe saw star. */
function v8Reexports(v8) {
  return [
    ...(v8.reexports || []).map((r) => ({ ...r, kind: r.imported === '*' ? 'namespace' : 'named' })),
    ...(v8.starReexports || []).map((spec) => ({ exported: '*', spec, imported: '*', kind: 'star' })),
  ];
}

/** A `reexports` edge for one tuple whose specifier is a tracked module, else null. */
function reexportEdge(path, r, tracked, opts) {
  const t = resolveSpecifier(path, r.spec, tracked);
  if (t.kind !== 'module') return null;
  if (r.kind === 'star') {
    return makeEdge(moduleId(path), moduleId(t.target), 'reexports', { ...opts, evidence: `${path} export * from ${r.spec}`, star: true });
  }
  if (r.kind === 'namespace') {
    return makeEdge(symbolId(path, r.exported), moduleId(t.target), 'reexports', {
      ...opts, evidence: `${path} exports ${r.exported} as the namespace of ${r.spec}`, namespace: true,
    });
  }
  const as = r.imported === r.exported ? '' : ` as ${r.exported}`;
  return makeEdge(symbolId(path, r.exported), symbolId(t.target, r.imported), 'reexports', {
    ...opts, evidence: `${path} re-exports ${r.imported}${as} from ${r.spec}`,
  });
}

/** Sole resolver: a specifier is a tracked module, an external, or unresolved. Never guessed. */
export function resolveSpecifier(fromFile, spec, tracked) {
  if (!RELATIVE.test(spec)) return { kind: 'external', target: externalId(spec) };
  const hit = candidatesFor(fromFile, spec).find((c) => tracked.has(c));
  return hit ? { kind: 'module', target: hit } : { kind: 'unresolved', target: null };
}

/**
 * -> the graph. `files` are repo-relative POSIX paths; `readFile` returns their source.
 *
 * Every file is in exactly ONE of three states, and they sum to the input:
 *   analysed   both witnesses answered. Nodes, edges, a surface.
 *   partial    W1 read it, W2 refused it. Its outgoing references are recorded and its own surface
 *              is not — so it can still protect another module's export from being called dead.
 *   unreadable W1 failed. Nothing is recorded, and it is the reason every reachability answer is a
 *              lower bound: a file nobody could read may import anything. codegraph/query.mjs
 *              carries that through as `unknownFrom` on every answer rather than in prose.
 */
export async function analyse({ files, readFile, source = 'worktree', env = process.env }) {
  const tracked = new Set(files);
  const analysed = new Map();
  const partial = new Map();
  const unreadable = [];

  for (const path of [...files].sort()) {
    let src;
    try {
      src = readFile(path);
    } catch (e) {
      // ENOENT on a file the caller just listed is not "absent", it is a race or a broken listing.
      unreadable.push({ path, witness: 'read', reason: `unreadable: ${e.code || e.message}` });
      continue;
    }
    const lex = extract(src);
    // W1 failing is the only state that makes a file a hole. Nothing about it can be trusted, so it
    // contributes nothing AND it is the reason every reachability answer downstream is a lower
    // bound: a file nobody could read may import anything.
    if (!lex.ok) { unreadable.push({ path, witness: 'lexical', reason: lex.reason }); continue; }
    // eslint-disable-next-line no-await-in-loop -- V8 link is sequential by nature; one isolate
    const v8 = await surfaceOf(src, path);
    const common = {
      path,
      lex,
      bindings: importBindings(lex.masked, src),
      lexicalSpecs: new Set(relativeSpecifiers(src)),
      // V8 does not report `import()` AT ALL — not the dynamic form, not even one with a literal
      // argument. Leaving it out would make every module reached only dynamically look unreferenced,
      // and its whole export surface look dead. That is not a smaller answer, it is a wrong one.
      dynamic: dynamicSpecifiers(src),
    };
    // PARTIAL, and it is not a fudge. A file V8 refuses still contains import statements W1 can
    // read, and those references are the half that PROTECTS other answers: a symbol imported by a
    // workflow script V8 will not parse is not a dead export. What a partial file never gets is a
    // surface or symbols of its own — those are W2's to state, and W2 declined.
    if (!v8.ok) { partial.set(path, { ...common, v8Reason: v8.reason }); continue; }
    analysed.set(path, { ...common, v8 });
  }

  const nodes = new Map();
  const edges = [];
  const addNode = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return nodes.get(n.id); };

  // ── nodes ────────────────────────────────────────────────────────────────────────────────────
  for (const f of analysed.values()) {
    addNode(makeNode('module', moduleId(f.path), {
      path: f.path,
      exports: f.v8.exports,
      surfaceComplete: f.v8.surfaceComplete,
      starReexports: f.v8.starReexports,
      // query.mjs needs it where a re-export, not a direct import, reaches this default
      defaultObjectLiteral: !!f.lex.defaultObjectLiteral,
    }));
    const declared = new Map(f.lex.symbols.map((s) => [s.name, s]));
    const w1Re = new Map(f.lex.reexports.filter((r) => r.kind !== 'star').map((r) => [r.exported, r]));
    const v8Re = new Map(v8Reexports(f.v8).filter((r) => r.kind !== 'star').map((r) => [r.exported, r]));
    for (const s of f.lex.symbols) {
      addNode(makeNode('symbol', symbolId(f.path, s.name), {
        path: f.path,
        name: s.name,
        symbolKind: s.kind,
        line: s.line,                                  // EVIDENCE only — the id excludes it
        exported: f.v8.exports.includes(s.name),
        witness: f.v8.exports.includes(s.name) ? 'both' : 'lexical',
      }));
    }
    for (const name of f.v8.exports) {
      if (declared.has(name)) continue;
      const re = v8Re.get(name);
      const w1 = w1Re.get(name);
      const agreed = !!re && !!w1 && reexportKey(re) === reexportKey(w1);
      addNode(makeNode('symbol', symbolId(f.path, name), {
        path: f.path,
        name,
        symbolKind: re ? 'reexport' : 'unknown',
        line: agreed ? w1.line : null,
        exported: true,
        // V8 linked it; W1 found no declaration here, and 'both' only when it read the same re-export
        witness: agreed ? 'both' : 'v8',
      }));
    }
  }

  // ── edges ────────────────────────────────────────────────────────────────────────────────────
  const unresolvedImports = [];
  const dynamicallyImported = new Set();
  // `import * as ns from './x'` binds a namespace, and `ns.thing()` is a member access this does not
  // track. Every export of such a module is therefore reachable in a way no `binds` edge records —
  // measured 2026-09-04: 4 statements, and without this they would have made two whole surfaces
  // look dead. Same for a module whose default export is an object literal somebody imports.
  const namespaceImported = new Set();
  const unresolvedCalls = new Map();      // name -> { sites, why }
  const ambiguousCalls = [];

  for (const f of analysed.values()) {
    const from = moduleId(f.path);
    const specs = [...new Set([...f.v8.specifiers, ...f.bindings.map((b) => b.spec)])].sort();

    for (const spec of specs) {
      const r = resolveSpecifier(f.path, spec, tracked);
      const witness = f.lexicalSpecs.has(spec) ? 'both' : 'v8';
      if (r.kind === 'unresolved') {
        unresolvedImports.push({ file: f.path, spec });
        edges.push(makeEdge(from, externalId(spec), 'imports', { witness, existence: 'unknown', evidence: `${f.path} ${spec}` }));
        continue;
      }
      if (r.kind === 'external') {
        addNode(makeNode('external', externalId(spec), { spec }));
        edges.push(makeEdge(from, externalId(spec), 'imports', { witness, existence: 'confirmed', evidence: `${f.path} ${spec}` }));
        continue;
      }
      edges.push(makeEdge(from, moduleId(r.target), 'imports', { witness, existence: 'confirmed', evidence: `${f.path} ${spec}` }));
    }

    for (const spec of f.dynamic) {
      const r = resolveSpecifier(f.path, spec, tracked);
      if (r.kind !== 'module') continue;
      // existence 'unknown' on purpose: a dynamic import names no bindings, so this edge says the
      // module is reachable and says NOTHING about which of its exports are used.
      dynamicallyImported.add(r.target);
      edges.push(makeEdge(from, moduleId(r.target), 'imports', {
        witness: 'lexical', existence: 'unknown', evidence: `${f.path} import(${spec})`, dynamic: true,
      }));
    }

    // reexports — V8 decides, as it does the surface; W1's tuples are held against it below and never
    // mint an edge alone. A named target's surface confirms or contradicts it, the way `binds` is read.
    const w1Keys = new Set(f.lex.reexports.map(reexportKey));
    for (const r of v8Reexports(f.v8)) {
      let existence = 'confirmed';
      if (r.kind === 'named') {
        const t = resolveSpecifier(f.path, r.spec, tracked);
        const target = t.kind === 'module' ? analysed.get(t.target) : null;
        if (!target) existence = 'unknown';
        else if (!target.v8.exports.includes(r.imported)) existence = target.v8.surfaceComplete ? 'contradicted' : 'unknown';
      }
      const e = reexportEdge(f.path, r, tracked, { witness: w1Keys.has(reexportKey(r)) ? 'both' : 'v8', existence });
      if (e) edges.push(e);
    }

    for (const s of f.lex.symbols) {
      edges.push(makeEdge(from, symbolId(f.path, s.name), 'defines', {
        witness: f.v8.exports.includes(s.name) ? 'both' : 'lexical',
        existence: 'confirmed',
        evidence: `${f.path}:${s.line}`,
      }));
    }

    // binds — one edge per imported name, resolved to the symbol it names in the target module.
    const localTarget = new Map();
    const externalLocals = new Set();
    for (const b of f.bindings) {
      if (b.kind === 'bare') continue;
      const r = resolveSpecifier(f.path, b.spec, tracked);
      if (r.kind === 'external' && b.local) externalLocals.add(b.local);
      if (r.kind === 'module' && b.kind === 'star') namespaceImported.add(r.target);
      if (r.kind === 'module' && b.kind === 'default') {
        const target = analysed.get(r.target);
        if (target && target.lex.defaultObjectLiteral) namespaceImported.add(r.target);
      }
      if (b.kind === 'star' || r.kind !== 'module') continue;
      const target = analysed.get(r.target);
      const to = symbolId(r.target, b.exported);
      let existence = 'unknown';
      if (target && target.v8.exports.includes(b.exported)) existence = 'confirmed';
      else if (target && target.v8.surfaceComplete) existence = 'contradicted';
      edges.push(makeEdge(from, to, 'binds', {
        witness: target && target.v8.exports.includes(b.exported) ? 'both' : 'lexical',
        existence,
        evidence: `${f.path} imports ${b.exported}${b.local === b.exported ? '' : ` as ${b.local}`} from ${b.spec}`,
      }));
      if (existence === 'confirmed') localTarget.set(b.local, to);
    }

    // calls — resolved through the local declarations and the bindings above, or not at all.
    const declaredHere = new Set(f.lex.symbols.map((s) => s.name));
    for (const c of f.lex.calls) {
      const local = declaredHere.has(c.name) ? symbolId(f.path, c.name) : null;
      const imported = localTarget.get(c.name) || null;
      if (local && imported) {
        // A local declaration AND an import provide this name. W1 does no scope analysis, so which
        // one is in scope at the call site is genuinely undecided — it is not resolved to whichever
        // is likelier, because a likelier guess is still a guess wearing a verdict's clothes.
        ambiguousCalls.push({ file: f.path, name: c.name, line: c.line });
        continue;
      }
      const to = local || imported;
      if (!to) {
        // Unresolved is not one thing. A call to `Map` and a call to a name nothing in this file
        // introduces are both "no edge", and only the second is a gap in the extractor.
        const why = externalLocals.has(c.name) ? 'external-import' : GLOBALS.has(c.name) ? 'global' : 'unknown';
        const prev = unresolvedCalls.get(c.name) || { sites: 0, why, where: [] };
        // Three sites, named. A bucket you cannot navigate to is a number, not a measurement.
        if (why === 'unknown' && prev.where.length < 3) prev.where.push(`${f.path}:${c.line}`);
        unresolvedCalls.set(c.name, { sites: prev.sites + 1, why, where: prev.where });
        continue;
      }
      const caller = c.from ? symbolId(f.path, c.from) : from;
      edges.push(makeEdge(caller, to, 'calls', {
        witness: 'lexical',
        existence: 'confirmed',
        evidence: `${f.path}:${c.line}`,
      }));
    }
  }

  // Partial files: references only. No module node with an empty export list — a module that
  // reports `exports: []` is indistinguishable from one that exports nothing, and W2 never said so.
  for (const f of partial.values()) {
    const from = moduleId(f.path);
    addNode(makeNode('module', moduleId(f.path), {
      path: f.path,
      exports: null,
      surfaceComplete: false,
      starReexports: [],
      state: 'partial',
      reason: f.v8Reason,
    }));
    for (const spec of [...new Set([...f.lexicalSpecs, ...f.bindings.map((b) => b.spec), ...f.dynamic])].sort()) {
      const r = resolveSpecifier(f.path, spec, tracked);
      if (r.kind === 'external') continue;
      if (r.kind === 'unresolved') { unresolvedImports.push({ file: f.path, spec }); continue; }
      edges.push(makeEdge(from, moduleId(r.target), 'imports', {
        witness: 'lexical', existence: 'unknown', evidence: `${f.path} ${spec} (partial: ${f.v8Reason})`,
      }));
    }
    for (const b of f.bindings) {
      if (b.kind === 'bare' || b.kind === 'star') continue;
      const r = resolveSpecifier(f.path, b.spec, tracked);
      if (r.kind !== 'module') continue;
      edges.push(makeEdge(from, symbolId(r.target, b.exported), 'binds', {
        witness: 'lexical', existence: 'unknown', evidence: `${f.path} imports ${b.exported} from ${b.spec} (partial)`,
      }));
    }
    // W1's word alone, so 'unknown' — and still followed, for the reason its binds are
    for (const r of f.lex.reexports) {
      const e = reexportEdge(f.path, r, tracked, { witness: 'lexical', existence: 'unknown' });
      if (e) edges.push(e);
    }
  }

  // ── divergence, both directions, never summed ────────────────────────────────────────────────
  const falsePositive = [];
  const falseNegative = [];
  const reFalsePositive = [];
  const reFalseNegative = [];
  for (const f of analysed.values()) {
    const v8set = new Set(f.v8.exports);
    const w1set = new Set(f.lex.exportedNames);
    const fp = f.lex.exportedNames.filter((n) => !v8set.has(n));
    const fn = f.v8.exports.filter((n) => !w1set.has(n));
    if (fp.length) falsePositive.push({ path: f.path, names: fp });
    if (fn.length) falseNegative.push({ path: f.path, names: fn });
    // The same two directions over what each export resolves to. Exact keys, no tolerance: a
    // re-export edge only one witness can see is either a lexer hole or a lexer invention.
    const v8re = new Set(v8Reexports(f.v8).map(reexportKey));
    const w1re = new Set(f.lex.reexports.map(reexportKey));
    const rfp = [...w1re].filter((k) => !v8re.has(k)).sort();
    const rfn = [...v8re].filter((k) => !w1re.has(k)).sort();
    if (rfp.length) reFalsePositive.push({ path: f.path, reexports: rfp });
    if (rfn.length) reFalseNegative.push({ path: f.path, reexports: rfn });
  }

  const byReason = {};
  for (const u of unreadable) {
    const key = `${u.witness}: ${String(u.reason).split(':')[0]}`;
    byReason[key] = (byReason[key] || 0) + 1;
  }

  const merged = mergeEdges(edges);
  return {
    v: SCHEMA_VERSION,
    generatedAt: now(env),
    source,
    dynamicallyImported: [...dynamicallyImported].sort(),
    namespaceImported: [...namespaceImported].sort(),
    files: {
      input: files.length,
      analysed: [...analysed.keys()].sort(),
      // Three states, and they sum to the input. `partial` is a file whose references are known and
      // whose surface is not; `unreadable` is a file about which nothing is known, and it is the
      // only one that makes another answer a lower bound.
      partial: [...partial.values()].map((f) => ({ path: f.path, reason: f.v8Reason })).sort((a, b) => a.path.localeCompare(b.path)),
      unreadable: unreadable.sort((a, b) => a.path.localeCompare(b.path)),
    },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: merged,
    summary: {
      analysed: analysed.size,
      partial: partial.size,
      unreadable: unreadable.length,
      unreadableByReason: byReason,
      nodesByKind: count(nodes.values(), (n) => n.kind),
      edgesByKind: count(merged, (e) => e.kind),
      edgesByExistence: count(merged, (e) => e.existence),
      divergence: {
        falsePositive,                                 // W1 claimed an export V8 does not have
        falseNegative,                                 // V8 has an export W1 never found
        filesCompared: analysed.size,
        reexports: {
          falsePositive: reFalsePositive,              // W1 read a re-export V8 does not resolve
          falseNegative: reFalseNegative,              // V8 resolves a re-export W1 never read
        },
      },
      unresolved: {
        imports: unresolvedImports.sort((a, b) => a.file.localeCompare(b.file) || a.spec.localeCompare(b.spec)),
        calls: [...unresolvedCalls].map(([name, v]) => ({ name, sites: v.sites, why: v.why, where: v.where }))
          .sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name)),
        callsByReason: count(unresolvedCalls.values(), (v) => v.why),
        ambiguousCalls: ambiguousCalls.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)),
      },
    },
  };
}

function count(iter, key) {
  const out = {};
  for (const x of iter) { const k = key(x); out[k] = (out[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort());
}
