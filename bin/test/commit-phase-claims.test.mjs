// commit-phase reads spine's live file claims before it lands. A changed path another session has
// claimed in this working tree refuses and names the holder, unless --take-claims; a dirty path
// outside the change set that no claim names is listed; a claim that records no repository is
// named and never enforced; and spine that cannot be read is `claims: not checked (<why>)`, after
// which the land goes on. Spine is a fixture here: a bin/spine-read.mjs that replays fixed JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimVerdict, porcelainPaths } from '../commit-phase-core.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';
const ME = 'me000000-0000';
const PEER = 'peer0000-1111';
const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function world(t) {
  const base = mkdtempSync(join(tmpdir(), 'cw-claims-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, 'repo');
  mkdirSync(dir);
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 't@example.invalid']); g(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'b.txt'), 'two\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'test: base']);
  const spine = join(base, 'spine');
  mkdirSync(join(spine, 'bin'), { recursive: true });
  writeFileSync(join(spine, 'bin', 'spine-read.mjs'), [
    "import { readFileSync } from 'node:fs';",
    "process.stdout.write(readFileSync(new URL('../answer.txt', import.meta.url), 'utf8'));",
    'process.exitCode = Number(process.env.FAKE_SPINE_EXIT || 0);',
  ].join('\n'));
  const answer = (live) => writeFileSync(join(spine, 'answer.txt'), typeof live === 'string' ? live
    : JSON.stringify({ schema: 1, slice: 'claims', store: '/fixture/tasks.db', data: { live, staleCount: 0 } }));
  answer([]);
  return { base, dir, spine, answer, root: g(dir, ['rev-parse', '--show-toplevel']) };
}

function cli(w, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: w.dir, encoding: 'utf8',
    env: { ...process.env, CW_COMMIT_REPO: w.dir, CW_TOUCH_LEDGER: join(w.base, 'touches.jsonl'), CW_ALLOW_UNSIGNED: '1',
           CW_COMMIT_SESSION: ME, CW_SPINE_DIR: w.spine, ...env },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

const claim = (w, path, extra = {}) => ({ path, planId: 'p', taskId: '3', goal: 'peer work on the file', claimedAt: '2026-10-19T00:00:00.000Z',
  scoped: true, root: w.root, session: PEER, sessionVia: 'note', ...extra });

test('refuse: a changed path claimed by another session in this tree stops the land and names the holder', (t) => {
  const w = world(t);
  const head = g(w.dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(w.dir, 'a.txt'), 'mine\n');
  w.answer([claim(w, 'a.txt')]);
  const r = cli(w, ['-m', 'test: write a', '--', 'a.txt']);
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /REFUSED — 1 changed path\(s\) are claimed by another live session/);
  assert.match(r.err, /a\.txt — session peer0000 · plan p task 3 "peer work on the file" · since 2026-10-19T00:00:00\.000Z/);
  assert.match(r.err, /--take-claims/);
  assert.equal(g(w.dir, ['rev-parse', 'HEAD']), head, 'nothing landed');

  const pre = cli(w, ['--check', '--', 'a.txt']);
  assert.equal(pre.code, 2, 'the pre-flight predicts the refusal');
  assert.equal(g(w.dir, ['rev-parse', 'HEAD']), head);

  const anon = cli(w, ['-m', 'test: write a', '--', 'a.txt'], { CW_COMMIT_SESSION: '', CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '' });
  assert.equal(anon.code, 2);
  assert.match(anon.err, /names no session/);
});

test('take: --take-claims lands over the claim and records the take beside the commit', (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'a.txt'), 'mine\n');
  w.answer([claim(w, 'a.txt')]);
  const r = cli(w, ['-m', 'test: write a', '--take-claims', '--', 'a.txt']);
  assert.equal(r.code, 0, r.err);
  const [sha, ...rest] = r.out.split('\n');
  assert.equal(g(w.dir, ['rev-parse', 'HEAD']), sha.trim(), 'the sha is still the first stdout line');
  assert.match(rest.join('\n'), /took claim \(--take-claims\) — a\.txt was held by session peer0000 · plan p task 3/);
  assert.match(r.err, /--take-claims — landing a\.txt over session peer0000/);
});

test('your own claim, a claim scoped to another tree and an unscoped claim never refuse', (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'a.txt'), 'mine\n');
  writeFileSync(join(w.dir, 'b.txt'), 'also mine\n');
  w.answer([
    claim(w, 'a.txt', { session: ME }),
    claim(w, 'b.txt', { root: '/some/other/checkout' }),
    claim(w, 'b.txt', { scoped: false, root: null, session: null, sessionVia: null, planId: 'hand', taskId: '9', goal: 'hand claim' }),
  ]);
  const r = cli(w, ['-m', 'test: write both', '--', 'a.txt', 'b.txt']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /REFUSED/);
  assert.match(r.err, /claims: b\.txt is also claimed by session unknown · plan hand task 9 "hand claim" .* records no repository, so it is not enforced/);
  assert.match(r.err, /claims checked — 2 changed and \d+ dirty path\(s\) against 3 live claim\(s\) in \/fixture\/tasks\.db \(spine via CW_SPINE_DIR\)/);
});

