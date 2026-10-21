#!/usr/bin/env node
// dep-provenance.mjs — capture WHERE each dependency was resolved from, at scan time.
//
// The one thing no retained artifact can answer. See monitor/dep-provenance.mjs for the measurement
// behind that claim: the syft SBOM, npm-audit and depscan all normalise a git resolution away, so
// the `resolved` line has to be read while the checkout still exists.
//
// This produces INVENTORY, not findings. A git dependency is a legitimate, common choice; the
// finding is a dependency MOVING off the registry between slices, which only a comparison can see
// (monitor/dep-provenance.mjs diffProvenance).
//
// Usage: node bin/dep-provenance.mjs <repo-dir> [--out <file>]
//
// Fails closed. An unreadable lockfile is `ran:false` with a reason, never an empty inventory: an
// empty inventory would say "this repo resolves nothing from git", which is the false clean.

import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseYarnLock, parsePackageLock, RESOLUTION } from '../monitor/dep-provenance.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', 'coverage', '.next', 'target']);

/** Every yarn.lock / package-lock.json in the tree, bounded in depth so a monorepo terminates. */
export function findLockfiles(root, maxDepth = 6) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.yarn') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE.has(e.name)) walk(p, depth + 1); continue; }
      if (e.name === 'yarn.lock' || e.name === 'package-lock.json') out.push(p);
    }
  };
  walk(root, 0);
  return out.sort();
}

export function collect(root) {
  const locks = findLockfiles(root);
  if (!locks.length) {
    return { ran: false, reason: 'no-subject', detail: 'no yarn.lock or package-lock.json in the tree',
      packages: {}, counts: {}, lockfiles: [] };
  }
  const packages = {}; const lockfiles = []; const unreadable = [];
  for (const lock of locks) {
    const rel = relative(root, lock) || lock;
    let parsed;
    try {
      const text = readFileSync(lock, 'utf8');
      parsed = lock.endsWith('yarn.lock') ? parseYarnLock(text) : parsePackageLock(JSON.parse(text));
    } catch (e) {
      // FAIL CLOSED: a lockfile we could not read is named, and does not silently contribute zero.
      unreadable.push({ lockfile: rel, error: String(e && e.message).slice(0, 200) });
      continue;
    }
    lockfiles.push({ lockfile: rel, packages: Object.keys(parsed).length });
    for (const [name, v] of Object.entries(parsed)) {
      // First lockfile wins, and the conflict is recorded rather than overwritten.
      if (packages[name] && packages[name].resolution !== v.resolution) {
        packages[name].conflict = true;
      } else if (!packages[name]) {
        packages[name] = { ...v, lockfile: rel };
      }
    }
  }
  const counts = {};
  for (const v of Object.values(packages)) counts[v.resolution] = (counts[v.resolution] || 0) + 1;
  return {
    ran: lockfiles.length > 0,
    ...(lockfiles.length ? {} : { reason: 'unparseable', detail: 'every lockfile found failed to parse' }),
    packages, counts, lockfiles,
    ...(unreadable.length ? { unreadable } : {}),
    vocabulary: RESOLUTION,
    note: 'INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a '
      + 'dependency MOVING off a registry between slices, which only a comparison can see.',
  };
}

function main(argv) {
  const args = argv.slice(2);
  const root = resolve(args.find((a) => !a.startsWith('--')) || '.');
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args[oi + 1] : join(root, 'dep-provenance.json');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`dep-provenance: ${root} is not a directory\n`);
    process.exit(2);
  }
  const doc = collect(root);
  // tmp+rename: a reader must never see a half-written inventory.
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, out);
  const g = doc.counts.git || 0;
  process.stdout.write(`dep-provenance: ${Object.keys(doc.packages).length} package(s) across `
    + `${doc.lockfiles.length} lockfile(s) — ${g} git, ${doc.counts.registry || 0} registry, `
    + `${doc.counts.unknown || 0} unknown\n`);
}

if (isMainModule(import.meta.url)) main(process.argv);
