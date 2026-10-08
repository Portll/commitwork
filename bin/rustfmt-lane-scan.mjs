#!/usr/bin/env node
// commitwork — cargo fmt --check once per Cargo root, folded into rustfmt.json.
//
// Success is judged from the output, never the exit: rustfmt exits 1 both for "files differ" and
// for "could not run" (a pinned toolchain that is not installed prints no diff and exits 1). A root
// counts only when it exits 0 or prints at least one diff; with no counted root the report is
// removed so the lane reads noscan, not clean.
//
// RUSTUP_AUTO_INSTALL=0 because a repo's rust-toolchain.toml otherwise makes rustup download a
// toolchain mid-scan. CARGO_NET_OFFLINE because cargo fmt needs no registry.
//
// usage: rustfmt-lane-scan.mjs --out <file> --log <file> [--root .] [--max-depth 4]

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, appendFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const OUT = arg('out');
const LOG = arg('log');
// rustfmt prints canonical paths (/private/tmp on macOS); an unresolved root puts every file "outside".
const ROOT = realpathSync(resolve(arg('root', process.cwd())));
const MAX_DEPTH = Number(arg('max-depth', '4'));

if (!OUT || !LOG) {
  console.error('usage: rustfmt-lane-scan.mjs --out <file> --log <file> [--root .] [--max-depth N]');
  process.exit(2);
}

const log = (s) => { try { appendFileSync(LOG, s + '\n'); } catch { /* the log is never the reason a scan fails */ } };
try { writeFileSync(LOG, ''); } catch {}
const refuse = (why) => {
  log(`REFUSING to report a scan: ${why}. Removing the report so this lane reads as noscan rather than clean.`);
  try { if (existsSync(OUT)) rmSync(OUT); } catch {}
  process.exit(1);
};
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };

const SKIP = new Set(['.git', 'target', 'vendor', 'node_modules', 'reports', 'reference']);
const roots = [];
(function walk(dir, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  if (entries.some((e) => e.isFile() && e.name === 'Cargo.toml')) roots.push(dir);
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
    walk(join(dir, e.name), depth + 1);
  }
})(ROOT, 0);

// Members of a workspace already formatted by `--all` at its root would be formatted twice.
const workspaces = roots.filter((r) => /^\s*\[workspace\]/m.test(readText(join(r, 'Cargo.toml'))));
const inWorkspace = (r) => workspaces.some((w) => w !== r && r.startsWith(w + sep));
const targets = roots.filter((r) => !inWorkspace(r));

log(`rustfmt-lane-scan: root=${ROOT} maxDepth=${MAX_DEPTH}`);
log(`Cargo roots: ${roots.length}, formatted: ${targets.length}${targets.length ? ` -> ${targets.map((r) => relative(ROOT, r) || '.').join(', ')}` : ''}`);
if (!targets.length) refuse('no Cargo.toml at any depth');

const DECLARE_RE = /\bcargo\s+(?:\+\S+\s+)?fmt\b|\brustfmt\b/;
function declaration() {
  for (const r of [ROOT, ...targets]) {
    for (const f of ['rustfmt.toml', '.rustfmt.toml']) if (existsSync(join(r, f))) return `config ${relative(ROOT, join(r, f))}`;
  }
  const wf = join(ROOT, '.github', 'workflows');
  let flows = [];
  try { flows = readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => join(wf, f)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const p of [...flows, ...['Makefile', 'justfile', 'Justfile', '.pre-commit-config.yaml'].map((f) => join(ROOT, f))]) {
    if (DECLARE_RE.test(readText(p))) return `ci ${relative(ROOT, p)}`;
  }
  return null;
}

const version = (spawnSync('rustfmt', ['--version'], { encoding: 'utf8' }).stdout || '').trim() || null;
const env = { ...process.env, RUSTUP_AUTO_INSTALL: '0', CARGO_NET_OFFLINE: 'true' };
const DIFF_RE = /^Diff in (.+?)(?::(\d+):|\s+at line\s+(\d+):)\s*$/gm;
const ERROR_FILE_RE = /^error[^\n]*\n\s*-->\s+(.+?):\d+:\d+/gm;

const files = new Map();
const parseErrors = new Map();
const rootResults = [];
let outside = 0;
const repoPath = (abs) => {
  let real;
  try { real = realpathSync(resolve(ROOT, abs)); } catch { real = resolve(ROOT, abs); }
  const rel = relative(ROOT, real);
  if (rel.startsWith('..')) { outside++; return null; }
  return rel.split(sep).join('/');
};

for (const r of targets) {
  const rel = relative(ROOT, r) || '.';
  const res = spawnSync('cargo', ['fmt', '--all', '--', '--check'], { cwd: r, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const stdout = res.stdout || '', stderr = res.stderr || '';
  let diffs = 0;
  for (const m of stdout.matchAll(DIFF_RE)) {
    diffs++;
    const f = repoPath(m[1]); if (!f) continue;
    if (!files.has(f)) files.set(f, new Set());
    files.get(f).add(Number(m[2] || m[3]) || 0);
  }
  for (const m of stderr.matchAll(ERROR_FILE_RE)) {
    const f = repoPath(m[1]); if (f && !parseErrors.has(f)) parseErrors.set(f, stderr.slice(m.index, m.index + 240).split('\n')[0]);
  }
  const counted = res.status === 0 || diffs > 0;
  rootResults.push({ root: rel, exit: res.status, diffs, counted });
  log(`== ${rel}: exit=${res.status} diffHunks=${diffs}${counted ? '' : ' NOT COUNTED'}`);
  if (stderr.trim()) log(stderr.trim().split('\n').slice(0, 12).join('\n'));
}

if (!rootResults.some((r) => r.counted)) refuse('no Cargo root produced a check result (see stderr above)');
if (outside > 0 && files.size === 0) refuse(`all ${outside} diff hunk(s) resolved outside ${ROOT} — a path-mapping failure, not a clean tree`);

// Hunks are a set of lines per file: a path dependency formatted from two roots is one hunk.
const sortedFiles = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([file, lines]) => ({ file, hunks: lines.size, firstLine: Math.min(...lines) }));
const sortedErrors = [...parseErrors.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([file, message]) => ({ file, message }));

const report = {
  tool: 'rustfmt',
  version,
  declared: declaration(),
  roots: rootResults,
  partial: rootResults.some((r) => !r.counted) || sortedErrors.length > 0,
  outsideRepo: outside,
  files: sortedFiles,
  parseErrors: sortedErrors,
};
writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
log(`wrote ${OUT}: ${sortedFiles.length} file(s) differ, ${sortedErrors.length} unparseable, declared=${report.declared ?? 'no'}`);
process.exit(0);
