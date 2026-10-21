import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, exitCodeFor, previousRelease, EXIT, HELD_OUT_DIR } from '../corpus-rotation-check.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus-rotation-check.mjs');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ENV = { GIT_AUTHOR_NAME: 'fx', GIT_AUTHOR_EMAIL: 'fx@example.invalid', GIT_COMMITTER_NAME: 'fx', GIT_COMMITTER_EMAIL: 'fx@example.invalid' };

function repoWith(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-corpus-rot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  const add = (name) => { mkdirSync(join(dir, HELD_OUT_DIR), { recursive: true }); writeFileSync(join(dir, HELD_OUT_DIR, name), `${name}\n`); };
  const commit = (msg) => { git(dir, 'add', '-A'); execFileSync('git', ['-C', dir, 'commit', '-q', '-m', msg], { env: { ...process.env, ...ENV } }); return git(dir, 'rev-parse', 'HEAD'); };
  return { dir, add, commit };
}

test('a held-out file committed since the previous v* tag is growth; the same set is not; a shrink is named', (t) => {
  const r = repoWith(t);
  r.add('a.txt'); r.commit('one'); git(r.dir, 'tag', 'v0.1.0');
  writeFileSync(join(r.dir, 'other.txt'), 'x'); const same = r.commit('unrelated');
  const unchanged = compare({ repo: r.dir, ref: same, env: {} });
  assert.equal(unchanged.status, 'unchanged');
  assert.deepEqual([unchanged.since, unchanged.before, unchanged.after], ['v0.1.0', 1, 1]);
  assert.equal(exitCodeFor(unchanged), EXIT.unchanged);

  r.add('b.txt'); const grown = r.commit('two');
  const grew = compare({ repo: r.dir, ref: grown, env: {} });
  assert.equal(grew.status, 'grew');
  assert.deepEqual(grew.added, [`${HELD_OUT_DIR}/b.txt`]);
  assert.equal(exitCodeFor(grew), EXIT.grew);

  writeFileSync(join(r.dir, HELD_OUT_DIR, 'notes.md'), 'not a shape'); const md = r.commit('md only');
  assert.equal(compare({ repo: r.dir, ref: md, since: grown, env: {} }).status, 'unchanged', 'only .txt files are shapes');

  rmSync(join(r.dir, HELD_OUT_DIR, 'a.txt')); const shrunk = r.commit('drop one');
  const shrink = compare({ repo: r.dir, ref: shrunk, since: 'v0.1.0', env: {} });
  assert.deepEqual([shrink.status, shrink.removed], ['grew', [`${HELD_OUT_DIR}/a.txt`]], 'b was added since the tag, and the removal is still reported');
});

test('a renamed held-out file is not growth; an edited one is new content', (t) => {
  const r = repoWith(t);
  r.add('a.txt'); r.commit('one'); git(r.dir, 'tag', 'v0.1.0');
  git(r.dir, 'mv', `${HELD_OUT_DIR}/a.txt`, `${HELD_OUT_DIR}/renamed.txt`); const moved = r.commit('rename');
  const mv = compare({ repo: r.dir, ref: moved, env: {} });
  assert.deepEqual([mv.status, mv.added, mv.removed], ['unchanged', [], []], 'the same shape under a new name measures nothing new');
  writeFileSync(join(r.dir, HELD_OUT_DIR, 'renamed.txt'), 'a different payload\n'); const edited = r.commit('edit');
  const ed = compare({ repo: r.dir, ref: edited, env: {} });
  assert.deepEqual([ed.status, ed.added], ['grew', [`${HELD_OUT_DIR}/renamed.txt`]]);
});

