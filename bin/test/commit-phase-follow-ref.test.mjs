// commit-phase step 8: a land from a sibling worktree with --ref brings every other checkout of
// that ref along on the paths it can take without losing anything, and names the rest.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { followAction, checkoutsOf, parseDiffTree } from '../commit-phase-core.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
const A = `100644:${'a'.repeat(40)}`;
const B = `100644:${'b'.repeat(40)}`;
const P = `100644:${'c'.repeat(40)}`;

describe('followAction', () => {
  test('current only when index and file are both the commit\'s', () => {
    assert.equal(followAction({ index: B, worktree: B, before: A, after: B }), 'current');
    assert.equal(followAction({ index: null, worktree: null, before: A, after: null }), 'current');
  });
  test('fast-forward while each side holds the parent\'s or the commit\'s content', () => {
    assert.equal(followAction({ index: A, worktree: A, before: A, after: B }), 'fast-forward');
    assert.equal(followAction({ index: B, worktree: A, before: A, after: B }), 'fast-forward', 'index repaired, file behind');
    assert.equal(followAction({ index: A, worktree: B, before: A, after: B }), 'fast-forward', 'file current, index behind');
    assert.equal(followAction({ index: null, worktree: null, before: null, after: B }), 'fast-forward', 'an added path');
    assert.equal(followAction({ index: A, worktree: A, before: A, after: null }), 'fast-forward', 'a deleted path');
  });
  test('left for any other content, an unreadable state or a mode the land did not write', () => {
    assert.equal(followAction({ index: A, worktree: P, before: A, after: B }), 'left', 'a peer edit in the file');
    assert.equal(followAction({ index: P, worktree: P, before: A, after: B }), 'left', 'a peer edit staged');
    assert.equal(followAction({ index: A, worktree: null, before: A, after: B }), 'left', 'a peer deleted the file');
    assert.equal(followAction({ index: null, worktree: P, before: null, after: B }), 'left', 'an untracked file in the way');
    assert.equal(followAction({ index: 'unreadable', worktree: A, before: A, after: B }), 'left');
    assert.equal(followAction({ index: A, worktree: `100755:${'a'.repeat(40)}`, before: A, after: B }), 'left');
  });
});

describe('checkoutsOf', () => {
  const porcelain = [
    'worktree /r/primary', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '',
    'worktree /r/side', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/side', '',
    'worktree /r/detached', 'HEAD 2222222222222222222222222222222222222222', 'detached', '',
    'worktree /r/bare.git', 'bare', '',
    'worktree /r/gone', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main2', 'prunable gitdir file points to non-existent location', '',
  ].join('\n');
  test('names the checkouts on the ref and no other', () => {
    assert.deepEqual(checkoutsOf(porcelain, 'refs/heads/main'), ['/r/primary']);
    assert.deepEqual(checkoutsOf(porcelain, 'refs/heads/side'), ['/r/side']);
    assert.deepEqual(checkoutsOf(porcelain, 'refs/heads/none'), []);
    assert.deepEqual(checkoutsOf('', 'refs/heads/main'), []);
  });
});

describe('parseDiffTree', () => {
  const z = (rows) => rows.flatMap(([meta, path]) => [meta, path]).join('\0') + '\0';
  const o = 'a'.repeat(40), n = 'b'.repeat(40), zero = '0'.repeat(40);
  test('modify, add, delete and a mode change, with the path verbatim', () => {
    assert.deepEqual(parseDiffTree(z([
      [`:100644 100644 ${o} ${n} M`, 'a b [1].txt'],
      [`:000000 100644 ${zero} ${n} A`, 'new.txt'],
      [`:100644 000000 ${o} ${zero} D`, 'gone.txt'],
      [`:100644 100755 ${o} ${o} M`, 'run.sh'],
    ])), [
      { path: 'a b [1].txt', before: `100644:${o}`, after: `100644:${n}` },
      { path: 'new.txt', before: null, after: `100644:${n}` },
      { path: 'gone.txt', before: `100644:${o}`, after: null },
      { path: 'run.sh', before: `100644:${o}`, after: `100755:${o}` },
    ]);
  });
  test('an entry that does not parse refuses the whole reading', () => {
    assert.equal(parseDiffTree(`:100644 100644 ${o} ${n} M\0`), null);
    assert.equal(parseDiffTree(`garbage\0x.txt\0`), null);
    assert.deepEqual(parseDiffTree(''), []);
  });
});

// ── end to end, against real git ─────────────────────────────────────────────

const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const pkg = (v) => `{\n  "name": "fixture",\n  "version": "${v}",\n  "private": true\n}\n`;
const read = (dir, p) => readFileSync(join(dir, p), 'utf8');

function cli(cwd, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: {
      ...process.env, CW_COMMIT_REPO: cwd, CW_TOUCH_LEDGER: join(cwd, '.cw-test-touches.jsonl'),
      CW_ALLOW_UNSIGNED: '1', CW_COMMIT_SESSION: 'follow62',
    },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-follow-ref-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const primary = join(root, 'primary');
  const side = join(root, 'side');
  execFileSync('git', ['init', '-q', '-b', 'main', primary]);
  g(primary, ['config', 'user.email', 'test@example.invalid']);
  g(primary, ['config', 'user.name', 'test']);
  writeFileSync(join(primary, '.gitignore'), '.cw-test-touches.jsonl\n');
  writeFileSync(join(primary, 'mine.txt'), 'base\n');
  writeFileSync(join(primary, 'gone.txt'), 'bye\n');
  writeFileSync(join(primary, 'run.sh'), 'echo\n');
  writeFileSync(join(primary, 'a b [1].txt'), 'odd\n');
  writeFileSync(join(primary, 'package.json'), pkg('0.1.0'));
  g(primary, ['add', '-A']);
  g(primary, ['commit', '-q', '-m', 'test: base']);
  g(primary, ['worktree', 'add', '-q', '-b', 'side', side]);
  return { primary, side };
}

