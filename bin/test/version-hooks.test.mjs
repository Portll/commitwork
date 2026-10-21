// The git-hook half of the version rule: the decisions first, then the installed hooks against real
// git in scratch repos — bare, amend, pathspec and merge commits, the opt-outs, a rebase, the main
// guard and a chained hook.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampDecision, workingCopyText, isAmend, commitRaises } from '../version-stamp.mjs';
import { installHooks, hookText, HOOKS, chainedName, VERSION_HOOK_MARKER } from '../install-version-hooks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = (version, { test: script = 'true' } = {}) =>
  `{\n  "name": "fixture",\n  "version": "${version}",\n  "scripts": {\n    "test": "${script}"\n  }\n}\n`;

describe('the decisions', () => {
  test('stampDecision: a commit that does not raise the version takes bumpPatch of its highest parent', () => {
    assert.deepEqual(stampDecision({ parentTexts: [pkg('0.1.5')], indexText: pkg('0.1.5') }), { action: 'stamp', from: '0.1.5', version: '0.1.6', text: pkg('0.1.6') });
    assert.equal(stampDecision({ parentTexts: [pkg('0.1.5')], indexText: pkg('0.1.5', { test: 'x' }) }).text, pkg('0.1.6', { test: 'x' }), 'the commit\'s own edits survive');
    assert.equal(stampDecision({ parentTexts: [pkg('0.1.5')], indexText: pkg('0.1.2') }).version, '0.1.6', 'a stale version is raised');
    assert.equal(stampDecision({ parentTexts: [pkg('0.1.5'), pkg('0.1.9')], indexText: pkg('0.1.9') }).version, '0.1.10', 'a merge stamps from its higher parent');
  });

  test('stampDecision: a commit that raises the version itself keeps it; nothing to bump from is no stamp', () => {
    assert.deepEqual(stampDecision({ parentTexts: [pkg('0.1.5')], indexText: pkg('0.2.0') }), { action: 'keep', version: '0.2.0' });
    assert.deepEqual(stampDecision({ parentTexts: [pkg('0.1.5')], indexText: pkg('0.1.6') }), { action: 'keep', version: '0.1.6' });
    assert.deepEqual(stampDecision({ parentTexts: [], indexText: pkg('0.0.1') }), { action: 'none' }, 'the first commit');
    assert.deepEqual(stampDecision({ parentTexts: [null], indexText: pkg('0.0.1') }), { action: 'none' }, 'the commit that adds package.json');
  });

  test('stampDecision fails closed: a deleted package.json, an unparseable parent', () => {
    assert.match(stampDecision({ parentTexts: [pkg('0.1.5')], indexText: null }).why, /deletes package\.json/);
    assert.equal(stampDecision({ parentTexts: ['{ nope'], indexText: pkg('0.1.5') }).action, 'refuse');
    assert.equal(stampDecision({ parentTexts: [pkg('0.1.5'), pkg('latest')], indexText: pkg('0.1.5') }).action, 'refuse');
  });

  test('workingCopyText moves the version token only when the copy carried the index version', () => {
    const indexText = pkg('0.1.5');
    assert.equal(workingCopyText({ worktree: indexText, indexText, stamped: pkg('0.1.6'), version: '0.1.6' }), pkg('0.1.6'));
    assert.equal(workingCopyText({ worktree: pkg('0.1.5', { test: 'wip' }), indexText, stamped: pkg('0.1.6'), version: '0.1.6' }), pkg('0.1.6', { test: 'wip' }), 'an unstaged edit survives');
    assert.equal(workingCopyText({ worktree: pkg('0.3.0'), indexText, stamped: pkg('0.1.6'), version: '0.1.6' }), null, 'its own version edit is left');
    assert.equal(workingCopyText({ worktree: null, indexText, stamped: pkg('0.1.6'), version: '0.1.6' }), null);
  });

  test('isAmend reads --amend and its unambiguous prefixes, nothing else', () => {
    for (const yes of ['git commit --amend', '/usr/bin/git commit -q --amend -m x', 'git commit --amen', 'git commit --am --no-edit']) assert.ok(isAmend(yes), yes);
    for (const no of ['git commit -m "--amended"', 'git commit -m x', 'git commit --amendment', '', null]) assert.ok(!isAmend(no), String(no));
  });

  test('commitRaises: strictly above the first parent, or no parent copy at all', () => {
    assert.deepEqual(commitRaises({ parentText: pkg('0.1.5'), text: pkg('0.1.6') }), { ok: true });
    assert.deepEqual(commitRaises({ parentText: null, text: pkg('0.1.0') }), { ok: true });
    assert.match(commitRaises({ parentText: pkg('0.1.5'), text: pkg('0.1.5') }).why, /0\.1\.5 after 0\.1\.5/);
    assert.match(commitRaises({ parentText: pkg('0.1.5'), text: null }).why, /deletes/);
    assert.equal(commitRaises({ parentText: pkg('0.1.5'), text: '{' }).ok, false);
  });

  test('every hook carries the marker and fails closed when its program is missing', () => {
    for (const hook of HOOKS) {
      const text = hookText(hook, { node: process.execPath, script: '/nonexistent/version-stamp.mjs' });
      assert.ok(text.includes(VERSION_HOOK_MARKER), hook);
      assert.match(text, /REFUSED|NOT checked/, hook);
    }
  });
});

