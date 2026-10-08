// node --test monitor/test/  — RETENTION PROTECTION: a fresh batch dir is never compacted.
// compact-reports.mjs has no exports and no root override, so the tests build a scratch
// commitwork-shaped tree, copy the real script plus its transitive local imports, and run it for
// real including --apply. Nothing here reimplements the protection logic.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryPathFor } from '../store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const SCRIPT = join(CW, 'monitor/compact-reports.mjs');
const KEEP = 2; // passed as --keep on every run so the fixture never depends on the live registry

const MONITOR_OUT = 'testarea';
const REGISTRY = {
  reportsRoot: 'reports',
  monitorOutput: MONITOR_OUT,
  retention: { keepFullSweeps: KEEP, dropDirPattern: '^codeql-(java-)?db$', protect: ['runtime-latest', 'custom-protected'] },
};

const trees = [];
after(() => { for (const t of trees) rmSync(t, { recursive: true, force: true }); });

// Copies `entry` and its relative imports, keeping repo layout.
function copyWithLocalDeps(entry, root, seen = new Set()) {
  const abs = resolve(entry);
  if (seen.has(abs)) return seen;
  seen.add(abs);
  const dest = join(root, relative(CW, abs));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
  const src = readFileSync(abs, 'utf8');
  for (const re of [/from\s+['"](\.\.?\/[^'"]+)['"]/g, /^\s*import\s+['"](\.\.?\/[^'"]+)['"]/gm]) {
    for (const m of src.matchAll(re)) {
      const dep = resolve(dirname(abs), m[1]);
      if (existsSync(dep)) copyWithLocalDeps(dep, root, seen);
    }
  }
  return seen;
}

