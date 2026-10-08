// node --test bin/test/  — `commit-phase.mjs --from-blob`, the mode that exists so nobody hand-rolls
// this sequence again.
//
// WHY THIS EXISTS. Landing one file out of a contended one is the commonest operation on this tree,
// and six sessions were about to be handed a shell recipe for it. Every hand-roll of the sequence
// re-derives its safety properties from memory and drops whichever the author did not know about:
// the broadcast recipe dropped the commit-message check, an earlier one dropped the step-6 shared
// index repair (leaving files `MM`), and all of them hardcoded `100644` in the cacheinfo. That last
// one was measured on 2026-09-01 — it rewrites a tracked 100755 script to 100644, git reports
// success, and a committed hook silently stops being executable.
//
// So the property under test is not "it commits a file". It is that this path keeps EVERY property
// the pathspec path has — mode, message check, index repair, compare-and-swap — while reading no
// working tree at all. Each test below pins one of them, because the failure mode of this feature
// is that it works and quietly loses one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
// Every commit stamps package.json from its parent's, so the fixture carries one.
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';

function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'cw-fromblob-'));
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(d, 'mine.txt'), 'base\n');
  writeFileSync(join(d, 'theirs.txt'), 'base\n');
  writeFileSync(join(d, 'package.json'), PKG);
  writeFileSync(join(d, 's.sh'), '#!/bin/sh\necho v1\n'); chmodSync(join(d, 's.sh'), 0o755);
  g('add', '-A'); g('commit', '-q', '-m', 'test: base');
  // CW_TOUCH_LEDGER IS SET HERE, at the helper, not in each test — the same hermetic default
  // commit-phase-attribution.test.mjs adopted on 2026-08-30 and this file never got. commit-phase
  // records what it LANDS, so without it every run appended six rows (mine.txt x3, s.sh, new.sh,
  // new.txt) under a scratch tree-id to the real .claude/store/touches.jsonl. Measured 2026-09-02:
  // 1,209 such rows were live, 33% of the ledger alongside forbidden-trailer's, and one reader that
  // does not check `r` — bin/gate-spine.mjs — reported them to a session as its own edits.
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: 'utf8',
    // CW_ALLOW_UNSIGNED: signing is covered in bin/test/commit-phase-signing.test.mjs; requiring a
    // private key here would make this file fail on any box that does not hold one.
    env: { ...process.env, CW_TOUCH_LEDGER: join(d, '.cw-test-touches.jsonl'), CW_ALLOW_UNSIGNED: '1' },
  });
  return { d, g, run, mode: (p) => g('ls-tree', 'HEAD', p).split(/\s+/)[0] };
}
const content = (name, text) => { const p = join(tmpdir(), `cw-fb-${name}-${process.pid}`); writeFileSync(p, text); return p; };

