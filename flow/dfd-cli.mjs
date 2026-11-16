// flow/dfd-cli.mjs — draw a data flow diagram from a dfd@1 file, from the flow graph, or from a
// scanned repository (its static pass, its CodeQL code flows, or both).
//
// usage: commitwork dfd --from <dfd.json> [options]
//        commitwork dfd --graph [<flow.json>] [--tests] [--imports] [options]
//        commitwork dfd --repo <path> [--codeql <file>] [options]
//        commitwork dfd --codeql <file> [options]
//        (node flow/dfd-cli.mjs takes the same arguments)
//
// Options are listed in HELP below (`--help` prints them).
//
// exit: 0 written · 2 usage · 20 the document is not a valid dfd@1 · 21 an input is absent, unreadable
//       or not a flow graph, --repo is not a git checkout, --codeql is neither SARIF nor dataflow
//       records, or --coverage is unreadable or holds no lcov record · 22 the filter matched no node, --collapse named a group with no element, the
//       model is larger than --max, or --repo/--codeql found no flow to draw
// env, read at call time: CW_HARNESS_STORE (the flow store directory, default reports/harness; --graph
//       without a path reads flow.json there)
//
// --repo never executes the target's code: its sources are parsed by V8 (vm.SourceTextModule or
// vm.Script, constructed and never linked or run) and read by the mask lexer, and its schedules are
// read from the workflow and crontab text. The pass needs --experimental-vm-modules; without it the
// command runs itself again in a child that has the flag.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, storePath } from './store.mjs';
import { validateDfd, analyse, filterModel, subgraph, taintOnly, scannerOnly } from '../lib/dfd.mjs';
import { fromFlowGraph, fromCodeFlows, mergeModels, unknownOf, fromFindings, issuesFromRecords, applyVerdicts } from './dfd-adapter.mjs';
import { parseLcov, applyLcov, applyExercised, hopsExercisedByLcov, splitDrifted } from './dfd-coverage-adapter.mjs';
import { analyseRepo, isSelf, lsFiles, targetSources, trackedSources } from './static.mjs';
import { dataflowFromResult, traceOf } from '../cra/dataflow-evidence.mjs';
import { functionsOf, functionAt } from '../codegraph/function-at.mjs';
import { readSarif } from '../monitor/sarif-read.mjs';
import { renderHtml, groupSizes, ORIENTATIONS } from '../lib/dfd-render.mjs';
import { renderPathsHtml } from '../lib/dfd-paths-render.mjs';
import { renderMapHtml } from '../lib/dfd-map-render.mjs';
import { renderStoryHtml } from '../lib/dfd-story-render.mjs';
import { renderReplayHtml } from '../lib/dfd-replay-render.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const SELF = fileURLToPath(import.meta.url);

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, INVALID: 20, INPUT: 21, SIZE: 22 });
export const DEFAULT_MAX = 150;

const VALUE_FLAGS = ['from', 'repo', 'codeql', 'prefix', 'focus', 'hops', 'direction', 'collapse', 'collapse-all-groups-over', 'orientation', 'max', 'emit', 'fonts', 'title', 'findings', 'coverage', 'verdicts', 'view', 'out'];
const BOOL_FLAGS = ['tests', 'imports', 'functions', 'taint-only', 'scanner-only', 'issues', 'only-live', 'help'];
const EMIT = ['html', 'model', 'analysis'];
export const VIEWS = Object.freeze(['classic', 'paths', 'map', 'story', 'replay']);
const FONTS = ['inline', 'none', 'served'];
const DIRECTIONS = ['in', 'out', 'both'];
const WHOLE = { hops: 'hops', max: 'max', 'collapse-all-groups-over': 'collapseOver' };

export const USAGE = 'usage: commitwork dfd --from <dfd.json> | --graph [<flow.json>] | --repo <path> [--codeql <file> [--functions]] | --codeql <file>  [--prefix p] [--focus node] [--hops n] [--direction in|out|both] '
  + '[--collapse g[,g]] [--collapse-all-groups-over n] [--orientation LR|TB|auto] [--findings file] [--coverage lcov] [--only-live] [--emit html|model|analysis] [--out file]';

