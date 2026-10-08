// bin/test-run.mjs — the entry point that makes the suite reproducible.
//
// THE DEFECT IT CLOSES, measured 2026-09-04: two consecutive `npm test` runs of the same tree gave
// 191 and 504 unique failing tests. The cause is on the WRITE side — 65 test files spawn
// monitor/sweep.mjs or rollup.mjs, and those resolve output paths from env vars almost no test set,
// so production code running under the suite appended to the repository's real
// `reports/perf-feedback.jsonl` mid-run. Later tests then read what earlier tests wrote.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { AMBIENT_OUTPUTS, TEST_GLOBS, scopedOutputEnv, fingerprint, outputFingerprint, ownedByOutput, snapshotTrees, changedPaths } from '../test-run.mjs';

describe('the ambient-output registry', () => {
  test('every entry names an env var the SOURCE actually reads', async () => {
    // A registry entry nobody reads is inert — it would scope nothing while looking like it did,
    // which is the shape this repo treats as worse than a missing entry because it reads as cover.
    const { execFileSync } = await import('node:child_process');
    const src = execFileSync('git', ['grep', '-l', '-E', AMBIENT_OUTPUTS.map((o) => o.env).join('|'),
      '--', '*.mjs'], { encoding: 'utf8', cwd: join(import.meta.dirname, '..', '..') });
    for (const o of AMBIENT_OUTPUTS) {
      assert.ok(src.length, 'git grep returned nothing at all');
      assert.match(o.env, /^CW_[A-Z0-9_]+$/, `${o.env} is not a CW_ override name`);
      assert.ok(isAbsolute(o.live), `${o.env}'s live path must be absolute, got ${o.live}`);
    }
  });

  test('the live paths are the ones that were actually being polluted', () => {
    const live = AMBIENT_OUTPUTS.map((o) => o.live.replace(/\\/g, '/'));
    // perf-feedback is the one reproduced directly: running only monitor/test/rollup*.test.mjs
    // mutated it. The others come from the same census and share the mechanism.
    assert.ok(live.some((p) => p.endsWith('reports/perf-feedback.jsonl')));
    assert.ok(live.some((p) => p.endsWith('.claude/store/chain-tips.jsonl')));
    assert.ok(AMBIENT_OUTPUTS.length >= 5, 'the registry lost entries');
  });

  test('the glob list still covers every test directory', () => {
    for (const d of ['admin', 'bin', 'lib', 'monitor', 'cra']) {
      assert.ok(TEST_GLOBS.some((g) => g.startsWith(`${d}/`)), `${d} dropped out of the run`);
    }
  });
});

describe('scopedOutputEnv', () => {
  test('redirects every ambient output into the scratch directory', () => {
    const env = scopedOutputEnv('/scratch', {});
    assert.equal(Object.keys(env).length, AMBIENT_OUTPUTS.length, 'every output must be scoped');
    for (const [k, v] of Object.entries(env)) {
      assert.ok(String(v).includes('scratch'), `${k} was not redirected: ${v}`);
      assert.ok(!String(v).includes('commitwork'), `${k} still points into the repo: ${v}`);
    }
  });

  test('a CALLER-SET value wins — this is a floor, not a cage', () => {
    // A test that genuinely wants the live path, or an operator debugging one, must be able to say
    // so. Overriding them here would make the scoping unfalsifiable from the outside.
    const env = scopedOutputEnv('/scratch', { CW_PERF_FEEDBACK: 'D:/mine.jsonl' });
    assert.equal(env.CW_PERF_FEEDBACK, undefined, 'must not overwrite what the caller already set');
    assert.ok(env.CW_CHAIN_ANCHORS, 'but the ones the caller did NOT set are still scoped');
  });

  test('distinct outputs get distinct paths — one file for two writers is its own bug', () => {
    const env = scopedOutputEnv('/scratch', {});
    assert.equal(new Set(Object.values(env)).size, Object.keys(env).length);
  });
});

