// bin/test/anchor-witness.test.mjs — the off-host witness, against real git repositories.
//
// The witness exists because the anchor stores live under $HOME, writable by the account whose
// tampering they are meant to catch. What it must never do is record a regression: a store that
// shrank without rotating is the shape of a truncation, and writing that as the new witnessed
// state would launder it one layer up. Verified here against a bare repo and a clone, and the
// same rule is asserted on the watcher side in commitwork-remote's test/watch.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { runWitness, regressions, classifyPushFailure, storeHead, buildWitness } from '../anchor-witness.mjs';

const sh = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

let dir;
let saved;
function world() {
  dir = mkdtempSync(join(tmpdir(), 'cw-witness-'));
  const remote = join(dir, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', remote]);
  const producer = join(dir, 'producer');
  spawnSync('git', ['clone', '-q', remote, producer]);
  sh(producer, ['config', 'user.email', 't@t']); sh(producer, ['config', 'user.name', 't']);
  process.env.CW_WITNESS_REPO = producer;
  process.env.CW_VERDICT_ANCHORS = join(dir, 'verdict-anchors.jsonl');
  process.env.CW_DATA_ANCHORS = join(dir, 'data-anchors.jsonl');
  process.env.CW_AGENT_TAGS = join(dir, 'agent-tags.jsonl');
  writeFileSync(process.env.CW_VERDICT_ANCHORS, '');
  return { remote, producer };
}
const grow = (n) => { for (let i = 0; i < n; i++) appendFileSync(process.env.CW_VERDICT_ANCHORS, `${JSON.stringify({ v: 1, kind: 'verdict-anchor', file: 'x.jsonl', records: i, prev: 'genesis' })}\n`); };

test.beforeEach(() => { saved = { ...process.env }; });
test.afterEach(() => {
  for (const k of ['CW_WITNESS_REPO', 'CW_VERDICT_ANCHORS', 'CW_DATA_ANCHORS', 'CW_AGENT_TAGS']) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('a growing store is recorded and pushed, and an unchanged one records nothing new', () => {
  const w = world();
  grow(3);
  const first = runWitness();
  assert.equal(first.state, 'recorded');
  assert.equal(first.pushed, true);
  assert.equal(sh(w.producer, ['rev-parse', 'refs/heads/witness-anchors']), first.commit);
  const again = runWitness();
  assert.equal(again.state, 'unchanged');
  assert.equal(sh(w.producer, ['rev-list', '--count', 'refs/heads/witness-anchors']), '1');
});

test('a store that shrank without rotating is REGRESSION, and the witness keeps the last good state', () => {
  const w = world();
  grow(5);
  const good = runWitness();
  assert.equal(good.state, 'recorded');
  writeFileSync(process.env.CW_VERDICT_ANCHORS, ''); // the truncation the anchors exist to catch
  grow(1);
  const bad = runWitness();
  assert.equal(bad.state, 'REGRESSION');
  assert.equal(bad.code, 1);
  assert.match(bad.detail.join(' '), /records fell 5 -> 1/);
  assert.equal(sh(w.producer, ['rev-parse', 'refs/heads/witness-anchors']), good.commit,
    'the witness must not advance over a regression');
});

test('the witness carries counts and hashes only — no paths, no usernames, no journal content', () => {
  world();
  grow(2);
  const body = JSON.stringify(buildWitness({ remoteLedgerTip: null }));
  assert.doesNotMatch(body, /\/Users\/|\/home\/|\.jsonl/);
  assert.match(body, /"verdict-anchors"/);
  assert.match(body, /"tipHash"/);
});

test('the agent-tag roster head is witnessed: a rewritten last row under the same count is REGRESSION', async () => {
  const w = world();
  grow(1);
  const { allocate } = await import('../agent-tag.mjs');
  for (const context of ['alpha', 'beta']) allocate({ model: 'opus5', context, at: '2026-01-01T00:00:00.000Z' });
  const good = runWitness();
  assert.equal(good.state, 'recorded');
  const head = good.witness.stores.find((s) => s.name === 'agent-tags');
  assert.equal(head.present, true);
  assert.equal(head.records, 2);
  assert.equal(head.chain.verified, 2);
  // The chain cannot see its own tail rewritten; the witness off this box can.
  const lines = readFileSync(process.env.CW_AGENT_TAGS, 'utf8').split('\n').filter(Boolean);
  lines[1] = lines[1].replace('beta', 'gamma');
  writeFileSync(process.env.CW_AGENT_TAGS, `${lines.join('\n')}\n`);
  const bad = runWitness();
  assert.equal(bad.state, 'REGRESSION');
  assert.match(bad.detail.join(' '), /agent-tags: same record count, different tip/);
  assert.equal(sh(w.producer, ['rev-parse', 'refs/heads/witness-anchors']), good.commit);
});

test('it writes through plumbing: no index entry, no working-tree file, no branch checked out', () => {
  const w = world();
  grow(2);
  runWitness();
  assert.equal(sh(w.producer, ['status', '--porcelain']), '', 'the working tree stays clean');
  assert.equal(existsSync(join(w.producer, 'witness.json')), false, 'nothing is written into the checkout');
  assert.notEqual(sh(w.producer, ['symbolic-ref', '--short', 'HEAD']), 'witness-anchors');
});

test('an absent store is absent, never a zero-record store', () => {
  world();
  const head = storeHead('verdict-anchors', join(dir, 'does-not-exist.jsonl'));
  assert.equal(head.present, false);
  assert.equal(head.tipHash, null);
});

test('regressions: grow or rotate, never shrink, vanish or change tip under the same count', () => {
  const s = (records, generations = 0, tipHash = `h${records}`) => ({ stores: [{ name: 'v', present: true, records, generations, tipHash }] });
  assert.deepEqual(regressions(s(3), s(5)), []);
  assert.deepEqual(regressions(s(9), s(1, 1)), [], 'a rotation legitimately resets the count');
  assert.equal(regressions(s(5), s(4)).length, 1);
  assert.equal(regressions(s(5), s(5, 0, 'other')).length, 1);
  assert.equal(regressions(s(5), { stores: [{ name: 'v', present: false, records: 0, generations: 0, tipHash: null }] }).length, 1);
});

test('a push rejection means different things and is classified, not lumped into one failure', () => {
  assert.equal(classifyPushFailure('! [rejected] main -> main (non-fast-forward)'), 'diverged');
  assert.equal(classifyPushFailure('fatal: Authentication failed for https://github.com/x/y'), 'not-permitted');
  assert.equal(classifyPushFailure('fatal: unable to access: Could not resolve host: github.com'), 'offline');
  assert.equal(classifyPushFailure('something nobody has seen'), 'push-failed');
});

test('under a test runner with no seam it refuses rather than witnessing the real repository', () => {
  world();
  delete process.env.CW_WITNESS_REPO;
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this assertion only means anything under node --test');
  assert.throws(() => runWitness(), /refusing to write under a test runner/);
});

// Inside a hook in a linked worktree git exports an absolute GIT_DIR, and a child `git -C <clone>`
// obeys it. The self-sweep started by commitwork's post-commit hook therefore wrote the witness
// into commitwork and pushed it to commitwork's own origin, 29 times from 2026-09-18.
function decoy() {
  const d = join(dir, 'decoy');
  spawnSync('git', ['init', '-q', d]);
  sh(d, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'decoy']);
  return d;
}
function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const hasRef = (repo, ref) => spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', ref], { encoding: 'utf8' }).status === 0;

test('an exported GIT_DIR cannot redirect the witness: it lands in the clone, never in the hooked repo', () => {
  const w = world();
  const d = decoy();
  grow(2);
  const r = withEnv({ GIT_DIR: join(d, '.git'), GIT_INDEX_FILE: join(d, '.git', 'index') }, () => runWitness());
  assert.equal(r.state, 'recorded', JSON.stringify(r));
  assert.equal(r.pushed, true);
  assert.equal(hasRef(d, 'refs/heads/witness-anchors'), false, 'the witness was written into the repository the environment named');
  assert.equal(sh(w.producer, ['rev-parse', 'refs/heads/witness-anchors']), r.commit);
  assert.equal(sh(w.remote, ['rev-parse', 'refs/heads/witness-anchors']), r.commit);
});

test('a directory that git resolves to some other repository is refused, not written', () => {
  world();
  const d = decoy();
  const nested = join(d, 'not-a-clone');
  mkdirSync(nested);
  writeFileSync(join(nested, 'HEAD'), ''); // passes the presence check, and git walks up to the decoy
  grow(1);
  const r = withEnv({ CW_WITNESS_REPO: nested }, () => runWitness());
  assert.equal(r.state, 'wrong-repository', JSON.stringify(r));
  assert.equal(r.code, 2);
  assert.equal(hasRef(d, 'refs/heads/witness-anchors'), false);
});

test('a clone that publishes to this repository\'s own origin is refused', (t) => {
  const ours = spawnSync('git', ['-C', join(import.meta.dirname, '..', '..'), 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (ours.status !== 0) { t.skip('this checkout has no origin to compare against'); return; }
  const w = world();
  sh(w.producer, ['remote', 'set-url', 'origin', ours.stdout.trim()]);
  grow(1);
  const r = runWitness({ push: false });
  assert.equal(r.state, 'not-independent', JSON.stringify(r));
  assert.equal(hasRef(w.producer, 'refs/heads/witness-anchors'), false);
});