// ── against real git ─────────────────────────────────────────────────────────

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-version-hooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = join(dir, '.gitconfig-empty');
  writeFileSync(cfg, '');
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1',
    CW_ALLOW_UNSIGNED: '1', CW_TOUCH_LEDGER: join(dir, '.touches.jsonl'), CW_COMMIT_SESSION: 'vh', CW_SELF_SWEEP: '0',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CW_VERSION_STAMP', 'CW_VERSION_GUARD', 'CW_COMMIT_REPO']) delete env[k];
  const repo = join(dir, 'r');
  const run = (args, extra = {}) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const g = (args, extra) => { const r = run(args, extra); assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.err}`); return r; };
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
  g(['config', 'user.email', 'test@example.invalid']);
  g(['config', 'user.name', 'test']);
  writeFileSync(join(repo, 'package.json'), pkg('0.1.0'));
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'test: base']);
  const r = installHooks(repo, { write: true, node: process.execPath, cw: ROOT });
  assert.equal(r.ok, true, r.lines.join('\n'));
  const ver = (rev = 'HEAD') => JSON.parse(g(['show', `${rev}:package.json`]).out).version;
  const disk = () => JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  const edit = (file, text) => writeFileSync(join(repo, file), text);
  return { repo, run, g, ver, disk, edit };
}

describe('the installed hooks, against real git', () => {
  test('a bare commit is stamped, and the working copy and index follow', (t) => {
    const s = scratch(t);
    s.edit('a.txt', 'b\n');
    s.g(['add', 'a.txt']);
    const r = s.g(['commit', '-q', '-m', 'test: one']);
    assert.match(r.err, /package\.json 0\.1\.0 → 0\.1\.1 in this commit/);
    assert.deepEqual([s.ver(), s.disk(), s.g(['status', '--porcelain']).out], ['0.1.1', '0.1.1', '']);
    s.edit('a.txt', 'c\n');
    s.g(['commit', '-q', '-a', '-m', 'test: two']);
    assert.equal(s.ver(), '0.1.2', 'commit -a');
  });

  test('a commit that sets its own version keeps it, and an amend does not bump again', { skip: process.platform === 'win32' && 'amend detection reads the git process argv through ps' }, (t) => {
    const s = scratch(t);
    s.edit('package.json', pkg('0.2.0'));
    s.g(['commit', '-q', '-a', '-m', 'chore: set 0.2.0']);
    assert.equal(s.ver(), '0.2.0');
    s.edit('a.txt', 'amended\n');
    s.g(['commit', '-q', '-a', '--amend', '-m', 'chore: set 0.2.0 and a']);
    assert.deepEqual([s.ver(), s.ver('HEAD~1')], ['0.2.0', '0.1.0']);
    s.edit('a.txt', 'next\n');
    s.g(['commit', '-q', '-a', '-m', 'test: next']);
    s.g(['commit', '-q', '--amend', '-m', 'test: next, reworded']);
    assert.equal(s.ver(), '0.2.1', 'an amend of a stamped commit keeps its stamp');
  });

  test('a pathspec commit is stamped and names the index repair', (t) => {
    const s = scratch(t);
    s.edit('a.txt', 'p\n');
    const r = s.g(['commit', '-q', '-m', 'test: pathspec', '--', 'a.txt']);
    assert.equal(s.ver(), '0.1.1');
    assert.match(r.err, /git reset -q -- package\.json/);
    s.g(['reset', '-q', '--', 'package.json']);
    assert.equal(s.g(['status', '--porcelain']).out, '');
  });

  test('a merge is stamped from its higher parent, concluded after a conflict or clean', (t) => {
    const s = scratch(t);
    s.g(['checkout', '-q', '-b', 'side']);
    for (const n of ['1', '2', '3']) { s.edit(`s${n}.txt`, n); s.g(['add', '-A']); s.g(['commit', '-q', '-m', `test: side ${n}`]); }
    s.g(['checkout', '-q', 'main']);
    s.edit('m.txt', 'm');
    s.g(['add', '-A']);
    s.g(['commit', '-q', '-m', 'test: main']);
    assert.deepEqual([s.ver('side'), s.ver('main')], ['0.1.3', '0.1.1']);
    assert.notEqual(s.run(['merge', '-q', '--no-ff', '-m', 'chore: merge side', 'side']).code, 0, 'both sides stamped the version line');
    s.g(['checkout', '--ours', '--', 'package.json']);
    s.g(['add', 'package.json']);
    s.g(['commit', '-q', '--no-edit']);
    assert.equal(s.ver(), '0.1.4', 'the lower side\'s copy is raised past the higher parent');
    s.g(['checkout', '-q', '-b', 'quiet']);
    s.edit('q.txt', 'q');
    s.g(['add', '-A']);
    s.g(['commit', '-q', '-m', 'test: quiet'], { CW_VERSION_STAMP: '0' });
    s.g(['checkout', '-q', 'main']);
    const stopped = s.run(['merge', '-q', '--no-ff', '-m', 'chore: merge quiet', 'quiet']);
    assert.notEqual(stopped.code, 0, 'git writes a clean merge\'s tree before pre-merge-commit, so it stops for the stamp');
    assert.match(stopped.err, /git commit --no-edit/);
    assert.match(stopped.err, /Not committing merge/, 'the hook stopped it, not the guard after it');
    assert.doesNotMatch(stopped.err, /version-guard/);
    s.g(['commit', '-q', '--no-edit']);
    assert.equal(s.ver(), '0.1.5');
    assert.equal(s.g(['rev-list', '--parents', '-n', '1', 'HEAD']).out.split(' ').length, 3, 'still a merge');
  });

  test('without the stamp a commit on main is refused by the guard, and both opt-outs let it through', (t) => {
    const s = scratch(t);
    const head = s.g(['rev-parse', 'HEAD']).out;
    s.edit('a.txt', 'x\n');
    const r = s.run(['commit', '-q', '-a', '-m', 'test: unstamped'], { CW_VERSION_STAMP: '0' });
    assert.notEqual(r.code, 0);
    assert.match(r.err, /version-guard: REFUSED/);
    assert.equal(s.g(['rev-parse', 'HEAD']).out, head, 'main did not move');
    s.g(['commit', '-q', '-a', '-m', 'test: unstamped'], { CW_VERSION_STAMP: '0', CW_VERSION_GUARD: '0' });
    assert.equal(s.ver(), '0.1.0');
  });

  test('a rebased stack is restamped, and only a stamped one moves main', (t) => {
    const s = scratch(t);
    s.g(['checkout', '-q', '-b', 'feat']);
    for (const n of ['1', '2']) { s.edit(`f${n}.txt`, n); s.g(['add', '-A']); s.g(['commit', '-q', '-m', `test: feat ${n}`], { CW_VERSION_STAMP: '0' }); }
    assert.deepEqual([s.ver('feat'), s.ver('feat~1')], ['0.1.0', '0.1.0'], 'the branch carries no bump');
    const refused = s.run(['update-ref', 'refs/heads/main', 'feat', 'main']);
    assert.notEqual(refused.code, 0);
    assert.match(refused.err, /2 commit\(s\) that do not raise/);
    s.g(['checkout', '-q', 'main']);
    s.edit('m.txt', 'm');
    s.g(['add', '-A']);
    s.g(['commit', '-q', '-m', 'test: main moves']);
    s.g(['checkout', '-q', 'feat']);
    s.g(['rebase', '-q', 'main']);
    assert.deepEqual([s.ver('feat~2'), s.ver('feat~1'), s.ver('feat')], ['0.1.1', '0.1.2', '0.1.3']);
    assert.equal(s.disk(), '0.1.3');
    s.g(['update-ref', 'refs/heads/main', 'feat', s.g(['rev-parse', 'main']).out]);
    s.g(['update-ref', 'refs/heads/main', 'feat~2', 'feat']);
    assert.equal(s.ver('main'), '0.1.1', 'moving main backwards is not a land');
  });

  test('a hook another tool wrote is chained and runs after the stamp; uninstall puts it back', (t) => {
    const s = scratch(t);
    installHooks(s.repo, { write: true, uninstall: true, cw: ROOT });
    const hooks = join(s.repo, '.git', 'hooks');
    const foreign = '#!/bin/sh\necho ran >> "$(git rev-parse --git-dir)/foreign-ran"\n';
    writeFileSync(join(hooks, 'pre-commit'), foreign);
    chmodSync(join(hooks, 'pre-commit'), 0o755);
    const r = installHooks(s.repo, { write: true, cw: ROOT });
    assert.ok(r.lines.some((l) => /chain the existing hook/.test(l)), r.lines.join('\n'));
    s.edit('a.txt', 'chained\n');
    s.g(['commit', '-q', '-a', '-m', 'test: chained']);
    assert.equal(s.ver(), '0.1.1');
    assert.ok(existsSync(join(s.repo, '.git', 'foreign-ran')), 'the chained hook ran');
    writeFileSync(join(hooks, 'pre-commit'), foreign);
    assert.equal(installHooks(s.repo, { write: true, cw: ROOT }).ok, false, 'a foreign hook over an existing chain is refused');
    writeFileSync(join(hooks, 'pre-commit'), hookText('pre-commit', { node: process.execPath, script: join(ROOT, 'bin', 'version-stamp.mjs') }));
    installHooks(s.repo, { write: true, uninstall: true, cw: ROOT });
    assert.equal(readFileSync(join(hooks, 'pre-commit'), 'utf8'), foreign);
    assert.equal(existsSync(join(hooks, chainedName('pre-commit'))), false);
  });
});
