#!/usr/bin/env node
// commitwork — run a Go scanner ONCE PER MODULE, not once per repo.
//
// WHY THIS EXISTS. govulncheck and gosec both take `./...`, which is scoped to the module rooted at
// the CURRENT directory. Run at a repo root that contains no go.mod, govulncheck does not scan
// nothing-and-report-clean — it refuses outright: "govulncheck only works with Go modules. Try
// navigating to your module directory." The lane then recorded a void for repos that are, in fact,
// full of Go. Measured on the 100randomrepos corpus 2026-08-21: 13 of 29 Go repos carried their
// go.mod one or more levels down (1Panel-dev_1Panel has TWO — core/ and agent/; coze-dev_coze-loop
// has backend/; agentscope-ai_AgentTeams has agentteams-controller/). Walking to the modules and
// scanning each turned those voids into findings: coze-loop +3,924, 1Panel +622, AgentTeams +186.
//
// THE OUTPUT CONTRACT DIFFERS PER TOOL, and getting it wrong is silent:
//   · govulncheck -format json emits a STREAM of concatenated objects. Appending a second module's
//     stream is valid — monitor/extractors.mjs splits on the top-level brace boundary and dedupes
//     by osv+reachability. So this concatenates.
//   · gosec -fmt sarif emits ONE JSON DOCUMENT. Appending a second would produce two concatenated
//     documents and an unparseable file. So this merges runs[] instead.
//
// AND THE EXIT CODE IS EARNED, NEVER ASSERTED. Neither tool's exit code separates "ran clean" from
// "never ran": gosec exits non-zero merely for FINDING issues, and govulncheck exits 3 on findings
// and non-zero on load failure. So success is judged from the OUTPUT, and when nothing real was
// produced this deletes the report and exits non-zero, so the lane degrades to noscan rather than
// leaving an empty-but-valid file that reads as a clean scan. A concrete case this catches:
// govulncheck built against an older Go than a module requires emits ONLY its `config` banner and
// exits — 289 bytes that an earlier version of this logic scored as a clean pass.
//
// usage: go-lane-scan.mjs --tool govulncheck|gosec --out <file> --log <file> [--root .] [--max-depth 4]

