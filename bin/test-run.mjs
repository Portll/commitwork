#!/usr/bin/env node
// The test entry point — `npm test` runs this, not `node --test` directly.
//
// ── WHY THIS EXISTS: THE SUITE WAS NOT REPRODUCIBLE ─────────────────────────────────────────────
// Measured 2026-09-04: two consecutive `npm test` runs of the SAME tree produced 191 and 504 unique
// failing tests. A spread of 300 is not flakiness at the margin — it means nobody in this repository
// could tell a regression from noise, which hollows out every gate and every "the tests pass" claim
// the project makes about itself.
//
// The cause is not what it looks like. Only ~11 test files READ live ambient state, and most of
// those skip honestly when it is absent. The leak is on the WRITE side, and it comes through
// production code the tests spawn: 65 test files run `monitor/sweep.mjs` or `monitor/rollup.mjs`
// as a child process, and those modules resolve their output paths from env vars that almost no
// test sets. `monitor/perf-feedback.mjs` is the clearest case —
//
//     resolve(process.env.CW_REPORTS_ROOT || 'reports', 'perf-feedback.jsonl')
//
// — which is CWD-RELATIVE, so a child spawned with `cwd: CW` appends to the repository's real
// `reports/perf-feedback.jsonl` in the middle of the suite. Reproduced directly: running only
// `monitor/test/rollup*.test.mjs` mutated that file. Later tests then read what earlier tests wrote,
// and eight concurrent sessions do the same to each other.
//
// ── WHY IT IS FIXED HERE RATHER THAN IN 65 FILES ────────────────────────────────────────────────
// Every one of these paths is already env-overridable and read at CALL time — the house invariant
// is in place. What was missing was anyone setting the overrides. Setting them once, for the whole
// run, fixes all 65 spawners without touching them, cannot be forgotten by the 66th, and leaves any
// test that genuinely wants the live path free to override it back locally.
//
// It has to be a Node wrapper rather than an npm-script env prefix because `VAR=x cmd` is not
// portable to PowerShell and this repo has zero dependencies, so `cross-env` is not available.
//
// ── AND IT CHECKS ITSELF ────────────────────────────────────────────────────────────────────────
// Redirecting the writes is a marker; proving the live files did not move is the effect. This
// fingerprints every ambient path before and after and FAILS THE RUN if one changed. Without that
// this file would be exactly the kind of guard it exists to replace — one that reads as protection
// and is never checked. Note that `reports/` and `.claude/` are BOTH GITIGNORED, so a
// `git status` check cannot see this pollution at all; that is the same ignore-rule blind spot
// CLAUDE.md already records for the durability check.

import { isMainModule } from '../lib/is-main.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, statSync, readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The globs `npm test` used to carry inline. Kept here so the run's shape and its environment are
// described in one place.
export const TEST_GLOBS = [
  'admin/**/*.test.mjs', 'bin/**/*.test.mjs', 'lib/**/*.test.mjs', 'monitor/**/*.test.mjs',
  'sitemap/**/*.test.mjs', 'cra/**/*.test.mjs', 'map/**/*.test.mjs', 'chunk-diff/**/*.test.mjs',
  'flow/**/*.test.mjs', 'mcp/**/*.test.mjs', 'codegraph/**/*.test.mjs',
];

/**
 * Every env var that REDIRECTS A WRITE, with the live path it falls back to.
 *
 * One registry, two consumers: the scoping below, and the self-check that the live paths did not
 * move. The self-check only fails on paths listed here; an output nobody listed is caught by the
 * tree snapshot below, which can only warn — other sessions write these trees during a run.
 */
export const AMBIENT_OUTPUTS = [
  { env: 'CW_PERF_FEEDBACK', live: join(CW, 'reports', 'perf-feedback.jsonl'), as: 'file' },
  { env: 'CW_FORENSICS_OUT', live: join(CW, 'reports', 'forensics.json'), as: 'file' },
  { env: 'CW_OBSERVABLES_OUT', live: join(CW, 'reports', 'observables.json'), as: 'file' },
  { env: 'CW_CHAIN_ANCHORS', live: join(CW, '.claude', 'store', 'chain-tips.jsonl'), as: 'file' },
  { env: 'CW_SLOP_SWEEP_LOG', live: join(CW, '.claude', 'store', 'slop-sweeps.jsonl'), as: 'file' },
  // admin/serve.mjs writes this at every boot, and the admin tests boot it dozens of times.
  { env: 'CW_PANEL_CODE_STAMP', live: join(CW, '.claude', 'store', 'panel-code-stamp.json'), as: 'file' },
  { env: 'CW_SWEEP_LIVE_LOG', live: join(CW, 'reports', 'sweep-latest.log'), as: 'file' },
  // A directory: admin/lib/jobs.mjs writes one <kind>-latest.log per panel job kind into it.
  // `files` is what in it this entry owns, so the self-check sees those writes and no peer's.
  { env: 'CW_JOB_LOG_DIR', live: join(CW, 'reports'), as: 'dir', files: /^[a-z][a-z0-9-]*-latest\.log$/ },
  { env: 'CW_PANEL_RESTART_LOG', live: join(CW, 'reports', 'panel-restart.log'), as: 'file' },
  { env: 'CW_SWEEP_REFUSALS', live: join(CW, 'reports', 'sweep-refusals.jsonl'), as: 'file' },
  // Every gate journals its verdict here. On a fresh clone there is no sidecar link, so a run that
  // wrote the live path left a real .claude/verdicts behind, which sidecar-paths reads as degradation.
  { env: 'CW_VERDICT_DIR', live: join(CW, '.claude', 'verdicts'), as: 'dir', files: /\.jsonl$/ },
  // rollup.mjs backfills per-CVE EPSS detail into this private record whenever a slice names a CVE it
  // has not scored; in the shared checkout the private dir is the sidecar.
  { env: 'CW_EPSS_DETAIL', live: join(CW, 'monitor', 'private', 'epss-detail.json'), as: 'file' },
];

