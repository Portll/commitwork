// Reuse a lane's result when nothing it reads has changed.
//
// A lane may declare `reuse` in the manifest only if its output is a function of inputs this module
// can name: the files on disk under the scanned tree, the lane's own definition and the commitwork
// files it executes, the tool versions, the CW_* settings its command reads (and the file a setting
// names), and the query packs the tool loads locally. Lanes that consult live data (advisory
// databases, registries, GitHub's API, credential verifiers) never declare it. Every input goes into
// one key; any input that cannot be read means no reuse, never a guess.
//
// Modes (CW_LANE_REUSE, with CW_LANE_CACHE naming the cache):
//   off     nothing here runs
//   verify  every lane runs; the output is compared with the cached one for the same key and the
//           match is journalled. This is the evidence that reuse is safe before it is turned on.
//   on      a key hit restores the cached outputs instead of running the lane
//
// A cache entry hard-links the files the original run wrote, so it costs no space while that batch
// exists and keeps the bytes alive after it is pruned. Each file's hash is stored with it and checked
// before use, because a hard link also carries any later in-place edit. A restore copies (a clone
// where the filesystem supports one), so nothing written into the new batch reaches the cache. Only
// a completed scan is stored: a pass whose report exists, whose recorded exit is 0, and whose inputs
// did not move while it ran.
//
// env, read at call time: CW_LANE_REUSE (off, verify or on; default off), CW_LANE_CACHE (the cache
//   directory; reuse stays off without one), CW_LANE_REUSE_MAX_FILES (the largest tree that is
//   fingerprinted, default 200000), CW_CODEQL_PACKAGES (local CodeQL packs, default
//   ~/.codeql/packages), CW_CODEQL_MODELS (a repository's CodeQL models, default in the private
//   store), CW_NOW (the time recorded on a stored entry and a journal row)

import {
  readdirSync, lstatSync, readlinkSync, readFileSync, mkdirSync, linkSync, copyFileSync, accessSync,
  writeFileSync, renameSync, rmSync, appendFileSync, statSync, realpathSync, constants as fsc,
} from 'node:fs';
import { join, dirname, resolve, basename, relative, isAbsolute, delimiter, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readSarif } from '../../monitor/sarif-read.mjs';
import { codeqlModelsDirFor } from '../../monitor/store-paths.mjs';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { resolveLauncher } from '../joern-lane.mjs';

export const REUSE_MODES = Object.freeze(['off', 'verify', 'on']);
export const PACK_KINDS = Object.freeze(['codeql', 'joern']);
const KEY_VERSION = 2;
// The runner's own files that decide what a lane's command sees: its sandbox and its environment.
const ALWAYS_INPUTS = Object.freeze(['bin/lib/sandbox.mjs', 'bin/lib/scanner-env.mjs']);
const UNKEYED_ENV = new Set(['CW_ROOT', 'CW_REPORT_DIR', 'CW_CONTAINER_NAME']);
const KEYED_PROCESS_ENV = Object.freeze(['CW_SANDBOX']);
// A cached file name: no separator and no dot segment, so an entry cannot name a path outside its dir.
const FILE_NAME = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

const positive = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const firstLine = (e) => String(e?.code || e?.message || e).split('\n')[0];
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const now = () => process.env.CW_NOW || new Date().toISOString();
const safeId = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_');
const within = (base, p) => { const r = relative(base, p); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };

/** null when reuse is off or no cache is named. Read at call time. */
export function reuseConfig(env = process.env) {
  const mode = REUSE_MODES.includes(env.CW_LANE_REUSE) ? env.CW_LANE_REUSE : 'off';
  if (mode === 'off' || !env.CW_LANE_CACHE) return null;
  return { mode, cache: resolve(env.CW_LANE_CACHE), maxFiles: positive(env.CW_LANE_REUSE_MAX_FILES, 200000) };
}

