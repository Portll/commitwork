#!/usr/bin/env node
// platform-support — record what a CI job's test run measured on one platform, and check that the
// platform statements in docs/SCOPE.md and docs/PLATFORM-SEAMS.md quote that record.
//
// usage: node bin/platform-support.mjs --run <id> [--repo <owner/name>] [--platform windows] [--dry]
//        node bin/platform-support.mjs --log <file> --run-id <id> [--head-sha <sha>] [--node <v>]
//             [--platform <p>] [--measured-at <iso>] [--job <name>] [--dry]
//        node bin/platform-support.mjs --check
// --run reads the run and each job whose name names the platform through `gh` (read-only: run view
// and its log); --log parses a saved job log instead. Both the spec and the TAP reporter are read.
// Only what the log shows is recorded: a step whose output was discarded measured nothing.
// `failing` names the tests that failed on their own; a parent failed only by a subtest is counted
// in `fail` and not named.
// --check: every doc must state each record as
//   "<Platform> CI measured <YYYY-MM-DD> at `<sha>`, Node <version>: N pass / M fail / K skipped"
// exit: 0 written, or the docs quote the record under --check · 20 --check: a doc's statement
//       differs from the record, or a doc states none · 21 a log, run, record or doc could not be
//       read or parsed · 22 usage · 23 nothing measured: a job's log has no test totals, the job
//       did not complete, no job matched, or --check found no record
// env, read at call time: CW_PLATFORM_SUPPORT_ROOT (docs root, default this checkout),
//   CW_PLATFORM_SUPPORT_RECORD (record path, default <root>/reports/platform-support.json)
// output: the record via writeAtomic; no generation timestamp, so re-runs are byte-identical

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXIT = { OK: 0, DRIFT: 20, UNREADABLE: 21, USAGE: 22, UNMEASURED: 23 };
export const DOCS = ['docs/SCOPE.md', 'docs/PLATFORM-SEAMS.md'];
const PLATFORMS = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

const rootDir = () => resolve(process.env.CW_PLATFORM_SUPPORT_ROOT || join(HERE, '..'));
const recordPath = () => resolve(process.env.CW_PLATFORM_SUPPORT_RECORD
  || join(rootDir(), 'reports', 'platform-support.json'));
const fail = (exitCode, msg) => Object.assign(new Error(msg), { exitCode });

// `gh run view --log` prefixes `job<TAB>step<TAB>timestamp `; the raw API log only the timestamp.
// gh renders ESC as the two characters `^[`.
const PREFIX = /^(?:[^\t\n]*\t[^\t\n]*\t)?\uFEFF?(\d{4}-\d\d-\d\dT[\d:.]+Z) ?/;
const ANSI = /(?:\x1b|\^\[)\[[0-9;]*m/g;
const DURATION = /\s+\(\d+(?:\.\d+)?m?s\)/;
const KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];

export function splitLog(text) {
  let last = null;
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((raw) => {
    const m = raw.match(PREFIX);
    if (m) last = m[1];
    return (m ? raw.slice(m[0].length) : raw).replace(ANSI, '');
  });
  return { lines, lastTimestamp: last };
}

const clean = (s) => s.replace(DURATION, '').trim();
const reasonOf = (directive) => directive.replace(/^SKIP\b\s*/i, '').trim();

function relLocation(loc, workdir) {
  if (!loc) return null;
  let p = loc.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/:\d+:\d+$/, '');
  const w = workdir?.replace(/\\/g, '/').replace(/\/$/, '');
  if (w && p.toLowerCase().startsWith(`${w.toLowerCase()}/`)) p = p.slice(w.length + 1);
  return p;
}

