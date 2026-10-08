#!/usr/bin/env node
// joern-lane — run joern-scan once per language its query bundle has queries for, each with an
// explicit --language, and keep the JVM's stderr beside the result.
//
// Measured 2026-09-18 on joern 4.0.620, and the reason each part exists:
//   · The bundle's 58 queries target c, java, kotlin, php, android and ghidra. Left to guess, joern
//     builds a graph for the tree's dominant language, so a JS repository cost commitwork an hour and
//     C and PHP queries matched Go and TS method names by regex — out of every query's contract —
//     while the C file in a mostly-JS tree was never read.
//   · Auto-detect and `--language` both reach a generated `importCode.<name>(...)`, and the names
//     `pythonsrc` and `javasrc` are not ImportCode members: the script does not compile, exit 1.
//     `java` is the working name for javasrc2cpg (joernwork/patches/03).
//   · The distribution launcher sends the JVM's stderr to the literal /tmp/joern-scan-log.txt,
//     which every joern-scan on the box truncates. The launcher's own text is run here with that
//     one path replaced, `$0` still the launcher so its path resolution and retry-on-2 are intact.
//
// usage: joern-lane.mjs <src> <reportDir> <excludeRegex>
// writes: joern.txt (per-language stdout, each section headed `# joern-lane …`), joern-lane.json,
//         joern-<language>.log (that run's JVM stderr). Exit 0 all scanned, 1 any failed, 3 nothing
//         in a covered language, 2 usage, 127 no readable joern-scan launcher.

import { readFileSync, readdirSync, realpathSync, openSync, closeSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, delimiter, relative } from 'node:path';
import { dirExcluder } from './scan-exclusions.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const TMP_LOG = '/tmp/joern-scan-log.txt';

// Query language → the frontend name that compiles, and the sources it reads. `android` queries run
// on java and kotlin graphs. ghidra needs a binary input this lane does not pass, so it is reported
// as unmapped rather than silently dropped.
export const FRONTENDS = Object.freeze([
  { id: 'c', language: 'c', queryLanguages: ['c'], exts: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx'] },
  { id: 'java', language: 'java', queryLanguages: ['java', 'android'], exts: ['.java'] },
  { id: 'kotlin', language: 'kotlin', queryLanguages: ['kotlin', 'android'], exts: ['.kt', '.kts'] },
  { id: 'php', language: 'php', queryLanguages: ['php'], exts: ['.php'] },
]);
export const COVERED_EXTS = Object.freeze(FRONTENDS.flatMap((f) => f.exts));
const FALLBACK_QUERY_LANGUAGES = ['c', 'java', 'kotlin', 'php', 'android'];
const FALLBACK_TAGS = 'default,badfn,remote-code-execution,sql-injection,xss,path-traversal,uaf,integers,cryptography,misconfiguration,insecure-network-traffic,setxid,race-condition,magic-hash,strings,posix,badimpl,android';

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function onPath(name, env = process.env) {
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * The launcher to run and how. A Homebrew shim (`JAVA_HOME=… exec "<launcher>" "$@"`) is followed to
 * the launcher it names, keeping its JAVA_HOME default. `captured` is false when the launcher's text
 * does not carry the /tmp literal, in which case it runs as-is and the stderr is not ours to read.
 */
export function resolveLauncher(env = process.env) {
  const given = env.CW_JOERN_SCAN || onPath('joern-scan', env);
  if (!given) return null;
  // A launcher that exists but cannot be resolved or read (EACCES, a dangling link) is the same
  // answer as one that is absent: there is no launcher to run. Throwing out of the lane instead
  // would exit with a stack trace the runner reads as a result.
  try {
    let path = realpathSync(given);
    let text = readFileSync(path, 'utf8');
    let javaHome = null;
    const shim = !text.includes(TMP_LOG) && /\bexec\s+"([^"]+)"/.exec(text);
    if (shim) {
      const jh = /JAVA_HOME:-([^}"]+)\}/.exec(text);
      if (jh) javaHome = jh[1];
      path = realpathSync(shim[1]);
      text = readFileSync(path, 'utf8');
    }
    return { path, text, javaHome, captured: text.includes(TMP_LOG) };
  } catch { return null; }
}

// The patched launcher text and its path travel in the environment, never in a shell line: the
// inner shell runs the text with `$0` set to the launcher, as if it had been exec'd.
const TRAMPOLINE = 'exec /bin/sh -c "$CW_JOERN_TEXT" "$CW_JOERN_LAUNCHER" "$@"';

/** One joern-scan invocation. stdout → outPath, the JVM's stderr → errPath when captured. */
export function runJoern(launcher, args, { cwd, outPath, errPath, env = process.env }) {
  const runEnv = { ...env, ...(launcher.javaHome && !env.JAVA_HOME ? { JAVA_HOME: launcher.javaHome } : {}) };
  const out = openSync(outPath, 'w');
  try {
    const r = launcher.captured
      ? spawnSync('/bin/sh', ['-c', TRAMPOLINE, 'joern-lane', ...args], {
        cwd, stdio: ['ignore', out, 'pipe'],
        env: { ...runEnv, CW_JOERN_TEXT: launcher.text.split(TMP_LOG).join(shq(errPath)), CW_JOERN_LAUNCHER: launcher.path },
      })
      : spawnSync(launcher.path, args, { cwd, env: runEnv, stdio: ['ignore', out, 'pipe'] });
    return { status: r.status, signal: r.signal, error: r.error ? r.error.code || r.error.message : null, launcherStderr: String(r.stderr || '') };
  } finally { closeSync(out); }
}

/** Query languages and tags from a dumped query db; null when it cannot be read. */
export function readQueryDb(path) {
  let q; try { q = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  const list = Array.isArray(q) ? q : (q && q.queries) || null;
  if (!Array.isArray(list) || !list.length) return null;
  const languages = {}; const tags = new Set();
  for (const x of list) {
    if (x && x.language) languages[x.language] = (languages[x.language] || 0) + 1;
    for (const t of (x && x.tags) || []) if (t !== 'metrics') tags.add(t);
  }
  return { languages: Object.fromEntries(Object.entries(languages).sort(([a], [b]) => (a < b ? -1 : 1))), tags: [...tags].sort() };
}

/** Source files per frontend, walking the tree the way the exclusion policy prunes it. */
export function countSources(root, excluded = dirExcluder()) {
  const counts = Object.fromEntries(FRONTENDS.map((f) => [f.id, 0]));
  const byExt = new Map(FRONTENDS.flatMap((f) => f.exts.map((e) => [e, f.id])));
  const unreadable = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) {
      if (e.code !== 'ENOENT') unreadable.push(relative(root, dir) || '.');
      continue;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) { if (!excluded(relative(root, abs))) stack.push(abs); continue; }
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf('.');
      const id = dot > 0 ? byExt.get(e.name.slice(dot).toLowerCase()) : null;
      if (id) counts[id]++;
    }
  }
  return { counts, unreadable: unreadable.sort() };
}

