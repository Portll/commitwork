// flow/dfd-coverage-adapter.mjs — test coverage as a layer on a dfd@1 model.
//
// Two measurements, kept apart because they answer different questions:
//   nodes[].coverage   how much of an element's code a test run executed (lines, branches), read
//                      from an lcov report. A file element takes its whole record; a function
//                      element takes the lines inside its own range.
//   flows[].coverage   whether a test run exercised a flow at all, read from what a runtime pass
//                      observed (flow/reconcile.mjs) or from pairs the caller supplies.
//
// ABSENT IS NOT ZERO. An element the report does not mention, a function whose range nobody could
// give, a flow in a module the run never entered: each stays without a `coverage` field and is
// counted, never written as 0% or as not exercised. A zero must be measured (flow/reconcile.mjs
// holds the same rule for divergence).
//
// A COVERED LINE IS NOT A TESTED GUARD. Coverage says a test ran the code. It does not say a test
// would fail without the check; that is what a patch's `tested` evidence means, and nothing here
// raises it.
//
// Pure functions: the caller reads the files (flow/dfd-cli.mjs --coverage) and supplies the
// function ranges (codegraph/function-at.mjs functionsOf).

import { fileOfNode } from './dfd-rescan.mjs';
import { sinkKindOf } from './dfd-adapter.mjs';

const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);

/**
 * An lcov tracefile -> one record per SF block:
 *   { file, lines: Map<line, hits>, branches: [{ line, taken }], functions: [{ name, line, hits }] }
 * `taken` is the hit count of one branch arm; an arm lcov writes as `-` (its block never ran) is 0.
 * A line that is not a well-formed lcov statement, or a statement outside any SF block, is counted
 * in the returned array's `malformed` property (not enumerable, so two parses compare by their
 * records) and skipped: a truncated report still yields the records it holds. Summary statements
 * (LF, LH, BRF, BRH, FNF, FNH), TN and any statement this reader does not know are ignored without
 * being counted: they carry nothing the detail lines do not.
 */
export function parseLcov(text) {
  const records = [];
  let malformed = 0;
  let cur = null;
  const fnLine = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    if (line === 'end_of_record') {
      if (cur) records.push(cur); else malformed++;
      cur = null;
      continue;
    }
    const at = line.indexOf(':');
    if (at < 1) { malformed++; continue; }
    const key = line.slice(0, at);
    const value = line.slice(at + 1);
    if (!/^[A-Z]+$/.test(key)) { malformed++; continue; }
    if (key === 'SF') {
      // a second SF before end_of_record: the first block was cut off, and still holds what it holds
      if (cur) { records.push(cur); malformed++; }
      if (!value) { malformed++; cur = null; continue; }
      cur = { file: value, lines: new Map(), branches: [], functions: [] };
      fnLine.clear();
      continue;
    }
    if (key === 'TN') continue;
    if (!cur) { malformed++; continue; }
    if (key === 'DA') {
      const [l, h] = value.split(',');
      const ln = num(l || '');
      const hits = num(h || '');
      if (ln === null || hits === null) { malformed++; continue; }
      cur.lines.set(ln, (cur.lines.get(ln) || 0) + hits);
    } else if (key === 'BRDA') {
      const parts = value.split(',');
      const ln = num(parts[0] || '');
      const taken = parts[3] === '-' ? 0 : num(parts[3] || '');
      if (parts.length < 4 || ln === null || taken === null) { malformed++; continue; }
      cur.branches.push({ line: ln, taken });
    } else if (key === 'FN') {
      // FN:<line>,<name> and the newer FN:<line>,<end line>,<name>
      const parts = value.split(',');
      const ln = num(parts[0] || '');
      const name = parts.length >= 3 && num(parts[1]) !== null ? parts.slice(2).join(',') : parts.slice(1).join(',');
      if (ln === null || !name) { malformed++; continue; }
      fnLine.set(name, ln);
      cur.functions.push({ name, line: ln, hits: 0 });
    } else if (key === 'FNDA') {
      const comma = value.indexOf(',');
      const hits = comma < 0 ? null : num(value.slice(0, comma));
      const name = comma < 0 ? '' : value.slice(comma + 1);
      if (hits === null || !name) { malformed++; continue; }
      const known = cur.functions.find((f) => f.name === name);
      if (known) known.hits += hits;
      else cur.functions.push({ name, line: fnLine.get(name) ?? null, hits });
    }
  }
  // a block with no end_of_record: the report was cut off; keep what it holds and say so
  if (cur) { records.push(cur); malformed++; }
  Object.defineProperty(records, 'malformed', { value: malformed, enumerable: false });
  return records;
}

