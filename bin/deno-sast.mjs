#!/usr/bin/env node
// bin/deno-sast.mjs — the Deno lanes' scan: type-argument erasure, opengrep cross-function taint,
// the data-flow inventory, and the DFD/mutability pass.
//
// usage: node bin/deno-sast.mjs <repo> --pack security|reliability --sarif <out.sarif>
//                               [--dfd <prefix>] [--inventory <out.json>]
//   security    manifests/semgrep-deno-security/   → sast-deno       (+ inventory + DFD when --dfd)
//   reliability manifests/semgrep-deno-reliability/ → deno-reliability
// exit: 0 the SARIF was written (with or without findings) · 1 the engine ran and failed ·
//       2 usage · 127 opengrep is not installed (NOTHING is written, so the lane reads not-scanned)
// env, read at call time: CW_OPENGREP (engine binary, default `opengrep`), CW_DENO_SAST_TIMEOUT_SEC
//   (whole-scan budget, default 1800), CW_SCAN_EXCLUDE_DIRS (via bin/scan-exclusions.mjs)
//
// WHY OPENGREP AND NOT SEMGREP. The rules are cross-function taint: a request read in one helper
// and executed in another. Semgrep evaluates that only with --pro-intrafile, behind an account;
// opengrep's --taint-intrafile is the same analysis under LGPL-2.1. The lane REQUIRES opengrep
// rather than falling back to Semgrep CE, because a fallback that silently loses every
// cross-function path would publish a thinner scan under the same lane name.
//
// WHY A MIRROR. lib/ts-type-args.mjs erases `<T>` at call sites so the engine sees
// `kv.get<number>(k)` and `db.queryObject<User>(sql)` at all (both engines drop them from the AST).
// The erasure is length-preserving, so the mirror's line/column for every finding is the original
// file's, and the SARIF's relative URIs are the repository's own. The repository is never written.
//
// THE LOCALE. opengrep 1.33.1 decodes .semgrepignore as ASCII under a C/POSIX locale and dies on
// the first non-ASCII byte (UnicodeDecodeError, no output). The child runs with LC_ALL=C.UTF-8.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { eraseCallTypeArgs } from '../lib/ts-type-args.mjs';
import { excludeDirs } from './scan-exclusions.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { readSarif } from '../monitor/sarif-read.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { buildReport, markdownOf } from './deno-dfd.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKS = Object.freeze({
  security: join(ROOT, 'manifests', 'semgrep-deno-security'),
  reliability: join(ROOT, 'manifests', 'semgrep-deno-reliability'),
  inventory: join(ROOT, 'manifests', 'semgrep-deno-inventory'),
});
const TS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const MAX_BYTES = 2 * 1024 * 1024;     // larger sources are generated or bundled; counted, not read
const ALWAYS_SKIP = new Set(['.git', 'node_modules', '.deno', '_fresh']);

const engine = () => process.env.CW_OPENGREP || 'opengrep';
const childEnv = () => ({ ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8', NO_COLOR: '1' });

export function engineVersion(bin = engine()) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', env: childEnv() });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || '').trim().split('\n').pop() || null;
}

/**
 * Copy every JS/TS source under `repo` into `mirror`, erasing type arguments in TS.
 * -> { files, erasedFiles, erasedSites, unclassified: [rel], oversize: [rel], skippedDirs }
 */
export function buildMirror(repo, mirror, { dirs = excludeDirs() } = {}) {
  const skip = new Set([...ALWAYS_SKIP, ...dirs.filter((d) => !d.includes('/'))]);
  const skipPaths = dirs.filter((d) => d.includes('/'));
  const rec = { files: 0, erasedFiles: 0, erasedSites: 0, unclassified: [], oversize: [], skippedDirs: 0 };
  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, e.name); const rel = relative(repo, abs);
      if (e.isDirectory()) {
        if (skip.has(e.name) || skipPaths.some((p) => rel === p || rel.endsWith(`/${p}`))) { rec.skippedDirs++; continue; }
        walk(abs); continue;
      }
      if (!e.isFile()) continue;
      const ext = extname(e.name);
      if (!TS.has(ext) && !JS.has(ext)) continue;
      let size; try { size = statSync(abs).size; } catch { continue; }
      if (size > MAX_BYTES) { rec.oversize.push(rel); continue; }
      const out = join(mirror, rel);
      mkdirSync(dirname(out), { recursive: true });
      if (TS.has(ext)) {
        const src = readFileSync(abs, 'utf8');
        const r = eraseCallTypeArgs(src);
        if (!r.ok) rec.unclassified.push(rel);
        if (r.sites.length) { rec.erasedFiles++; rec.erasedSites += r.sites.length; }
        writeFileSync(out, r.text);
      } else copyFileSync(abs, out);
      rec.files++;
    }
  };
  walk(repo);
  // The repository's own ignore file governs the mirror exactly as it governs the sast lane.
  for (const f of ['.semgrepignore']) if (existsSync(join(repo, f))) copyFileSync(join(repo, f), join(mirror, f));
  return rec;
}