// The gitignored trees production code writes into. Snapshotted by size and mtime, following a
// directory symlink once, because .claude/store and .claude/verdicts are links into the sidecar.
export const AMBIENT_TREES = ['reports', '.claude'];

export function snapshotTrees(root = CW, trees = AMBIENT_TREES) {
  const out = new Map();
  const seen = new Set();
  const walk = (abs, rel) => {
    let real;
    try { real = realpathSync(abs); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const a = join(abs, e.name), r = `${rel}/${e.name}`;
      let st;
      try { st = statSync(a); } catch { continue; }
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) out.set(r, `${st.size}:${st.mtimeMs}`);
    }
  };
  for (const t of trees) walk(join(root, t), t);
  return out;
}

export function changedPaths(before, after) {
  const changed = [];
  for (const [p, v] of after) if (before.get(p) !== v) changed.push(p);
  for (const p of before.keys()) if (!after.has(p)) changed.push(p);
  return changed.sort();
}

/** A fingerprint that distinguishes "absent" from "empty" — those are different states here. */
export function fingerprint(path) {
  try {
    const st = statSync(path);
    if (!st.isFile()) return `notfile:${st.isDirectory() ? 'dir' : 'other'}`;
    return `${st.size}:${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)}`;
  } catch (e) {
    return e.code === 'ENOENT' ? 'absent' : `unreadable:${e.code}`;
  }
}

/** An entry's state: a file's fingerprint, or for a directory entry, one per file it owns. */
export function outputFingerprint(o) {
  if (o.as !== 'dir') return fingerprint(o.live);
  let names;
  try { names = readdirSync(o.live).filter((n) => o.files.test(n)).sort(); }
  catch (e) { return e.code === 'ENOENT' ? 'absent' : `unreadable:${e.code}`; }
  return names.map((n) => `${n}=${fingerprint(join(o.live, n))}`).join(' ');
}

/** Whether a changed path, relative to `root`, is one an AMBIENT_OUTPUTS entry accounts for. */
export function ownedByOutput(rel, root = CW, outputs = AMBIENT_OUTPUTS) {
  return outputs.some((o) => (o.as === 'dir'
    ? join(root, dirname(rel)) === o.live && o.files.test(basename(rel))
    : join(root, rel) === o.live));
}

/**
 * Env overrides pointing every ambient output into `dir`.
 * An override the CALLER already set is left alone — a test harness or an operator asking for the
 * real path must win over this default, or this becomes a cage rather than a floor.
 */
export function scopedOutputEnv(dir, env = process.env) {
  const out = {};
  for (const o of AMBIENT_OUTPUTS) {
    if (env[o.env]) continue;
    out[o.env] = join(dir, o.env.replace(/^CW_/, '').toLowerCase().replace(/_/g, '-'));
  }
  return out;
}

function main() {
  const passthrough = process.argv.slice(2);
  const scratch = mkdtempSync(join(tmpdir(), 'cw-test-scope-'));
  mkdirSync(join(scratch, 'reports'), { recursive: true });
  const scoped = scopedOutputEnv(scratch);

  const before = new Map(AMBIENT_OUTPUTS.map((o) => [o.env, outputFingerprint(o)]));
  const treesBefore = snapshotTrees();

  const args = ['--test', '--test-concurrency=1', ...(passthrough.length ? passthrough : TEST_GLOBS)];
  const child = spawn(process.execPath, args, {
    cwd: CW,
    stdio: 'inherit',
    env: { ...process.env, ...scoped },
  });

  child.on('exit', (code, signal) => {
    // The self-check runs whatever the suite's verdict was: a suite that fails AND pollutes needs
    // to be told about both, and the pollution is the one nobody would otherwise notice.
    const moved = [];
    for (const o of AMBIENT_OUTPUTS) {
      const now = outputFingerprint(o);
      if (now !== before.get(o.env)) moved.push(`${o.live}\n      ${before.get(o.env)}  ->  ${now}`);
    }
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }

    const unlisted = changedPaths(treesBefore, snapshotTrees()).filter((p) => !ownedByOutput(p));
    if (unlisted.length) {
      console.error(`\n\x1b[33m${unlisted.length} file(s) under ${AMBIENT_TREES.join(', ')} changed during the run\x1b[0m`);
      console.error('  Not a failure: another session or a sweep may have written them. In a private');
      console.error('  worktree they are the suite\'s own writes — give each an env override and list it');
      console.error('  in AMBIENT_OUTPUTS.');
      for (const p of unlisted.slice(0, 40)) console.error(`    - ${p}`);
      if (unlisted.length > 40) console.error(`    … and ${unlisted.length - 40} more`);
    }

    if (moved.length) {
      console.error('\n\x1b[31mAMBIENT STATE WAS MUTATED BY THE TEST SUITE\x1b[0m');
      console.error('  These paths are shared, gitignored, and read by other tests — which is how a');
      console.error('  suite stops reproducing. Scope the write: set the env var in the test that');
      console.error('  spawns the production code, or add it to AMBIENT_OUTPUTS in bin/test-run.mjs.');
      for (const m of moved) console.error(`    - ${m}`);
      process.exit(code === 0 ? 1 : (code ?? 1));
    }
    if (signal) { console.error(`test runner killed by ${signal}`); process.exit(1); }
    process.exit(code ?? 1);
  });
}

const invokedDirectly = isMainModule(import.meta.url);
if (invokedDirectly) main();