const ANSI = /\[[0-9;]*m/g;
// Most specific first: a compile error's E008 header names only the temp script; the line after it
// names the member that does not exist.
const WHY = [/is not a member/, /\[ERROR\]| ERROR /, /Exception|could not|Could not/, /^Error|not found/i];
/** The line that says why a run failed, from its stderr then its stdout. */
export function failureLine(...texts) {
  const lines = texts.flatMap((t) => String(t || '').replace(ANSI, '').split('\n').map((l) => l.replace(/^\|\s*/, '').trim())
    .filter((l) => l && !l.startsWith('WARNING:') && !/^at /.test(l)));
  for (const re of WHY) {
    const hit = lines.find((l) => re.test(l));
    if (hit) return hit.slice(0, 240);
  }
  return null;
}

const scanRanIn = (txt) => /^Result: /m.test(txt) || txt.includes('ScanPass completed');

// 127, the shell's "command not found": the runner reduces coverage only on exit > 1 because 1 is
// the found-something convention for several tools, so a lane that never found its binary must not
// share that code with "a language failed".
export const EXIT_NO_LAUNCHER = 127;

export function runLane(src, reportDir, rx, env = process.env) {
  const say = (s) => process.stderr.write(`joern-lane: ${s}\n`);
  const launcher = resolveLauncher(env);
  if (!launcher) { say('joern-scan is not on PATH, or its launcher cannot be read'); return EXIT_NO_LAUNCHER; }

  // Everything in flight lives under one directory named for this run. Two sweeps on one repo share
  // reportDir, and fixed names let each delete the other's workspace or read a half-written query db.
  const runId = env.CW_JOERN_RUN_ID || `${process.pid}-${Date.now().toString(36)}`;
  const runDir = join(reportDir, `joern-run-${runId}`);
  const dumpDir = join(runDir, 'dump');
  mkdirSync(dumpDir, { recursive: true });
  const qdbPath = join(runDir, 'querydb.json');
  const dump = runJoern(launcher, ['--dump-to', qdbPath], { cwd: dumpDir, outPath: join(dumpDir, 'out.txt'), errPath: join(dumpDir, 'err.txt'), env });
  const db = readQueryDb(qdbPath);
  const queryLanguages = db ? Object.keys(db.languages) : FALLBACK_QUERY_LANGUAGES;
  const tags = db && db.tags.length ? db.tags.join(',') : FALLBACK_TAGS;
  const mapped = new Set(FRONTENDS.flatMap((f) => f.queryLanguages));
  const unmapped = queryLanguages.filter((l) => !mapped.has(l));

  const { counts, unreadable } = countSources(src, dirExcluder());
  const present = FRONTENDS.filter((f) => counts[f.id] > 0 && f.queryLanguages.some((l) => queryLanguages.includes(l)));
  const dumpExit = dump.status === null ? (dump.signal || dump.error || 'no status') : dump.status;
  const record = {
    tool: 'joern-lane',
    launcher: { stderrCaptured: launcher.captured },
    querydb: { source: db ? 'dump' : 'fallback', languages: db ? db.languages : null, tags: tags.split(','),
      ...(db ? {} : { fallbackReason: `query db dump unreadable (dump exit ${dumpExit}); languages and tags are the lane's hardcoded lists` }) },
    unmapped, sourceCounts: counts, unreadableDirs: unreadable, languages: [],
  };
  const jsonPath = join(reportDir, 'joern-lane.json');
  const publish = () => writeAtomic(jsonPath, `${JSON.stringify(record, null, 2)}\n`);

  if (!present.length) {
    publish();
    rmSync(runDir, { recursive: true, force: true });
    say(`no source in a language the query bundle covers (${FRONTENDS.map((f) => f.id).join(', ')}) — nothing to scan`);
    return 3;
  }

  // Every planned language is on record BEFORE it runs, as a failure. A kill at the lane's time cap
  // then leaves a sidecar that names what never finished, rather than one listing only the languages
  // that did and so certifying them as the whole repository.
  for (const f of present) {
    record.languages.push({ id: f.id, language: f.language, files: counts[f.id], exit: null, scanRan: false, results: 0,
      reason: 'not completed: the lane ended before this language finished scanning' });
  }
  publish();

  const sections = [];
  for (const [i, f] of present.entries()) {
    const work = join(runDir, `work-${f.id}`);
    mkdirSync(work, { recursive: true });
    const outPath = join(runDir, `${f.id}.txt`);
    const errPath = join(runDir, `${f.id}.log`);
    const r = runJoern(launcher, [src, '--overwrite', '--language', f.language, '--tags', tags, '--frontend-args', '--exclude-regex', rx],
      { cwd: work, outPath, errPath, env });
    rmSync(work, { recursive: true, force: true });
    const stdout = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    // Gated on the file existing, not on the launcher's shape: a launcher whose text names the /tmp
    // path but never redirects to it produces no file, and claiming captured stderr then is a lie.
    const haveErr = existsSync(errPath);
    const stderr = haveErr ? readFileSync(errPath, 'utf8') : r.launcherStderr;
    const ran = scanRanIn(stdout);
    const exit = r.status === null ? (r.signal ? `signal ${r.signal}` : r.error || 'no status') : r.status;
    const ok = exit === 0 && ran;
    const row = { id: f.id, language: f.language, files: counts[f.id], exit, scanRan: ran,
      results: (stdout.match(/^Result: /gm) || []).length };
    if (!ok) {
      row.reason = failureLine(stderr, stdout)
        || (ran ? `exited ${exit} after its scan pass` : `exited ${exit} with no scan pass${haveErr ? '' : ' (stderr went to the shared /tmp log and is not attributable to this run)'}`);
    }
    record.languages[i] = row;
    if (haveErr) writeAtomic(join(reportDir, `joern-${f.id}.log`), stderr);
    sections.push(`# joern-lane language=${f.id} exit=${exit} files=${counts[f.id]}\n${stdout}${stdout.endsWith('\n') || !stdout ? '' : '\n'}`);
    // Published after each language, not once at the end: what has run is on disk before the next
    // language starts.
    writeAtomic(join(reportDir, 'joern.txt'), sections.join(''));
    publish();
    say(ok ? `${f.id}: scanned ${counts[f.id]} file(s), ${row.results} result line(s)` : `${f.id}: FAILED — ${row.reason}`);
  }

  // Removed only on a normal finish: after a kill the half-written stdout is the only evidence.
  rmSync(runDir, { recursive: true, force: true });
  const failed = record.languages.filter((l) => l.reason);
  if (failed.length) say(`${failed.length} of ${record.languages.length} language(s) failed: ${failed.map((l) => `${l.id} — ${l.reason}`).join('; ')}`);
  return failed.length ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  const [src, reportDir, rx] = process.argv.slice(2);
  if (!src || !reportDir || !rx) {
    process.stderr.write('usage: joern-lane.mjs <src> <reportDir> <excludeRegex>\n');
    process.exit(2);
  }
  process.exit(runLane(src, reportDir, rx));
}
