// admin/lib/panel-build.mjs — the commit a panel booted from, read from git's files on fixture trees.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuild } from '../lib/panel-build.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-panel-build-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const A = 'a'.repeat(40), B = 'b'.repeat(40);

function tree(name, files) {
  const root = join(TMP, name);
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

test('a branch with a loose ref', () => {
  const root = tree('loose', { 'package.json': '{"version":"1.2.3"}', '.git/HEAD': 'ref: refs/heads/main\n', '.git/refs/heads/main': `${A}\n` });
  assert.deepEqual(readBuild(root, 'T'), { version: '1.2.3', bootAt: 'T', checkout: true, commit: A, short: A.slice(0, 8), branch: 'main' });
});

test('a packed ref, and a detached HEAD', () => {
  const packed = tree('packed', { '.git/HEAD': 'ref: refs/heads/main\n', '.git/packed-refs': `# pack-refs\n${B} refs/heads/main\n` });
  assert.equal(readBuild(packed, 'T').commit, B);
  const detached = tree('detached', { '.git/HEAD': `${A}\n` });
  assert.equal(readBuild(detached, 'T').branch, null);
  assert.equal(readBuild(detached, 'T').commit, A);
});

test('a worktree reads its own HEAD and the common refs', () => {
  tree('main', { '.git/refs/heads/feat': `${B}\n`, '.git/worktrees/wt/HEAD': 'ref: refs/heads/feat\n', '.git/worktrees/wt/commondir': '../..\n' });
  const wt = tree('wt', { '.git': `gitdir: ${join(TMP, 'main', '.git', 'worktrees', 'wt')}\n` });
  const b = readBuild(wt, 'T');
  assert.equal(b.commit, B);
  assert.equal(b.branch, 'feat');
});

test('no checkout is its own answer, and a broken one is not mistaken for it', () => {
  assert.equal(readBuild(tree('plain', { 'package.json': '{}' }), 'T').checkout, false);
  const broken = readBuild(tree('broken', { '.git/HEAD': 'ref: refs/heads/gone\n' }), 'T');
  assert.equal(broken.checkout, true);
  assert.equal(broken.commit, null);
  assert.match(broken.reason, /refs\/heads\/gone/);
});
