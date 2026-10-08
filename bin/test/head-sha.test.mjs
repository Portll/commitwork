// head-sha — a verdict record that does not name the tree it measured can never be re-derived.
// Two properties: the helper answers honestly (null when there is no HEAD), and EVERY gate stamps
// it — the helper existing changes nothing if a gate forgets to call it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { headSha } from '../head-sha.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..');

// A git-archive export or tarball CI checkout has no .git, so headSha() is legitimately null
// there — stand down WITH a stated reason rather than failing for a reason no commit could fix.
const inWorkTree = (() => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: BIN, stdio: 'ignore' });
    return true;
  } catch { return false; }
})();
const standDown = (t) => {
  t.diagnostic('no git work tree here (git archive export or tarball CI) — headSha() is legitimately '
    + 'null and the sha-shaped assertions stand down; the null-path tests below still run');
  return true;
};

test('resolves the repository HEAD as a full sha', (t) => {
  if (!inWorkTree) return standDown(t);
  const sha = headSha();
  assert.match(sha, /^[0-9a-f]{40}$/, 'expected a 40-char sha for this work tree');
});

// The seam must be read at CALL time — the import above has already happened.
test('CW_HEAD_SHA overrides, and is read at call time (not at module load)', () => {
  const planted = 'a'.repeat(40);
  const before = process.env.CW_HEAD_SHA;
  try {
    process.env.CW_HEAD_SHA = planted;
    assert.equal(headSha(), planted);
  } finally {
    if (before === undefined) delete process.env.CW_HEAD_SHA; else process.env.CW_HEAD_SHA = before;
  }
});

// `CW_HEAD_SHA=` sets an empty string, not an unset variable — blank must fall through, never stamp empty.
test('an empty or whitespace override is unset, not an empty sha', (t) => {
  if (!inWorkTree) return standDown(t);
  const before = process.env.CW_HEAD_SHA;
  try {
    for (const blank of ['', '   ']) {
      process.env.CW_HEAD_SHA = blank;
      assert.match(headSha(), /^[0-9a-f]{40}$/, `blank override ${JSON.stringify(blank)} should fall through to git`);
    }
  } finally {
    if (before === undefined) delete process.env.CW_HEAD_SHA; else process.env.CW_HEAD_SHA = before;
  }
});

// Null says there is no HEAD; a placeholder would re-derive against the wrong tree.
test('returns null outside a work tree — never a placeholder', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-nohead-'));
  try {
    assert.equal(headSha(d), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a tree with no commits yet is null, not an unborn-HEAD error string', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-unborn-'));
  try {
    const init = spawnSync('git', ['init', '-q', d], { encoding: 'utf8' });
    if (init.status !== 0) return;   // no git available; the property above already covers absence
    assert.equal(headSha(d), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── THE ONE THAT MATTERS ───────────────────────────────────────────────────────────────────────
// Three gates built records by hand and omitted the field — a new gate without a headSha stamp
// fails here instead of accumulating un-re-derivable records.
test('every gate stamps headSha on the record it journals', () => {
  const gates = {
    'gate-tests.mjs': 'headSha: HEAD_SHA',
    'gate-ratchet.mjs': 'headSha: headSha()',
    'gate-spine.mjs': 'headSha: headSha()',
    'docs-doctor.mjs': 'headSha: headSha()',
  };
  for (const [file, stamp] of Object.entries(gates)) {
    const src = readFileSync(join(BIN, file), 'utf8');
    assert.ok(
      src.includes(stamp),
      `${file} must put a headSha on its journal record (looked for ${JSON.stringify(stamp)}) — `
      + 'a record that does not name the tree it measured can never be re-derived, so it can never '
      + 'be adjudicated except by a human who remembers it',
    );
  }
});
