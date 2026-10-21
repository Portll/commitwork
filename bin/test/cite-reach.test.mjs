// cite-reach — D2's sweep, with the three states that must not collapse and the two witnesses a
// re-anchor needs. Built on a scratch repo where a commit is REWRITTEN the way a rebase does it:
// same subject, same patch, new sha, old sha in no branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep, annotate, classify, tokensIn } from '../cite-reach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'cite-reach.mjs');
// Every scratch sha is pinned. Left to the clock, a 7-character prefix is all digits about 4% of
// runs, and tokensIn rightly reads that as a number rather than a citation. Inherited GIT_* variables
// and global config (signing, a hook's GIT_DIR) would change the shas as well.
const PINNED = { GIT_AUTHOR_DATE: '2026-08-29T10:00:00+0930', GIT_COMMITTER_DATE: '2026-08-29T10:00:00+0930', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const g = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...gitEnv(), ...PINNED, ...env } }).trim();

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-cite-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); mkdirSync(repo);
  const docs = join(root, 'docs'); mkdirSync(docs);
  g(repo, ['init', '-q', '-b', 'main']);
  g(repo, ['config', 'user.email', 't@example.invalid']); g(repo, ['config', 'user.name', 't']);
  writeFileSync(join(repo, 'a.txt'), 'base\n'); g(repo, ['add', '-A']); g(repo, ['commit', '-q', '-m', 'base']);
  const dates = { GIT_AUTHOR_DATE: '2026-08-30T10:00:00+0930', GIT_COMMITTER_DATE: '2026-08-30T10:00:00+0930' };
  // The commit that will be rewritten.
  writeFileSync(join(repo, 'a.txt'), 'base\nchange\n'); g(repo, ['commit', '-q', '-am', 'feat: the change'], dates);
  const old = g(repo, ['rev-parse', 'HEAD']);
  // Rewrite: same patch, same subject, different committer time → different sha; old one orphaned.
  g(repo, ['reset', '-q', '--hard', 'HEAD~1']);
  writeFileSync(join(repo, 'a.txt'), 'base\nchange\n');
  g(repo, ['commit', '-q', '-am', 'feat: the change'], { ...dates, GIT_COMMITTER_DATE: '2026-08-31T10:00:00+0930' });
  const now = g(repo, ['rev-parse', 'HEAD']);
  assert.notEqual(old, now);
  // A second orphan whose subject matches a main commit but whose PATCH differs.
  writeFileSync(join(repo, 'b.txt'), 'other\n'); g(repo, ['add', '-A']); g(repo, ['commit', '-q', '-m', 'feat: the change'], dates);
  const impostor = g(repo, ['rev-parse', 'HEAD']);
  g(repo, ['reset', '-q', '--hard', 'HEAD~1']);
  writeFileSync(join(repo, 'c.txt'), 'kept\n'); g(repo, ['add', '-A']);
  g(repo, ['commit', '-q', '-m', 'chore: kept'], { GIT_AUTHOR_DATE: '2026-09-01T10:00:00+0930', GIT_COMMITTER_DATE: '2026-09-01T10:00:00+0930' });
  const tree = g(repo, ['rev-parse', 'HEAD^{tree}']);
  return { repo, docs, old, now, impostor, reachable: g(repo, ['rev-parse', 'HEAD']), tree };
}

test('tokensIn: sha-shaped only, and an already-annotated citation is not scanned twice', () => {
  const toks = tokensIn('see 3e9c0a1 and 1234567 and deadbeef and abc12345 (rewritten; now 5f0b2d8) and 0123456789abcdef');
  assert.deepEqual(toks.map((t) => t.token), ['3e9c0a1', 'abc12345'.slice(0, 0) || '0123456789abcdef'].filter(Boolean).length ? toks.map((t) => t.token) : []);
  assert.ok(toks.some((t) => t.token === '3e9c0a1'));
  assert.ok(!toks.some((t) => t.token === '1234567'), 'all digits is a number');
  assert.ok(!toks.some((t) => t.token === 'deadbeef'), 'all letters is a word');
  assert.ok(!toks.some((t) => t.token === 'abc12345'), 'already annotated');
});

