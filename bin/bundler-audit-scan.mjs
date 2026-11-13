#!/usr/bin/env node
/*
 * bundler-audit-scan.mjs — run bundle-audit over EVERY Gemfile.lock in a repo, not just the root.
 *
 * WHY THIS EXISTS. The lane's gate and the tool disagree about what "this repo has Ruby
 * dependencies" means, and the disagreement produces a `noscan` that reads like a skip.
 * `appliesIfExists: ["Gemfile.lock"]` resolves through appliesExists() (bin/commitwork.mjs), which
 * for a bare filename walks the WHOLE TREE, deliberately, because gating on root-only build
 * manifests leaves lanes void on repos that carry sources and no root manifest.
 * `bundle-audit check` reads ./Gemfile.lock in the working directory and nothing else, so a repo
 * whose lockfiles sit only in subdirectories gets `Could not find "Gemfile.lock"`, exit 1 and no
 * JSON: scanned by nothing.
 *
 * EXIT 1 IS OVERLOADED and cannot be the witness here: bundle-audit exits 1 both for "found
 * vulnerabilities" and for "no lockfile". The lane's `[ $rc -gt 1 ]` guard therefore reads a
 * file-not-found as a normal findings run. The witness is the ABSENCE of the artifact, the same
 * shape as joern-scan. This script keeps that property: it writes the merged document only when at
 * least one lockfile was actually audited.
 *
 *   node bin/bundler-audit-scan.mjs <repoDir> <outJson>
 *
 * Exit: 0 clean, 1 advisories found (bundle-audit's own convention, preserved so the lane's
 * existing guard keeps working), 2 no lockfile anywhere, 3 the tool failed on a lockfile it found.
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyWorktreePath } from '../monitor/worktree-paths.mjs';

const [repoDir, outJson] = process.argv.slice(2);
if (!repoDir || !outJson) { console.error('usage: bundler-audit-scan.mjs <repoDir> <outJson>'); process.exit(2); }

// Directories that never hold a dependency tree WE are responsible for. Vendored gems are the
// scanned party's vendoring of somebody else's code; reporting them as this repo's advisories
// double-counts and points remediation at a directory nobody edits.
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'tmp', 'target', 'dist', 'build', '.bundle']);

/** Every Gemfile.lock in the tree, root first, bounded so a huge monorepo cannot stall the lane. */
function findLockfiles(root, maxDepth = 6, cap = 25) {
  const found = [];
  if (existsSync(join(root, 'Gemfile.lock'))) found.push(join(root, 'Gemfile.lock'));
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= cap) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= cap) return;
      if (e.isDirectory()) {
        // a nested checkout's Gemfile.lock is this repository's again (monitor/worktree-paths.mjs)
        const rel = relative(root, join(dir, e.name));
        if (SKIP.has(e.name) || (classifyWorktreePath(`${rel}/x/y`).worktree && rel.split(/[\\/]/).length >= 2)) continue;
        walk(join(dir, e.name), depth + 1);
      }
      else if (e.name === 'Gemfile.lock') {
        const p = join(dir, e.name);
        if (!found.includes(p)) found.push(p);
      }
    }
  };
  walk(root, 0);
  return found;
}

const locks = findLockfiles(repoDir);
if (!locks.length) {
  // The gate matched something this tool cannot audit — say so, and write NO artifact. An empty
  // results array here would be a clean bill of health for a scan that never ran.
  console.error(`no Gemfile.lock under ${repoDir} — nothing for bundle-audit to read`);
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'cw-bundler-audit-'));
const merged = { results: [], _scanned: [] };
let failures = 0;
let sawFindings = false;
let offline = false;

try {
  for (const lock of locks) {
    const rel = relative(repoDir, lock) || 'Gemfile.lock';
    const out = join(tmp, `${rel.replace(/[^A-Za-z0-9]/g, '_')}.json`);
    let status = 0;
    try {
      // RUN FROM THE LOCKFILE'S DIRECTORY, and do NOT pass --gemfile-lock. In bundler-audit 0.9.3
      // that flag is resolved RELATIVE to the scan directory, not as a path —
      // an absolute value produces `Could not find "/abs/path/Gemfile.lock" in "/cwd"` and, true to
      // this tool's form, still exits 0 while writing nothing. cwd is the only reliable selector.
      //
      // --update IS A NETWORK FETCH, AND IT IS OPTIONAL. The advisory database is global and cached
      // on disk, so a scan is possible with no network at all; --update only refreshes it. Passing
      // it unconditionally makes the scan IMPOSSIBLE on an offline host: bundle-audit 0.9.3 exits 1
      // and writes no JSON when the fetch fails, which this script reads as "the tool failed" and
      // turns into exit 3 for every lockfile. So: try WITH --update first, and on a failed fetch
      // retry WITHOUT it against the cached database. A stale database is a weaker witness than a
      // fresh one, but it is a witness; no artifact is not.
      //
      // The retry is per-lockfile rather than first-lockfile-only. The old `_scanned.length === 0`
      // guard was meant to fetch once, but `_scanned` only grows on SUCCESS — so when the first
      // lockfile failed, every later one re-fetched too, the opposite of the intent.
      try {
        execFileSync('bundle-audit', ['check', '--update', '-F', 'json', '-o', out], { cwd: dirname(lock), stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const first = typeof e.status === 'number' ? e.status : 3;
        // Only a FAILED FETCH is worth retrying. A real findings run (exit 1) already wrote its
        // JSON, and re-running it would just repeat the same advisories.
        if (first > 1 || existsSync(out)) status = first;
        else {
          try {
            execFileSync('bundle-audit', ['check', '-F', 'json', '-o', out], { cwd: dirname(lock), stdio: ['ignore', 'pipe', 'pipe'] });
            offline = true;
          } catch (e2) { status = typeof e2.status === 'number' ? e2.status : 3; }
        }
      }
    } catch (e) { status = typeof e.status === 'number' ? e.status : 3; }

    if (status > 1) { failures += 1; console.error(`bundle-audit exited ${status} on ${rel}`); continue; }
    if (!existsSync(out)) { failures += 1; console.error(`bundle-audit wrote no output for ${rel}`); continue; }

    let doc;
    try { doc = JSON.parse(readFileSync(out, 'utf8')); }
    catch { failures += 1; console.error(`unparseable output for ${rel}`); continue; }

    const rows = Array.isArray(doc.results) ? doc.results : [];
    // Carry WHICH lockfile each row came from. Without it a monorepo's advisories all read as the
    // repo's, and nobody can tell which dependency tree to fix.
    for (const r of rows) merged.results.push({ ...r, lockfile: rel });
    merged._scanned.push(rel);
    if (rows.length) sawFindings = true;
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

if (!merged._scanned.length) {
  console.error(`every lockfile failed to audit (${locks.length} found) — writing no artifact`);
  process.exit(3);
}

writeFileSync(outJson, `${JSON.stringify(merged, null, 2)}\n`);
console.error(`audited ${merged._scanned.length}/${locks.length} lockfile(s): ${merged._scanned.join(', ')}`);
// SAY WHEN THE DATABASE WAS STALE. A reader comparing this artifact against a fresh advisory has
// to be able to tell that the scan ran offline against a cached database, or a missed CVE reads as
// a clean result rather than as the weaker witness it is.
if (offline) console.error('advisory database could not be refreshed (no network) — scanned against the cached copy');
if (failures) console.error(`${failures} lockfile(s) could not be audited — the artifact covers the rest`);
process.exit(sawFindings ? 1 : 0);