/** What a sweep adds to each run's env for the laneReuse setting. Off is passed explicitly, so an
 *  ambient value the settings layer rejected cannot reach the runner. */
export function sweepReuseEnv(mode, env, defaultCache) {
  if (mode !== 'verify' && mode !== 'on') return { CW_LANE_REUSE: 'off' };
  return { CW_LANE_REUSE: mode, CW_LANE_CACHE: env.CW_LANE_CACHE || defaultCache };
}

const tooBig = new Set();

// A link whose target leaves the tree (or enters .git) points at content the fingerprint never
// reads, so a scanner that follows it could see a change the key does not.
function linkStaysInside(base, p, link) {
  let target;
  try { target = realpathSync(p); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    target = resolve(realpathSync(dirname(p)), link);
  }
  return within(base, target) && !within(join(base, '.git'), target);
}

/**
 * Every regular file and symlink under `root` (except .git at the top) with its size, mtime and
 * ctime. The ctime moves on any write, including one that restores the old mtime.
 * Untracked and ignored files count: a lane that reads the filesystem sees them too.
 * -> { ok: true, hash, files } | { ok: false, why }
 */
export function treeFingerprint(root, { maxFiles = 200000 } = {}) {
  const memoKey = `${root}\0${maxFiles}`;
  if (tooBig.has(memoKey)) return { ok: false, why: `the tree has more than ${maxFiles} files` };
  const h = createHash('sha256');
  let files = 0;
  let base;
  const walk = (dir, rel) => {
    let names;
    try { names = readdirSync(dir).sort(byName); } catch (e) { throw new Error(`${rel || '.'} unreadable (${firstLine(e)})`); }
    for (const name of names) {
      if (rel === '' && name === '.git') continue;
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(p, { bigint: true });
      if (st.isDirectory()) { walk(p, r); continue; }
      if (++files > maxFiles) throw Object.assign(new Error('too big'), { tooBig: true });
      let link = '';
      if (st.isSymbolicLink()) {
        link = readlinkSync(p);
        if (!linkStaysInside(base, p, link)) throw new Error(`${r} links outside the tree`);
      }
      h.update(`${r}\0${st.size}\0${st.mtimeNs}\0${st.ctimeNs}\0${link}\n`);
    }
  };
  try { base = realpathSync(root); walk(root, ''); } catch (e) {
    if (e.tooBig) { tooBig.add(memoKey); return { ok: false, why: `the tree has more than ${maxFiles} files` }; }
    return { ok: false, why: `tree fingerprint failed: ${e.message}` };
  }
  return { ok: true, hash: h.digest('hex'), files };
}

export function resetReuseMemo() { tooBig.clear(); }

// Static and literal dynamic imports of local modules, followed to closure, so a helper the lane
// script imports is an input too. An unreadable module stays in the list, and keying it then fails.
const IMPORT_RE = /(?:^|[^\w.])(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|(?:^|[^\w.])import\s*['"](\.{1,2}\/[^'"]+)['"]/g;
export function localImports(file) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return []; }
  return [...src.matchAll(IMPORT_RE)].map((m) => resolve(dirname(file), m[1] || m[2] || m[3]));
}
export function localImportClosure(file) {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const g of localImports(f)) visit(g);
  };
  visit(resolve(file));
  return [...seen].sort();
}