export const HELP = `Draw a data flow diagram (Gane–Sarson) from a dfd@1 file, from commitwork's own flow graph, or
from a scanned repository. \`node flow/dfd-cli.mjs\` takes the same arguments.

${USAGE}

source (exactly one)
  --from <file>       a dfd@1 document, hand-authored or emitted by a tool (schema/dfd.schema.json)
  --graph [<file>]    the flow graph through the adapter; default <CW_HARNESS_STORE>/flow.json,
                      which \`node flow/static.mjs\` or \`node flow/report.mjs\` writes
  --repo <path>       another git checkout: the static pass over its tracked .mjs .cjs .js .jsx .ts
                      .tsx .mts .cts files (TypeScript through node:module stripTypeScriptTypes).
                      Its code is parsed, never run. What it cannot read is counted, never clean
  --codeql <file>     a scanned repository's CodeQL code flows: a SARIF file, or dataflow records
                      (cra/dataflow-evidence.mjs rows, a JSON array or { records: [...] }). With
                      --repo, merged into its static graph: a CodeQL file and a module are one
                      element when their repository-relative paths are equal
  --tests             keep test modules and fixtures (left out by default)
  --imports           keep module-to-module imports as flows (left out by default: not data flows)
  --verdicts <file>   remediation verdicts onto the model's issues: a JSON array of
                      { id | rule+file[+line], verdict: fixed | not-a-defect | not-resolved, reason }.
                      fixed becomes mitigated, not-a-defect becomes dismissed, the reason kept in the
                      note; a dismissals file (reason, no verdict) reads as not-a-defect. Not a rescan.
                      Or an object { prs: [{ id, title, state, files }], verdicts: [...] }: a verdict's
                      "pr" then names the pull request that carries it, and --view map plays them back
  --issues            with --codeql: every result of the scan becomes an issue on the module it sits in
                      (a module with no data flow is added for it); severity is the rule's own
                      security-severity score in CVSS bands, undetermined when the rule gives none
  --taint-only        keep only the flows a value was traced along (CodeQL code flows) and the elements
                      they join; what was left out is counted in the page's banner
  --scanner-only      keep every flow a scanner reported: the traced ones, and the results of rules
                      that trace no value, each drawn at its place (evidence.method pattern)
  --functions         with --repo and --codeql: place every step of each CodeQL trace in the function
                      it sits in, one element per function, grouped by file (.mjs, .cjs, .js)

filter
  --prefix <p>        seed the filter with every node whose label or id starts with <p>
  --focus <node>      seed the filter with one node, by id or label
  --hops <n>          keep everything within n flows of the seeds (default 1)
  --direction <d>     in: follow flows into the seeds only · out: out of them only · both (default)

drawing
  --collapse <g,...>  draw each named group (boundary) as one node; flows across it merge per other
                      end, mode and role, with the count in the label
  --collapse-all-groups-over <n>
                      collapse every group with more than n elements
  --orientation <o>   LR (ranks left to right) | TB (top to bottom) | auto (default: TB when LR is
                      wider than 1600 units and TB is narrower)
  --max <n>           refuse to draw more than n elements (default ${DEFAULT_MAX}), counted after collapsing
  --fonts <mode>      inline (default) | none | served — see lib/house-css.mjs
  --view <view>       classic (default): the whole graph, laid out once, no script · map: any size, groups
                      opened in place on the page, a few dozen boxes at a time · paths: source-to-impact
                      paths with patch timeline, combinations and SARIF fill (needs its script; the
                      document's impacts, gates, patches and nested groups drive it) · story: for a
                      reader who does not know the code: one fixed picture of the findings and
                      what surrounds them, lit a layer at a time (the picture, the lines data
                      follows, the findings, each change set, what is left); shows "plain" names ·
                      replay: change sets step by step on a process flow, beside the file tree
  --title <text>      the diagram's title

findings overlay
  --coverage <file>   an lcov report of a test run: each file element, and with --repo each function
                      element, takes the line and branch coverage the report holds for it. An element
                      the report does not hold stays unmeasured; it is never written as 0%
  --findings <file>   merge a findings overlay onto the model: items carrying an \`at\` ARE the
                      overlay; a commitwork findings.json instead enriches the model's own
                      findings[] (each an id + an \`at\` placement) by id with cwe / severity / title
  --only-live         draw only the live findings — where a CWE is still unremediated and reachable

output
  --emit <what>       html (default) | model (the filtered dfd@1 document, before any collapse) |
                      analysis (the analysis as JSON)
  --out <file>        write there (tmp+rename) and print one summary line; default is stdout
  --help              this text

exit: 0 written · 2 usage · 20 not a valid dfd@1 · 21 an input is absent, unreadable or not a flow
graph, --repo is not a git checkout, or --codeql is neither SARIF nor dataflow records · 22 the
filter matched no node, --collapse named a group with no element, more than --max, or --repo or
--codeql found no flow to draw
`;