const porcelain = (dir) => g(dir, ['status', '--porcelain', '--untracked-files=no']);
const indexBlob = (dir, p) => g(dir, ['ls-files', '--stage', '--', `:(literal)${p}`]).split(/\s+/)[1];

describe('a land from a sibling worktree with --ref', () => {
  test('brings the checkout of that ref along: edits, an add, a delete, a mode change and the stamp', (t) => {
    const { primary, side } = scratch(t);
    writeFileSync(join(side, 'mine.txt'), 'landed\n');
    writeFileSync(join(side, 'a b [1].txt'), 'odd landed\n');
    writeFileSync(join(side, 'new.txt'), 'new\n');
    unlinkSync(join(side, 'gone.txt'));
    chmodSync(join(side, 'run.sh'), 0o755);
    const r = cli(side, ['--ref', 'refs/heads/main', '-m', 'test: commit from a sibling', '--', 'mine.txt', 'a b [1].txt', 'new.txt', 'gone.txt', 'run.sh']);
    assert.equal(r.code, 0, r.err);
    const sha = r.out.split('\n')[0].trim();
    assert.equal(g(primary, ['rev-parse', 'main']), sha);
    assert.equal(porcelain(primary), '', 'git reads the primary as clean against the new HEAD');
    assert.equal(read(primary, 'mine.txt'), 'landed\n');
    assert.equal(read(primary, 'a b [1].txt'), 'odd landed\n');
    assert.equal(read(primary, 'new.txt'), 'new\n');
    assert.equal(existsSync(join(primary, 'gone.txt')), false);
    assert.ok(statSync(join(primary, 'run.sh')).mode & 0o100, 'the exec bit followed');
    assert.equal(JSON.parse(read(primary, 'package.json')).version, '0.1.1');
    for (const p of ['mine.txt', 'a b [1].txt', 'new.txt', 'run.sh', 'package.json']) {
      assert.equal(indexBlob(primary, p), g(primary, ['rev-parse', `main:${p}`]), `index entry for ${p} is HEAD's`);
    }
    assert.match(r.out, /primary has refs\/heads\/main checked out — brought 6 landed path\(s\) along/);
    assert.doesNotMatch(r.err, /holds other content|not brought along|could not be listed|could not be read/i);
  });

  test('a peer edit in the file is named and left, and the other paths still follow', (t) => {
    const { primary, side } = scratch(t);
    writeFileSync(join(primary, 'mine.txt'), 'peer\n');
    writeFileSync(join(side, 'mine.txt'), 'landed\n');
    writeFileSync(join(side, 'new.txt'), 'new\n');
    const r = cli(side, ['--ref', 'refs/heads/main', '-m', 'test: commit over a peer edit', '--', 'mine.txt', 'new.txt']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(primary, 'mine.txt'), 'peer\n', 'the peer edit is untouched');
    assert.equal(read(primary, 'new.txt'), 'new\n');
    assert.deepEqual(porcelain(primary).split('\n').map((l) => l.slice(3)), ['mine.txt'], 'only the peer path differs from HEAD');
    assert.match(r.err, /holds other content on 1 landed path\(s\); left as they are[\s\S]*\n {2}mine\.txt\n/);
    assert.match(r.out, /brought 2 landed path\(s\) along/);
  });

  test('peer content staged in the index is named and left', (t) => {
    const { primary, side } = scratch(t);
    writeFileSync(join(primary, 'mine.txt'), 'staged peer\n');
    g(primary, ['add', 'mine.txt']);
    const staged = indexBlob(primary, 'mine.txt');
    writeFileSync(join(side, 'mine.txt'), 'landed\n');
    const r = cli(side, ['--ref', 'refs/heads/main', '-m', 'test: commit over a staged peer edit', '--', 'mine.txt']);
    assert.equal(r.code, 0, r.err);
    assert.equal(indexBlob(primary, 'mine.txt'), staged);
    assert.equal(read(primary, 'mine.txt'), 'staged peer\n');
    assert.match(r.err, /left as they are[\s\S]*\n {2}mine\.txt\n/);
  });

  test('an untracked file where the land adds one is left', (t) => {
    const { primary, side } = scratch(t);
    writeFileSync(join(primary, 'new.txt'), 'untracked peer\n');
    writeFileSync(join(side, 'new.txt'), 'new\n');
    const r = cli(side, ['--ref', 'refs/heads/main', '-m', 'test: add over an untracked file', '--', 'new.txt']);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(primary, 'new.txt'), 'untracked peer\n');
    assert.match(r.err, /left as they are[\s\S]*\n {2}new\.txt\n/);
  });
});

test('a land in the checkout that holds the ref touches no other checkout and says nothing about one', (t) => {
  const { primary, side } = scratch(t);
  writeFileSync(join(primary, 'mine.txt'), 'landed in place\n');
  const sideBefore = g(side, ['rev-parse', 'HEAD']);
  const r = cli(primary, ['-m', 'test: commit in place', '--', 'mine.txt']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out + r.err, /checked out/);
  assert.equal(porcelain(primary), '');
  assert.equal(g(side, ['rev-parse', 'HEAD']), sideBefore, 'a checkout of another branch is not a checkout of this ref');
  assert.equal(read(side, 'mine.txt'), 'base\n');
});
