// bin/mainline-data.mjs on a scratch git repo with a known shape — main, a feature branch merged
// back, one commit after — written to --out in tmp. Pins the graph the renderer consumes: the
// first-parent spine is lane 0 and flagged mainline, the branch commit takes an outer lane, the
// merge has two in-window parents; --cap keeps the spine and records the truncation; reruns agree
// on everything but the `generated` stamp, and under CW_NOW on every byte; a repo with no commits is
// an empty manifest and exit 0; a missing dir or a non-repo exits 1 and writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'mainline-data.mjs');

function scratch(t, name = 'graph-fixture') {
  const root = mkdtempSync(join(tmpdir(), 'cw-mainline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, name); mkdirSync(repo);
  let tick = 0;
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    // one second apart, so --date-order is decided by the fixture rather than by the wall clock
    env: { ...process.env, GIT_AUTHOR_DATE: `2026-01-01T00:00:${String(tick).padStart(2, '0')}Z`, GIT_COMMITTER_DATE: `2026-01-01T00:00:${String(tick).padStart(2, '0')}Z` },
  }).trim();
  const commit = (file, msg) => { tick++; writeFileSync(join(repo, file), `${msg}\n`); git('add', '--', file); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  const c1 = commit('a.txt', 'c1');
  const c2 = commit('a.txt', 'c2');
  git('checkout', '-q', '-b', 'feat');
  const f1 = commit('f.txt', 'f1');
  git('checkout', '-q', 'main');
  const c3 = commit('a.txt', 'c3');
  tick++; git('merge', '-q', '--no-ff', '-m', 'merge feat', 'feat');
  const m = git('rev-parse', 'HEAD');
  const c4 = commit('a.txt', 'c4');
  return { root, repo, out: join(root, 'out'), sha: { c1, c2, f1, c3, m, c4 } };
}

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CW_NOW: '', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('the full graph: spine on lane 0, the branch commit on an outer lane, one two-parent merge', (t) => {
  const s = scratch(t);
  const r = run([s.repo, '--out', s.out, '--slug', 'demo']);
  assert.equal(r.code, 0, r.err);
  const doc = JSON.parse(readFileSync(join(s.out, 'mainline.demo.json'), 'utf8'));
  assert.equal(doc.schema, 'mainline/v1');
  assert.equal(doc.slug, 'demo');
  assert.deepEqual(doc.branchTip, { sha: s.sha.c4, name: 'main' });
  assert.equal(doc.truncation, undefined);
  const by = Object.fromEntries(doc.commits.map((c) => [c.sha, c]));
  assert.equal(doc.commits.length, 6);
  for (const k of ['c1', 'c2', 'c3', 'm', 'c4']) {
    assert.equal(by[s.sha[k]].mainline, true, `${k} is on the first-parent spine`);
    assert.equal(by[s.sha[k]].lane, 0, `${k} is on lane 0`);
  }
  assert.equal(by[s.sha.f1].mainline, false);
  assert.ok(by[s.sha.f1].lane >= 1, 'the branch commit is off the carriageway');
  assert.equal(by[s.sha.f1].branch, 'feat');
  assert.equal(by[s.sha.m].isMerge, true);
  assert.deepEqual(by[s.sha.m].parentsInWindow, [s.sha.c3, s.sha.f1]);
  assert.equal(doc.lanes, 2);
  assert.deepEqual(doc.commits.map((c) => c.row), [0, 1, 2, 3, 4, 5], 'rows are the emitted order');
  assert.equal(doc.commits[0].sha, s.sha.c4, 'newest first');
  assert.match(r.out, /commits=6 \(full history, 6\)/);
  assert.match(r.out, /lanes=2 {2}merges=1 .* spine=5/);
});

test('--cap keeps the newest spine commits and says it truncated', (t) => {
  const s = scratch(t);
  const r = run([s.repo, '--out', s.out, '--slug', 'demo', '--cap', '3']);
  assert.equal(r.code, 0, r.err);
  const doc = JSON.parse(readFileSync(join(s.out, 'mainline.demo.json'), 'utf8'));
  assert.deepEqual(doc.truncation, { note: 'showing newest 3 of 6 commits', cap: 3, totalCommits: 6, shown: 3 });
  assert.deepEqual(doc.commits.map((c) => c.sha), [s.sha.c4, s.sha.m, s.sha.c3], 'spine first, never a branch commit ahead of it');
  assert.deepEqual(doc.commits.find((c) => c.sha === s.sha.m).parentsInWindow, [s.sha.c3], 'the out-of-window parent is a stub');
  assert.match(r.out, /commits=3 \(of 6 total — TRUNCATED to newest 3\)/);
});

test('reruns over the same history agree on everything except the generated stamp', (t) => {
  const s = scratch(t);
  assert.equal(run([s.repo, '--out', s.out, '--slug', 'a']).code, 0);
  assert.equal(run([s.repo, '--out', s.out, '--slug', 'b']).code, 0);
  const strip = (slug) => { const d = JSON.parse(readFileSync(join(s.out, `mainline.${slug}.json`), 'utf8')); delete d.generated; delete d.slug; return d; };
  assert.deepEqual(strip('a'), strip('b'));
});

test('the default slug is the repo dir name, lower-cased and dash-folded', (t) => {
  const s = scratch(t, 'Ledger_Batch.Core');
  const r = run([s.repo, '--out', s.out]);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(s.out, 'mainline.ledger-batch-core.json')), r.out);
  assert.match(r.out, /slug=ledger-batch-core/);
});

test('a missing dir and a non-repo dir each exit 1 with the reason and write nothing', (t) => {
  const s = scratch(t);
  const missing = run([join(s.root, 'nope'), '--out', s.out]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /mainline: repo dir not found: .*nope/);
  const plain = join(s.root, 'plain'); mkdirSync(plain);
  const notRepo = run([plain, '--out', s.out]);
  assert.equal(notRepo.code, 1);
  assert.match(notRepo.err, /mainline: not a git work tree: .*plain/);
  assert.equal(existsSync(s.out), false);
});

test('under CW_NOW the stamp is the pinned time and reruns are byte-identical', (t) => {
  const s = scratch(t);
  const pin = { CW_NOW: '2026-02-03T04:05:06Z' };
  assert.equal(run([s.repo, '--out', join(s.out, 'a'), '--slug', 'demo'], pin).code, 0);
  assert.equal(run([s.repo, '--out', join(s.out, 'b'), '--slug', 'demo'], pin).code, 0);
  const a = readFileSync(join(s.out, 'a', 'mainline.demo.json'), 'utf8');
  assert.equal(JSON.parse(a).generated, '2026-02-03T04:05:06.000Z');
  assert.equal(readFileSync(join(s.out, 'b', 'mainline.demo.json'), 'utf8'), a);
});

test('a repo with no commits writes an empty manifest and exits 0', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-mainline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'empty'); mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  const r = run([repo, '--out', join(root, 'out'), '--slug', 'empty'], { CW_NOW: '2026-02-03T04:05:06Z' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /mainline: no commits found \(empty repo\?\)/);
  const doc = JSON.parse(readFileSync(join(root, 'out', 'mainline.empty.json'), 'utf8'));
  assert.deepEqual([doc.schema, doc.slug, doc.generated, doc.branchTip, doc.lanes, doc.commits], ['mainline/v1', 'empty', '2026-02-03T04:05:06.000Z', null, 0, []]);
  assert.equal(doc.truncation, undefined);
});
