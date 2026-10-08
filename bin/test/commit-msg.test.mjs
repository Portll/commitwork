import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanMessage, checkMessage } from '../commit-msg.mjs';
import { installOne } from '../install-commit-msg.mjs';
import { MSG_HOOK_MARKER } from '../lib/commit-msg-hook.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('cleanMessage: what git would commit', () => {
  test('comment lines go, and a verbose diff below the scissors goes with them', () => {
    const raw = 'feat: add x\n\nbody\n# Please enter the commit message\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n';
    assert.equal(cleanMessage(raw), 'feat: add x\n\nbody\n');
  });
  test('another comment character, CRLF and leading blank lines', () => {
    assert.equal(cleanMessage('\r\n; note\r\nfix: add x\r\n', ';'), 'fix: add x\n');
  });
});

describe('checkMessage', () => {
  test('an imperative subject passes under every rule set', () => {
    for (const name of [null, 'cobolwork', 'ironwork', 'cobolwork-web']) {
      assert.equal(checkMessage('fix: refuse a forbidden trailer\n', name).ok, true, String(name));
    }
  });
  test('a declarative subject is refused, naming the rule set and the fix', () => {
    const r = checkMessage('feat: the gate fails a patch\n', 'cobolwork');
    assert.equal(r.ok, false);
    assert.match(r.lines.join('\n'), /cobolwork commit rules[\s\S]*noun phrase/);
  });
  test('a Co-Authored-By trailer is refused, fixups included', () => {
    for (const subject of ['fix: add x', 'fixup! fix: add x']) {
      assert.match(checkMessage(`${subject}\n\nCo-Authored-By: someone <a@b>\n`, null).lines[0], /Co-Authored-By/);
    }
  });
  test('fixup!, squash! and amend! subjects pass for a later autosquash', () => {
    for (const p of ['fixup!', 'squash!', 'amend!']) assert.equal(checkMessage(`${p} feat: the gate fails\n`, null).ok, true, p);
  });
  test('an unknown rule set refuses every message', () => {
    assert.match(checkMessage('fix: add x\n', 'nope').lines[0], /no|rule sets/);
    assert.equal(checkMessage('fix: add x\n', 'nope').ok, false);
  });
});

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-commit-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  g(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'f'), 'a\n');
  g(dir, ['add', 'f']);
  return dir;
}

const commit = (dir, message) => spawnSync('git', ['commit', '-q', '-m', message], { cwd: dir, encoding: 'utf8' });
const commits = (dir) => Number(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim() || 0);

describe('the installed hook, end to end on a bare git commit', () => {
  test('refuses a declarative subject, then commits the imperative one', (t) => {
    const dir = scratch(t);
    const r = installOne(`${dir}=ironwork`, { write: true, cw: REPO });
    assert.equal(r.ok, true, r.line);
    assert.equal(g(dir, ['config', '--get', 'commitwork.rules']), 'ironwork');
    const hook = join(dir, '.git', 'hooks', 'commit-msg');
    assert.ok(statSync(hook).mode & 0o100, 'the hook is executable');

    const refused = commit(dir, 'feat: the parser lowers OCCURS DEPENDING ON');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /ironwork commit rules[\s\S]*noun phrase/);
    assert.equal(commits(dir), 0, 'nothing was committed');

    assert.equal(commit(dir, 'feat: lower OCCURS DEPENDING ON tables').status, 0, 'the shout tell is off in ironwork');
    assert.equal(commits(dir), 1);
  });

  test('refuses a Co-Authored-By trailer', (t) => {
    const dir = scratch(t);
    installOne(`${dir}=cobolwork-web`, { write: true, cw: REPO });
    const r = commit(dir, 'feat: add the page\n\nCo-Authored-By: someone <a@b>');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Co-Authored-By/);
  });

  test('fails closed when the gate script is missing', (t) => {
    const dir = scratch(t);
    installOne(`${dir}=cobolwork`, { write: true, cw: join(dir, 'no-commitwork-here') });
    const r = commit(dir, 'feat: add the page');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /gate cannot run/);
    assert.equal(commits(dir), 0);
  });
});

describe('install-commit-msg', () => {
  test('a dry run writes nothing and sets nothing', (t) => {
    const dir = scratch(t);
    const r = installOne(`${dir}=cobolwork`, { cw: REPO });
    assert.match(r.line, /DRY RUN/);
    assert.ok(!existsSync(join(dir, '.git', 'hooks', 'commit-msg')));
    assert.equal(spawnSync('git', ['config', '--get', 'commitwork.rules'], { cwd: dir }).status, 1);
  });

  test('the rule set defaults to the directory name, and an unknown one is refused', (t) => {
    const dir = scratch(t);
    const r = installOne(dir, { write: true, cw: REPO });
    assert.equal(r.ok, false);
    assert.match(r.line, /no rule set 'cw-commit-msg-/);
  });

  test('a hook commitwork did not write is kept unless --force, and --uninstall removes only ours', (t) => {
    const dir = scratch(t);
    const hook = join(dir, '.git', 'hooks', 'commit-msg');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(installOne(`${dir}=cobolwork`, { write: true, cw: REPO }).ok, false);
    assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n');
    assert.equal(installOne(`${dir}=cobolwork`, { write: true, force: true, cw: REPO }).ok, true);
    assert.match(readFileSync(hook, 'utf8'), new RegExp(MSG_HOOK_MARKER));
    assert.equal(installOne(dir, { write: true, uninstall: true }).ok, true);
    assert.ok(!existsSync(hook));
    assert.equal(spawnSync('git', ['config', '--get', 'commitwork.rules'], { cwd: dir }).status, 1);
  });
});
