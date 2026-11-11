// flow/dfd-cli.mjs — draw a data flow diagram from a dfd@1 file or from the flow graph.
//
// usage: node flow/dfd-cli.mjs --from <dfd.json> [options]
//        node flow/dfd-cli.mjs --graph [<flow.json>] [--tests] [--imports] [options]
//
// Options are listed in HELP below (`--help` prints them).
//
// exit: 0 written · 2 usage · 20 the document is not a valid dfd@1 · 21 an input is absent, unreadable
//       or not a flow graph · 22 the filter matched no node, --collapse named a group with no element,
//       or the model is larger than --max
// env, read at call time: CW_HARNESS_STORE (the flow store directory, default reports/harness; --graph
//       without a path reads flow.json there)

import { readJson, storePath } from './store.mjs';
import { validateDfd, analyse, filterModel } from '../lib/dfd.mjs';
import { fromFlowGraph } from './dfd-adapter.mjs';
import { renderHtml, groupSizes, ORIENTATIONS } from '../lib/dfd-render.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, INVALID: 20, INPUT: 21, SIZE: 22 });
export const DEFAULT_MAX = 150;

const VALUE_FLAGS = ['from', 'prefix', 'focus', 'hops', 'direction', 'collapse', 'collapse-all-groups-over', 'orientation', 'max', 'emit', 'fonts', 'title', 'out'];
const BOOL_FLAGS = ['tests', 'imports', 'help'];
const EMIT = ['html', 'model', 'analysis'];
const FONTS = ['inline', 'none', 'served'];
const DIRECTIONS = ['in', 'out', 'both'];
const WHOLE = { hops: 'hops', max: 'max', 'collapse-all-groups-over': 'collapseOver' };

export const USAGE = 'usage: node flow/dfd-cli.mjs --from <dfd.json> | --graph [<flow.json>]  [--prefix p] [--focus node] [--hops n] [--direction in|out|both] '
  + '[--collapse g[,g]] [--collapse-all-groups-over n] [--orientation LR|TB|auto] [--emit html|model|analysis] [--out file]';

export const HELP = `Draw a data flow diagram (Gane–Sarson) from a dfd@1 file or from the flow graph.

${USAGE}

source (exactly one)
  --from <file>       a dfd@1 document, hand-authored or emitted by a tool (schema/dfd.schema.json)
  --graph [<file>]    the flow graph through the adapter; default <CW_HARNESS_STORE>/flow.json,
                      which \`node flow/static.mjs\` or \`node flow/report.mjs\` writes
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
graph · 22 the filter matched no node, --collapse named a group with no element, or more than --max
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
  if ((opts.from === undefined) === (opts.graph === undefined)) return { error: 'give exactly one of --from <dfd.json> and --graph [<flow.json>]' };
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

/**
 * Parsed options -> { model, collapse } (the filtered dfd@1 document and the groups to draw as one
 * node each) or { code, error }. Shared with the panel route, so the two read and refuse alike.
 */
export function prepare(opts, { env = process.env, filter = filterModel } = {}) {
  let model;
  if (opts.from !== undefined) {
    const got = load(opts.from, 'dfd document');
    if (got.error) return { code: EXIT.INPUT, error: got.error };
    model = got.data;
  } else {
    const path = opts.graph === true ? storePath('flow.json', env) : opts.graph;
    const got = load(path, 'flow graph');
    if (got.error) return { code: EXIT.INPUT, error: `${got.error}${opts.graph === true ? ' — run `node flow/static.mjs` to write it' : ''}` };
    if (!got.data || !Array.isArray(got.data.nodes) || !Array.isArray(got.data.edges)) return { code: EXIT.INPUT, error: `${path} is not a flow graph (no nodes and edges arrays)` };
    model = fromFlowGraph(got.data, { tests: !!opts.tests, imports: !!opts.imports, title: opts.title });
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

export function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr, filter = filterModel } = {}) {
  const fail = (code, msg) => { stderr.write(`dfd: ${msg}\n`); return code; };
  const { opts, error } = parseArgs(argv);
  if (error) return fail(EXIT.USAGE, `${error}\n     ${USAGE}\n     (--help lists every option)`);
  if (opts.help) { stdout.write(HELP); return EXIT.OK; }

  const got = prepare(opts, { env, filter });
  if (got.error) return fail(got.code, got.error);
  const { model, collapse, drawn } = got;

  const emit = opts.emit || 'html';
  const max = opts.max ?? DEFAULT_MAX;
  if (emit === 'html' && drawn > max) {
    return fail(EXIT.SIZE, `${drawn} elements is more than --max ${max}: a diagram that size is not readable. Narrow it with --prefix or --focus (and --hops), collapse groups with --collapse or --collapse-all-groups-over, or raise --max.`);
  }
  let text;
  let stats = null;
  if (emit === 'model') text = `${JSON.stringify(model, null, 2)}\n`;
  else if (emit === 'analysis') text = `${JSON.stringify(analyse(model), null, 2)}\n`;
  else ({ html: text, stats } = renderHtml(model, { fonts: opts.fonts || 'inline', collapse, orientation: opts.orientation || 'auto' }));
  if (opts.out === undefined) { stdout.write(text); return EXIT.OK; }
  writeAtomic(opts.out, text, { mkdir: true });
  const drawing = stats ? `, ${stats.orientation} ${stats.width}x${stats.height}, ${stats.crossings} crossing(s), ${stats.collisions} label collision(s)` : '';
  stdout.write(`dfd: ${stats ? stats.elements : model.nodes.length} elements, ${stats ? stats.flows : model.flows.length} flows -> ${opts.out} (${emit}${drawing})\n`);
  return EXIT.OK;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