/** -> { opts } or { error }. `--graph` takes an optional path. */
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    const next = argv[i + 1];
    if (name === 'graph') opts.graph = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
    else if (a === '-h') opts.help = true;
    else if (BOOL_FLAGS.includes(name)) opts[name] = true;
    else if (VALUE_FLAGS.includes(name)) {
      if (next === undefined) return { error: `--${name} needs a value` };
      opts[name] = argv[++i];
    } else return { error: `unknown argument ${a}` };
  }
  if (opts.help) return { opts };
  const sources = [opts.from !== undefined, opts.graph !== undefined, opts.repo !== undefined || opts.codeql !== undefined].filter(Boolean).length;
  if (opts.functions && (opts.repo === undefined || opts.codeql === undefined)) return { error: '--functions places each CodeQL step in its function, so it needs both --repo <path> (the sources) and --codeql <file> (the traces)' };
  if (sources !== 1) return { error: 'give exactly one source: --from <dfd.json>, --graph [<flow.json>], or --repo <path> and/or --codeql <file>' };
  for (const [flag, key] of Object.entries(WHOLE)) {
    if (opts[flag] === undefined) continue;
    if (!/^\d+$/.test(opts[flag])) return { error: `--${flag} takes a whole number, got ${opts[flag]}` };
    const value = Number(opts[flag]);
    delete opts[flag];
    opts[key] = value;
  }
  if (opts.direction !== undefined) {
    if (!DIRECTIONS.includes(opts.direction)) return { error: `--direction takes one of ${DIRECTIONS.join(', ')}` };
    if (opts.prefix === undefined && opts.focus === undefined) return { error: '--direction needs --prefix or --focus: it says which way to walk from the seeds' };
  }
  if (opts.orientation !== undefined && !ORIENTATIONS.includes(opts.orientation)) return { error: `--orientation takes one of ${ORIENTATIONS.join(', ')}` };
  if (opts.collapse !== undefined) {
    opts.collapse = opts.collapse.split(',').map((g) => g.trim()).filter(Boolean);
    if (!opts.collapse.length) return { error: '--collapse takes one or more group ids, comma-separated' };
  }
  if (opts.emit !== undefined && !EMIT.includes(opts.emit)) return { error: `--emit takes one of ${EMIT.join(', ')}` };
  if (opts.view !== undefined && !VIEWS.includes(opts.view)) return { error: `--view takes one of ${VIEWS.join(', ')}` };
  if (opts.view === 'map' && opts.collapse !== undefined) return { error: '--view map opens and closes groups on the page, so it takes no --collapse' };
  if (opts.view === 'story' && opts.collapse !== undefined) return { error: '--view story chooses what to draw from the findings, so it takes no --collapse' };
  if (opts.view === 'replay' && opts.collapse !== undefined) return { error: '--view replay opens and closes groups on the page, so it takes no --collapse' };
  if (opts.issues && opts.codeql === undefined) return { error: '--issues places a scan\'s results, so it needs --codeql' };
  if (opts.view === 'paths' && opts.collapse !== undefined) return { error: '--view paths draws its own levels from the document\'s nested groups, so it takes no --collapse' };
  if (opts.fonts !== undefined && !FONTS.includes(opts.fonts)) return { error: `--fonts takes one of ${FONTS.join(', ')}` };
  return { opts };
}

function load(path, what) {
  let r;
  try { r = readJson(path); } catch (e) { return { error: e.message }; }
  if (r.state === 'absent') return { error: `${what} not found at ${path}` };
  return { data: r.data };
}

/**
 * (file) -> the functions of that file in the checkout at `root`, as [{ name, line, endLine }], or
 * null when the file cannot be read that way (outside the checkout, unreadable, not a language
 * codegraph's lexer reads, or the lexer bailed). An lcov report names the files, so each path is
 * resolved and refused unless it stays inside `root`.
 */
