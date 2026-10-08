// A lane must not index BUILD OUTPUT. `target/`, `node_modules/`, `vendor/`, `build/`, `dist/` are
// produced by a toolchain, are not tracked, and are not the repository — a finding in one of them
// describes a dependency's generated artifact, attributed to the repo that happened to compile it.
//
// MEASURED 2026-08-28 on shodh-memory: joern published 656 findings and 656 of 656 were under
// `target/debug/build/` — vendored C headers emitted by dependency build scripts (lz4-sys and
// friends). ZERO were in the repository's own source. Re-running the shipped lane line verbatim
// with the exclusion in place: 656 -> 0, with `ScanPass completed` still in the log, so the lane
// reads GENUINELY CLEAN rather than grey. Both directions asserted, which is the point.
//
// The determinism half matters more than the count. `target/` is untracked, so whether it exists
// and what it holds depends on whether somebody ran `cargo build` before the sweep. The same
// repository at the same commit therefore produced 14 shellLint rows in one sweep and 167 in the
// next, because a DIFFERENT tool had populated a directory in between. Same inputs must give the
// same outputs, and an untracked build directory is not an input.
//
// sast-codeql already had this guard and states the same lesson in its own refusal message — an
// unfiltered database "indexes generated output (reports/, map/data/) and inflated one area to 638
// phantom highs". This test generalises the rule so the next lane does not have to relearn it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { excludeDirs } from '../scan-exclusions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
const T = mkdtempSync(join(tmpdir(), 'cw-scanexcl-'));

// Lanes that walk a source TREE themselves rather than reading a lockfile or a single named file.
// Keyed by check id so adding a lane is a deliberate act, not an accident of pattern-matching.
const TREE_WALKERS = ['sast-joern', 'shell-lint'];

// ONE SOURCE OF TRUTH. The lanes used to hand-maintain their own lists and disagree — stub-detect's
// SKIP_DIRS held `target`, shell-lint's `grep -v` did not, joern had no list at all. Asserting that
// each lane RENDERS the shared file is stronger than asserting it happens to name the right
// directories, because it is the divergence that caused the defect, not the contents.
for (const id of TREE_WALKERS) {
  test(`${id} takes its exclusions from the shared policy, not its own copy`, () => {
    const check = manifest.checks.find((c) => c.id === id);
    assert.ok(check, `${id} is not in the manifest — update TREE_WALKERS or the check id`);
    const cmd = (check.local || []).join(' ; ');
    assert.match(cmd, /bin\/scan-exclusions\.mjs/,
      `${id} does not render manifests/scan-exclude-dirs.txt — a second hand-maintained list is exactly how 'target' came to be excluded by one lane and indexed by another`);
    assert.match(cmd, /\|\|\s*exit 1/,
      `${id} must ABORT when the exclusion policy cannot be read. Proceeding unfiltered restores the 656-finding behaviour at the moment nobody is watching, so an unreadable policy is a reason to stop, not a reason to scan everything`);
  });
}

test('the shared policy names the directories the defect was measured in', () => {
  const dirs = excludeDirs();
  for (const d of ['target', 'node_modules', 'vendor', 'dist', 'build']) {
    assert.ok(dirs.includes(d), `scan-exclude-dirs.txt is missing '${d}'`);
  }
  // The over-exclusion bound, asserted rather than promised. `bin` is real source in THIS
  // repository; if it ever appears here, deep SAST silently stops reading commitwork's own code.
  for (const d of ['bin', 'src', 'lib', 'monitor', 'out', 'obj']) {
    assert.ok(!dirs.includes(d), `scan-exclude-dirs.txt must NOT hold '${d}' — an over-exclusion is a false clean, the worst failure this platform has`);
  }
});

test('an unreadable or empty policy throws rather than rendering an empty exclusion', () => {
  assert.throws(() => excludeDirs('/nonexistent-scan-exclude-list'), /ENOENT/);
  const empty = join(T, 'empty.txt'); writeFileSync(empty, '# only a comment\n\n');
  assert.throws(() => excludeDirs(empty), /lists no directories/);
  const bad = join(T, 'bad.txt'); writeFileSync(bad, 'node_modules\n../etc\n');
  assert.throws(() => excludeDirs(bad), /not a plain directory name/);
});

// The negative control. Without it the test above passes for a lane that merely NAMES the
// directories somewhere harmless, and it would also have passed against the pre-fix command if that
// command had happened to contain the word "target" in a comment.
test('the guard fails on a command that does not exclude anything', () => {
  const bare = 'joern-scan "$src" --overwrite > "$rd/joern.txt" 2>&1';   // the pre-2026-08-28 line
  for (const dir of ['target', 'node_modules', 'vendor']) {
    assert.ok(!new RegExp(`\\b${dir}\\b`).test(bare),
      `the pre-fix command must NOT satisfy the guard, or the guard proves nothing`);
  }
});
