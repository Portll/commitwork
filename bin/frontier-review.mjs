#!/usr/bin/env node
// bin/frontier-review.mjs — draft, emit and check the taint-frontier worksheets (cra/frontier-review.mjs).
//
// usage: node bin/frontier-review.mjs draft <sweep dir> [--repo <name>]
//        node bin/frontier-review.mjs emit [--repo <name>]
//        node bin/frontier-review.mjs status <sweep dir> [--repo <name>]
// draft   merges the sweep's unclaimed frontier calls into <models dir>/<repo>/frontier-review.json,
//         keeping every decision already made
// emit    writes <models dir>/<repo>/frontier-<lib>.yml from the decided sink and summary rows, which
//         bin/codeql-model-pack.mjs then loads into that repository's next CodeQL lane
// status  prints the sweep's frontier with each worksheet applied, as JSON: open, neutral, and the
//         calls decided a sink that are still unclaimed (a model that did not take)
// exit: 0 done; status always, its JSON naming any worksheet it could not use · 1 draft or emit: a
//       worksheet could not be used, or a decision does not validate (named on stderr; nothing is
//       written for that repository) · 2 usage
// env, read at call time: CW_CODEQL_MODELS (via monitor/store-paths.mjs)
//
// Writes only into the private models store, atomically, and only the two files named above. A
// worksheet that exists but cannot be read is never replaced: a draft over it would discard the
// decisions it holds.
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrontier, frontierSummary } from '../cra/taint-frontier.mjs';
import {
  readReview, mergeReview, reviewText, reviewPath, modelsYaml, applyReview,
  generatedModelFile, GENERATED_HEADER,
} from '../cra/frontier-review.mjs';
import { LIBRARY } from './codeql-model-pack.mjs';
import { codeqlModelsDirFor } from '../monitor/store-paths.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const out = { cmd, dir: null, repo: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--repo') out.repo = rest[++i] || null;
    else if (!out.dir) out.dir = rest[i];
    else return { error: `unexpected argument ${rest[i]}` };
  }
  if (!['draft', 'emit', 'status'].includes(cmd)) return { error: 'a command: draft, emit or status' };
  if (cmd !== 'emit' && !out.dir) return { error: `${cmd} takes the sweep directory` };
  if (cmd === 'emit' && out.dir) return { error: 'emit reads the worksheets, not a sweep' };
  return out;
}

/** Library name -> the frontier languages that target it (javascript <- javascript-typescript, javascript). */
const languagesByLib = () => {
  const m = new Map();
  for (const [lang, lib] of Object.entries(LIBRARY)) m.set(lib, [...(m.get(lib) || []), lang]);
  return m;
};

export function draft({ dir, repo = null, modelsDir, log = console.error }) {
  const f = buildFrontier({ dir });
  if (f.state !== 'ok') { log(`frontier-review: the sweep cannot be read (${f.state}: ${f.reason})`); return 1; }
  const source = basename(resolve(dir));
  let code = 0;
  for (const name of Object.keys(f.repos).sort()) {
    if (repo && name !== repo) continue;
    const path = reviewPath(modelsDir, name);
    const got = readReview(path);
    if (got.state !== 'ok' && got.state !== 'absent') {
      log(`frontier-review: ${name}: the worksheet is ${got.state} (${got.reason}) — left as it is, not redrafted`);
      code = 1;
      continue;
    }
    const next = mergeReview(got.review, name, f.repos[name].calls, source);
    writeAtomic(path, reviewText(next), { mkdir: true });
    const open = next.entries.filter((e) => e.decision == null).length;
    log(`frontier-review: ${name}: ${next.entries.length} entries, ${open} undecided -> ${path}`);
  }
  return code;
}

export function emit({ repo = null, modelsDir, log = console.error }) {
  let names;
  try { names = readdirSync(modelsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch (e) {
    if (e.code === 'ENOENT') { log(`frontier-review: no models store at ${modelsDir} — nothing to emit`); return 0; }
    log(`frontier-review: the models store cannot be listed (${e.code || e.message})`);
    return 1;
  }
  let code = 0;
  for (const name of names) {
    if (repo && name !== repo) continue;
    const got = readReview(reviewPath(modelsDir, name));
    if (got.state === 'absent') continue;
    if (got.state !== 'ok') { log(`frontier-review: ${name}: the worksheet is ${got.state} (${got.reason}) — nothing emitted`); code = 1; continue; }
    for (const [lib, langs] of languagesByLib()) {
      const out = join(modelsDir, name, generatedModelFile(lib));
      const y = modelsYaml(got.review, lib, langs);
      if (y && y.invalid.length) {
        for (const i of y.invalid) log(`frontier-review: ${name}: ${i.key}: ${i.reason}`);
        log(`frontier-review: ${name}: ${generatedModelFile(lib)} not written until every decision validates`);
        code = 1;
        continue;
      }
      if (!y) { removeGenerated(out, log); continue; }
      writeAtomic(out, y.text);
      log(`frontier-review: ${name}: ${y.rows} model row(s) -> ${out}`);
    }
  }
  return code;
}

// A generated file whose rows were all undecided is removed — but only one this tool wrote. A file
// without the header is someone's own model and is never touched.
function removeGenerated(path, log) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!text.startsWith(GENERATED_HEADER)) { log(`frontier-review: ${path} was not written by this tool — left in place`); return; }
  rmSync(path);
  log(`frontier-review: no decided rows remain -> removed ${path}`);
}

export function status({ dir, repo = null, modelsDir }) {
  const f = buildFrontier({ dir });
  const names = Object.keys(f.repos || {}).filter((n) => !repo || n === repo).sort();
  const reviews = Object.fromEntries(names.map((n) => [n, readReview(reviewPath(modelsDir, n))]));
  const applied = applyReview({ ...f, repos: Object.fromEntries(names.map((n) => [n, f.repos[n]])) }, reviews);
  const s = frontierSummary(applied);
  const byRepo = {};
  for (const n of names) {
    const r = applied.repos[n];
    const count = (k) => r.calls.filter((c) => c.review === k).length;
    byRepo[n] = { ...s.byRepo[n], review: r.review, neutral: count('neutral'), sinkOpen: count('sink-open'), undecided: count('undecided'), invalid: count('invalid'),
      sinkOpenCalls: r.calls.filter((c) => c.review === 'sink-open').map((c) => ({ language: c.language, api: c.api, param: c.param, file: c.file, line: c.line })) };
  }
  return { state: f.state, reason: f.reason, totals: applied.totals, byRepo };
}

if (isMainModule(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (a.error) {
    console.error(`frontier-review: ${a.error}\nusage: node bin/frontier-review.mjs draft|status <sweep dir> [--repo <name>] · emit [--repo <name>]`);
    process.exit(2);
  }
  const modelsDir = codeqlModelsDirFor(ROOT);
  if (a.cmd === 'status') {
    process.stdout.write(`${JSON.stringify(status({ ...a, modelsDir }), null, 1)}\n`);
    process.exit(0);
  }
  process.exit(a.cmd === 'draft' ? draft({ ...a, modelsDir }) : emit({ ...a, modelsDir }));
}