import { writeFileSync, existsSync, rmSync, mkdtempSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { readSarif } from '../monitor/sarif-read.mjs';
import { walkGoModules } from './lib/go-modules.mjs';

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const TOOL = arg('tool');
const OUT = arg('out');
const LOG = arg('log');
const ROOT = arg('root', process.cwd());
const MAX_DEPTH = Number(arg('max-depth', '4'));

if (!TOOL || !OUT || !LOG || !['govulncheck', 'gosec', 'golangci'].includes(TOOL)) {
  console.error('usage: go-lane-scan.mjs --tool govulncheck|gosec|golangci --out <file> --log <file> [--root .] [--max-depth N]');
  process.exit(2);
}

const log = (s) => { try { appendFileSync(LOG, s + '\n'); } catch { /* the log is never the reason a scan fails */ } };
try { writeFileSync(LOG, ''); } catch {}

// ── find the modules ────────────────────────────────────────────────────────────────────────
// The repo root is included in the walk, so a conventional single-module repo behaves exactly as
// it did before this file existed. Shared with the CodeQL Go lane: one walk, one skip list.
const { modules, unexplored } = walkGoModules(ROOT, MAX_DEPTH);

log(`go-lane-scan: tool=${TOOL} root=${ROOT} maxDepth=${MAX_DEPTH}`);
log(`modules found: ${modules.length}${modules.length ? ` -> ${modules.map((m) => relative(ROOT, m) || '.').join(', ')}` : ''}`);

if (unexplored.length) {
  log(`walk stopped at maxDepth=${MAX_DEPTH}; subdirectories below these were not searched, so a module there is not scanned: ${unexplored.map((m) => relative(ROOT, m) || '.').join(', ')}`);
}

if (!modules.length) {
  // No module at any depth. This is genuinely "nothing to scan" rather than a failure, but it is
  // still NOT a clean scan — leave no report, so the lane reads as a void.
  log('no go.mod at any depth — nothing to scan; leaving no report so this reads as noscan, not clean');
  try { if (existsSync(OUT)) rmSync(OUT); } catch {}
  process.exit(1);
}

// ── run per module ──────────────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cw-go-lane-'));
let attempted = 0;
const streamParts = [];
const sarifRuns = [];
let sarifParsed = 0;

for (const mod of modules) {
  attempted++;
  const rel = relative(ROOT, mod) || '.';
  log(`== module: ${rel}`);
  if (TOOL === 'govulncheck') {
    const r = spawnSync('govulncheck', ['-format', 'json', './...'], { cwd: mod, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.stderr) log(r.stderr.trim().split('\n').slice(0, 12).join('\n'));
    if (r.stdout) streamParts.push(r.stdout);
    log(`   exit=${r.status} stdout=${(r.stdout || '').length}B`);
  } else {
    const part = join(tmp, `${attempted}.sarif`);
    // golangci-lint emits SARIF 2.1.0 with driver `golangci-lint` and ruleId = the LINTER name
    // (errcheck, ineffassign, …), so it merges through the same reader as gosec. Like gosec it
    // exits non-zero merely for finding issues, which is why the status is logged and never used
    // as the ran/did-not-run signal — that decision is made from the parsed output below.
    const r = TOOL === 'golangci'
      ? spawnSync('golangci-lint', ['run', '--output.sarif.path', part, './...'],
        { cwd: mod, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      : spawnSync('gosec', ['-quiet', '-fmt', 'sarif', '-out', part, '-exclude-dir=.git', '-exclude-dir=vendor', './...'],
        { cwd: mod, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.stderr) log(r.stderr.trim().split('\n').slice(0, 8).join('\n'));
    log(`   exit=${r.status}`);
    // The shared reader classifies each part; only `ok` contributes runs. Its non-ok states are
    // the discrimination this lane used to hand-roll.
    const part_r = readSarif(part);
    if (part_r.state === 'ok') { sarifRuns.push(...part_r.runs); sarifParsed++; }
    else if (part_r.state !== 'absent') log(`   part ${part_r.state}: ${part_r.reason || ''}`.trimEnd());
  }
}
try { rmSync(tmp, { recursive: true, force: true }); } catch {}
log(`modules attempted: ${attempted}`);

// ── decide, from the OUTPUT, whether anything real was produced ─────────────────────────────
if (TOOL === 'govulncheck') {
  const raw = streamParts.join('');
  let objects = 0, substantive = 0, findings = 0;
  for (const chunk of raw.split(/\n(?=\{)/)) {
    const t = chunk.trim(); if (!t) continue;
    try {
      const o = JSON.parse(t); if (!o) continue;
      objects++;
      if (o.finding) { findings++; substantive++; }
      else if (o.progress || o.osv) substantive++;
    } catch { /* a malformed chunk is not evidence of anything */ }
  }
  // `config` is govulncheck's BANNER, printed before it attempts the scan. A config-only stream is
  // the signature of a run that analysed nothing — most often a Go toolchain older than the module
  // requires. Accepting it as output is how a 289-byte banner became a clean bill of health.
  if (substantive === 0) {
    log(`REFUSING to report a scan: ${objects} object(s), none substantive — banner only, so no package was analysed. `
      + 'Removing the report so this lane reads as noscan rather than clean.');
    try { if (existsSync(OUT)) rmSync(OUT); } catch {}
    process.exit(1);
  }
  writeFileSync(OUT, raw);
  log(`wrote ${OUT}: ${objects} object(s), ${substantive} substantive, ${findings} finding record(s)`);
  process.exit(0);
}

if (sarifParsed === 0) {
  log('REFUSING to report a scan: no parseable SARIF part from any module. '
    + 'Removing the report so this lane reads as noscan rather than clean.');
  try { if (existsSync(OUT)) rmSync(OUT); } catch {}
  process.exit(1);
}
const doc = { version: '2.1.0', runs: sarifRuns };
doc['$schema'] = 'https://json.schemastore.org/sarif-2.1.0.json';
writeFileSync(OUT, JSON.stringify(doc, null, 1));
const results = sarifRuns.reduce((n, r) => n + (Array.isArray(r.results) ? r.results.length : 0), 0);
log(`wrote ${OUT}: merged ${sarifParsed} part(s), ${sarifRuns.length} run(s), ${results} result(s)`);
process.exit(0);
