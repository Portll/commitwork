#!/usr/bin/env node
/*
 * bundler-audit-scan.mjs — run bundle-audit over EVERY Gemfile.lock in a repo, not just the root.
 *
 * WHY THIS EXISTS. The lane's gate and the tool disagreed about what "this repo has Ruby
 * dependencies" means, and the disagreement was invisible because it produced a `noscan` that read
 * like a skip. `appliesIfExists: ["Gemfile.lock"]` resolves through appliesExists()
 * (bin/commitwork.mjs), which for a bare filename walks the WHOLE TREE — deliberately, because
 * gating on root-only build manifests is what left the CodeQL lanes void on repos that carry
 * sources and no root manifest. `bundle-audit check` reads ./Gemfile.lock in the working directory
 * and nothing else.
 *
 * Measured 2026-09-02 on Homebrew/brew: lockfiles at docs/Gemfile.lock and
 * Library/Homebrew/Gemfile.lock, none at root. The gate said "applies", the lane spent 1.2s
 * updating the advisory database, then bundle-audit reported `Could not find "Gemfile.lock"`,
 * exited 1, and wrote no JSON. A repo with two real Ruby dependency trees was reported as scanned
 * by nothing.
 *
 * EXIT 1 IS OVERLOADED and cannot be the witness here: bundle-audit exits 1 both for "found
 * vulnerabilities" and for "no lockfile". The lane's `[ $rc -gt 1 ]` guard therefore reads a
 * file-not-found as a normal findings run. What saved it was the ABSENCE of the artifact, not the
 * exit code — the same shape as joern-scan. This script keeps that property: it writes the merged
 * document only when at least one lockfile was actually audited.
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
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), depth + 1); }
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

try {
  for (const lock of locks) {
    const rel = relative(repoDir, lock) || 'Gemfile.lock';
    const out = join(tmp, `${rel.replace(/[^A-Za-z0-9]/g, '_')}.json`);
    let status = 0;
    try {
      // RUN FROM THE LOCKFILE'S DIRECTORY, and do NOT pass --gemfile-lock. Measured 2026-09-02
      // (bundler-audit 0.9.3): that flag is resolved RELATIVE to the scan directory, not as a path —
      // an absolute value produces `Could not find "/abs/path/Gemfile.lock" in "/cwd"` and, true to
      // this tool's form, still exits 0 while writing nothing. cwd is the only reliable selector.
      //
      // --update only on the FIRST lockfile: the advisory database is global, so re-fetching it per
      // lockfile turns a 2-lockfile repo into two network round trips for identical data.
      const args = ['check', '-F', 'json', '-o', out];
      if (merged._scanned.length === 0) args.splice(1, 0, '--update');
      execFileSync('bundle-audit', args, { cwd: dirname(lock), stdio: ['ignore', 'pipe', 'pipe'] });
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
if (failures) console.error(`${failures} lockfile(s) could not be audited — the artifact covers the rest`);
process.exit(sawFindings ? 1 : 0);