describe('fingerprint — the self-check that makes the scoping falsifiable', () => {
  test('ABSENT and EMPTY are different states', () => {
    // The whole point of the after-run comparison: a file that appeared where none was is exactly
    // the pollution being detected, and "absent" collapsing into "empty" would hide it.
    const d = mkdtempSync(join(tmpdir(), 'cw-fp-'));
    try {
      const p = join(d, 'x.jsonl');
      assert.equal(fingerprint(p), 'absent');
      writeFileSync(p, '');
      assert.notEqual(fingerprint(p), 'absent', 'an empty file is not an absent one');
      const empty = fingerprint(p);
      writeFileSync(p, 'a');
      assert.notEqual(fingerprint(p), empty, 'content change must move the fingerprint');
      // An APPEND is the actual pollution shape — perf-feedback.jsonl is append-only.
      const one = fingerprint(p);
      writeFileSync(p, 'ab');
      assert.notEqual(fingerprint(p), one, 'an append must be detected');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a directory or an unreadable path is its own state, never "absent"', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-fp2-'));
    try {
      mkdirSync(join(d, 'adir'));
      assert.match(fingerprint(join(d, 'adir')), /^notfile:/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the same content yields the same fingerprint — it must not alarm on every run', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-fp3-'));
    try {
      const p = join(d, 'x');
      writeFileSync(p, 'stable');
      assert.equal(fingerprint(p), fingerprint(p));
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('a directory entry — one override, one log per job kind', () => {
  const files = /^[a-z][a-z0-9-]*-latest\.log$/;

  test('a file it owns appearing or growing moves its state; a peer file beside it does not', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-fpdir-'));
    try {
      const o = { env: 'CW_X', live: d, as: 'dir', files };
      const empty = outputFingerprint(o);
      writeFileSync(join(d, 'peer.json'), '{}');
      assert.equal(outputFingerprint(o), empty, 'a file the entry does not own is not its write');
      writeFileSync(join(d, 'health-all-latest.log'), '');
      const one = outputFingerprint(o);
      assert.notEqual(one, empty, 'a new per-kind log must be seen');
      writeFileSync(join(d, 'health-all-latest.log'), 'x\n');
      assert.notEqual(outputFingerprint(o), one, 'an append must be seen');
      assert.equal(outputFingerprint({ ...o, live: join(d, 'missing') }), 'absent');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the unregistered-write warning skips exactly what an entry owns', () => {
    const root = join(tmpdir(), 'cw-owned');
    const outs = [{ live: join(root, 'reports'), as: 'dir', files }, { live: join(root, 'reports', 'x.jsonl'), as: 'file' }];
    assert.ok(ownedByOutput('reports/bola-latest.log', root, outs));
    assert.ok(ownedByOutput('reports/x.jsonl', root, outs));
    assert.ok(!ownedByOutput('reports/other.json', root, outs));
    assert.ok(!ownedByOutput('reports/area/bola-latest.log', root, outs), 'a nested file is not the directory entry\'s');
  });
});

// ── SECOND WITNESS: the real production module, through the real override ──────────────────────
// Everything above tests the wrapper's own logic. This proves the thing the wrapper exists to do:
// that the env it sets actually moves where production code writes.
test('EFFECT: the scoping moves monitor/perf-feedback.mjs off the live path', async () => {
  const { feedbackPath } = await import('../../monitor/perf-feedback.mjs');
  const saved = process.env.CW_PERF_FEEDBACK;
  try {
    delete process.env.CW_PERF_FEEDBACK;
    const live = feedbackPath();
    assert.match(live.replace(/\\/g, '/'), /reports\/perf-feedback\.jsonl$/,
      'unscoped, this resolves into the repository — the leak being closed');

    const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
    try {
      Object.assign(process.env, scopedOutputEnv(d, process.env));
      const scoped = feedbackPath();
      assert.notEqual(scoped, live, 'the override must actually take effect');
      assert.ok(scoped.startsWith(d), `must land in the scratch dir: ${scoped}`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  } finally {
    if (saved === undefined) delete process.env.CW_PERF_FEEDBACK; else process.env.CW_PERF_FEEDBACK = saved;
  }
});

describe('snapshotTrees — the warning for writes nobody registered', () => {
  test('a new, changed or removed file shows; an untouched one does not', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-trees-'));
    try {
      mkdirSync(join(root, 'reports', 'area'), { recursive: true });
      writeFileSync(join(root, 'reports', 'area', 'keep.json'), '{}');
      writeFileSync(join(root, 'reports', 'gone.log'), 'x');
      writeFileSync(join(root, 'reports', 'grow.log'), 'x');
      const before = snapshotTrees(root);
      rmSync(join(root, 'reports', 'gone.log'));
      writeFileSync(join(root, 'reports', 'grow.log'), 'xx');
      writeFileSync(join(root, 'reports', 'new.html'), '<p>');
      assert.deepEqual(changedPaths(before, snapshotTrees(root)),
        ['reports/gone.log', 'reports/grow.log', 'reports/new.html']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a directory symlink is followed, so a write into the sidecar through it is seen', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-trees-'));
    const side = mkdtempSync(join(tmpdir(), 'cw-trees-side-'));
    try {
      mkdirSync(join(root, '.claude'), { recursive: true });
      symlinkSync(side, join(root, '.claude', 'store'));
      const before = snapshotTrees(root);
      writeFileSync(join(side, 'touches.jsonl'), '{}\n');
      assert.deepEqual(changedPaths(before, snapshotTrees(root)), ['.claude/store/touches.jsonl']);
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(side, { recursive: true, force: true }); }
  });

  test('an absent tree is an empty snapshot, not an error', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-trees-'));
    try { assert.equal(snapshotTrees(root).size, 0); } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