/** An lcov path as the model names files: repository-relative, forward slashes; null when it is absolute and no root strips it. */
export function relativePath(file, root = null) {
  let f = String(file).replace(/\\/g, '/');
  const base = root === null ? null : String(root).replace(/\\/g, '/').replace(/\/+$/, '');
  if (base !== null && (f === base || f.startsWith(`${base}/`))) f = f.slice(base.length + 1);
  if (f.startsWith('/') || /^[A-Za-z]:\//.test(f)) return null;
  return f.replace(/^(?:\.\/)+/, '');
}

/** A function element's id -> { file, name } (name '' is the file's module level), or null for any other element. */
export function functionOfNode(node) {
  if (!node || node.kind !== 'process' || !node.id.startsWith('fn:')) return null;
  const rest = node.id.slice(3);
  const colon = rest.indexOf(':');
  const hash = rest.lastIndexOf('#');
  if (colon < 0 || hash <= colon) return null;
  return { file: rest.slice(colon + 1, hash), name: rest.slice(hash + 1) };
}

const tally = (lines, branches) => ({
  lines: { covered: lines.filter(([, h]) => h > 0).length, total: lines.length },
  ...(branches.length ? { branches: { covered: branches.filter((b) => b.taken > 0).length, total: branches.length } } : {}),
});

/**
 * Write nodes[].coverage from lcov records. -> { model, matched, unmatched, unmeasured, unranged, malformed }.
 *   model       a copy; the input is not changed
 *   matched     how many elements were given a coverage
 *   unmatched   lcov files no element stands for (a file with no flow is not an element), sorted
 *   unmeasured  files that are elements and that the report does not hold, sorted: NOT 0% — nobody ran them
 *   unranged    function elements whose file the report holds but whose lines could not be picked out
 *               (no `rangesOf`, it returned null, or it does not name the function), by id
 *   malformed   parseLcov's count, carried through
 * A file element (fileOfNode) takes its whole record. A function element `fn:<repo>:<file>#<name>`
 * takes the lines whose INNERMOST range is that function (so a class does not claim its methods'
 * lines); `fn:<repo>:<file>#` is the module level, the lines inside no range. `rangesOf(file)` ->
 * [{ name, line, endLine }] | null. A function with no instrumented line gets `total: 0`: it was
 * measured and holds nothing to cover, which is not the same as not measured.
 * `root`, when given, is stripped from absolute lcov paths; an absolute path it does not hold
 * cannot be matched and is listed in `unmatched` as written.
 */
export function applyLcov(model, records, { rangesOf = null, source = 'lcov', root = null } = {}) {
  const byFile = new Map();
  const unplaced = [];
  for (const r of records || []) {
    const rel = relativePath(r.file, root);
    if (rel === null) { unplaced.push(r.file); continue; }
    const have = byFile.get(rel);
    if (!have) { byFile.set(rel, { lines: new Map(r.lines), branches: r.branches.slice() }); continue; }
    // the same file reported twice (two test processes): hits add
    for (const [l, h] of r.lines) have.lines.set(l, (have.lines.get(l) || 0) + h);
    have.branches.push(...r.branches);
  }
  const used = new Set();
  const unmeasured = new Set();
  const unranged = [];
  const rangeCache = new Map();
  const ranges = (file) => {
    if (!rangeCache.has(file)) rangeCache.set(file, rangesOf ? rangesOf(file) || null : null);
    return rangeCache.get(file);
  };
  const innermost = (rs, line) => {
    let best = null;
    for (const r of rs) {
      if (line < r.line || line > r.endLine) continue;
      if (!best || r.line > best.line || (r.line === best.line && r.endLine < best.endLine)) best = r;
    }
    return best ? best.name : '';
  };
  let matched = 0;
  const nodes = model.nodes.map((n) => {
    const file = fileOfNode(n);
    if (file !== null) {
      const rec = byFile.get(file);
      if (!rec) { unmeasured.add(file); return n; }
      used.add(file);
      matched++;
      return { ...n, coverage: { ...tally([...rec.lines], rec.branches), source } };
    }
    const fn = functionOfNode(n);
    if (!fn) return n;
    const rec = byFile.get(fn.file);
    if (!rec) { unmeasured.add(fn.file); return n; }
    used.add(fn.file);
    const rs = ranges(fn.file);
    if (!rs || (fn.name !== '' && !rs.some((r) => r.name === fn.name))) { unranged.push(n.id); return n; }
    matched++;
    return { ...n, coverage: { ...tally([...rec.lines].filter(([l]) => innermost(rs, l) === fn.name), rec.branches.filter((b) => innermost(rs, b.line) === fn.name)), source } };
  });
  return {
    model: { ...model, nodes },
    matched,
    unmatched: [...[...byFile.keys()].filter((f) => !used.has(f)), ...unplaced].sort(),
    unmeasured: [...unmeasured].sort(),
    unranged,
    malformed: (records && records.malformed) || 0,
  };
}

const pairKey = (from, to) => `${from}\u0000${to}`;

/**
 * Write flows[].coverage from what a test run was seen to do. -> { model, exercised, notExercised, unmeasured, unmatched }.
 *
 * `observed` is one of:
 *   an array of { from, to, tests? }   pairs in the model's own element ids that a test run took.
 *       With `entered` (the element ids the run is known to have executed) a flow leaving an
 *       entered element and not in the list is `exercised: false`; without it, a flow not in the
 *       list is left unmeasured, because the list does not say what the run could have seen.
 *   a reconcile report (flow/reconcile.mjs: an object with `edges`)   each edge carries what this
 *       needs: `runtimeCoverage: 'visited'` with `existence: 'confirmed'` is exercised, `visited`
 *       without it is not exercised (the module ran and the flow did not happen), `unvisited` is
 *       unmeasured. An edge the report marks `unfalsifiable` is unmeasured too: the run could not
 *       have told. Edges are matched to flows by from/to id; the flow-graph adapter renames and
 *       splits some stores, and an edge that matches no flow is counted in `unmatched`.
 *       A reconcile report does not record WHAT was run. It is accepted only with `testRun: true`,
 *       the caller's statement that the trace came from the test suite; otherwise this throws.
 *
 * Decision on evidence the model already carries: a flow whose own evidence says a runtime saw it
 * (evidence.witness runtime|both, existence confirmed) is NOT marked exercised on that account.
 * That evidence says the flow is real; it does not say a TEST took it — the trace may be of a
 * manual run or of production. Only `observed`, which the caller vouches for, writes this field.
 *
 * `witness` names the run (a suite, a trace file) and is written on every flow this marks.
 */
export function applyExercised(model, observed, { witness, entered = null, missed = [], testRun = false } = {}) {
  const seen = new Map();
  const notSeen = new Set();
  let unmatched = 0;
  const flowKeys = new Set(model.flows.map((f) => pairKey(f.from, f.to)));
  if (Array.isArray(observed)) {
    for (const o of observed) {
      if (!o || typeof o.from !== 'string' || typeof o.to !== 'string') { unmatched++; continue; }
      const k = pairKey(o.from, o.to);
      if (!flowKeys.has(k)) { unmatched++; continue; }
      if (!seen.has(k)) seen.set(k, new Set());
      for (const t of o.tests || []) seen.get(k).add(t);
    }
  } else if (observed && Array.isArray(observed.edges)) {
    if (!testRun) throw new Error('dfd-coverage: a reconcile report does not say what was run; pass testRun: true to state that its trace is of the test suite');
    for (const e of observed.edges) {
      const k = pairKey(e.from, e.to);
      if (e.runtimeCoverage !== 'visited' || e.unfalsifiable) continue;
      if (!flowKeys.has(k)) { unmatched++; continue; }
      if (e.existence === 'confirmed') { if (!seen.has(k)) seen.set(k, new Set()); notSeen.delete(k); } else if (!seen.has(k)) notSeen.add(k);
    }
  } else throw new Error('dfd-coverage: applyExercised takes an array of { from, to } pairs or a reconcile report with edges');
  // pairs a measurement looked at and did not see taken; one seen elsewhere stays seen
  for (const m of missed) { const k = pairKey(m.from, m.to); if (flowKeys.has(k) && !seen.has(k)) notSeen.add(k); }
  const scope = entered === null ? null : new Set(entered);
  const count = { exercised: 0, notExercised: 0, unmeasured: 0 };
  const flows = model.flows.map((f) => {
    const k = pairKey(f.from, f.to);
    if (seen.has(k)) {
      count.exercised++;
      const tests = [...seen.get(k)].sort();
      return { ...f, coverage: { exercised: true, ...(tests.length ? { tests } : {}), ...(witness ? { witness } : {}) } };
    }
    if (notSeen.has(k) || (scope && scope.has(f.from))) {
      count.notExercised++;
      return { ...f, coverage: { exercised: false, ...(witness ? { witness } : {}) } };
    }
    count.unmeasured++;
    return f;
  });
  return { model: { ...model, flows }, ...count, unmatched };
}

/**
 * The hops fromCodeFlows draws for one traced record when it places steps in functions (the record
 * carries path.trace; `functionOf` is the same resolver), each with the two trace steps it joins:
 * { from, to, a, b }. The first hop is the input into the first function (a and b are the source
 * step) and the last is the last function into the sink (both are the sink step). A record with no
 * trace gives none.
 */
export function traceHops(record, functionOf) {
  const p = record && record.path;
  if (!p || !Array.isArray(p.trace) || !p.trace.length) return [];
  const place = (st) => {
    const fn = st.file ? functionOf(st.file, st.line) : undefined;
    return fn === undefined ? `code:${record.repo}:${st.file || p.source.file}` : `fn:${record.repo}:${st.file}#${fn ? fn.name : ''}`;
  };
  const first = p.trace[0];
  const hops = [{ from: `input:${record.repo}:${p.source.file}:${p.source.line}`, to: place(first), a: first, b: first }];
  let last = hops[0].to;
  let lastStep = first;
  for (const st of p.trace.slice(1)) {
    const here = place(st);
    if (here !== last) { hops.push({ from: last, to: here, a: lastStep, b: st }); last = here; }
    lastStep = st;
  }
  hops.push({ from: last, to: `sink:${record.repo}:${sinkKindOf(record.rule).category}`, a: lastStep, b: lastStep });
  return hops;
}

/**
 * Which traced hops a test run executed, read from its lcov: a hop is `observed` when both of the
 * lines it joins ran, `missed` when the report instruments both and at least one never ran, and
 * counted `unmeasured` when either line is not in the report. -> { observed, missed, unmeasured },
 * the first two as { from, to } pairs for applyExercised.
 *
 * This says the two lines ran under a test. It does not say the tainted value travelled between
 * them, and it is not a test of any guard: it is the floor under "a test exercises this path".
 */
export function hopsExercisedByLcov(records, lcov, { functionOf, root = null } = {}) {
  const lines = new Map();
  for (const rec of lcov) {
    const file = relativePath(rec.file, root);
    if (file === null) continue;
    if (!lines.has(file)) lines.set(file, new Map());
    for (const [ln, hits] of rec.lines) lines.get(file).set(ln, (lines.get(file).get(ln) || 0) + hits);
  }
  const ran = (st) => { const of = lines.get(st.file); return of && of.has(st.line) ? of.get(st.line) > 0 : null; };
  const state = new Map();
  let unmeasured = 0;
  for (const r of records || []) {
    for (const h of traceHops(r, functionOf)) {
      const a = ran(h.a);
      const b = ran(h.b);
      if (a === null || b === null) { unmeasured++; continue; }
      const k = pairKey(h.from, h.to);
      if (a && b) state.set(k, { from: h.from, to: h.to, seen: true });
      else if (!state.has(k)) state.set(k, { from: h.from, to: h.to, seen: false });
    }
  }
  const pair = ({ from, to }) => ({ from, to });
  return { observed: [...state.values()].filter((x) => x.seen).map(pair), missed: [...state.values()].filter((x) => !x.seen).map(pair), unmeasured };
}

/** CodeQL's step text without its access-path decorations: "[post update] out [settings]" -> "out". */
const bareExpr = (expr) => String(expr).replace(/^\[post update\] /, '').replace(/( \[[^\]]*\])+$/, '');