test('warn: dirty paths outside the change set that no tree-scoped claim names are listed', (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'a.txt'), 'mine\n');
  writeFileSync(join(w.dir, 'b.txt'), 'a peer edit\n');
  mkdirSync(join(w.dir, 'new'));
  writeFileSync(join(w.dir, 'new', 'untracked.txt'), 'x\n');
  writeFileSync(join(w.dir, 'claimed.txt'), 'held\n');
  w.answer([claim(w, 'claimed.txt')]);
  const r = cli(w, ['-m', 'test: write a', '--', 'a.txt']);
  assert.equal(r.code, 0, r.err);
  const line = r.err.split('\n').find((l) => l.includes('unclaimed dirty'));
  assert.ok(line, r.err);
  assert.match(line, /unclaimed dirty \(2, outside this change set\): b\.txt, new\/untracked\.txt$/);
  assert.doesNotMatch(line, /claimed\.txt|a\.txt/);
});

test('not checked: a missing, failing or garbled spine is said to be unread, and the land goes on', (t) => {
  const w = world(t);
  const cases = [
    [{ CW_SPINE_DIR: join(w.base, 'nowhere') }, /claims: not checked \(CW_SPINE_DIR=.*nowhere has no bin\/spine-read\.mjs\)/],
    [{ CW_SPINE_DIR: '', HOME: join(w.base, 'empty-home') }, /claims: not checked \(spine not found: CW_SPINE_DIR is unset/],
    [{ FAKE_SPINE_EXIT: '20' }, /claims: not checked \(.*spine-read\.mjs exited 20: store is locked\)/, JSON.stringify({ error: 'store is locked' })],
    [{}, /claims: not checked \(.*spine-read\.mjs exited 0 with output that is not JSON\)/, 'garbage'],
    [{ FAKE_SPINE_EXIT: '21' }, /claims: not checked \(.*exited 21: unknown slice claims/, JSON.stringify({ error: 'unknown slice claims; expected plans' })],
    [{}, /claims: not checked \(.*answered without a claims list\)/, JSON.stringify({ slice: 'plans', data: [] })],
  ];
  let n = 0;
  for (const [env, want, answer] of cases) {
    w.answer(answer ?? []);
    writeFileSync(join(w.dir, 'a.txt'), `edit ${++n}\n`);
    const r = cli(w, ['-m', `test: write edit ${n}`, '--', 'a.txt'], env);
    assert.equal(r.code, 0, `${want}: ${r.err}`);
    assert.match(r.err, want);
    assert.doesNotMatch(r.err, /claims checked|unclaimed dirty/, 'an unread store reports nothing as if measured');
    assert.equal(g(w.dir, ['show', 'HEAD:a.txt']), `edit ${n}`);
  }
});

test('claimVerdict binds absolute claims inside the tree and nothing outside it', () => {
  const v = claimVerdict({
    root: '/r', me: 'me', staged: ['x.mjs', 'y.mjs'], dirty: ['x.mjs', 'z.mjs', 'w.mjs'],
    claims: [
      { path: '/r/x.mjs', session: 'peer', scoped: false },
      { path: '/rr/y.mjs', session: 'peer', scoped: false },
      { path: 'z.mjs', session: 'peer', scoped: true, root: '/r' },
      { path: 'w.mjs', session: 'peer', scoped: false },
    ],
  });
  assert.deepEqual(v.refuse.map((x) => x.path), ['x.mjs']);
  assert.deepEqual(v.unclaimedDirty, ['w.mjs'], 'an unscoped claim does not count as a claim on this tree');
  const anon = claimVerdict({ root: '/r', me: null, staged: ['z.mjs'], claims: [{ path: 'z.mjs', session: null, scoped: true, root: '/r' }] });
  assert.equal(anon.refuse.length, 1, 'with no session on either side the claim cannot be recognised as yours');
});

test('porcelainPaths keeps the first entry\'s status column and both sides of a rename', () => {
  assert.deepEqual(porcelainPaths(' M a.txt\0R  new.txt\0old.txt\0?? dir/u.txt\0'), ['a.txt', 'new.txt', 'old.txt', 'dir/u.txt']);
  assert.deepEqual(porcelainPaths(''), []);
});