export function rangeResolver(root, read = (p) => readFileSync(p, 'utf8')) {
  const base = resolve(root);
  return (file) => {
    const full = resolve(base, String(file));
    if (!FUNCTION_SOURCES.test(String(file)) || !full.startsWith(base + sep)) return null;
    try { const r = functionsOf(read(full)); return r.ok ? r.functions : null; } catch { return null; }
  };
}

/**
 * --coverage <file> -> { model, coverage } or { error }. `coverage` counts what applyLcov did:
 * { measured, unmeasured, unmatched, unranged, malformed }. With `repo` (the --repo checkout) a
 * function element is measured over its own lines and an absolute report path under the checkout
 * is placed; without it only file elements are measured. A report that holds no record at all is
 * an input failure: reading it as "nothing covered" would be a zero nobody measured.
 */
export function readCoverage(path, model, repo, read = (p) => readFileSync(p, 'utf8')) {
  let text;
  try { text = read(path); } catch (e) { return { error: `--coverage ${path}: ${e.code || e.message}` }; }
  const records = parseLcov(text);
  if (!records.length) return { error: `--coverage ${path} holds no lcov record (no SF block)${records.malformed ? `; ${records.malformed} line(s) could not be read` : ''}` };
  const root = repo === undefined ? null : resolve(repo);
  const got = applyLcov(model, records, { source: `lcov ${basename(path)}`, ...(root === null ? {} : { root, rangesOf: rangeResolver(root, read) }) });
  return { model: got.model, lcov: records, coverage: { measured: got.matched, unmeasured: got.unmeasured.length, unmatched: got.unmatched.length, unranged: got.unranged.length, malformed: got.malformed } };
}

/** Does this source need the static pass (asynchronous, and V8's module parser)? */
export const needsPass = (opts) => opts.repo !== undefined;

/** A SARIF document's rules by id, the driver's and every extension's. */
export function rulesOf(doc) {
  const out = new Map();
  for (const run of (doc && Array.isArray(doc.runs) ? doc.runs : [])) {
    for (const set of [run?.tool?.driver, ...(Array.isArray(run?.tool?.extensions) ? run.tool.extensions : [])]) {
      for (const r of (set && Array.isArray(set.rules) ? set.rules : [])) if (r && typeof r.id === 'string') out.set(r.id, r);
    }
  }
  return out;
}

/** What --issues needs of one result beyond its record: the line, the rule's score, its first CWE. */
export function issueFacts(result, rules) {
  const props = rules.get(result?.ruleId)?.properties || {};
  const score = Number.parseFloat(props['security-severity']);
  const tag = (Array.isArray(props.tags) ? props.tags : []).find((t) => /^external\/cwe\/cwe-\d+$/i.test(String(t)));
  const line = result?.locations?.[0]?.physicalLocation?.region?.startLine;
  const message = result?.message?.text;
  return { ...(Number.isInteger(line) ? { line } : {}), ...(typeof message === 'string' && message ? { message: message.slice(0, 600) } : {}), ...(Number.isFinite(score) ? { securitySeverity: score } : {}), ...(tag ? { cwe: `CWE-${Number(tag.split('-').pop())}` } : {}) };
}

/**
 * --codeql <file> -> { records } or { error }. A SARIF document goes through the one SARIF reader
 * (monitor/sarif-read.mjs) and each result through dataflowFromResult, attributed to `repo`; a JSON
 * array, or an object with a `records` array, is taken as dataflow records already.
 */
export function readCodeFlows(path, repo, { trace = false } = {}) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { return { error: `--codeql ${path}: ${e.code || e.message}` }; }
  let doc = null;
  try { doc = JSON.parse(text); } catch { /* the reader below names what is wrong with it */ }
  if (Array.isArray(doc)) return { records: doc };
  if (doc && Array.isArray(doc.records)) return { records: doc.records };
  const rec = readSarif(path);
  const rules = rulesOf(doc);
  if (rec.state !== 'ok') return { error: `--codeql ${path} is neither dataflow records nor a readable SARIF document (SARIF state: ${rec.state}${rec.reason ? `, ${rec.reason}` : ''})` };
  return { records: rec.results.map((r) => {
    const row = dataflowFromResult(r, repo, null);
    // --functions needs every step of the trace, which the record's path does not keep
    if (trace && row && row.path) row.path.trace = traceOf(r);
    if (row) Object.assign(row, issueFacts(r, rules));
    return row;
  }).filter(Boolean) };
}