describe('it lands CONTENT, not the working tree', () => {
  test('the committed blob is the supplied file, and the worktree is left alone', () => {
    const f = fixture();
    try {
      const src = content('a', 'base\nMY LINE ONLY\n');
      writeFileSync(join(f.d, 'mine.txt'), 'base\nA CO-SESSION LINE IN MY FILE\n'); // dirty, must be ignored
      const r = f.run('--from-blob', `mine.txt=${src}`, '-m', 'test: commit only my hunk');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(f.g('show', 'HEAD:mine.txt'), 'base\nMY LINE ONLY');
      // The whole point: what landed was never in the working tree, and the worktree still is not it.
      assert.match(f.g('show', ':/only my hunk') + '', /only my hunk/);
      assert.equal(readFileSync(join(f.d, 'mine.txt'), 'utf8'), 'base\nA CO-SESSION LINE IN MY FILE\n');
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  test("a co-session's other dirty file is NOT swept into the commit", () => {
    // `git commit -- mine.txt` would not take theirs.txt either — but it WOULD take the co-session's
    // line inside mine.txt, which the test above covers. This one pins the file-set boundary.
    const f = fixture();
    try {
      writeFileSync(join(f.d, 'theirs.txt'), 'CO-SESSION HALF-FINISHED\n');
      const r = f.run('--from-blob', `mine.txt=${content('b', 'mine\n')}`, '-m', 'test: commit mine only');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(f.g('show', 'HEAD:theirs.txt'), 'base');
      assert.deepEqual(f.g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean), ['mine.txt', 'package.json'],
        'mine and the version stamp, never theirs');
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });
});

describe('the file mode is read from HEAD, never assumed', () => {
  test('a tracked 100755 script stays executable', () => {
    // The measured defect in every hand-rolled version. `--cacheinfo 100644,…` here would pass, and
    // the committed script would stop being runnable with nothing failing.
    const f = fixture();
    try {
      assert.equal(f.mode('s.sh'), '100755', 'fixture precondition');
      const r = f.run('--from-blob', `s.sh=${content('c', '#!/bin/sh\necho v2\n')}`, '-m', 'test: exec bit must survive');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(f.mode('s.sh'), '100755', 'the exec bit was silently dropped');
      assert.match(f.g('show', 'HEAD:s.sh'), /echo v2/);
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  test('a path HEAD does not carry takes the mode of the supplied file', () => {
    const f = fixture();
    try {
      const exec = content('d', '#!/bin/sh\necho new\n'); chmodSync(exec, 0o755);
      const plain = content('e', 'just text\n');
      assert.equal(f.run('--from-blob', `new.sh=${exec}`, '-m', 'test: add an executable').status, 0);
      assert.equal(f.mode('new.sh'), '100755');
      assert.equal(f.run('--from-blob', `new.txt=${plain}`, '-m', 'test: add a plain file').status, 0);
      assert.equal(f.mode('new.txt'), '100644');
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });
});

describe('it keeps the properties a hand-roll drops', () => {
  test('the shared index is repaired — files are dirty, never half-staged (MM)', () => {
    const f = fixture();
    try {
      writeFileSync(join(f.d, 'theirs.txt'), 'co-session\n');
      f.run('--from-blob', `mine.txt=${content('f', 'landed\n')}`, '-m', 'test: commit');
      for (const line of f.g('status', '--short').split('\n').filter(Boolean)) {
        assert.doesNotMatch(line, /^(MM|M[ADRC])/, `shared index left half-staged: ${line}`);
      }
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  test('the forbidden-trailer check applies on THIS path too, and nothing lands', () => {
    const f = fixture();
    try {
      const before = f.g('rev-list', '--count', 'HEAD');
      const r = f.run('--from-blob', `mine.txt=${content('g', 'x\n')}`, '-m', 'test: add a subject\n\nCo-Authored-By: Claude <n@a>');
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /REFUSED/);
      assert.equal(f.g('rev-list', '--count', 'HEAD'), before, 'fail closed — HEAD must not move');
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });
});

describe('refusals', () => {
  test('--from-blob and a `-- <path>` set are mutually exclusive', () => {
    // Mixing them would read the working tree for SOME paths, which defeats the one guarantee.
    const f = fixture();
    try {
      const r = f.run('--from-blob', `mine.txt=${content('h', 'x\n')}`, '-m', 'test: write a message', '--', 'theirs.txt');
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /mutually exclusive/);
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  test('a malformed pair and a missing content file both refuse without landing', () => {
    const f = fixture();
    try {
      const before = f.g('rev-list', '--count', 'HEAD');
      assert.notEqual(f.run('--from-blob', 'mine.txt', '-m', 'test: write a message').status, 0, 'no = in the pair');
      assert.notEqual(f.run('--from-blob', 'mine.txt=/nope/missing', '-m', 'test: write a message').status, 0, 'absent content file');
      assert.equal(f.g('rev-list', '--count', 'HEAD'), before);
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });
});

describe('the declared base — the only guard against a STALE freeze', () => {
  // --from-blob buys "no worktree dirt adopted". It does not buy "nobody changed this path since
  // I froze", and the CAS cannot supply that: head0 is read at run start, so a land whose content
  // was frozen against an older HEAD passes the CAS and reverts the intervening change silently.
  // Found 2026-09-02.
  const baseOf = (f, p) => f.g('rev-parse', `HEAD:${p}`);

  test('a base that still matches HEAD lands', () => {
    const f = fixture();
    try {
      const b = baseOf(f, 'mine.txt');
      const r = f.run('--from-blob', `mine.txt=${content('ok', 'base\nmine\n')}@${b}`, '-m', 'test: commit it');
      assert.equal(r.status, 0, r.stderr);
      assert.match(f.g('show', 'HEAD:mine.txt'), /mine/);
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  test('a STALE base is REFUSED and nothing lands', () => {
    const f = fixture();
    try {
      const stale = baseOf(f, 'mine.txt');                 // freeze here
      writeFileSync(join(f.d, 'mine.txt'), 'base\nTHEIRS\n');
      f.g('add', 'mine.txt'); f.g('commit', '-q', '-m', 'test: commit as a peer first');
      const head = f.g('rev-parse', 'HEAD');

      const r = f.run('--from-blob', `mine.txt=${content('stale', 'base\nMINE ONLY\n')}@${stale}`, '-m', 'test: expect a refusal');
      assert.notEqual(r.status, 0, 'must exit non-zero');
      assert.match(r.stderr, /REFUSED/);
      // BOTH blobs named — the hazard is that nothing looks wrong, so the message has to show it.
      assert.ok(r.stderr.includes(stale), 'the declared base must be named');
      assert.ok(r.stderr.includes(baseOf(f, 'mine.txt')), 'the blob HEAD now carries must be named');
      assert.equal(f.g('rev-parse', 'HEAD'), head, 'HEAD must not move — fail closed');
      assert.match(f.g('show', 'HEAD:mine.txt'), /THEIRS/, "the peer's content must survive");
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  test('NO declared base still lands — the flag is optional and old callers are untouched', () => {
    const f = fixture();
    try {
      const r = f.run('--from-blob', `mine.txt=${content('nobase', 'base\nno base\n')}`, '-m', 'test: commit it');
      assert.equal(r.status, 0, r.stderr);
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });

  // The suffix is split from the right ONLY when no file exists under the literal name, so a real
  // path that happens to end in @<40-hex> is still itself. Over-eager splitting would make an
  // existing file unreachable and report it as missing.
  test('a content file whose NAME ends in @<40-hex> is not mistaken for a base', () => {
    const f = fixture();
    try {
      const weird = join(tmpdir(), `cw-fb-weird-${process.pid}@${'a'.repeat(40)}`);
      writeFileSync(weird, 'base\nweird name\n');
      const r = f.run('--from-blob', `mine.txt=${weird}`, '-m', 'test: commit it');
      assert.equal(r.status, 0, r.stderr);
      assert.match(f.g('show', 'HEAD:mine.txt'), /weird name/);
      rmSync(weird, { force: true });
    } finally { rmSync(f.d, { recursive: true, force: true }); }
  });
});