/**
 * The steps of a traced record whose text is no longer at the place the scan recorded, read through
 * `lineOf(file, line)` (the source line, or null when it cannot be read): -> [{ file, line, expr }].
 * A SARIF document names lines, not a revision, so a scan laid over a later checkout puts each step
 * in whichever function now owns that line number, and a coverage report then answers for the wrong
 * line. A step is checked when the scan gave its columns on one line: the text there must be the
 * step's expression, or begin and end as its abbreviation ("fs.real ... .conf')") does. A step
 * that cannot be checked is not counted: this finds drift, it does not prove its absence.
 */
export function driftedSteps(record, lineOf) {
  const trace = (record && record.path && record.path.trace) || [];
  const out = [];
  for (const st of trace) {
    if (!st.file || !Number.isInteger(st.col) || !Number.isInteger(st.endCol) || !st.expr || st.expr.includes('\\n') || st.expr.includes('\n')) continue;
    const line = lineOf(st.file, st.line);
    const at = line === null || line === undefined ? null : line.slice(st.col - 1, st.endCol - 1);
    const want = bareExpr(st.expr);
    const cut = want.indexOf(' ... ');
    const same = at !== null && (cut < 0 ? at === want : at.startsWith(want.slice(0, cut)) && at.endsWith(want.slice(cut + 5)));
    if (!same) out.push({ file: st.file, line: st.line, expr: st.expr });
  }
  return out;
}

/** Split traced records by driftedSteps: -> { current, drifted: [{ record, steps }] }. A record with no trace is current. */
export function splitDrifted(records, lineOf) {
  const current = [];
  const drifted = [];
  for (const r of records || []) {
    const steps = driftedSteps(r, lineOf);
    if (steps.length) drifted.push({ record: r, steps }); else current.push(r);
  }
  return { current, drifted };
}