const FUNCTION_SOURCES = /\.(mjs|cjs|js)$/;

/**
 * (file, line) -> the function that line sits in, read from the checkout at `root`:
 * { name, kind } · null for module level · undefined when the file cannot be placed (outside the
 * checkout, unreadable, not a language codegraph's lexer reads, or the lexer bailed). The path comes
 * from a SARIF document, so it is resolved and refused unless it stays inside `root`.
 */
const DRIFT_KEY = 'code flows the source has moved under since the scan';

/** (file, line) -> that source line of a checkout, or null when it cannot be read; one read per file. */
export function sourceLines(root, read = (p) => readFileSync(p, 'utf8')) {
  const base = resolve(root);
  const cache = new Map();
  return (file, line) => {
    if (!cache.has(file)) {
      const full = resolve(base, String(file));
      let lines = null;
      if (full.startsWith(base + sep)) { try { lines = read(full).split(/\r?\n/); } catch { lines = null; } }
      cache.set(file, lines);
    }
    const lines = cache.get(file);
    return lines && line >= 1 && line <= lines.length ? lines[line - 1] : null;
  };
}

export function functionResolver(root, read = (p) => readFileSync(p, 'utf8')) {
  const base = resolve(root);
  const cache = new Map();
  return (file, line) => {
    if (!cache.has(file)) {
      let fns = null;
      const full = resolve(base, String(file));
      if (FUNCTION_SOURCES.test(String(file)) && full.startsWith(base + sep)) {
        try { const r = functionsOf(read(full)); if (r.ok) fns = r.functions; } catch { fns = null; }
      }
      cache.set(file, fns);
    }
    const fns = cache.get(file);
    if (fns === null) return undefined;
    const hit = functionAt(fns, line);
    return hit ? { name: hit.name, kind: hit.kind } : null;
  };
}

/**
 * --repo and/or --codeql -> { model } (the unfiltered dfd@1 document) or { code, error }.
 * Asynchronous when --repo is given: the static pass parses each file with V8.
 */
