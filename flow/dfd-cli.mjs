// flow/dfd-cli.mjs — draw a data flow diagram from a dfd@1 file or from the flow graph.
//
// usage: node flow/dfd-cli.mjs --from <dfd.json> [options]
//        node flow/dfd-cli.mjs --graph [<flow.json>] [--tests] [--imports] [options]
//
//   --from <file>      a dfd@1 document, hand-authored or emitted by a tool (schema/dfd.schema.json)
//   --graph [<file>]   the flow graph through the adapter; default <CW_HARNESS_STORE>/flow.json,
//                      which `node flow/static.mjs` or `node flow/report.mjs` writes
//   --tests            keep test modules and fixtures (left out by default)
//   --imports          keep module-to-module imports as flows (left out by default: not data flows)
//   --prefix <p>       seed the filter with every node whose label or id starts with <p>
//   --focus <node>     seed the filter with one node, by id or label
//   --hops <n>         keep everything within n flows of the seeds (default 1)
//   --max <n>          refuse to draw more than n elements (default 150); filter, or raise it
//   --emit <what>      html (default) | model (the dfd@1 document) | analysis (the analysis as JSON)
//   --fonts <mode>     inline (default) | none | served — see lib/house-css.mjs
//   --title <text>     the diagram's title
//   --out <file>       write there (tmp+rename) and print one summary line; default is stdout
//
// exit: 0 written · 2 usage · 20 the document is not a valid dfd@1 · 21 an input is absent, unreadable
//       or not a flow graph · 22 the filter matched no node, or the model is larger than --max
// env, read at call time: CW_HARNESS_STORE (the flow store directory, default reports/harness; --graph
//       without a path reads flow.json there)

import { readJson, storePath } from './store.mjs';
import { validateDfd, analyse, fromFlowGraph, filterModel } from '../lib/dfd.mjs';
import { renderHtml } from '../lib/dfd-render.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, INVALID: 20, INPUT: 21, SIZE: 22 });
export const DEFAULT_MAX = 150;

const VALUE_FLAGS = ['from', 'prefix', 'focus', 'hops', 'max', 'emit', 'fonts', 'title', 'out'];
const BOOL_FLAGS = ['tests', 'imports'];
const EMIT = ['html', 'model', 'analysis'];
const FONTS = ['inline', 'none', 'served'];

/** -> { opts } or { error }. `--graph` takes an optional path. */
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    const next = argv[i + 1];
    if (name === 'graph') opts.graph = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
    else if (BOOL_FLAGS.includes(name)) opts[name] = true;
    else if (VALUE_FLAGS.includes(name)) {
      if (next === undefined) return { error: `--${name} needs a value` };
      opts[name] = argv[++i];
    } else return { error: `unknown argument ${a}` };
  }
  if ((opts.from === undefined) === (opts.graph === undefined)) return { error: 'give exactly one of --from <dfd.json> and --graph [<flow.json>]' };
  for (const k of ['hops', 'max']) {
    if (opts[k] === undefined) continue;
    if (!/^\d+$/.test(opts[k])) return { error: `--${k} takes a whole number, got ${opts[k]}` };
    opts[k] = Number(opts[k]);
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

export function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const fail = (code, msg) => { stderr.write(`dfd: ${msg}\n`); return code; };
  const { opts, error } = parseArgs(argv);
  if (error) return fail(EXIT.USAGE, `${error}\n     usage: node flow/dfd-cli.mjs --from <dfd.json> | --graph [<flow.json>]  [--prefix p] [--focus node] [--hops n] [--emit html|model|analysis] [--out file]`);

  let model;
  if (opts.from !== undefined) {
    const got = load(opts.from, 'dfd document');
    if (got.error) return fail(EXIT.INPUT, got.error);
    model = got.data;
  } else {
    const path = opts.graph === true ? storePath('flow.json', env) : opts.graph;
    const got = load(path, 'flow graph');
    if (got.error) return fail(EXIT.INPUT, `${got.error}${opts.graph === true ? ' — run `node flow/static.mjs` to write it' : ''}`);
    if (!got.data || !Array.isArray(got.data.nodes) || !Array.isArray(got.data.edges)) return fail(EXIT.INPUT, `${path} is not a flow graph (no nodes and edges arrays)`);
    model = fromFlowGraph(got.data, { tests: !!opts.tests, imports: !!opts.imports, title: opts.title });
  }
  const valid = validateDfd(model);
  if (!valid.ok) return fail(EXIT.INVALID, `not a valid dfd@1 document:\n${valid.errors.map((e) => `  ${e}`).join('\n')}`);
  if (opts.title !== undefined) model = { ...model, title: opts.title };

  model = filterModel(model, { prefix: opts.prefix, focus: opts.focus, hops: opts.hops ?? 1 });
  if (model === null) return fail(EXIT.SIZE, `the filter matched no node (prefix ${JSON.stringify(opts.prefix ?? null)}, focus ${JSON.stringify(opts.focus ?? null)})`);

  const emit = opts.emit || 'html';
  const max = opts.max ?? DEFAULT_MAX;
  if (emit === 'html' && model.nodes.length > max) {
    return fail(EXIT.SIZE, `${model.nodes.length} elements is more than --max ${max}: a diagram that size is not readable. Narrow it with --prefix or --focus (and --hops), or raise --max.`);
  }
  const text = emit === 'model' ? `${JSON.stringify(model, null, 2)}\n`
    : emit === 'analysis' ? `${JSON.stringify(analyse(model), null, 2)}\n`
      : renderHtml(model, { fonts: opts.fonts || 'inline' }).html;
  if (opts.out === undefined) { stdout.write(text); return EXIT.OK; }
  writeAtomic(opts.out, text, { mkdir: true });
  stdout.write(`dfd: ${model.nodes.length} elements, ${model.flows.length} flows -> ${opts.out} (${emit})\n`);
  return EXIT.OK;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
