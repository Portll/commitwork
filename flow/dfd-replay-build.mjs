// flow/dfd-replay-build.mjs — write the replay page of a dfd@1 document: change sets step by step,
// the process flow beside a file tree.
//
// usage: node flow/dfd-replay-build.mjs <doc.dfd.json> <out.html> [--verdicts <file>] [--title <t>]
//          [--label <l>] [--chip <c>] [--as-of <when>]
//
// exit: 0 written · 2 usage · 20 the document (or the document with its verdicts) is not a valid
//       dfd@1 · 21 an input is absent or not JSON, or the page cannot be written

import { readFileSync } from 'node:fs';
import { validateDfd } from '../lib/dfd.mjs';
import { applyVerdicts } from './dfd-adapter.mjs';
import { renderReplayHtml } from '../lib/dfd-replay-render.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, INVALID: 20, INPUT: 21 });
export const USAGE = 'usage: node flow/dfd-replay-build.mjs <doc.dfd.json> <out.html> [--verdicts <file>] [--title <t>] [--label <l>] [--chip <c>] [--as-of <when>]';
const VALUED = Object.freeze({ '--verdicts': 'verdicts', '--title': 'title', '--label': 'label', '--chip': 'chip', '--as-of': 'asOf' });

/** Arguments -> { input, output, verdicts?, page: { title?, label?, chip?, asOf? } }, or { error }. */
export function parseArgs(argv) {
  const pos = [];
  const got = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (Object.hasOwn(VALUED, a)) {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      got[VALUED[a]] = argv[i += 1];
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else pos.push(a);
  }
  if (pos.length !== 2) return { error: 'needs one document and one output path' };
  const { verdicts, ...page } = got;
  return { input: pos[0], output: pos[1], ...(verdicts !== undefined ? { verdicts } : {}), page };
}

const readJsonFile = (read, path) => {
  try { return { value: JSON.parse(read(path)) }; } catch (err) { return { error: `${path}: ${err.code === 'ENOENT' ? 'absent' : err.message}` }; }
};
const problems = (v) => v.errors.slice(0, 10).map((e) => `  ${e}`).join('\n');

/** Build the page. Streams and file access are injected; returns the exit code. */
export function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, read = (p) => readFileSync(p, 'utf8'), write = (p, d) => writeAtomic(p, d), apply = applyVerdicts } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { stdout.write(`${USAGE}\n`); return EXIT.OK; }
  if (opts.error) { stderr.write(`${opts.error}\n${USAGE}\n`); return EXIT.USAGE; }
  const doc = readJsonFile(read, opts.input);
  if (doc.error) { stderr.write(`${doc.error}\n`); return EXIT.INPUT; }
  let model = doc.value;
  const first = validateDfd(model);
  if (!first.ok) { stderr.write(`${opts.input}: not a valid dfd@1\n${problems(first)}\n`); return EXIT.INVALID; }
  if (opts.verdicts !== undefined) {
    const list = readJsonFile(read, opts.verdicts);
    if (list.error) { stderr.write(`${list.error}\n`); return EXIT.INPUT; }
    const v = list.value;
    const got = apply(model, Array.isArray(v) ? v : v && v.verdicts, { prs: Array.isArray(v) ? null : v && v.prs });
    model = got.model;
    stdout.write(`verdicts: ${got.applied} applied, ${got.unmatched.length} naming no issue, ${got.ignored.length} ignored\n`);
    const second = validateDfd(model);
    if (!second.ok) { stderr.write(`${opts.input} with ${opts.verdicts}: not a valid dfd@1\n${problems(second)}\n`); return EXIT.INVALID; }
  }
  const page = Object.fromEntries(Object.entries(opts.page).filter(([, v]) => v !== undefined));
  const { html, stats } = renderReplayHtml(model, page);
  try { write(opts.output, html); } catch (err) { stderr.write(`${opts.output}: ${err.message}\n`); return EXIT.INPUT; }
  for (const s of stats.steps) stdout.write(`step ${s.step}: ${s.open} open, ${s.dealt} dealt with · ${s.title}\n`);
  stdout.write(`${opts.output}: ${stats.bytes} bytes · ${stats.elements} elements (${stats.drawable} drawable) · ${stats.flows} flows · ${stats.findings} issues · ${stats.sets} change sets · ${stats.files} files\n`);
  return EXIT.OK;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
