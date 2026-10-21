// node --test bin/test/commit-map-baseline.test.mjs
//
// The rewrite commit map (bin/lib/commit-map.mjs) and the one thing it unblocks: an audit baseline
// recorded before a history rewrite.
//
// This history has been rewritten three times. The 2026-07-29 audit recorded `f63114a` beside its
// queue, and after the 2026-10-11 rewrite `bin/anchor-staleness.mjs` refused outright — so the
// drifted-anchor population was not high, it was UNMEASURABLE, which reads the same as quiet in
// every report that quotes it. The map is the only artefact that can say what a stored sha became,
// and the gate must translate through it, say that it did, and still refuse when nothing resolves.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommitMap, resolveRewritten } from '../lib/commit-map.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'anchor-staleness.mjs');
const scratch = () => mkdtempSync(join(tmpdir(), 'commit-map-'));
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const writeMap = (dir, rows, header = '# old-sha new-sha — a fixture\n') => {
  const p = join(dir, 'map.txt');
  writeFileSync(p, header + rows.map((r) => r.join(' ')).join('\n') + '\n');
  return p;
};

describe('the map reader answers, or says why it cannot — never an empty map', () => {
  test('an absent map is a stated refusal, not "that sha was never rewritten"', () => {
    const dir = scratch();
    try {
      const r = loadCommitMap(CW, { path: join(dir, 'nope.txt') });
      assert.equal(r.ok, false);
      assert.match(r.reason, /no commit map at/);
      assert.match(r.reason, /--rebuild/, 'the refusal must name the way out');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a readable map with no rows is ok and says so — the CALLER decides what that means', () => {
    // Not a refusal here on purpose. resolve-sha can still answer "resolves as-is" from the object
    // store with an empty map; anchor-staleness cannot translate and refuses downstream. Deciding
    // it inside the reader broke the first of those two, which is how this rule got its comment.
    const dir = scratch();
    try {
      const p = join(dir, 'map.txt');
      writeFileSync(p, '# only a comment\n');
      const r = loadCommitMap(CW, { path: p });
      assert.equal(r.ok, true);
      assert.equal(r.rows, 0);
      assert.equal(resolveRewritten('a'.repeat(40), r.map), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unreadable map is a refusal — a permission error is not "nothing was rewritten"', () => {
    const dir = scratch();
    try {
      const r = loadCommitMap(CW, { path: dir });   // a directory: readFileSync throws EISDIR
      assert.equal(r.ok, false);
      assert.match(r.reason, /could not be read/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('comments and blank lines are skipped, rows are read', () => {
    const dir = scratch();
    try {
      const p = writeMap(dir, [[A, B]]);
      const r = loadCommitMap(CW, { path: p });
      assert.equal(r.ok, true);
      assert.equal(r.map.size, 1);
      assert.equal(r.map.get(A), B);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('prefix lookup, because a stored sha is short and the map is long', () => {
  const map = new Map([[A, B], ['ab'.repeat(20), 'c'.repeat(40)]]);

  test('a full sha and a short prefix both resolve', () => {
    assert.equal(resolveRewritten(A, map), B);
    assert.equal(resolveRewritten('aaaaaaa', map), B);
  });

  test('a prefix matching two DIFFERENT commits answers null, never the first', () => {
    // 'a' prefixes both rows, and they rewrote to different commits. Returning either would hand
    // back one of two trees with no way for the caller to know it had a choice.
    assert.equal(resolveRewritten('a', map), null);
  });

  test('a sha nothing maps answers null, and junk is not an answer', () => {
    assert.equal(resolveRewritten('f'.repeat(40), map), null);
    assert.equal(resolveRewritten('', map), null);
    assert.equal(resolveRewritten('zzz', map), null);
    assert.equal(resolveRewritten(null, map), null);
  });

  test('a prefix matching two rows that rewrote to the SAME commit still resolves', () => {
    const dupes = new Map([['dead' + '0'.repeat(36), B], ['dead' + '1'.repeat(36), B]]);
    assert.equal(resolveRewritten('dead', dupes), B, 'one answer, reached two ways, is not ambiguous');
  });
});

describe('the audit baseline survives a rewrite', () => {
  // anchor-staleness judges THE REPOSITORY IT LIVES IN — REPO_ROOT is its own module path, not cwd —
  // so the fixture is a synthetic queue over commitwork's own history, with a synthetic sha standing
  // in for the pre-rewrite baseline and a real commit as what the map says it became.
  const git = (...a) => execFileSync('git', ['-C', CW, ...a], { encoding: 'utf8' }).trim();
  const TARGET = git('rev-parse', 'HEAD~1');
  const PROBE = 'package.json';            // present at HEAD~1 and at HEAD, so a comparison happens

  function fixture() {
    const dir = scratch();
    const auditDir = join(dir, 'audit');
    mkdirSync(auditDir, { recursive: true });
    // The real queue's shape: a `queue` array of entries keyed on id and anchored file:line.
    writeFileSync(join(auditDir, 'queue.json'), JSON.stringify({
      tool: 'fixture', queue: [{
        id: 'q-fixture', key: `${PROBE}:2|the version line`, anchor: `${PROBE}:2`,
        file: PROBE, line: 2, severity: 'medium', kind: 'invalid',
        summary: 'the version line', disposition: 'open',
      }],
    }));
    return { dir, auditDir };
  }

  // spawnSync, not execFileSync: the announcement under test goes to STDERR, and execFileSync
  // returns stdout alone on success — the assertion would have read an empty string and passed
  // for the wrong reason on the one path that matters.
  const run = (f, env) => {
    const r = spawnSync(process.execPath, [CLI, '--queue', join(f.auditDir, 'queue.json'), '--json', '--no-gate'],
      { encoding: 'utf8', env: { ...process.env, CW_AUDIT_DIR: f.auditDir, ...env } });
    return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
  };

  test('a rewritten baseline is translated through the map, and the run SAYS it was', () => {
    const f = fixture();
    try {
      const map = writeMap(f.dir, [[A, TARGET]]);
      writeFileSync(join(f.auditDir, 'baseline'), `${A}\n`);
      const r = run(f, { CW_COMMIT_MAP: map });
      assert.equal(r.code, 0, r.err || r.out);
      const report = JSON.parse(r.out);
      assert.equal(report.baseline, TARGET, 'the report must record the ref it COMPARED, not the one the audit stored');
      assert.notEqual(report.results[0].state, 'no-baseline', 'a translated baseline must produce a real comparison');
      assert.match(r.err, /was rewritten; comparing against/,
        'a translated baseline that is not announced lets a reader take the number for the recorded tree');
      assert.match(r.err, new RegExp(TARGET.slice(0, 12)), 'and it must name which ref it used');
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('a baseline the map cannot answer still REFUSES, and names the way out', () => {
    const f = fixture();
    try {
      const map = writeMap(f.dir, [[A, TARGET]]);
      writeFileSync(join(f.auditDir, 'baseline'), `${'e'.repeat(40)}\n`);   // in neither git nor the map
      const r = run(f, { CW_COMMIT_MAP: map });
      assert.equal(r.code, 2, 'an unresolvable baseline must not fall back to a guessed ref');
      assert.match(r.err, /does not resolve in this repository/);
      assert.match(r.err, /maps it to nothing/);
      assert.match(r.err, /--baseline/);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('a zero-row map refuses HERE, where there is nothing to translate with', () => {
    const f = fixture();
    try {
      const map = writeMap(f.dir, [], '# no rows\n');
      writeFileSync(join(f.auditDir, 'baseline'), `${A}\n`);
      const r = run(f, { CW_COMMIT_MAP: map });
      assert.equal(r.code, 2);
      assert.match(r.err, /maps it to nothing/);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('an absent map is reported as the reason, not as an unresolvable baseline alone', () => {
    const f = fixture();
    try {
      writeFileSync(join(f.auditDir, 'baseline'), `${A}\n`);
      const r = run(f, { CW_COMMIT_MAP: join(f.dir, 'absent.txt') });
      assert.equal(r.code, 2);
      assert.match(r.err, /the rewrite map could not answer/);
      assert.match(r.err, /no commit map at/);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('a map pointing at a commit THIS repository lacks says the map is a rewrite behind', () => {
    const f = fixture();
    try {
      const map = writeMap(f.dir, [[A, B]]);                                 // B is not a commit here
      writeFileSync(join(f.auditDir, 'baseline'), `${A}\n`);
      const r = run(f, { CW_COMMIT_MAP: map });
      assert.equal(r.code, 2);
      assert.match(r.err, /which does not resolve either/);
      assert.match(r.err, /--rebuild/);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('a baseline that resolves on its own is used untouched — no map is read', () => {
    const f = fixture();
    try {
      writeFileSync(join(f.auditDir, 'baseline'), `${TARGET}\n`);
      const r = run(f, { CW_COMMIT_MAP: join(f.dir, 'absent.txt') });   // absent on purpose
      assert.equal(r.code, 0, r.err || r.out);
      assert.equal(JSON.parse(r.out).baseline, TARGET);
      assert.doesNotMatch(r.err, /was rewritten/, 'a working baseline must not be announced as translated');
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
});

describe('resolve-sha separates an orphan from a current commit', () => {
  // Two states were one for as long as this tool existed: a sha that exists ONLY in this object
  // store answered "resolves as-is", the same words a commit in HEAD's history gets. A doc stamp
  // naming a rebase orphan was read as fine on that answer, while bin/docs-doctor.mjs was
  // correctly calling the same sha not-in-history. `--scan` had always drawn the line; the
  // single-sha path had not.
  const CLI_SHA = join(CW, 'bin', 'resolve-sha.mjs');
  const git = (...a) => execFileSync('git', ['-C', CW, ...a], { encoding: 'utf8' }).trim();
  const run = (sha, env = {}) => {
    const r = spawnSync(process.execPath, [CLI_SHA, sha], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
  };

  test('a commit in HEAD history says so, and does not merely say "as-is"', () => {
    const r = run(git('rev-parse', '--short', 'HEAD~1'));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /in HEAD's history/);
    assert.doesNotMatch(r.out, /ORPHANED|UNKNOWN/);
  });

  test('a sha in neither the map nor the store is UNKNOWN', () => {
    const r = run('deadbeefdeadbeef');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /UNKNOWN/);
    assert.match(r.out, /gc/i, 'and it names why it might be unrecoverable');
  });

  test('an object present here but OUTSIDE HEAD history is ORPHANED, not current', () => {
    // Built, not hunted for: a commit on a detached tree that is reachable from no branch is
    // exactly the shape a rebase leaves behind, and it must not read as "resolves as-is".
    const dir = scratch();
    try {
      const tree = git('rev-parse', 'HEAD^{tree}');
      const orphan = execFileSync('git', ['-C', CW, 'commit-tree', tree, '-m', 'an orphan for the test'],
        { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
      assert.equal(git('cat-file', '-t', orphan), 'commit', 'the fixture must be a real object');
      // A map that EXISTS and holds no rows: an ABSENT map is a refusal before the per-sha loop
      // is reached, so it would have proved nothing about the three states.
      const r = run(orphan, { CW_COMMIT_MAP: writeMap(dir, [], '# no rows\n') });
      assert.match(r.out, /ORPHANED/);
      assert.match(r.out, /NOT in HEAD's history/);
      assert.match(r.out, /No clone resolves it/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