export async function scannedModel(opts, { env = process.env, analyse: pass = analyseRepo } = {}) {
  let staticModel = null;
  let root = null;
  if (opts.repo !== undefined) {
    root = resolve(opts.repo);
    let files;
    let unsupported = {};
    const self = isSelf(root);
    try {
      lsFiles(root, ['--error-unmatch', '.']);
    } catch {
      return { code: EXIT.INPUT, error: `--repo ${opts.repo} is not a git checkout with tracked files (git ls-files failed)` };
    }
    if (self) files = trackedSources(root);
    else ({ sources: files, unsupported } = targetSources(root));
    const graph = await pass({ root, files, env, self, unsupported });
    staticModel = fromFlowGraph(graph, { tests: !!opts.tests, imports: !!opts.imports, title: opts.title || `data flows of ${basename(root)}` });
    const unknown = unknownOf(graph);
    staticModel.source = { ...staticModel.source, note: `The static pass (flow/static.mjs) over ${basename(root)}'s tracked JS/TS sources: read, never run.`, unknown };
  }
  let codeModel = null;
  let codeRecords = null;
  let allRecords = null;
  let drifted = [];
  if (opts.codeql !== undefined) {
    const repo = root ? basename(root) : basename(dirname(resolve(opts.codeql)));
    const got = readCodeFlows(opts.codeql, repo, { trace: !!opts.functions || !!opts.issues });
    if (got.error) return { code: EXIT.INPUT, error: got.error };
    codeRecords = got.records;
    allRecords = got.records;
    if (opts.functions) {
      // the scan names lines, not a revision: a flow whose steps are no longer where it recorded
      // them would be drawn through whichever functions now own those line numbers
      const split = splitDrifted(got.records, sourceLines(root));
      codeRecords = split.current;
      drifted = split.drifted;
    }
    codeModel = fromCodeFlows(codeRecords, { title: opts.title || `code flows of ${repo}`, ...(opts.functions ? { functionOf: functionResolver(root) } : {}) });
  }
  let model = staticModel && codeModel ? mergeModels(staticModel, codeModel, { root, title: opts.title }) : (staticModel || codeModel);
  if (opts.issues) ({ model } = issuesFromRecords(model, allRecords));
  if (drifted.length) model.source = { ...model.source, omitted: { ...(model.source.omitted || {}), [DRIFT_KEY]: drifted.length } };
  if (!model.nodes.length) {
    const counts = (o) => Object.entries(o || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    const u = model.source.unknown;
    return { code: EXIT.SIZE, error: `nothing to draw: no flow was found (left out: ${counts(model.source.omitted)}${u ? `; not analysed: ${u.unanalysable} of ${u.files} file(s)` : ''})` };
  }
  return { model, records: opts.functions && opts.codeql !== undefined ? codeRecords : null, drifted: drifted.map((d) => ({ rule: d.record.rule, file: d.record.file, at: `${d.steps[0].file}:${d.steps[0].line}`, steps: d.steps.length })) };
}

/**
 * Parsed options -> { model, collapse } (the filtered dfd@1 document and the groups to draw as one
 * node each) or { code, error }. Shared with the panel route, so the two read and refuse alike.
 * `source` is a model already built (scannedModel, or the route's child): it is validated, filtered
 * and collapsed exactly as a loaded one.
 */
export function prepare(opts, { env = process.env, filter = filterModel, source = null, records = null } = {}) {
  let model;
  if (source) model = source;
  else if (opts.from !== undefined) {
    const got = load(opts.from, 'dfd document');
    if (got.error) return { code: EXIT.INPUT, error: got.error };
    model = got.data;
  } else {
    const path = opts.graph === true ? storePath('flow.json', env) : opts.graph;
    const got = load(path, 'flow graph');
    if (got.error) return { code: EXIT.INPUT, error: `${got.error}${opts.graph === true ? ' — run `node flow/static.mjs` to write it' : ''}` };
    if (!got.data || !Array.isArray(got.data.nodes) || !Array.isArray(got.data.edges)) return { code: EXIT.INPUT, error: `${path} is not a flow graph (no nodes and edges arrays)` };
    model = fromFlowGraph(got.data, { tests: !!opts.tests, imports: !!opts.imports, title: opts.title });
    const unknown = unknownOf(got.data);
    if (unknown) model.source = { ...model.source, unknown };
  }
  if (opts.findings !== undefined) {
    const got = load(opts.findings, 'findings overlay');
    if (got.error) return { code: EXIT.INPUT, error: got.error };
    model = fromFindings(model, got.data);
  }
  const valid = validateDfd(model);
  if (!valid.ok) return { code: EXIT.INVALID, error: `not a valid dfd@1 document:\n${valid.errors.map((e) => `  ${e}`).join('\n')}` };
  if (opts.title !== undefined) model = { ...model, title: opts.title };
  let coverage = null;
  let verdicts = null;
  if (opts.coverage !== undefined) {
    const got = readCoverage(opts.coverage, model, opts.repo);
    if (got.error) return { code: EXIT.INPUT, error: got.error };
    ({ model, coverage } = got);
    // with traces placed in functions, the same report says which traced hops a test ran
    if (records && opts.repo !== undefined) {
      const root = resolve(opts.repo);
      const hops = hopsExercisedByLcov(records, got.lcov, { functionOf: functionResolver(root), root });
      const ex = applyExercised(model, hops.observed, { missed: hops.missed, witness: `lcov ${basename(opts.coverage)}: both traced lines ran under the test run` });
      model = ex.model;
      coverage = { ...coverage, hops: { exercised: ex.exercised, notExercised: ex.notExercised, unmeasured: hops.unmeasured } };
    }
  }
  if (opts.verdicts !== undefined) {
    let list;
    try { list = JSON.parse(readFileSync(opts.verdicts, 'utf8')); } catch (e) { return { code: EXIT.INPUT, error: `--verdicts ${opts.verdicts}: ${e.code || 'not JSON'}` }; }
    const got = applyVerdicts(model, Array.isArray(list) ? list : list && list.verdicts, { prs: Array.isArray(list) ? null : list && list.prs });
    model = got.model;
    verdicts = { applied: got.applied, unmatched: got.unmatched.length, ignored: got.ignored.length };
  }
  if (opts['taint-only']) {
    model = subgraph(model, taintOnly);
    if (!model.flows.length) return { code: EXIT.SIZE, error: '--taint-only: the model holds no traced flow (evidence.method taint); CodeQL code flows carry it, the static pass does not' };
  } else if (opts['scanner-only']) {
    model = subgraph(model, scannerOnly);
    if (!model.flows.length) return { code: EXIT.SIZE, error: '--scanner-only: the model holds no flow a scanner reported (evidence.method taint or pattern); --codeql supplies them, the static pass does not' };
  }

  model = filter(model, { prefix: opts.prefix, around: opts.focus, hops: opts.hops ?? 1,
    ...(opts.direction === undefined ? {} : { direction: opts.direction }) });
  if (model === null) return { code: EXIT.SIZE, error: `the filter matched no node (prefix ${JSON.stringify(opts.prefix ?? null)}, focus ${JSON.stringify(opts.focus ?? null)})` };

  const sizes = groupSizes(model);
  const named = opts.collapse || [];
  const absent = named.filter((g) => !sizes.has(g));
  if (absent.length) return { code: EXIT.SIZE, error: `--collapse names no group with an element in the drawing: ${absent.join(', ')}${sizes.size ? ` (groups: ${[...sizes.keys()].join(', ')})` : ''}` };
  const over = opts.collapseOver === undefined ? [] : [...sizes].filter(([, k]) => k > opts.collapseOver).map(([g]) => g);
  const collapse = [...new Set([...named, ...over])];
  return { model, collapse, drawn: model.nodes.length - collapse.reduce((s, g) => s + sizes.get(g) - 1, 0), ...(coverage ? { coverage } : {}), ...(verdicts ? { verdicts } : {}) };
}

/** The prepared model -> the drawing, the document or the analysis, to --out or stdout. -> exit code. */
function emit(opts, got, { stdout, fail }) {
  if (got.error) return fail(got.code, got.error);
  const { model, collapse, drawn } = got;
  const emitWhat = opts.emit || 'html';
  const max = opts.max ?? DEFAULT_MAX;
  if (emitWhat === 'html' && !['map', 'story', 'replay'].includes(opts.view) && drawn > max) {
    return fail(EXIT.SIZE, `${drawn} elements is more than --max ${max}: a diagram that size is not readable. Narrow it with --prefix or --focus (and --hops), collapse groups with --collapse or --collapse-all-groups-over, or raise --max.`);
  }
  let text;
  let stats = null;
  let pathStats = null;
  let mapStats = null;
  let storyStats = null;
  let replayStats = null;
  if (emitWhat === 'model') text = `${JSON.stringify(model, null, 2)}\n`;
  else if (emitWhat === 'analysis') text = `${JSON.stringify(analyse(model), null, 2)}\n`;
  else if (opts.view === 'paths') {
    const got = renderPathsHtml(model, { fonts: opts.fonts || 'inline' });
    text = got.html;
    pathStats = got.stats;
  } else if (opts.view === 'map') {
    const got = renderMapHtml(model, { fonts: opts.fonts || 'inline' });
    text = got.html;
    mapStats = got.stats;
  } else if (opts.view === 'story') {
    const got = renderStoryHtml(model, { fonts: opts.fonts || 'inline' });
    text = got.html;
    storyStats = got.stats;
  } else if (opts.view === 'replay') {
    const got = renderReplayHtml(model, opts.title !== undefined ? { title: opts.title } : {});
    text = got.html;
    replayStats = got.stats;
  } else ({ html: text, stats } = renderHtml(model, { fonts: opts.fonts || 'inline', collapse, orientation: opts.orientation || 'auto', onlyLive: !!opts['only-live'] }));
  if (opts.out === undefined) { stdout.write(text); return EXIT.OK; }
  writeAtomic(opts.out, text, { mkdir: true });
  const pathWord = pathStats ? `, paths view: ${pathStats.paths} path(s), ${pathStats.open} open, ${pathStats.unevaluated} not evaluated, ${pathStats.closed} closed${pathStats.truncated ? ' (cut)' : ''}` : '';
  const mapWord = mapStats ? `, map view: ${mapStats.elements} code element(s), ${mapStats.leaves} folded, ${mapStats.issues} issue(s), ${mapStats.drawn} box(es) drawn at first` : '';
  const storyWord = storyStats ? `, story view: ${storyStats.drawn} box(es) drawn, ${storyStats.hidden} left out, ${storyStats.places} finding(s), ${storyStats.stages} stage(s)` : '';
  const replayWord = replayStats ? `, replay view: ${replayStats.sets} change set(s), ${replayStats.findings} issue(s), ${replayStats.drawable} drawable element(s), ${replayStats.files} file(s)` : '';
  const drawing = replayStats ? replayWord : storyStats ? storyWord : mapStats ? mapWord : pathStats ? pathWord : stats ? `, ${stats.orientation} ${stats.width}x${stats.height}, ${stats.crossings} crossing(s), ${stats.collisions} label collision(s)` : '';
  const u = model.source?.unknown;
  const unknown = u ? `; unknown: ${u.unanalysable} of ${u.files} file(s) not analysed, ${Object.values(u.unsupportedLanguages || {}).reduce((a, b) => a + b, 0)} in other languages, ${u.computedSites} computed site(s)` : '';
  const c = got.coverage;
  const covered = c ? `; coverage: ${c.measured} element(s) measured, ${c.unmeasured} file(s) not in the report, ${c.unmatched} report file(s) with no element, ${c.unranged} function(s) without a range${c.malformed ? `, ${c.malformed} report line(s) unreadable` : ''}` : '';
  const hops = c && c.hops ? `; traced hops: ${c.hops.exercised} run by the tests, ${c.hops.notExercised} not, ${c.hops.unmeasured} on lines the report does not hold` : '';
  const vd = got.verdicts ? `; verdicts: ${got.verdicts.applied} applied, ${got.verdicts.unmatched} naming no issue, ${got.verdicts.ignored} ignored` : '';
  // results of rules that trace no value: on the diagram, and counted so the reader knows which kind
  const sited = new Set(model.flows.filter((f) => f.evidence && f.evidence.method === 'pattern').flatMap((f) => f.evidence.refs || [])).size;
  const pattern = sited ? `; ${sited} result(s) with no code flow drawn at their place, reach not traced` : '';
  const moved = model.source?.omitted?.[DRIFT_KEY];
  const drift = moved ? `; NOT DRAWN: ${moved} code flow(s) whose source has moved since the scan (rescan, or draw at the scanned commit)` : '';
  stdout.write(`dfd: ${stats ? stats.elements : model.nodes.length} elements, ${stats ? stats.flows : model.flows.length} flows -> ${opts.out} (${emitWhat}${drawing})${unknown}${covered}${hops}${vd}${pattern}${drift}\n`);
  return EXIT.OK;
}

/** Run this command again in a child carrying --experimental-vm-modules, its output passed through. */
export function rerunWithVmModules(argv, { env, stdout, stderr, run = spawnSync }) {
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const r = run(process.execPath, ['--experimental-vm-modules', '--no-warnings', SELF, ...argv],
    { env: childEnv, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.stdout) stdout.write(r.stdout);
  if (r.stderr) stderr.write(r.stderr);
  if (r.status === null) { stderr.write(`dfd: the static pass could not run (${r.signal || r.error})\n`); return EXIT.INPUT; }
  return r.status;
}

/**
 * -> the exit code; a Promise of it when the source is --repo or --codeql (the static pass parses
 * asynchronously). --from and --graph stay synchronous.
 */
export function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr, filter = filterModel, vmModules, analyse: pass } = {}) {
  const fail = (code, msg) => { stderr.write(`dfd: ${msg}\n`); return code; };
  const { opts, error } = parseArgs(argv);
  if (error) return fail(EXIT.USAGE, `${error}\n     ${USAGE}\n     (--help lists every option)`);
  if (opts.help) { stdout.write(HELP); return EXIT.OK; }

  if (opts.repo !== undefined || opts.codeql !== undefined) {
    return (async () => {
      const have = vmModules ?? typeof (await import('node:vm')).SourceTextModule === 'function';
      if (needsPass(opts) && !have && !pass) return rerunWithVmModules(argv, { env, stdout, stderr });
      const built = await scannedModel(opts, { env, ...(pass ? { analyse: pass } : {}) });
      if (built.error) return fail(built.code, built.error);
      return emit(opts, prepare(opts, { env, filter, source: built.model, records: built.records }), { stdout, fail });
    })();
  }
  return emit(opts, prepare(opts, { env, filter }), { stdout, fail });
}

if (isMainModule(import.meta.url)) Promise.resolve(main()).then((code) => { process.exitCode = code; });
