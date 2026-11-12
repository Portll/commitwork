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
//       or not a flow graph, --repo is not a git checkout, or --codeql is neither SARIF nor dataflow
//       records · 22 the filter matched no node, --collapse named a group with no element, the
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
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, storePath } from './store.mjs';
import { validateDfd, analyse, filterModel } from '../lib/dfd.mjs';
import { fromFlowGraph, fromCodeFlows, mergeModels, unknownOf } from './dfd-adapter.mjs';
import { analyseRepo, isSelf, lsFiles, targetSources, trackedSources } from './static.mjs';
import { dataflowFromResult } from '../cra/dataflow-evidence.mjs';
import { readSarif } from '../monitor/sarif-read.mjs';
import { renderHtml, groupSizes, ORIENTATIONS } from '../lib/dfd-render.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const SELF = fileURLToPath(import.meta.url);

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, INVALID: 20, INPUT: 21, SIZE: 22 });
export const DEFAULT_MAX = 150;

const VALUE_FLAGS = ['from', 'repo', 'codeql', 'prefix', 'focus', 'hops', 'direction', 'collapse', 'collapse-all-groups-over', 'orientation', 'max', 'emit', 'fonts', 'title', 'out'];
const BOOL_FLAGS = ['tests', 'imports', 'help'];
const EMIT = ['html', 'model', 'analysis'];
const FONTS = ['inline', 'none', 'served'];
const DIRECTIONS = ['in', 'out', 'both'];
const WHOLE = { hops: 'hops', max: 'max', 'collapse-all-groups-over': 'collapseOver' };

export const USAGE = 'usage: commitwork dfd --from <dfd.json> | --graph [<flow.json>] | --repo <path> [--codeql <file>] | --codeql <file>  [--prefix p] [--focus node] [--hops n] [--direction in|out|both] '
  + '[--collapse g[,g]] [--collapse-all-groups-over n] [--orientation LR|TB|auto] [--emit html|model|analysis] [--out file]';

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
  --title <text>      the diagram's title

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
  if (opts.fonts !== undefined && !FONTS.includes(opts.fonts)) return { error: `--fonts takes one of ${FONTS.join(', ')}` };
  return { opts };
}

function load(path, what) {
  let r;
  try { r = readJson(path); } catch (e) { return { error: e.message }; }
  if (r.state === 'absent') return { error: `${what} not found at ${path}` };
  return { data: r.data };
}

/** Does this source need the static pass (asynchronous, and V8's module parser)? */
export const needsPass = (opts) => opts.repo !== undefined;

/**
 * --codeql <file> -> { records } or { error }. A SARIF document goes through the one SARIF reader
 * (monitor/sarif-read.mjs) and each result through dataflowFromResult, attributed to `repo`; a JSON
 * array, or an object with a `records` array, is taken as dataflow records already.
 */
export function readCodeFlows(path, repo) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { return { error: `--codeql ${path}: ${e.code || e.message}` }; }
  let doc = null;
  try { doc = JSON.parse(text); } catch { /* the reader below names what is wrong with it */ }
  if (Array.isArray(doc)) return { records: doc };
  if (doc && Array.isArray(doc.records)) return { records: doc.records };
  const rec = readSarif(path);
  if (rec.state !== 'ok') return { error: `--codeql ${path} is neither dataflow records nor a readable SARIF document (SARIF state: ${rec.state}${rec.reason ? `, ${rec.reason}` : ''})` };
  return { records: rec.results.map((r) => dataflowFromResult(r, repo, null)).filter(Boolean) };
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
  if (opts.codeql !== undefined) {
    const repo = root ? basename(root) : basename(dirname(resolve(opts.codeql)));
    const got = readCodeFlows(opts.codeql, repo);
    if (got.error) return { code: EXIT.INPUT, error: got.error };
    codeModel = fromCodeFlows(got.records, { title: opts.title || `code flows of ${repo}` });
  }
  const model = staticModel && codeModel ? mergeModels(staticModel, codeModel, { root, title: opts.title }) : (staticModel || codeModel);
  if (!model.nodes.length) {
    const counts = (o) => Object.entries(o || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    const u = model.source.unknown;
    return { code: EXIT.SIZE, error: `nothing to draw: no flow was found (left out: ${counts(model.source.omitted)}${u ? `; not analysed: ${u.unanalysable} of ${u.files} file(s)` : ''})` };
  }
  return { model };
}

