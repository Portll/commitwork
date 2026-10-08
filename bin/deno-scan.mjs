#!/usr/bin/env node
// bin/deno-scan.mjs — run deno lint / deno check once per deno.json: each file is checked under
// its nearest-ancestor config. Output shapes belong to monitor/extractors.mjs — the single
// `Found N errors.` line is the repo total. Exit 0 whenever the scan ran; non-zero = scan failed.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '_fresh', 'vendor', 'dist', 'build', 'target',
  'reports', 'reference', '.claude', '.next', 'coverage', '.cache']);

// Strip ANSI as well as asking NO_COLOR — colour codes defeat _denoCheckCounts' TS-code regex.
const CHILD_ENV = { ...process.env, NO_COLOR: '1', TERM: 'dumb', CLICOLOR: '0' };
const stripAnsi = (s) => String(s || '').replace(/\[[0-9;]*[A-Za-z]/g, '');

/** Every directory owning a deno.json(c), deepest-last, deterministic. */
function configDirs(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && (e.name === 'deno.json' || e.name === 'deno.jsonc'))) out.push(dir);
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out.sort();
}

/** A config dir scans its own entries minus any subtree owned by a nested config. */
function targetsFor(dir, allDirs) {
  const nested = allDirs.filter((d) => d !== dir && d.startsWith(dir + sep));
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory() && nested.some((n) => n === p || n.startsWith(p + sep))) continue;
    if (e.isDirectory() || /\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(`./${e.name}`);
  }
  return out.sort();
}

const root = resolve(process.argv[2] || '.');
const mode = process.argv[3] === 'check' ? 'check' : 'lint';
const dirs = configDirs(root);

if (!dirs.length) {
  // No config: empty output is the extractors' `nosrc` — not an error, not clean.
  process.exit(0);
}

const rel = (d) => (relative(root, d) || '.');

if (mode === 'lint') {
  const diagnostics = [];
  const seen = new Set();
  let failures = 0;
  for (const d of dirs) {
    const targets = targetsFor(d, dirs);
    if (!targets.length) continue;
    const r = spawnSync('deno', ['lint', '--json', ...targets], { cwd: d, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.error || typeof r.stdout !== 'string' || !r.stdout.trim()) { failures++; continue; }
    let j;
    try { j = JSON.parse(r.stdout); } catch { failures++; continue; }
    for (const diag of (Array.isArray(j.diagnostics) ? j.diagnostics : [])) {
      // Repo-relative filenames so the same file dedupes across configs
      const abs = String(diag.filename || '').replace(/^file:\/\//, '');
      const path = abs ? relative(root, abs) : '';
      const line = diag.range?.start?.line ?? 0;
      const col = diag.range?.start?.col ?? 0;
      const key = `${path}|${line}|${col}|${diag.code || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push({ ...diag, filename: path });
    }
  }
  diagnostics.sort((a, b) => String(a.filename).localeCompare(String(b.filename))
    || (a.range?.start?.line ?? 0) - (b.range?.start?.line ?? 0)
    || String(a.code).localeCompare(String(b.code)));
  process.stdout.write(`${JSON.stringify({ version: 1, scannedConfigs: dirs.map(rel), diagnostics }, null, 2)}\n`);
  process.exit(failures === dirs.length ? 1 : 0);
}

// check
let total = 0, ran = 0;
const parts = [];
for (const d of dirs) {
  const targets = targetsFor(d, dirs);
  if (!targets.length) continue;
  // --node-modules-dir=none: A SCANNER MUST NOT MODIFY WHAT IT SCANS.
  //
  // Without it, `deno check` resolves npm deps and MATERIALISES a pnpm catalog into package.json.
  // Caught 2026-08-21 on openstatusHQ_openstatus: +193 insertions, reproducible every run. `deno
  // lint` does not do this; only `check` does.
  //
  // Two things make it worse than a stray file. The write ESCAPES THE SCANNED SCOPE — that repo's
  // deno configs are nested, so this ran with cwd=apps/web and wrote the REPO-ROOT package.json.
  // And lanes running after it scanned a tree the batch anchor no longer describes, so the slice
  // records several lanes against one sliceId as though they saw the same tree.
  //
  // It bought nothing: `deno check` reports the same 5 errors either way and still cannot resolve
  // `zod` — it just says so more honestly. Snapshot-and-restore was REJECTED: it lets the write
  // land, races any concurrent reader, and does nothing for untracked files.
  const r = spawnSync('deno', ['check', '--node-modules-dir=none', ...targets], { cwd: d, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error) { parts.push(`[deno-scan] ${rel(d)}: scan FAILED — ${r.error.message}`); continue; }
  ran++;
  const m = text.match(/Found (\d+) errors?\./);
  const n = m ? Number(m[1]) : 0;
  total += n;
  // Rewrite per-directory totals — _denoCheckCounts reads the FIRST `Found N errors.` it sees.
  parts.push(`[deno-scan] ===== ${rel(d)} — ${n} error(s) =====\n${text.replace(/Found (\d+) errors?\./g, '[deno-scan] subtotal: $1 error(s).')}`);
}
process.stdout.write(`${parts.join('\n')}\n`);
// The ONE line the extractor reads, written last and once.
process.stdout.write(`Found ${total} errors.\n`);
process.exit(ran ? 0 : 1);
