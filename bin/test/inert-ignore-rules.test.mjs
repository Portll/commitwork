// An ignore rule over an already-tracked path does NOTHING. git consults .gitignore only for
// untracked files, so a rule added to keep something out of the repository is inert from the moment
// it is written if the thing is already in the index — and it reads, to anyone auditing .gitignore,
// exactly like protection. Nothing errors. Nothing warns. The file keeps being committed.
//
// Measured here on 2026-08-27: four rules carrying explicit reasoning about not publishing another
// party's security posture ("This is another party's security posture; it is theirs to disclose,
// not ours") were all inert, over 13.1 MB — monitor/issues.json (7.8 MB, 415 rows naming client
// repos), monitor/projects.json, map/data/client-a (5.2 MB) and map/data/internal-b-dev. The comment
// block above one of them even recorded the symptom in prose — "while the file itself stayed
// tracked" — so it had been SEEN, written down, and left.
//
// This is the general detector, not a list of those four. It asks git the only question that
// matters: is any tracked file matched by an ignore rule? Deriving the population from `ls-files`
// rather than from a hand-kept list is the point — a list would only ever re-find what someone
// already knew, which is the failure mode that produced the prose comment instead of a fix.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * Every tracked path that an ignore rule ALSO matches.
 *
 * `check-ignore --no-index` is the whole trick: without it, git reports a tracked file as NOT
 * ignored — because for a tracked file the question is moot, which is precisely the confusion that
 * let four rules sit inert. `--no-index` asks the pattern question directly: "would this path be
 * ignored if it were untracked?" A yes on a TRACKED path means the rule is inert.
 *
 * Exit status: 0 = at least one path matched, 1 = none matched (not an error), anything else is a
 * real failure and must not be read as "none".
 */
function inertlyIgnored() {
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  assert.ok(tracked.length > 100, `only ${tracked.length} tracked files — refusing to certify a tree this small as clean`);

  let out = '';
  try {
    out = execFileSync('git', ['-C', REPO, 'check-ignore', '--no-index', '--stdin', '-z', '-v'],
      { input: `${tracked.join('\0')}\0`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (e.status === 1) return [];               // no tracked path is ignored — the good case
    throw new Error(`check-ignore failed (status ${e.status}): ${e.stderr || e.message}`);
  }

  // -z -v records are NUL-separated 4-tuples: source, linenum, pattern, pathname.
  const f = out.split('\0');
  const rows = [];
  // A `!` pattern that matches re-includes the path; -v reports it, and it is not an ignore.
  for (let i = 0; i + 3 < f.length; i += 4) {
    if (!f[i + 2].startsWith('!')) rows.push({ source: f[i], line: f[i + 1], pattern: f[i + 2], path: f[i + 3] });
  }
  return rows;
}

describe('ignore rules are effective, not decorative', () => {
  test('no tracked file is matched by an ignore rule', () => {
    const rows = inertlyIgnored();
    if (rows.length) {
      const byRule = new Map();
      for (const r of rows) {
        const k = `${r.source}:${r.line} ${r.pattern}`;
        byRule.set(k, (byRule.get(k) || 0) + 1);
      }
      const detail = [...byRule.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `    ${k}  — matches ${n} TRACKED file(s)`).join('\n');
      assert.fail(
        `${rows.length} tracked file(s) are matched by an ignore rule, so that rule is INERT — it was\n`
        + `written to keep them out of the repository and does nothing, because gitignore is only\n`
        + `consulted for untracked paths:\n${detail}\n\n`
        + `  Fix: \`git rm --cached <path>\` in the same commit as the rule. And say plainly whether the\n`
        + `  bytes were ever pushed — rm --cached does not remove them from history.`,
      );
    }
  });

  test('the detector can actually see an inert rule — it is not vacuously green', () => {
    // A test that only ever passes proves nothing. Assert the mechanism on a path we KNOW is
    // tracked and NOT ignored: check-ignore --no-index must say "no" for it, and must say "yes" for
    // a pattern that does cover it. Without --no-index the second answer would be wrong for a
    // tracked file, which is the exact blind spot this file exists to close.
    const probe = 'package.json';
    let ignored = true;
    try { execFileSync('git', ['-C', REPO, 'check-ignore', '--no-index', '-q', '--', probe]); }
    catch (e) { if (e.status === 1) ignored = false; else throw e; }
    assert.equal(ignored, false, `${probe} is ignored — the probe assumption is wrong, so this suite proves nothing`);

    // and the positive direction: a path the ignore file really does cover reports as ignored.
    //
    // The probe is `reports` ITSELF, not a path beneath it. reports/ became a symlink to the
    // reports sidecar on 2026-08-29, and `git check-ignore` does not answer for a pathspec beyond a
    // symbolic link — it exits 128 with `fatal: pathspec ... is beyond a symbolic link`, which this
    // test rethrew as an error rather than reading as a verdict. The old probe therefore stopped
    // testing the ignore rule the moment the directory became a link, and failed loudly instead of
    // silently, which is the only reason it was caught. The symlink itself is a file to git, so
    // `/reports` (no trailing slash, per the sidecar rule) still matches it and check-ignore can
    // answer — same subject, same question, no link crossed.
    let covered = false;
    try { execFileSync('git', ['-C', REPO, 'check-ignore', '--no-index', '-q', '--', 'reports']); covered = true; }
    catch (e) { if (e.status !== 1) throw e; }
    assert.ok(covered, 'reports is not reported as ignored — check-ignore is not answering the question this suite thinks it is');
  });
});
