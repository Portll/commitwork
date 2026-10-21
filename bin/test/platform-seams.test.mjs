// docs/PLATFORM-SEAMS.md names every file each macOS-only seam class appears in. This re-measures
// the tree and fails on a seam in an unlisted file, or a listed file that no longer has it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAM_CLASSES, seamsIn, measure, listedFiles } from '../lib/platform-seams.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = join(CW, 'docs', 'PLATFORM-SEAMS.md');

test('each class matches its seam and not the neighbouring prose', () => {
  const hit = (text, id) => seamsIn(text).has(id);
  assert.ok(hit("execFileSync('launchctl', ['print'])", 'launchd'));
  assert.ok(hit("join(homedir(), 'Library', 'LaunchAgents')", 'launchd'));
  assert.ok(hit("execFileSync('security', ['find-generic-password'])", 'keychain'));
  assert.ok(hit("const ref = 'keychain:svc/acct';", 'keychain'));
  assert.ok(!hit("{ cat: 'security', tool: 'x' }", 'keychain'), 'a category named security is not the keychain');
  assert.ok(hit('#!/bin/zsh', 'zsh'));
  assert.ok(hit("const p = '/Users/x/a';", 'users-path'));
  assert.ok(hit("const p = '/opt/homebrew/bin/node';", 'homebrew'));
  assert.ok(hit("spawn('sandbox-exec', ['-p', p])", 'sandbox-exec'));
  assert.ok(hit("run('sw_vers', ['-productVersion'])", 'macos-tools'));
  assert.ok(!hit("const open = 'x'; open(file);", 'macos-tools'));
  assert.ok(!hit("new Set(['sh', 'bash', 'zsh'])", 'zsh'), 'a shell name list is not a zsh dependency');
  assert.ok(!hit("/^(?:python|node|osascript)$/", 'macos-tools'), 'an interpreter name list is not an osascript call');
  assert.ok(hit("spawnSync('osascript', ['-e', s])", 'macos-tools'));
});

test('whole-line comments are skipped except for users-path; a shebang is not a comment', () => {
  assert.equal(seamsIn('// launchctl bootstrap gui/501 x.plist').size, 0);
  assert.equal(seamsIn('# brew install x').size, 0);
  assert.equal(seamsIn(' * runs sandbox-exec').size, 0);
  assert.ok(seamsIn('// built under /Users/x/src').has('users-path'));
  assert.ok(seamsIn('#!/usr/bin/env zsh\necho hi').has('zsh'));
  assert.equal(seamsIn("a('launchctl')\r\nb('launchctl')").get('launchd'), 2, 'CRLF splits lines');
});

test('measure() reads tracked sources only, skips test dirs, and reports deleted files apart', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-seams-'));
  try {
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
    git('init', '-q');
    mkdirSync(join(root, 'lib', 'test'), { recursive: true });
    writeFileSync(join(root, 'lib', 'a.mjs'), "spawn('osascript', ['-e', s]);\n");
    writeFileSync(join(root, 'lib', 'gone.mjs'), "spawn('launchctl', []);\n");
    writeFileSync(join(root, 'lib', 'test', 'a.test.mjs'), "spawn('launchctl', []);\n");
    writeFileSync(join(root, 'notes.md'), 'launchctl\n');
    writeFileSync(join(root, 'untracked.mjs'), "spawn('launchctl', []);\n");
    git('add', 'lib', 'notes.md');
    rmSync(join(root, 'lib', 'gone.mjs'));
    const r = measure(root);
    assert.equal(r.population, 2);
    assert.equal(r.read, 1);
    assert.deepEqual(r.missing, ['lib/gone.mjs']);
    assert.deepEqual(r.classes['macos-tools'].files, { 'lib/a.mjs': 1 });
    assert.deepEqual(r.classes.launchd.files, {}, 'tests, docs, untracked and deleted files do not count');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('listedFiles() fails closed on a missing section or an unknown class', () => {
  assert.throws(() => listedFiles('# no table here'), /Ratchet allow-list/);
  assert.throws(() => listedFiles('## Ratchet allow-list\n| launchctl | `a.mjs` |\n'), /unknown class "launchctl"/);
  const m = listedFiles('## Ratchet allow-list\n| launchd | `a.mjs` |\n## Next\n| zsh | `b.mjs` |\n');
  assert.deepEqual([...m.get('launchd')], ['a.mjs']);
  assert.equal(m.get('zsh').size, 0, 'rows after the section end are not read');
});

test('every seam in tracked source is in a file the doc lists, and every listed file still has it', () => {
  const r = measure(CW);
  const listed = listedFiles(readFileSync(DOC, 'utf8'));
  // Floor: the reader read the tree and found seams known to be there.
  assert.ok(r.read > 100 && r.read === r.population - r.missing.length, `read ${r.read} of ${r.population}`);
  assert.ok(r.classes.launchd.files['monitor/install-agents.mjs'], 'install-agents.mjs must register as a launchd seam');
  assert.ok(r.classes.keychain.files['lib/secrets.mjs'], 'lib/secrets.mjs must register as a keychain seam');
  const unlisted = [];
  const stale = [];
  for (const { id } of SEAM_CLASSES) {
    const found = r.classes[id].files;
    for (const p of Object.keys(found)) if (!listed.get(id).has(p)) unlisted.push(`${id}: ${p} (${found[p]} lines)`);
    for (const p of listed.get(id)) if (!found[p] && !r.missing.includes(p)) stale.push(`${id}: ${p}`);
  }
  assert.deepEqual(unlisted, [], 'new macOS-only seams: add each to docs/PLATFORM-SEAMS.md with its portable path or limit');
  assert.deepEqual(stale, [], 'listed in docs/PLATFORM-SEAMS.md but no longer a seam: remove the row');
});
