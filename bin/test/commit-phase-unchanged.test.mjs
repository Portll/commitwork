// M27, the pure form — a declared path whose blob equals HEAD's is not a change, and the tool says
// so BY NAME rather than reporting a smaller count and leaving the author to notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// Every commit stamps package.json from its parent's, so the fixture carries one.
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';

// spawnSync, not execFileSync: the warning under test is on STDERR of a run that EXITS 0, and
// execFileSync hands back stderr only through the exception of a non-zero exit.
function cli(cwd, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, CW_COMMIT_REPO: cwd, CW_TOUCH_LEDGER: join(cwd, '.cw-test-touches.jsonl'), CW_ALLOW_UNSIGNED: '1' },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-commit-unchanged-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  mkdirSync(join(dir, 'd'));
  writeFileSync(join(dir, 'd', 'c.txt'), 'c\n');
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-q', '-m', 'test: base']);
  return dir;
}

test('two declared paths, one byte-identical to HEAD: the land succeeds and NAMES the unchanged one', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'a.txt'), 'a changed\n');
  // b.txt is "edited" with a replace that matches nothing — the measured shape.
  writeFileSync(join(dir, 'b.txt'), 'b\n'.replace('never here', 'x'));
  const r = cli(dir, ['-m', 'fix: commit two paths, one unchanged', '--', 'a.txt', 'b.txt']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /M27 — b\.txt is byte-identical to HEAD and is NOT in this commit/);
  assert.doesNotMatch(r.err, /M27 — a\.txt/);
  assert.match(r.out, /landed .* 1 path\(s\)/);
  assert.equal(g(dir, ['show', '--format=', '--name-only', 'HEAD']), 'a.txt\npackage.json', 'a.txt and the version stamp; b.txt is not in it');
});

test('the ONLY declared path unchanged is refused as nothing-staged, and still named', (t) => {
  const dir = scratch(t);
  const r = cli(dir, ['-m', 'fix: commit nothing', '--', 'b.txt']);
  assert.equal(r.code, 1);
  assert.match(r.err, /M27 — b\.txt is byte-identical to HEAD/);
  assert.match(r.err, /NOTHING-STAGED/);
  assert.equal(g(dir, ['log', '--oneline']).split('\n').length, 1, 'nothing landed');
});

test('a declared DIRECTORY is not named as unchanged — only a file can be byte-identical', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'd', 'c.txt'), 'c changed\n');
  const r = cli(dir, ['-m', 'fix: commit a directory pathspec', '--', 'd']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /M27/);
});

test('a declared path that no longer exists is a deletion, not an unchanged file', (t) => {
  const dir = scratch(t);
  rmSync(join(dir, 'b.txt'));
  const r = cli(dir, ['-m', 'chore: delete b', '--', 'b.txt']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /M27/);
});