// spec: { batches: [name], files: { relPath: contents }, pointer: 'reports/<name>' }
// every batch gets <batch>/repo-a/codeql-db/db.bin, so "was it pruned?" is directly observable.
function makeTree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'cw-retention-'));
  trees.push(root);
  mkdirSync(join(root, 'monitor'), { recursive: true });
  copyWithLocalDeps(SCRIPT, root); // the REAL script + its local imports
  // Through the resolver the compactor reads with, not a literal — the registry lives under
  // monitor/private/ since 2026-08-27, and a fixture written to the old path would leave the script
  // reading nothing while the test still described a registry.
  mkdirSync(dirname(registryPathFor(root)), { recursive: true });
  writeFileSync(registryPathFor(root), JSON.stringify(spec.registry || REGISTRY, null, 2));
  const reports = join(root, 'reports');
  mkdirSync(reports, { recursive: true });
  for (const b of spec.batches || []) {
    mkdirSync(join(reports, b, 'repo-a/codeql-db'), { recursive: true });
    writeFileSync(join(reports, b, 'repo-a/codeql-db/db.bin'), 'x'.repeat(1024));
    writeFileSync(join(reports, b, 'repo-a/osv.sarif'), '{"runs":[]}');
    writeFileSync(join(reports, b, 'batch-manifest.json'), JSON.stringify({ sliceId: b, kind: 'sweep' }));
  }
  for (const [rel, body] of Object.entries(spec.files || {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  if (spec.pointer) writeFileSync(join(reports, '.codeql-fleet-latest'), spec.pointer);
  return { root, reports };
}

function compact(root, { apply = false, keep = KEEP, now } = {}) {
  const args = [join(root, 'monitor/compact-reports.mjs'), '--keep', String(keep)];
  if (apply) args.push('--apply');
  // CW_MONITOR_OUT deliberately unset — an inherited value would re-point the protected name
  const env = { ...process.env }; delete env.CW_MONITOR_OUT; delete env.CW_RETENTION_KEEP;
  if (now) env.CW_NOW = now; else delete env.CW_NOW; // an age floor is only testable against a fixed clock
  const stdout = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  return { stdout, touched: [...stdout.matchAll(/^\[compact\] (?:DRY )?([^:\n]+):/gm)].map((m) => m[1]) };
}

const dbOf = (reports, batch) => join(reports, batch, 'repo-a/codeql-db');
const survives = (reports, batch) => existsSync(dbOf(reports, batch));
const pruneManifest = (reports, batch) => existsSync(join(reports, batch, 'prune-manifest.json'));

// "fresh" = one of the newest KEEP
const OLD = ['sweep-20260101000000', 'sweep-20260102000000'];
const FRESH_OLD_FORM = ['sweep-20260726100000', 'sweep-20260726110000'];
const FRESH_NEW_FORM = ['sweep-20260726120000-client-a', 'sweep-20260726130000-client-d'];

// The pure policy is covered in retention-policy.test.mjs; this is the integration that matters —
// does the tool that DELETES actually honour a per-area declaration, or merely resolve one?
describe('per-area retention — a declared age floor survives contact with the compactor', () => {
  const AREA = 'commitwork-admin';
  const NOW = '2026-07-27T00:00:00Z';
  const NEWEST = [`sweep-20260726100000-${AREA}`, `sweep-20260726110000-${AREA}`]; // the newest KEEP=2
  const IN_FLOOR = `sweep-20260601000000-${AREA}`;  // 56d — inside 90d, NOT among the newest 2
  const OUTSIDE = `sweep-20260101000000-${AREA}`;   // 207d — outside the floor and not newest
  const batches = [OUTSIDE, IN_FLOOR, ...NEWEST];
  // batchArea() reads each batch's manifest; without it every batch is '(unscoped)' and the
  // per-area declaration is never consulted — which would make this whole block a false green.
  const manifests = Object.fromEntries(batches.map((b) => [`reports/${b}/batch-manifest.json`, JSON.stringify({ area: AREA })]));
  const withFloor = { ...REGISTRY, areas: [{ slug: AREA, out: AREA, retention: { keepDays: 90 } }] };
  const noFloor = { ...REGISTRY, areas: [{ slug: AREA, out: AREA }] };

  test('a batch inside the floor keeps its CodeQL DB even though it is not among the newest KEEP', () => {
    const { root, reports } = makeTree({ batches, files: manifests, registry: withFloor });
    // Proven against the SAME tree without the floor: otherwise "it survived" could just mean the
    // compactor never reached it, and the floor would be decorative.
    const bare = makeTree({ batches, files: manifests, registry: noFloor });
    compact(bare.root, { apply: true, now: NOW });
    assert.equal(survives(bare.reports, IN_FLOOR), false, 'without the floor this batch must be pruned — otherwise the test proves nothing');

    compact(root, { apply: true, now: NOW });
    assert.ok(survives(reports, IN_FLOOR), `PROTECTED BY FLOOR BUT PRUNED: ${IN_FLOOR}`);
    assert.equal(pruneManifest(reports, IN_FLOOR), false);
    for (const b of NEWEST) assert.ok(survives(reports, b), `${b} is among the newest KEEP and was pruned`);
  });

  test('the floor is a floor, not a blanket — what falls outside it is still compacted', () => {
    const { root, reports } = makeTree({ batches, files: manifests, registry: withFloor });
    compact(root, { apply: true, now: NOW });
    assert.equal(survives(reports, OUTSIDE), false, '207d is outside a 90d floor and must still be pruned');
    assert.ok(pruneManifest(reports, OUTSIDE), 'a pruned batch must carry its rebuild recipe');
  });

  test('the policy line names the area and its source, and is not mistaken for a touched batch', () => {
    const { root } = makeTree({ batches, files: manifests, registry: withFloor });
    const dry = compact(root, { now: NOW });
    assert.match(dry.stdout, new RegExp(`policy for ${AREA} — keep \\d+ \\(global\\) \\+ 90d floor \\(area '${AREA}'\\)`));
    assert.equal(dry.touched.includes(AREA), false, 'the policy line was parsed as a pruning candidate');
  });
});

describe('a freshly created batch dir is protected — OLD sweep-<stamp> form', () => {
  test('the newest KEEP batches keep their CodeQL DBs; only older batches are pruned', () => {
    const { root, reports } = makeTree({ batches: [...OLD, ...FRESH_OLD_FORM] });
    const dry = compact(root);
    assert.deepEqual(dry.touched.filter((n) => FRESH_OLD_FORM.includes(n)), [], `a fresh batch appeared in the dry run: ${dry.touched.join(', ')}`);
    assert.deepEqual(dry.touched.filter((n) => OLD.includes(n)).sort(), OLD.slice().sort(), 'the two old batches must be candidates (otherwise nothing is being tested)');

    compact(root, { apply: true });
    for (const b of FRESH_OLD_FORM) {
      assert.ok(survives(reports, b), `PROTECTED BATCH DELETED: ${b}/repo-a/codeql-db was rmSync'd by the compactor`);
      assert.equal(pruneManifest(reports, b), false, `${b} got a prune-manifest.json — it was compacted`);
    }
    for (const b of OLD) {
      assert.equal(survives(reports, b), false, `${b} should have been pruned; the fixture is not exercising the delete path`);
      assert.ok(pruneManifest(reports, b), `${b} was pruned with no prune-manifest.json — the reversibility record is missing`);
    }
  });

  test('every non-CodeQL artifact in a pruned batch survives (the documented preservation claim)', () => {
    const { root, reports } = makeTree({ batches: [...OLD, ...FRESH_OLD_FORM] });
    compact(root, { apply: true });
    for (const b of OLD) {
      assert.ok(existsSync(join(reports, b, 'repo-a/osv.sarif')), `${b}: osv.sarif was deleted — corrected-history re-reads it`);
      assert.ok(existsSync(join(reports, b, 'batch-manifest.json')), `${b}: batch-manifest.json was deleted`);
    }
  });

  test('with KEEP >= the batch count nothing is a candidate at all', () => {
    const { root, reports } = makeTree({ batches: [...OLD, ...FRESH_OLD_FORM] });
    const dry = compact(root, { keep: 4 });
    assert.deepEqual(dry.touched, []);
    compact(root, { apply: true, keep: 4 });
    for (const b of [...OLD, ...FRESH_OLD_FORM]) assert.ok(survives(reports, b), `${b} pruned despite KEEP=4`);
  });
});

describe('a freshly created batch dir is protected — NEW sweep-<stamp>-<area> form', () => {
  test('the newest KEEP batches keep their CodeQL DBs regardless of naming form',
    () => {
      const { root, reports } = makeTree({ batches: [...OLD, ...FRESH_NEW_FORM] });
      const dry = compact(root);
      assert.deepEqual(dry.touched.filter((n) => FRESH_NEW_FORM.includes(n)), [], `a fresh new-form batch appeared in the dry run: ${dry.touched.join(', ')}`);
      compact(root, { apply: true });
      for (const b of FRESH_NEW_FORM) assert.ok(survives(reports, b), `PROTECTED BATCH DELETED: ${b}/repo-a/codeql-db`);
      for (const b of OLD) assert.equal(survives(reports, b), false, `${b} should have been pruned`);
    });

  test('the two naming forms sort into ONE keep set (a mixed tree keeps the newest KEEP overall)',
    () => {
      // stamps interleave: newest KEEP=2 overall are the two new-form dirs
      const { root, reports } = makeTree({ batches: [...FRESH_OLD_FORM, ...FRESH_NEW_FORM] });
      compact(root, { apply: true });
      for (const b of FRESH_NEW_FORM) assert.ok(survives(reports, b), `${b} (newest overall) was pruned`);
      for (const b of FRESH_OLD_FORM) assert.equal(survives(reports, b), false, `${b} is older than the KEEP window and should have been pruned`);
    });
});

describe('re-proving the 2026-07-20 near-miss: sweep-latest.log must not displace a batch', () => {
  test('the log FILE never enters the keep set, so no real batch is pushed out of it', () => {
    // naive startsWith+sort puts the log LAST, so slice(-KEEP) would displace the oldest real batch
    const { root, reports } = makeTree({
      batches: FRESH_OLD_FORM,
      files: { 'reports/sweep-latest.log': '[sweep] done\n' },
    });
    const dry = compact(root);
    assert.deepEqual(dry.touched, [], `the log displaced a batch out of the keep set: ${dry.touched.join(', ')}`);
    compact(root, { apply: true });
    for (const b of FRESH_OLD_FORM) assert.ok(survives(reports, b), `${b} was pruned — sweep-latest.log took its place in the keep set`);
    assert.ok(existsSync(join(reports, 'sweep-latest.log')), 'the log itself must survive');
  });

  test('a directory whose name only RESEMBLES a batch is not treated as one', () => {
    // lookalike names must neither enter the keep set nor be protected out of the candidate list
    const { root } = makeTree({ batches: [...OLD, ...FRESH_OLD_FORM], files: { 'reports/sweep-2026072612/repo-a/keep.txt': 'x' } });
    const dry = compact(root);
    assert.equal(dry.touched.includes('sweep-2026072612'), false, 'a short-stamp dir with no codeql-db must not be reported');
    assert.deepEqual(dry.touched.sort(), OLD.slice().sort(), 'the keep set must still be the two newest REAL batches');
  });
});

describe('the hard-protected names', () => {
  test('monitorOutput, runtime-latest and registry `protect` entries are never compacted', () => {
    const { root, reports } = makeTree({
      batches: [...OLD, ...FRESH_OLD_FORM],
      files: {
        [`reports/${MONITOR_OUT}/repo-a/codeql-db/db.bin`]: 'x',
        [`reports/${MONITOR_OUT}/history/20260726110000.json`]: JSON.stringify({ anchors: { 'repo-a': { sha: 'deadbeef' } } }),
        'reports/runtime-latest/repo-a/codeql-db/db.bin': 'x',
        'reports/custom-protected/repo-a/codeql-db/db.bin': 'x',
      },
    });
    compact(root, { apply: true });
    for (const name of [MONITOR_OUT, 'runtime-latest', 'custom-protected']) {
      assert.ok(existsSync(join(reports, name, 'repo-a/codeql-db')), `${name}/ is hard-protected but its codeql-db was deleted`);
    }
  });

  test('the .codeql-fleet-latest pointer target is protected even when it is an old batch', () => {
    const { root, reports } = makeTree({
      batches: [...OLD, ...FRESH_OLD_FORM],
      pointer: `reports/${OLD[0]}`, // the OLDEST batch — otherwise the keep set would cover it anyway
    });
    const dry = compact(root);
    assert.equal(dry.touched.includes(OLD[0]), false, `the pointer target ${OLD[0]} was a compaction candidate`);
    compact(root, { apply: true });
    assert.ok(survives(reports, OLD[0]), `pointer target ${OLD[0]} lost its codeql-db`);
    assert.equal(survives(reports, OLD[1]), false, 'the non-pointed old batch should still have been pruned');
  });

  test('EVERY declared area\'s out dir is protected, not just the ambient one', () => {
    // the compactor walks the SHARED reports root — a second area must not become a candidate
    // because the current process is scoped elsewhere
    const registry = {
      ...REGISTRY,
      monitorOutput: 'alpha-monorepo',
      areas: [
        { slug: 'alpha', label: 'Alpha', out: 'alpha-monorepo', primary: true },
        { slug: 'beta', label: 'Beta' }, // no `out` => the dir is reports/beta
      ],
    };
    const { root, reports } = makeTree({
      registry,
      batches: [...OLD, ...FRESH_OLD_FORM],
      files: {
        'reports/alpha-monorepo/repo-a/codeql-db/db.bin': 'x',
        'reports/beta/repo-a/codeql-db/db.bin': 'x',
      },
    });
    const dry = compact(root);
    for (const a of ['alpha-monorepo', 'beta']) assert.equal(dry.touched.includes(a), false, `declared area dir ${a} is a compaction candidate`);
    compact(root, { apply: true });
    for (const a of ['alpha-monorepo', 'beta']) {
      assert.ok(existsSync(join(reports, a, 'repo-a/codeql-db')), `declared area ${a}/ lost its codeql-db to the compactor`);
    }
  });

  test('the prune manifest records the anchor SHA and the regeneration recipe', () => {
    const { root, reports } = makeTree({
      batches: [...OLD, ...FRESH_OLD_FORM],
      files: { [`reports/${MONITOR_OUT}/history/20260726110000.json`]: JSON.stringify({ anchors: { 'repo-a': { sha: 'deadbeefcafe' } } }) },
    });
    compact(root, { apply: true });
    const m = JSON.parse(readFileSync(join(reports, OLD[0], 'prune-manifest.json'), 'utf8'));
    assert.equal(m.batch, OLD[0]);
    assert.equal(m.keepFullSweeps, KEEP);
    assert.equal(m.removedDirs, 1);
    assert.equal(m.entries[0].repo, 'repo-a');
    assert.equal(m.entries[0].anchorSha, 'deadbeefcafe', 'the regeneration anchor must come from the history slice, not be null');
    assert.match(m.regeneration.recipe, /^codeql database create /);
  });
});

describe('the compactor never escapes its reports root', () => {
  test('a scratch-tree run touches nothing in the real repo tree', () => {
    const { root } = makeTree({ batches: [...OLD, ...FRESH_OLD_FORM] });
    const { stdout } = compact(root, { apply: true });
    assert.doesNotMatch(stdout, new RegExp(CW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the scratch compactor referenced the real commitwork checkout — ROOT resolution leaked');
    assert.match(stdout, /\[compact\] freed .* GB across 2 batches \(2 dirs\) · keeping newest 2 full/);
  });
});