function filesUnder(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return [path];
  const out = [];
  for (const e of readdirSync(path, { withFileTypes: true })) out.push(...filesUnder(join(path, e.name)));
  return out.sort();
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** CW_* names a lane's commands read, other than the per-run paths. */
export function referencedEnv(check) {
  const names = new Set();
  for (const cmd of check.local || []) for (const m of String(cmd).matchAll(/\$\{?(CW_[A-Z0-9_]+)/g)) names.add(m[1]);
  for (const n of (check.reuse && check.reuse.env) || []) names.add(n);
  for (const n of UNKEYED_ENV) names.delete(n);
  return [...names].sort();
}

// A setting whose value is an absolute path names a file the lane reads; its bytes are keyed with it.
function envValue(value) {
  if (value == null || !isAbsolute(String(value))) return value ?? null;
  let st;
  try { st = statSync(value); } catch (e) {
    if (e.code === 'ENOENT') return { path: value, absent: true };
    throw e;
  }
  if (!st.isFile()) throw new Error(`${value} is not a file, so its contents cannot be keyed`);
  return { path: value, sha: sha(readFileSync(value)) };
}

export const codeqlPackagesDir = (env = process.env) => env.CW_CODEQL_PACKAGES || join(homedir(), '.codeql', 'packages');

function codeqlPackListing(env) {
  const root = codeqlPackagesDir(env);
  let scopes;
  try { scopes = readdirSync(root).sort(byName); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const scope of scopes) {
    const sd = join(root, scope);
    if (!statSync(sd).isDirectory()) continue;
    for (const name of readdirSync(sd).sort(byName)) {
      const nd = join(sd, name);
      if (!statSync(nd).isDirectory()) continue;
      out.push(`${scope}/${name}@${readdirSync(nd).sort(byName).join(',')}`);
    }
  }
  return out;
}

// The model files bin/codeql-model-pack.mjs turns into a pack, resolved the way it resolves them.
function codeqlModels(env, root) {
  const dir = env.CW_CODEQL_MODELS ? resolve(env.CW_CODEQL_MODELS) : codeqlModelsDirFor(root, { ambient: false });
  try { statSync(dir); } catch (e) { if (e.code === 'ENOENT') return { dir, files: null }; throw e; }
  return { dir, files: Object.fromEntries(filesUnder(dir).map((f) => [relative(dir, f), sha(readFileSync(f))])) };
}

// Joern installs its query database as jars beside the launcher, and an update replaces them without
// changing the launcher's version.
function joernQueryDb(env) {
  const launcher = resolveLauncher(env);
  if (!launcher) throw new Error('the joern-scan launcher cannot be resolved');
  const lib = join(dirname(launcher.path), 'lib');
  const jars = readdirSync(lib).sort(byName).map((n) => {
    const st = statSync(join(lib, n), { bigint: true });
    return `${n}\0${st.size}\0${st.mtimeNs}`;
  });
  return { launcher: launcher.path, launcherSha: sha(launcher.text), jars };
}

// A tool that prints no version is identified by the executable PATH resolves to: its real path,
// size and times, which an upgrade or a reinstall changes. Only a missing entry moves on to the next
// PATH directory; any other error means the executable cannot be named.
export function binaryIdentity(tool, env = process.env) {
  for (const dir of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    let real;
    try { real = realpathSync(join(dir, tool)); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue;
      return null;
    }
    try {
      const st = statSync(real, { bigint: true });
      if (!st.isFile()) continue;
      try { accessSync(real, fsc.X_OK); } catch { continue; }
      return { path: real, size: String(st.size), mtimeNs: String(st.mtimeNs), ctimeNs: String(st.ctimeNs) };
    } catch { return null; }
  }
  return null;
}

/**
 * The key for one lane on one tree. `tools` is the versionsForTools() result recorded for this run;
 * `env` is what the lane's commands see.
 * -> { ok: true, key, parts } | { ok: false, why }
 */
export function reuseKey({ check, repoPath, tools, env = process.env, root, cfg }) {
  const decl = check.reuse;
  if (!decl) return { ok: false, why: 'the lane declares no reuse' };
  // The manifest guard holds bundled lanes to these; a repository's own manifest is held here.
  // Registry egress is allowed only beside packs, which key the local cache a registry fetch writes.
  if (check.egress !== 'none' && !(check.egress === 'registry' && decl.packs)) return { ok: false, why: `the lane's egress is ${check.egress || 'undeclared'} and nothing keys what it could fetch` };
  if (check.requires && Array.isArray(check.requires.secrets) && check.requires.secrets.length) return { ok: false, why: 'the lane takes secrets, so it reads live data' };
  if (check.executesRepoCode || check.requiresRepoTrust) return { ok: false, why: 'the lane runs repository code' };
  const declared = (check.requires && check.requires.tools) || [];
  if (!declared.length) return { ok: false, why: 'the lane declares no tools, so its version is unknown' };
  const toolIds = {};
  for (const t of declared) {
    const v = tools && tools[t];
    if (!v || v.state !== 'present') return { ok: false, why: `${t} is not present (${v ? v.state : 'not probed'})` };
    if (v.versionState === 'stated' && v.version) {
      toolIds[t] = { version: v.version, resolvedFrom: v.resolvedFrom || null, commit: v.commit || null };
      continue;
    }
    const bin = binaryIdentity(t, env);
    if (!bin) return { ok: false, why: `the ${t} version is not stated and its executable cannot be resolved` };
    toolIds[t] = { binary: bin };
  }
  const tree = treeFingerprint(repoPath, { maxFiles: cfg.maxFiles });
  if (!tree.ok) return { ok: false, why: tree.why };
  const inputs = {};
  try {
    for (const rel of [...ALWAYS_INPUTS, ...(decl.inputs || [])]) {
      const abs = join(root, rel);
      try { statSync(abs); } catch (e) {
        if (e.code === 'ENOENT') return { ok: false, why: `declared input ${rel} is missing` };
        throw e;
      }
      const files = abs.endsWith('.mjs') ? localImportClosure(abs) : filesUnder(abs);
      for (const f of files) {
        const name = relative(root, f);
        if (!within(root, f)) return { ok: false, why: `${rel} imports ${f}, outside the commitwork root` };
        inputs[name] = sha(readFileSync(f));
      }
    }
  } catch (e) { return { ok: false, why: `a declared input is unreadable (${firstLine(e)})` }; }
  const envVals = {};
  try {
    for (const n of [...referencedEnv(check), ...KEYED_PROCESS_ENV]) envVals[n] = envValue(env[n]);
  } catch (e) { return { ok: false, why: `a setting the lane reads names an unreadable file (${firstLine(e)})` }; }
  let packs = null;
  try {
    if (decl.packs === 'codeql') packs = { packages: codeqlPackListing(env), models: codeqlModels(env, root) };
    else if (decl.packs === 'joern') packs = { querydb: joernQueryDb(env) };
    else if (decl.packs !== undefined) return { ok: false, why: `unknown packs ${JSON.stringify(decl.packs)}` };
  } catch (e) { return { ok: false, why: `the ${decl.packs} query packs are unreadable (${firstLine(e)})` }; }
  const parts = { v: KEY_VERSION, check: sha(canonical(check)), tree: tree.hash, tools: toolIds, inputs, env: envVals, packs };
  return { ok: true, key: sha(canonical(parts)), parts: { ...parts, treeFiles: tree.files } };
}

const entryDir = (cfg, check, repoPath) => join(cfg.cache, safeId(check.id),
  `${basename(repoPath).replace(/[^A-Za-z0-9._-]/g, '_')}-${sha(resolve(repoPath)).slice(0, 12)}`);

// What makes an entry unusable before its files are read. An entry is data on disk, so every field
// that steers a restore is checked rather than trusted.
function entryProblem(e, check, repoPath) {
  if (!e || typeof e !== 'object') return 'it is not an object';
  if (e.v !== KEY_VERSION) return `it has format ${e.v}, not ${KEY_VERSION}`;
  if (e.check !== check.id || e.repo !== resolve(repoPath)) return 'it names another lane or repository';
  if (!Array.isArray(e.files) || !e.files.length || !e.files.every((f) => typeof f === 'string' && FILE_NAME.test(f))) return 'its file list is malformed';
  if (!e.hashes || typeof e.hashes !== 'object' || !e.files.every((f) => typeof e.hashes[f] === 'string')) return 'it has no hash for every file';
  if (!e.result || typeof e.result !== 'object' || e.result.status !== 'pass') return 'its result is not a completed pass';
  if (check.report && !e.files.includes(check.report.file)) return `it does not hold ${check.report.file}`;
  return null;
}

const fileSha = (path) => {
  if (!lstatSync(path).isFile()) throw new Error('not a regular file');
  return sha(readFileSync(path));
};

/** The cached entry for this lane and repo, or why there is none. Never throws. */
export function lookup(cfg, check, repoPath, key) {
  const dir = entryDir(cfg, check, repoPath);
  let entry;
  try { entry = JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')); } catch (e) {
    return { hit: false, why: e.code === 'ENOENT' ? 'no cached result' : `cache entry unreadable (${firstLine(e)})` };
  }
  const bad = entryProblem(entry, check, repoPath);
  if (bad) return { hit: false, why: `cache entry not used: ${bad}` };
  if (entry.key !== key) return { hit: false, why: 'an input changed since the cached run' };
  for (const f of entry.files) {
    let digest;
    try { digest = fileSha(join(dir, f)); } catch (e) { return { hit: false, why: `cached output ${f} unreadable (${firstLine(e)})` }; }
    if (digest !== entry.hashes[f]) return { hit: false, why: `cached output ${f} changed after it was stored` };
  }
  return { hit: true, entry, dir };
}

// An output may be a pattern with `*` (joern-*.log); it names whatever matches in the directory.
const globRe = (pattern) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
export function expandOutputs(patterns, dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  const out = new Set();
  for (const p of patterns) {
    if (!p.includes('*')) { if (names.includes(p)) out.add(p); continue; }
    const re = globRe(p);
    for (const n of names) if (re.test(n)) out.add(n);
  }
  return [...out].sort();
}

const link = (from, to) => {
  rmSync(to, { force: true });
  try { linkSync(from, to); } catch { copyFileSync(from, to); }
};

export const markerName = (check) => `reuse-${safeId(check.id)}.json`;

/**
 * Copy the cached outputs into reportDir, check each copy against its stored hash, and write a
 * marker naming the run they came from. Throws, with nothing left behind, when any step fails.
 */
export function restore(hit, check, reportDir) {
  const placed = [];
  try {
    for (const f of hit.entry.files) {
      const to = join(reportDir, f);
      rmSync(to, { force: true });
      placed.push(to);
      copyFileSync(join(hit.dir, f), to, fsc.COPYFILE_FICLONE);
      if (fileSha(to) !== hit.entry.hashes[f]) throw new Error(`cached output ${f} changed while it was restored`);
    }
    const marker = { check: check.id, reused: true, key: hit.entry.key, scannedAt: hit.entry.storedAt, from: hit.entry.reportDir, files: hit.entry.files };
    const at = join(reportDir, markerName(check));
    placed.push(at);
    writeAtomic(at, `${JSON.stringify(marker, null, 2)}\n`);
    return marker;
  } catch (e) {
    for (const p of placed) rmSync(p, { force: true });
    throw e;
  }
}

/** Whether a finished run is a completed scan worth storing. */
export function storable(check, result, reportDir) {
  if (!result || result.status !== 'pass' || !check.report) return false;
  const report = join(reportDir, check.report.file);
  try { if (!statSync(report).size) return false; } catch { return false; }
  try { return readFileSync(`${report}.exit`, 'utf8').trim() === '0'; } catch (e) { return e.code === 'ENOENT'; }
}

/** Store this run's outputs under the key, replacing the previous entry for the lane and repo. */
export function store(cfg, check, repoPath, key, result, reportDir) {
  const dir = entryDir(cfg, check, repoPath);
  const tmp = `${dir}.tmp-${process.pid}`;
  const old = `${dir}.old-${process.pid}`;
  try {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const files = expandOutputs(check.reuse.outputs, reportDir).filter((f) => lstatSync(join(reportDir, f)).isFile());
    const hashes = {};
    for (const f of files) {
      link(join(reportDir, f), join(tmp, f));
      hashes[f] = fileSha(join(tmp, f));
    }
    const { durationMs, ...kept } = result;
    writeFileSync(join(tmp, 'entry.json'), `${JSON.stringify({
      v: KEY_VERSION, key, check: check.id, repo: resolve(repoPath), storedAt: now(),
      reportDir: resolve(reportDir), result: kept, files, hashes,
    }, null, 2)}\n`);
    try { renameSync(dir, old); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    renameSync(tmp, dir);
    rmSync(old, { recursive: true, force: true });
    return { ok: true, files };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    return { ok: false, error: `lane result not cached: ${firstLine(e)}` };
  }
}

// CodeQL lists artifacts in extraction order, which its parallel extractor does not fix, and
// results point into that list by index. Compare what was found, with every index resolved.
export function sarifResults(path) {
  const read = readSarif(path);
  if (read.state !== 'ok') return `state:${read.state}`;
  return canonical(read.runs.map((run) => {
    const uris = (run.artifacts || []).map((a) => (a && a.location && a.location.uri) || null);
    const resolveRefs = (v) => {
      if (Array.isArray(v)) return v.map(resolveRefs);
      if (!v || typeof v !== 'object') return v;
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'ruleIndex') continue;
        if (k === 'artifactLocation' && x && typeof x === 'object' && Number.isInteger(x.index)) {
          const { index, ...rest } = x;
          out[k] = { ...resolveRefs(rest), uri: rest.uri || uris[index] || null };
          continue;
        }
        if (k === 'rule' && x && typeof x === 'object') { const { index, ...rest } = x; out[k] = resolveRefs(rest); continue; }
        out[k] = resolveRefs(x);
      }
      return out;
    };
    const driver = (run.tool && run.tool.driver) || {};
    return {
      tool: `${driver.name || ''}@${driver.semanticVersion || driver.version || ''}`,
      results: Array.isArray(run.results) ? run.results.map((r) => canonical(resolveRefs(r))).sort() : null,
      artifacts: [...new Set(uris)].sort(),
    };
  }));
}

// null when absent; undefined when present but unreadable, which can never count as a match.
const readOrAbsent = (p) => { try { return readFileSync(p); } catch (e) { return e.code === 'ENOENT' ? null : undefined; } };

/** This run's outputs against the cached ones: SARIF by its results, other files byte for byte,
 *  logs excluded (they carry timings). */
export function compareOutputs(hit, check, reportDir) {
  const differing = [];
  const names = new Set([...expandOutputs(check.reuse.outputs, reportDir), ...expandOutputs(check.reuse.outputs, hit.dir)]);
  for (const f of [...names].filter((n) => !n.endsWith('.log')).sort()) {
    const a = readOrAbsent(join(reportDir, f));
    const b = readOrAbsent(join(hit.dir, f));
    if (a === undefined || b === undefined) { differing.push(f); continue; }
    if (a === null && b === null) continue;
    if (a === null || b === null) { differing.push(f); continue; }
    if (a.equals(b)) continue;
    if (f.endsWith('.sarif') && sarifResults(join(reportDir, f)) === sarifResults(join(hit.dir, f))) continue;
    differing.push(f);
  }
  return { match: differing.length === 0, differing };
}

export function journal(cfg, row) {
  try {
    mkdirSync(cfg.cache, { recursive: true });
    appendFileSync(join(cfg.cache, 'verify.jsonl'), `${JSON.stringify({ at: now(), ...row })}\n`);
    return { ok: true };
  } catch (e) { return { ok: false, error: firstLine(e) }; }
}