/**
 * Parsed options -> { model, collapse } (the filtered dfd@1 document and the groups to draw as one
 * node each) or { code, error }. Shared with the panel route, so the two read and refuse alike.
 * `source` is a model already built (scannedModel, or the route's child): it is validated, filtered
 * and collapsed exactly as a loaded one.
 */
export function prepare(opts, { env = process.env, filter = filterModel, source = null } = {}) {
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
  const valid = validateDfd(model);
  if (!valid.ok) return { code: EXIT.INVALID, error: `not a valid dfd@1 document:\n${valid.errors.map((e) => `  ${e}`).join('\n')}` };
  if (opts.title !== undefined) model = { ...model, title: opts.title };

  model = filter(model, { prefix: opts.prefix, around: opts.focus, hops: opts.hops ?? 1,
    ...(opts.direction === undefined ? {} : { direction: opts.direction }) });
  if (model === null) return { code: EXIT.SIZE, error: `the filter matched no node (prefix ${JSON.stringify(opts.prefix ?? null)}, focus ${JSON.stringify(opts.focus ?? null)})` };

  const sizes = groupSizes(model);
  const named = opts.collapse || [];
  const absent = named.filter((g) => !sizes.has(g));
  if (absent.length) return { code: EXIT.SIZE, error: `--collapse names no group with an element in the drawing: ${absent.join(', ')}${sizes.size ? ` (groups: ${[...sizes.keys()].join(', ')})` : ''}` };
  const over = opts.collapseOver === undefined ? [] : [...sizes].filter(([, k]) => k > opts.collapseOver).map(([g]) => g);
  const collapse = [...new Set([...named, ...over])];
  return { model, collapse, drawn: model.nodes.length - collapse.reduce((s, g) => s + sizes.get(g) - 1, 0) };
}

/** The prepared model -> the drawing, the document or the analysis, to --out or stdout. -> exit code. */
function emit(opts, got, { stdout, fail }) {
  if (got.error) return fail(got.code, got.error);
  const { model, collapse, drawn } = got;
  const emitWhat = opts.emit || 'html';
  const max = opts.max ?? DEFAULT_MAX;
  if (emitWhat === 'html' && drawn > max) {
    return fail(EXIT.SIZE, `${drawn} elements is more than --max ${max}: a diagram that size is not readable. Narrow it with --prefix or --focus (and --hops), collapse groups with --collapse or --collapse-all-groups-over, or raise --max.`);
  }
  let text;
  let stats = null;
  if (emitWhat === 'model') text = `${JSON.stringify(model, null, 2)}\n`;
  else if (emitWhat === 'analysis') text = `${JSON.stringify(analyse(model), null, 2)}\n`;
  else ({ html: text, stats } = renderHtml(model, { fonts: opts.fonts || 'inline', collapse, orientation: opts.orientation || 'auto' }));
  if (opts.out === undefined) { stdout.write(text); return EXIT.OK; }
  writeAtomic(opts.out, text, { mkdir: true });
  const drawing = stats ? `, ${stats.orientation} ${stats.width}x${stats.height}, ${stats.crossings} crossing(s), ${stats.collisions} label collision(s)` : '';
  const u = model.source?.unknown;
  const unknown = u ? `; unknown: ${u.unanalysable} of ${u.files} file(s) not analysed, ${Object.values(u.unsupportedLanguages || {}).reduce((a, b) => a + b, 0)} in other languages, ${u.computedSites} computed site(s)` : '';
  stdout.write(`dfd: ${stats ? stats.elements : model.nodes.length} elements, ${stats ? stats.flows : model.flows.length} flows -> ${opts.out} (${emitWhat}${drawing})${unknown}\n`);
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
      return emit(opts, prepare(opts, { env, filter, source: built.model }), { stdout, fail });
    })();
  }
  return emit(opts, prepare(opts, { env, filter }), { stdout, fail });
}

if (isMainModule(import.meta.url)) Promise.resolve(main()).then((code) => { process.exitCode = code; });