// One record's measurements from a job log: totals summed over every reporter summary in it.
export function parseLog(text) {
  const { lines, lastTimestamp } = splitLog(text);
  const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let blocks = 0;
  let inBlock = false;
  let group = null;                 // test files named by the current `Run` step's script
  let blockFiles = [];
  const testFiles = [];
  const failing = [];
  const specInline = [];            // ✖ lines, used only when no `failing tests:` section exists
  const specParents = new Set();
  let specSection = false;
  let sawSection = false;
  let pendingLoc = null;
  let skip = 0;
  let skippedWithReason = 0;
  let workdir = null;
  let headSha = null;
  let nodeVersion = null;
  let platform = null;
  let tap = null;                   // a not-ok test point whose YAML block is being read

  const finishTap = () => {
    if (tap && tap.failureType !== 'subtestsFailed' && tap.type !== 'suite') {
      failing.push({ name: tap.name, file: tap.file });
    }
    tap = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    let m;

    if ((m = line.match(/^Working directory is '(.+)'$/))) workdir = m[1];
    if (!headSha && (m = line.match(/ fetch .* origin \+([0-9a-f]{40}):/))) headSha = m[1];
    if (!nodeVersion && (m = line.match(/[\\/]node[\\/](\d+\.\d+\.\d+)[\\/]/) || line.match(/^Acquiring (\d+\.\d+\.\d+) - /))) {
      nodeVersion = m[1];
    }
    if (!platform && line === '##[group]Operating System') {
      const os = (lines[i + 1] || '').toLowerCase();
      platform = os.includes('windows') ? 'windows' : os.includes('ubuntu') || os.includes('linux') ? 'linux'
        : os.includes('macos') || os.includes('mac os') ? 'macos' : null;
    }

    if (line.startsWith('##[group]Run ')) { finishTap(); group = []; specSection = false; continue; }
    if (line.startsWith('##[endgroup]')) {
      if (group) { blockFiles = group; group = null; }
      continue;
    }
    if (group) {
      for (const f of line.matchAll(/[\w./*-]+\.test\.mjs/g)) group.push(f[0]);
      continue;
    }

    // Reporter summaries: spec `ℹ tests 9`, TAP `# tests 9`.
    if ((m = t.match(/^(?:ℹ|#) (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d+(?:\.\d+)?)$/))) {
      if (m[1] === 'tests') { blocks++; inBlock = true; testFiles.push(...blockFiles); blockFiles = []; }
      if (inBlock && m[1] !== 'duration_ms') totals[m[1]] += Number(m[2]);
      if (m[1] === 'duration_ms') inBlock = false;
      continue;
    }

    // TAP test points.
    if ((m = line.match(/^(\s*)(not ok|ok) \d+ - (.*?)(?: # (TODO|SKIP)\b ?(.*))?$/))) {
      finishTap();
      const [, , status, name, directive, reason] = m;
      if (directive === 'SKIP') { skip++; if (reason?.trim()) skippedWithReason++; }
      if (status === 'not ok' && directive !== 'TODO' && directive !== 'SKIP') {
        tap = { name: name.trim(), file: null, failureType: null, type: null, indent: m[1].length };
      }
      continue;
    }
    if (tap) {
      if ((m = t.match(/^location: '(.*)'$/))) tap.file = m[1];
      else if ((m = t.match(/^failureType: '(.*)'$/))) tap.failureType = m[1];
      else if ((m = t.match(/^type: '(.*)'$/))) tap.type = m[1];
      else if (/^(?:# Subtest:|1\.\.\d+$)/.test(t)) finishTap();
      continue;
    }

    // Spec reporter.
    if (t === '✖ failing tests:') { specSection = true; sawSection = true; continue; }
    if (specSection) {
      if ((m = t.match(/^test at (.+)$/))) { pendingLoc = m[1]; continue; }
      if ((m = t.match(/^✖ (.+)$/)) && pendingLoc !== null) {
        failing.push({ name: clean(m[1]), file: pendingLoc });
        pendingLoc = null;
        continue;
      }
      if (/^⚠ /.test(t)) { pendingLoc = null; continue; }
      if (/^##\[/.test(line)) specSection = false;
      continue;
    }
    if ((m = t.match(/^﹣ (.+?)(?:\s+\(\d+(?:\.\d+)?m?s\))?(?: # (.*))?$/))) {
      skip++;
      if (m[2] && reasonOf(m[2])) skippedWithReason++;
      continue;
    }
    if ((m = t.match(/^▶ (.+)$/))) { specParents.add(clean(m[1])); continue; }
    if ((m = t.match(/^✖ (.+)$/))) specInline.push(clean(m[1]));
  }
  finishTap();
  if (!sawSection) {
    for (const name of specInline) if (!specParents.has(name)) failing.push({ name, file: null });
  }

  const named = failing
    .map((f) => ({ name: f.name, file: relLocation(f.file, workdir) }))
    .sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.name.localeCompare(b.name));
  return {
    blocks, totals, skip, skippedWithReason, failing: named,
    testFiles: [...new Set(testFiles)],
    headSha, nodeVersion, platform, lastTimestamp,
  };
}

export function toRecord(parsed, meta) {
  if (!parsed.blocks) throw fail(EXIT.UNMEASURED, `${meta.job || 'log'}: no test totals in the log — nothing was measured`);
  const byFile = {};
  for (const f of parsed.failing) byFile[f.file ?? '(unknown)'] = (byFile[f.file ?? '(unknown)'] || 0) + 1;
  return {
    platform: meta.platform || parsed.platform,
    node: meta.node || parsed.nodeVersion,
    runId: String(meta.runId),
    job: meta.job ?? null,
    headSha: meta.headSha || parsed.headSha,
    measuredAt: meta.measuredAt || parsed.lastTimestamp,
    tests: parsed.totals.tests,
    pass: parsed.totals.pass,
    fail: parsed.totals.fail,
    skip: parsed.totals.skipped,
    cancelled: parsed.totals.cancelled,
    todo: parsed.totals.todo,
    skippedWithReason: parsed.skippedWithReason,
    failing: parsed.failing.map((f) => (f.file ? `${f.file} > ${f.name}` : f.name)),
    failingByFile: Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b))),
    testFiles: parsed.testFiles,
    summaries: parsed.blocks,
  };
}

const MISSING = ['platform', 'node', 'headSha', 'measuredAt'];
function assertComplete(rec) {
  const gaps = MISSING.filter((k) => !rec[k]);
  if (gaps.length) throw fail(EXIT.USAGE, `the log does not state ${gaps.join(', ')}; pass it as a flag`);
  return rec;
}

export function serialize(records) {
  const sorted = [...records].sort((a, b) => a.platform.localeCompare(b.platform)
    || a.node.localeCompare(b.node, undefined, { numeric: true }) || String(a.job).localeCompare(String(b.job)));
  return `${JSON.stringify({ generatedBy: 'bin/platform-support.mjs', records: sorted }, null, 2)}\n`;
}

function gh(args, cwd) {
  try {
    return execFileSync('gh', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw fail(EXIT.UNREADABLE, `gh ${args.slice(0, 3).join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}

export function measureRun({ runId, repo, platform = 'windows', exec = gh, cwd = rootDir() }) {
  const repoArgs = repo ? ['--repo', repo] : [];
  let run;
  try {
    run = JSON.parse(exec(['run', 'view', String(runId), ...repoArgs, '--json', 'headSha,jobs'], cwd));
  } catch (e) {
    throw e.exitCode ? e : fail(EXIT.UNREADABLE, `run ${runId}: unparseable gh output: ${e.message}`);
  }
  const want = new RegExp(PLATFORMS[platform] || String(platform).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const jobs = (run.jobs || []).filter((j) => want.test(j.name));
  if (!jobs.length) throw fail(EXIT.UNMEASURED, `run ${runId}: no job names ${platform}`);
  return jobs.map((j) => {
    if (j.status && j.status !== 'completed') throw fail(EXIT.UNMEASURED, `run ${runId}: job "${j.name}" is ${j.status}`);
    const log = exec(['run', 'view', String(runId), ...repoArgs, '--log', '--job', String(j.databaseId)], cwd);
    const parsed = parseLog(log);
    return assertComplete(toRecord(parsed, {
      platform, runId, job: j.name, headSha: run.headSha, measuredAt: j.completedAt,
    }));
  });
}

const flat = (s) => s.replace(/\s+/g, ' ');
const STATEMENT = /\b(Windows|Linux|macOS) CI measured (\d{4}-\d{2}-\d{2}) at `([0-9a-f]{7,40})`, Node (\d+(?:\.\d+)*): (\d+) pass \/ (\d+) fail \/ (\d+) skipped/g;

export function statementsIn(text) {
  return [...flat(String(text)).matchAll(STATEMENT)].map((m) => ({
    platform: m[1], date: m[2], sha: m[3], node: m[4], pass: +m[5], fail: +m[6], skip: +m[7],
  }));
}

export const statementFor = (r) =>
  `${PLATFORMS[r.platform] || r.platform} CI measured ${r.measuredAt.slice(0, 10)} at \`${r.headSha.slice(0, 8)}\`, `
  + `Node ${r.node}: ${r.pass} pass / ${r.fail} fail / ${r.skip} skipped`;

// Drift lines for one doc: each record must be stated once, and every statement must match one.
export function compare(records, statements, doc) {
  const out = [];
  const label = (r) => PLATFORMS[r.platform] || r.platform;
  const covered = new Set(records.map(label));
  const matches = (s, r) => s.platform === label(r) && s.node === r.node && s.date === r.measuredAt.slice(0, 10)
    && r.headSha.startsWith(s.sha) && s.pass === r.pass && s.fail === r.fail && s.skip === r.skip;
  for (const r of records) {
    if (!statements.some((s) => matches(s, r))) out.push(`${doc}: does not state "${statementFor(r)}"`);
  }
  for (const s of statements) {
    if (covered.has(s.platform) && !records.some((r) => matches(s, r))) {
      out.push(`${doc}: states ${s.platform} Node ${s.node} ${s.date} \`${s.sha}\` ${s.pass}/${s.fail}/${s.skip}, which no record holds`);
    }
  }
  return out;
}

function readText(path, what) {
  try { return readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT' && what === 'record') throw fail(EXIT.UNMEASURED, `no record at ${path} — nothing measured to check against`);
    throw fail(EXIT.UNREADABLE, `${what} ${path}: ${e.message}`);
  }
}

export function check() {
  const path = recordPath();
  let records;
  try { ({ records } = JSON.parse(readText(path, 'record'))); } catch (e) {
    throw e.exitCode ? e : fail(EXIT.UNREADABLE, `record ${path}: ${e.message}`);
  }
  if (!Array.isArray(records) || !records.length) throw fail(EXIT.UNMEASURED, `record ${path} holds no measurement`);
  const drift = [];
  for (const doc of DOCS) drift.push(...compare(records, statementsIn(readText(join(rootDir(), doc), 'doc')), doc));
  return drift;
}

function parseArgs(argv) {
  const opts = {};
  const valued = new Set(['--run', '--repo', '--platform', '--log', '--run-id', '--head-sha', '--node', '--measured-at', '--job']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check' || a === '--dry') opts[a.slice(2)] = true;
    else if (valued.has(a) && argv[i + 1] !== undefined) opts[a.slice(2)] = argv[++i];
    else throw fail(EXIT.USAGE, `unknown or incomplete argument: ${a}`);
  }
  const modes = ['check', 'run', 'log'].filter((k) => opts[k]);
  if (modes.length !== 1) throw fail(EXIT.USAGE, 'give exactly one of --run <id>, --log <file>, --check');
  if (opts.log && !opts['run-id']) throw fail(EXIT.USAGE, '--log needs --run-id');
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.check) {
    const drift = check();
    if (drift.length) {
      for (const d of drift) console.error(d);
      return EXIT.DRIFT;
    }
    console.log(`platform-support: ${DOCS.join(' and ')} quote ${recordPath()}`);
    return EXIT.OK;
  }
  const records = opts.run
    ? measureRun({ runId: opts.run, repo: opts.repo, platform: opts.platform || 'windows' })
    : [assertComplete(toRecord(parseLog(readText(resolve(opts.log), 'log')), {
      platform: opts.platform, runId: opts['run-id'], job: opts.job, headSha: opts['head-sha'],
      node: opts.node, measuredAt: opts['measured-at'],
    }))];
  const body = serialize(records);
  if (opts.dry) process.stdout.write(body);
  else {
    writeAtomic(recordPath(), body, { mkdir: true });
    for (const r of records) console.log(`${statementFor(r)} (run ${r.runId}${r.job ? `, ${r.job}` : ''}) -> ${recordPath()}`);
  }
  return EXIT.OK;
}

if (isMainModule(import.meta.url)) {
  try { process.exitCode = main(); } catch (e) {
    console.error(`platform-support: ${e.message}`);
    process.exitCode = e.exitCode ?? EXIT.UNREADABLE;
  }
}