test('no previous release, a non-commit ref or a non-repository is cannot-tell, never a verdict; the CLI exits accordingly', (t) => {
  const r = repoWith(t);
  r.add('a.txt'); const only = r.commit('one');
  const noTag = compare({ repo: r.dir, ref: only, env: {} });
  assert.equal(noTag.status, 'cannot-tell');
  assert.match(noTag.reason, /no v\* tag/);
  assert.equal(exitCodeFor(noTag), EXIT.cannotTell);
  assert.equal(compare({ repo: r.dir, ref: 'nope', env: {} }).status, 'cannot-tell');
  assert.equal(compare({ repo: r.dir, ref: only, env: { CW_CORPUS_SINCE: 'v9' } }).status, 'cannot-tell', 'an env base that does not exist is not silently replaced');
  const empty = mkdtempSync(join(tmpdir(), 'cw-corpus-none-')); t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal(compare({ repo: empty, env: {} }).status, 'cannot-tell');

  const cli = spawnSync(process.execPath, [TOOL, '--repo', r.dir, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, EXIT.cannotTell, cli.stdout);
  assert.equal(JSON.parse(cli.stdout).status, 'cannot-tell');
  git(r.dir, 'tag', 'v0.1.0'); r.add('b.txt'); r.commit('two');
  const ok = spawnSync(process.execPath, [TOOL, '--repo', r.dir], { encoding: 'utf8' });
  assert.equal(ok.status, EXIT.grew, ok.stdout);
  assert.match(ok.stdout, /GREW — 1 → 2 held-out file\(s\) since v0\.1\.0; added b\.txt/);
});

// ── a rewrite orphans every tag, and this gate must still answer ──────────────────────────────
// commitwork's history was rewritten 2026-10-11 and its only v* tag now sits off main. `git
// describe` therefore finds nothing, and the gate reported `cannot-tell` on every release — which
// reads as "not measured yet" rather than "cannot be measured, ever". These pin the fallback AND
// pin that the weaker basis is disclosed, which is the half that would otherwise be lost.
test('a reachable tag is preferred, and reported as reachable', (t) => {
  const r = repoWith(t);
  r.add('a.txt'); r.commit('one'); git(r.dir, 'tag', 'v0.1.0');
  r.add('b.txt'); const head = r.commit('two');
  assert.deepEqual(previousRelease(r.dir, head), { tag: 'v0.1.0', reachable: true });
  const c = compare({ repo: r.dir, ref: head, env: {} });
  assert.equal(c.status, 'grew');
  assert.equal(c.sinceReachable, true);
});

test('a tag on an UNRELATED history is used, and says it is not an ancestor', (t) => {
  const r = repoWith(t);
  // An orphan branch with its own root is exactly the shape a rewrite leaves the old tag on.
  r.add('a.txt'); r.commit('one');
  git(r.dir, 'checkout', '-q', '--orphan', 'old');
  git(r.dir, 'rm', '-rq', '--cached', '.');
  writeFileSync(join(r.dir, 'only-there.txt'), 'x');
  r.commit('the pre-rewrite release');
  git(r.dir, 'tag', 'v0.9.0');
  git(r.dir, 'checkout', '-q', 'main');
  r.add('b.txt'); const head = r.commit('two');

  assert.equal(previousRelease(r.dir, head).reachable, false, 'no tag is in this history');
  assert.equal(previousRelease(r.dir, head).tag, 'v0.9.0');
  const c = compare({ repo: r.dir, ref: head, env: {} });
  assert.notEqual(c.status, 'cannot-tell', 'refusing here leaves the gate permanently unmeasurable');
  assert.equal(c.since, 'v0.9.0');
  assert.equal(c.sinceReachable, false, 'the caveat must travel with the number');

  const cli = spawnSync(process.execPath, [TOOL, '--repo', r.dir, '--ref', head], { encoding: 'utf8', env: { ...process.env, CW_CORPUS_SINCE: '' } });
  assert.match(cli.stdout, /NOT in this ref's history/, 'the printed line must carry the caveat, not just the JSON');
});

test('a basis the CALLER named carries no caveat — it was not inferred', (t) => {
  const r = repoWith(t);
  r.add('a.txt'); const first = r.commit('one'); git(r.dir, 'tag', 'v0.1.0');
  r.add('b.txt'); const head = r.commit('two');
  const c = compare({ repo: r.dir, ref: head, since: first, env: {} });
  assert.equal(c.sinceReachable, null, 'null is "not inferred", which is neither true nor false');
  const cli = spawnSync(process.execPath, [TOOL, '--repo', r.dir, '--ref', head, '--since', first], { encoding: 'utf8' });
  assert.doesNotMatch(cli.stdout, /NOT in this ref/);
});

test('no v* tag at all still REFUSES — the fallback must not invent a basis', (t) => {
  const r = repoWith(t);
  r.add('a.txt'); const head = r.commit('one');
  assert.equal(previousRelease(r.dir, head), null);
  const c = compare({ repo: r.dir, ref: head, env: {} });
  assert.equal(c.status, 'cannot-tell');
  assert.match(c.reason, /no v\* tag/);
  assert.match(c.reason, /--since/);
});