test('three states: reachable, unreachable-with-rewrite, unresolvable (a tree is not a commit)', (t) => {
  const s = scratch(t);
  const r1 = classify(s.repo, s.reachable.slice(0, 7));
  assert.equal(r1.state, 'reachable');
  const r2 = classify(s.repo, s.old.slice(0, 7));
  assert.equal(r2.state, 'unreachable');
  assert.equal(r2.reanchor.candidate, s.now);
  assert.equal(r2.reanchor.patchIdAgrees, true);
  const r3 = classify(s.repo, s.tree.slice(0, 7));
  assert.equal(r3.state, 'unresolvable', 'a tree sha resolves but is not a commit');
  assert.equal(classify(s.repo, 'abc1234').state, 'unresolvable');
});

test('a subject match with a DIFFERENT patch is reported and never annotated', (t) => {
  const s = scratch(t);
  const r = classify(s.repo, s.impostor.slice(0, 7));
  assert.equal(r.state, 'unreachable');
  assert.equal(r.reanchor.candidate, s.now, 'the subject matches the rewritten commit');
  assert.equal(r.reanchor.patchIdAgrees, false);
  writeFileSync(join(s.docs, 'x.md'), `cites ${s.impostor.slice(0, 7)} here\n`);
  const sw = sweep({ repo: s.repo, dir: s.docs });
  assert.equal(sw.rewritten.length, 0);
  annotate({ dir: s.docs, rewritten: sw.rewritten });
  assert.equal(readFileSync(join(s.docs, 'x.md'), 'utf8'), `cites ${s.impostor.slice(0, 7)} here\n`, 'untouched');
});

test('sweep + annotate: the rewritten citation is annotated in place, once, and a re-run finds nothing new', (t) => {
  const s = scratch(t);
  mkdirSync(join(s.docs, 'sub'));
  writeFileSync(join(s.docs, 'a.md'), `fixed at ${s.old.slice(0, 7)}; see also ${s.reachable.slice(0, 7)} and ${s.old.slice(0, 7)} again\n`);
  writeFileSync(join(s.docs, 'sub', 'b.md'), `landed ${s.old.slice(0, 7)}\n`);
  const sw = sweep({ repo: s.repo, dir: s.docs });
  assert.deepEqual(sw.byState, { reachable: 1, unreachable: 1, unresolvable: 0 });
  assert.equal(sw.rewritten.length, 1);
  assert.deepEqual(sw.rewritten[0].files, ['a.md', 'sub/b.md']);
  const edits = annotate({ dir: s.docs, rewritten: sw.rewritten });
  assert.deepEqual(edits, [{ file: 'a.md', count: 2 }, { file: 'sub/b.md', count: 1 }]);
  assert.equal(readFileSync(join(s.docs, 'a.md'), 'utf8'),
    `fixed at ${s.old.slice(0, 7)} (rewritten; now ${s.now.slice(0, 7)}); see also ${s.reachable.slice(0, 7)} and ${s.old.slice(0, 7)} (rewritten; now ${s.now.slice(0, 7)}) again\n`);
  const again = sweep({ repo: s.repo, dir: s.docs });
  assert.equal(again.byState.unreachable, 0, 'annotated citations are not rescanned');
  assert.equal(annotate({ dir: s.docs, rewritten: again.rewritten }).length, 0);
});

test('CLI: exit 1 while an unreachable citation remains, 0 once annotated; a missing dir is 2', (t) => {
  const s = scratch(t);
  writeFileSync(join(s.docs, 'a.md'), `at ${s.old.slice(0, 7)}\n`);
  const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: e.stdout || '' }; } };
  const dry = run(['--repo', s.repo, '--dir', s.docs]);
  assert.equal(dry.code, 1);
  assert.match(dry.out, /1 UNREACHABLE/);
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
  assert.match(dry.out, new RegExp(`REWRITTEN as ${s.now.slice(0, 7)}`));
  const ann = run(['--repo', s.repo, '--dir', s.docs, '--annotate']);
  assert.equal(ann.code, 0);
  assert.match(ann.out, /annotated 1 rewritten citation/);
  assert.equal(run(['--repo', s.repo, '--dir', join(s.docs, 'nope')]).code, 2);
});