function runEngine(mirror, pack, format, out, timeoutSec) {
  const args = ['scan', '--config', pack, '--taint-intrafile', '--quiet', `--${format}`, '--output', out, '--timeout', '30', '--timeout-threshold', '0'];
  if (format === 'sarif') args.push('--dataflow-traces');
  args.push('.');
  return spawnSync(engine(), args, { cwd: mirror, encoding: 'utf8', env: childEnv(), timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024 });
}

export function scan(repo, { pack, sarif, dfd, inventory }) {
  const version = engineVersion();
  if (!version) {
    process.stderr.write(`deno-sast: ${engine()} is not installed — this lane did NOT run and the repository is UNSCANNED for Deno ${pack} findings, not clean\n`);
    return 127;
  }
  const budget = Number(process.env.CW_DENO_SAST_TIMEOUT_SEC) > 0 ? Number(process.env.CW_DENO_SAST_TIMEOUT_SEC) : 1800;
  const work = mkdtempSync(join(tmpdir(), 'cw-deno-sast-'));
  const mirror = join(work, 'src'); mkdirSync(mirror);
  try {
    let dirs;
    try { dirs = excludeDirs(); } catch (e) {
      process.stderr.write(`deno-sast: REFUSED — the scan-exclusion list is unreadable (${e.message}); scanning unfiltered would publish build output as findings\n`);
      return 1;
    }
    const m = buildMirror(resolve(repo), mirror, { dirs });
    const raw = join(work, 'out.sarif');
    const r = runEngine(mirror, PACKS[pack], 'sarif', raw, budget);
    // The shared reader classifies what the engine wrote; anything but `ok` is a failed scan, and the
    // lane writes nothing, so it reads not-scanned. Only then is the document re-parsed whole, for
    // the rewrite (bin/semgrep-retry.mjs's pattern): never a defaulted `runs || []`.
    const rec = readSarif(raw);
    if (r.error || rec.state !== 'ok') {
      process.stderr.write(`deno-sast: ${engine()} ${r.error ? `failed (${r.error.message})` : `exit ${r.status}`}; its SARIF is ${rec.state}: ${rec.reason || ''} ${String(r.stderr || '').slice(-800)}\n`);
      return 1;
    }
    const doc = JSON.parse(readFileSync(raw, 'utf8'));
    const run = doc.runs[0];
    {
      run.properties = {
        ...(run.properties || {}),
        cwEngine: { name: 'opengrep', version, crossFunction: 'intrafile', flags: ['--taint-intrafile', '--dataflow-traces'] },
        cwPack: pack,
        cwMirror: {
          filesScanned: m.files, typeArgsErased: { files: m.erasedFiles, sites: m.erasedSites },
          // Files the lexer could not classify were scanned WITHOUT erasure: generic calls in them
          // are as invisible as they are to an unmodified engine. Named, so the gap is legible.
          unclassified: m.unclassified.slice(0, 200), unclassifiedCount: m.unclassified.length,
          oversize: m.oversize.slice(0, 200), oversizeCount: m.oversize.length,
        },
      };
    }
    let inv = null;
    if (pack === 'security' && (dfd || inventory)) {
      const invOut = join(work, 'inventory.json');
      const ri = runEngine(mirror, PACKS.inventory, 'json', invOut, budget);
      if (!ri.error && existsSync(invOut)) {
        try { inv = JSON.parse(readFileSync(invOut, 'utf8')); } catch { inv = null; }
      }
      if (inventory && inv) writeAtomic(inventory, JSON.stringify(inv) + '\n');
    }
    if (dfd) {
      const report = buildReport({ root: resolve(repo), sarifDocs: [{ path: sarif, doc }], inventory: inv });
      report.inventoryRead = inv !== null;
      writeAtomic(`${dfd}.json`, JSON.stringify(report, null, 1) + '\n');
      writeAtomic(`${dfd}.md`, markdownOf(report) + '\n');
    }
    writeAtomic(sarif, JSON.stringify(doc) + '\n');
    process.stderr.write(`deno-sast: ${pack}: ${m.files} file(s), ${m.erasedSites} type-argument site(s) erased in ${m.erasedFiles}, ${rec.resultCount} result(s)\n`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--pack') a.pack = argv[++i];
    else if (k === '--sarif') a.sarif = argv[++i];
    else if (k === '--dfd') a.dfd = argv[++i];
    else if (k === '--inventory') a.inventory = argv[++i];
    else if (!a.repo && !k.startsWith('--')) a.repo = k;
    else { process.stderr.write(`deno-sast: unknown argument ${k}\n`); return 2; }
  }
  if (!a.repo || !a.sarif || !PACKS[a.pack] || a.pack === 'inventory') {
    process.stderr.write('usage: deno-sast.mjs <repo> --pack security|reliability --sarif <out> [--dfd <prefix>] [--inventory <json>]\n');
    return 2;
  }
  return scan(a.repo, a);
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
