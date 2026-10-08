// bin/test/scan-exclusions-regex.test.mjs — the two properties the rendered exclusion regex must
// hold, both of which it violated silently until 2026-09-01, and neither of which any test covered.
//
// The sast-joern lane passed this regex to joern-scan via --frontend-args and excluded NOTHING for
// as long as it had existed. Two independent faults on one line:
//
//   1. BACKSLASHES. joern-scan embeds --frontend-args in generated Scala, where `\.` in a string
//      literal is an invalid escape. The scan never ran, stdout was a 41-byte husk, and the exit
//      code did not reliably say so. `[.]` is equivalent and survives the round-trip.
//   2. ANCHORING. c2cpg matches paths RELATIVE to the input dir, so a repo-root node_modules/
//      arrives as `node_modules/x.c` with nothing before it — and `.*/(…)` demands a literal `/`
//      ahead of the name. The commonest case there is never matched.
//
// Fault 1 masked fault 2 completely: the scan died before the regex was evaluated, so fixing either
// alone still excluded nothing. That is why these are asserted separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asRegex, asGrepArgs, excludeDirs, dirExcluder } from '../scan-exclusions.mjs';
import { writeFileSync } from 'node:fs';

const DIRS = ['node_modules', 'target', '.gradle', '.git'];

test('the rendered regex contains NO backslash — joern-scan compiles it as a Scala string literal', () => {
  const rx = asRegex(DIRS);
  assert.equal(rx.includes('\\'), false,
    `a backslash makes joern-scan fail compilation, skip the scan and still exit 0: ${rx}`);
  // and the real list, not just the sample — this is what actually ships
  assert.equal(asRegex(excludeDirs()).includes('\\'), false);
});

test('a leading separator is OPTIONAL — a repo-root excluded dir has nothing before it', () => {
  const rx = new RegExp(asRegex(DIRS));
  assert.equal(rx.test('node_modules/evil/a.c'), true,
    'a repo-root node_modules is the commonest case and was the one never matched');
  assert.equal(rx.test('pkg/node_modules/evil/a.c'), true, 'a nested one must still match');
  assert.equal(rx.test('.gradle/caches/x.java'), true, 'root-level dotted dir');
});

test('the dot stays LITERAL — [.] must not become a wildcard', () => {
  const rx = new RegExp(asRegex(DIRS));
  assert.equal(rx.test('a/.gradle/b'), true);
  assert.equal(rx.test('a/Xgradle/b'), false, '[.] matched a non-dot character — it is acting as a wildcard');
  assert.equal(rx.test('a/agradle/b'), false);
});

test('a file outside every excluded dir is NOT matched — the guard against over-exclusion', () => {
  const rx = new RegExp(asRegex(DIRS));
  for (const p of ['src/real.c', 'vuln.c', 'lib/target.c', 'a/b/c.java']) {
    assert.equal(rx.test(p), false, `${p} would be silently dropped from every scan`);
  }
  // `target.c` above is deliberate: the DIRECTORY target/ is excluded, a file named target.c is not.
  assert.equal(rx.test('target/classes/X.class'), true, 'the directory itself must still match');
});

test('a name needing a backslash is REFUSED, never escaped into a silent break', () => {
  // excludeDirs() already rejects these, so this is the second witness: asRegex called directly
  // must not quietly emit `\(` and hand joern an artifact-free scan.
  assert.throws(() => asRegex(['weird(name)']), /metacharacter/);
  assert.throws(() => asRegex(['a*b']), /metacharacter/);
});

test('--grep rendering is untouched by the regex change — shellcheck consumes it', () => {
  assert.equal(asGrepArgs(DIRS), '-e /node_modules/ -e /target/ -e /.gradle/ -e /.git/');
});

// ── the CLI block must actually run (measured 2026-09-02) ───────────────────────────────────────
// `import.meta.url === `file://${process.argv[1]}`` is FALSE whenever the script is reached through
// a symlink: import.meta.url is realpath-resolved, argv[1] is the path as typed. The block then
// does not run and the process prints NOTHING and exits ZERO — the precise silent-success this
// file's header promises is impossible. Every caller written `... || exit 1` sees a clean exit and
// an empty expression, which for an EXCLUSION means "exclude nothing".
import { execFileSync } from 'node:child_process';
import { symlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin, dirname as pdirname } from 'node:path';
import { fileURLToPath as f2p } from 'node:url';

const REPO = pjoin(pdirname(f2p(import.meta.url)), '..', '..');

test('the CLI prints a regex when invoked through a SYMLINKED path, not silence-and-exit-0', () => {
  const tmp = mkdtempSync(pjoin(tmpdir(), 'cw-sx-link-'));
  const link = pjoin(tmp, 'repo-link');
  try {
    symlinkSync(REPO, link);
    const out = execFileSync(process.execPath, [pjoin(link, 'bin', 'scan-exclusions.mjs'), '--regex'], { encoding: 'utf8' });
    assert.ok(out.trim().length > 0,
      'empty stdout with exit 0 — the main-module guard did not match, and every caller that only checks the exit code proceeds with no exclusions at all');
    assert.match(out, /node_modules/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('an unreadable list still exits NON-ZERO — the header\'s fail-closed claim, asserted', () => {
  assert.throws(() => execFileSync(
    process.execPath,
    [pjoin(REPO, 'bin', 'scan-exclusions.mjs'), '--regex'],
    { encoding: 'utf8', env: { ...process.env, CW_SCAN_EXCLUDE_DIRS: '/nonexistent/nope.txt' }, stdio: 'pipe' },
  ), 'a missing policy file must stop the lane, never render an empty exclusion');
});

// The PATH form. `.claude/worktrees` names one directory, not every `worktrees/` a target owns.
test('a path entry is accepted, rendered on a segment boundary, and matched only as a whole path', () => {
  assert.ok(excludeDirs().includes('.claude/worktrees'), 'the shipped list excludes nested agent worktrees');
  const rx = new RegExp(asRegex(['node_modules', '.claude/worktrees']));
  assert.equal(rx.test('.claude/worktrees/agent-x/CLAUDE.md'), true);
  assert.equal(rx.test('pkg/.claude/worktrees/agent-x/CLAUDE.md'), true);
  assert.equal(rx.test('worktrees/x/CLAUDE.md'), false, 'a bare worktrees/ is the target\'s own');
  assert.equal(rx.test('.claude/settings.json'), false);
  assert.equal(asGrepArgs(['.claude/worktrees']), '-e /.claude/worktrees/');
});

test('dirExcluder: names match any segment, paths match only a whole suffix on a boundary', () => {
  const skip = dirExcluder(['node_modules', '.claude/worktrees']);
  for (const p of ['node_modules', 'a/node_modules', '.claude/worktrees', './.claude/worktrees', 'a/.claude/worktrees', 'a\\.claude\\worktrees']) {
    assert.equal(skip(p), true, p);
  }
  for (const p of ['worktrees', 'src/worktrees', 'x.claude/worktrees', '.claude', '.claude/hooks', 'node_modules_x', '']) {
    assert.equal(skip(p), false, p);
  }
});

test('a `..` segment or an absolute path is still refused', () => {
  const dir = mkdtempSync(pjoin(tmpdir(), 'cw-excl-'));
  try {
    for (const bad of ['../etc', 'a/../b', '/etc', 'a//b']) {
      writeFileSync(pjoin(dir, 'l.txt'), `${bad}\n`);
      assert.throws(() => excludeDirs(pjoin(dir, 'l.txt')), /not a plain directory name/, bad);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
