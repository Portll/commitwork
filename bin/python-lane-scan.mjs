#!/usr/bin/env node
// commitwork — run a Python scanner (bandit or ruff) once over a repo.
//
// Unlike Go, Python has no module-boundary problem: both tools recursively walk a directory tree
// in a single invocation, so this does not need bin/go-lane-scan.mjs's per-module walk.
//
// THE OUTPUT CONTRACT DIFFERS PER TOOL, verified against real installs (not docs), corrected mid-
// build after the original spec assumed both had SARIF — bandit 1.8.6 does not
// (`-f {csv,custom,html,json,screen,txt,xml,yaml}`, no sarif); ruff 0.16.5 does
// (`--output-format sarif` is real):
//   · bandit: native `-f json`, `{results[], errors[]}` — parsed and re-written as-is.
//   · ruff: `--output-format sarif`, read through the shared monitor/sarif-read.mjs reader.
//
// AND THE EXIT CODE IS EARNED, NEVER ASSERTED: both tools exit non-zero merely for FINDING issues,
// so ran/did-not-run is judged from whether the output actually parses into the expected shape —
// same discipline as go-lane-scan.mjs. A tool that crashed or produced nothing gets no report, so
// the lane degrades to noscan rather than a false clean.
//
// usage: python-lane-scan.mjs --tool bandit|ruff --out <file> --log <file> [--root .]

import { readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readSarif } from '../monitor/sarif-read.mjs';

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const TOOL = arg('tool');
const OUT = arg('out');
const LOG = arg('log');
const ROOT = arg('root', process.cwd());
// AST parsing has no compilation risk, but that is not the same claim as "can't run long" — a
// pathological single generated file still needs a wall-clock bound, the same discipline every
// other lane in security-baseline.json applies.
const TIMEOUT_MS = Number(process.env.CW_PYTHON_LANE_TIMEOUT_MS || 120_000);

if (!TOOL || !OUT || !LOG || !['bandit', 'ruff'].includes(TOOL)) {
  console.error('usage: python-lane-scan.mjs --tool bandit|ruff --out <file> --log <file> [--root .]');
  process.exit(2);
}

const log = (s) => { try { appendFileSync(LOG, s + '\n'); } catch { /* the log is never the reason a scan fails */ } };
try { writeFileSync(LOG, ''); } catch { /* best-effort */ }

log(`python-lane-scan: tool=${TOOL} root=${ROOT} timeoutMs=${TIMEOUT_MS}`);

if (TOOL === 'bandit') {
  // -o WRITES THE JSON, rather than us parsing stdout. bandit interleaves progress text with its
  // report on STDOUT — measured 2026-09-02 on yt-dlp: 1,671,511 bytes beginning `Working...`, so
  // JSON.parse died on `Unexpected token 'W'` and this lane refused (correctly, fail-closed) and
  // published nothing. It had passed minutes earlier on a small tree, because bandit only emits the
  // progress line once a scan is long enough to warrant one. A lane that works on small
  // repositories and goes dark on large ones is the worst version of this failure: the repos where
  // it silently stops are exactly the ones with the most to find.
  //
  // Stripping a preamble would work too and is wrong — it makes the parser responsible for guessing
  // where a tool's chatter ends, and the next release moves that boundary. A separate channel has
  // no boundary to guess.
  const outTmp = `${OUT}.raw`;
  const r = spawnSync('bandit',
    ['-r', ROOT, '-f', 'json', '-o', outTmp, '-x', '.git,__pycache__,.tox,.eggs,venv,.venv,node_modules'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS });
  if (r.error) { log(`REFUSING: bandit could not run (${r.error.code || r.error.message}) — not installed, or timed out.`); try { if (existsSync(OUT)) rmSync(OUT); } catch {} process.exit(1); }
  if (r.stderr) log(r.stderr.trim().split('\n').slice(0, 12).join('\n'));
  log(`exit=${r.status} stdout=${(r.stdout || '').length}B report=${existsSync(outTmp) ? 'written' : 'ABSENT'}`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(outTmp, 'utf8')); } catch (e) {
    log(`REFUSING to report a scan: bandit's report at ${outTmp} is absent or did not parse (${e.message}). `
      + 'Removing the report so this lane reads as noscan, not clean.');
    try { if (existsSync(OUT)) rmSync(OUT); } catch {}
    try { if (existsSync(outTmp)) rmSync(outTmp); } catch {}
    process.exit(1);
  }
  try { rmSync(outTmp); } catch { /* the parsed copy is what ships */ }
  // errors[] means bandit itself failed on some input (e.g. a syntax error in a scanned file) —
  // real signal, distinct from a finding, logged rather than silently dropped.
  if (Array.isArray(parsed.errors) && parsed.errors.length) {
    log(`bandit reported ${parsed.errors.length} error(s) while scanning: ${JSON.stringify(parsed.errors).slice(0, 400)}`);
  }
  if (!Array.isArray(parsed.results)) {
    log('REFUSING to report a scan: bandit JSON has no results[] array — not the shape this lane expects. '
      + 'Removing the report.');
    try { if (existsSync(OUT)) rmSync(OUT); } catch {}
    process.exit(1);
  }
  writeFileSync(OUT, JSON.stringify(parsed, null, 1));
  log(`wrote ${OUT}: ${parsed.results.length} result(s), ${(parsed.errors || []).length} error(s)`);
  process.exit(0);
}

// ruff
// --no-cache: the host sandbox denies writes to the scanned tree, and ruff's default .ruff_cache
// there makes it exit 2 with no output on any clone that has not already got one.
const r = spawnSync('ruff',
  ['check', ROOT, '--no-cache', '--output-format', 'sarif', '--select', 'E,F,W,C90', '--ignore', 'S'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS });
if (r.error) { log(`REFUSING: ruff could not run (${r.error.code || r.error.message}) — not installed, or timed out.`); try { if (existsSync(OUT)) rmSync(OUT); } catch {} process.exit(1); }
if (r.stderr) log(r.stderr.trim().split('\n').slice(0, 12).join('\n'));
log(`exit=${r.status} stdout=${(r.stdout || '').length}B`);
if (!r.stdout || !r.stdout.trim()) {
  log('REFUSING to report a scan: ruff produced no stdout. Removing the report so this lane reads as noscan, not clean.');
  try { if (existsSync(OUT)) rmSync(OUT); } catch {}
  process.exit(1);
}
writeFileSync(OUT, r.stdout);
const part_r = readSarif(OUT);
if (part_r.state !== 'ok') {
  log(`REFUSING to report a scan: ruff's SARIF did not parse (${part_r.state}: ${part_r.reason || ''}). Removing the report.`);
  try { rmSync(OUT); } catch {}
  process.exit(1);
}
const results = part_r.runs.reduce((n, run) => n + (Array.isArray(run.results) ? run.results.length : 0), 0);
log(`wrote ${OUT}: ${part_r.runs.length} run(s), ${results} result(s)`);
process.exit(0);
