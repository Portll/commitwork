// bin/tree-integrity.mjs — every rule in both directions, over git repositories and installed-package
// RECORDs built here at test time. Nothing in them is executed.
import { test, describe, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, chmodSync, realpathSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scanTree, parseRecord, parseRecordLine, kindOf, binaryMagic, GIT_RULES, RECORD_RULES, RULE_CWE } from '../tree-integrity.mjs';
import { parseRuleCounts } from '../lib/report-parsers/sast-lint.mjs';
import { gitChildEnv } from '../lib/git-env.mjs';
import { _treeIntegrityCounts } from '../../monitor/extractors.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(REPO, 'bin', 'tree-integrity.mjs');
const CLI = join(REPO, 'bin', 'commitwork.mjs');
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

let savedMode;
beforeEach(() => { savedMode = process.env.CW_TARGET_MODE; delete process.env.CW_TARGET_MODE; });
afterEach(() => { if (savedMode === undefined) delete process.env.CW_TARGET_MODE; else process.env.CW_TARGET_MODE = savedMode; });
const webroot = (fn) => { process.env.CW_TARGET_MODE = 'webroot'; try { return fn(); } finally { delete process.env.CW_TARGET_MODE; } };

function tree(files, prefix = 'cw-treeint-') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
// Hooks off, signing off, one identity, and none of the caller's repository variables.
const git = (dir, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main',
  '-c', 'user.name=Portll', '-c', 'user.email=fx@example.invalid', '-C', dir, ...args], { encoding: 'utf8', env: gitChildEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'] });
function repo(files) {
  const root = tree(files);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'deploy');
  return root;
}
const at = (r, path, rule) => r.findings.find((f) => f.path === path && f.rule === rule);
const b64 = (buf) => createHash('sha256').update(buf).digest('base64url');

// A site-packages with one distribution whose RECORD matches what is on disk.
function site(extra = {}, { recordLines = null, installer = 'pip' } = {}) {
  const files = {
    'pkg/__init__.py': 'VERSION = "1.0"\n',
    'pkg/core.py': 'def run():\n    return 1\n',
    'pkg/data/table.json': '{"a": 1}\n',
    'pkg-1.0.dist-info/METADATA': 'Metadata-Version: 2.1\nName: pkg\nVersion: 1.0\n',
    'pkg-1.0.dist-info/INSTALLER': `${installer}\n`,
  };
  const lines = recordLines || [
    ...Object.entries(files).map(([p, body]) => `${p},sha256=${b64(Buffer.from(body))},${Buffer.byteLength(body)}`),
    'pkg-1.0.dist-info/RECORD,,',
    'pkg/__pycache__/core.cpython-312.pyc,,',
  ];
  const root = tree({ ...Object.fromEntries(Object.entries(files).map(([p, b]) => [`venv/lib/python3.12/site-packages/${p}`, b])) });
  const sp = join(root, 'venv/lib/python3.12/site-packages');
  writeFileSync(join(sp, 'pkg-1.0.dist-info/RECORD'), `${lines.join('\n')}\n`);
  for (const [rel, body] of Object.entries(extra)) { mkdirSync(dirname(join(sp, rel)), { recursive: true }); writeFileSync(join(sp, rel), body); }
  return { root, sp, rel: (p) => `venv/lib/python3.12/site-packages/${p}` };
}

describe('pieces', () => {
  test('RECORD lines parse as the csv module writes them, and a bad line is counted, never dropped silently', () => {
    assert.deepEqual(parseRecordLine('a/b.py,sha256=abc,12'), ['a/b.py', 'sha256=abc', '12']);
    assert.deepEqual(parseRecordLine('"a/b,c.py",sha256=abc,12'), ['a/b,c.py', 'sha256=abc', '12']);
    assert.deepEqual(parseRecordLine('"say ""hi"".txt",,'), ['say "hi".txt', '', '']);
    assert.equal(parseRecordLine('"unterminated,,'), null);
    const r = parseRecord('a.py,sha256=AAAA,1\nRECORD,,\n"broken,,\nb.py,md5=AAAA,1\nc.py,sha256=not base64!,1\n');
    assert.equal(r.entries.length, 3);
    assert.equal(r.bad, 2);
    assert.equal(r.unsupported, 1);
    assert.equal(r.entries[0].algo, 'sha256');
    assert.equal(r.entries[1].algo, undefined, 'a line without a hash is unhashed, not malformed');
  });

  test('kinds: code by name, control by name, executables by magic or by exec bit with a shebang', () => {
    assert.equal(kindOf('a/x.php', null), 'code');
    assert.equal(kindOf('a/.htaccess', null), 'control');
    assert.equal(kindOf('a/.gitignore', null), 'control');
    assert.equal(kindOf('a/photo.jpg', null, Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'other');
    assert.equal(kindOf('a/kworker', null, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])), 'executable');
    assert.equal(kindOf('a/run', { mode: 0o755 }, Buffer.from('#!/bin/sh')), 'executable');
    assert.equal(kindOf('a/notes', { mode: 0o644 }, Buffer.from('#!/bin/sh')), 'other', 'a shebang without the exec bit runs nothing');
    assert.ok(binaryMagic(Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])));
    assert.ok(!binaryMagic(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34])), 'a Java class file is not a fat Mach-O');
  });

  test('every rule carries a CWE and a severity table', () => {
    for (const r of [...GIT_RULES, ...RECORD_RULES]) assert.equal(RULE_CWE[r], 'CWE-345', r);
  });
});

describe('git drift on a deployed web root', () => {
  const base = { 'index.php': '<?php echo 1;\n', 'lib/util.php': '<?php function f() {}\n', '.htaccess': 'Require all denied\n',
    'readme.txt': 'hello\n', 'assets/app.js': 'console.log(1);\n', '.gitignore': 'cache/\n' };

  test('untracked code, modified and deleted tracked files each fire, at the severity their kind earns', () => {
    const root = repo(base);
    writeFileSync(join(root, 'lib/x.php'), '<?php // dropped\n');
    writeFileSync(join(root, 'kworker'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0]));
    writeFileSync(join(root, 'notes.txt'), 'not code\n');
    mkdirSync(join(root, 'uploads'));
    writeFileSync(join(root, 'uploads/.gitignore'), '*\n');
    writeFileSync(join(root, 'index.php'), '<?php echo 1; eval($_POST["x"]);\n');
    writeFileSync(join(root, 'readme.txt'), 'hello, edited\n');
    unlinkSync(join(root, 'lib/util.php'));
    unlinkSync(join(root, '.htaccess'));
    const r = webroot(() => scanTree(root));
    assert.equal(r.summary.mode, 'webroot');
    assert.equal(r.summary.git.state, 'measured');
    assert.match(r.summary.git.head, /^[0-9a-f]{40}$/);
    assert.equal(at(r, 'lib/x.php', 'git-untracked-code').sev, 'high');
    assert.match(at(r, 'kworker', 'git-untracked-code').detail, /^executable/);
    assert.match(at(r, 'uploads/.gitignore', 'git-untracked-code').detail, /ignored only by uploads\/\.gitignore, which is not on the record/,
      'an untracked ignore file that ignores itself is how a drop hides itself');
    assert.equal(at(r, 'notes.txt', 'git-untracked-code'), undefined, 'untracked data is counted, not reported');
    assert.equal(r.summary.git.untracked.other, 1);
    assert.equal(at(r, 'index.php', 'git-modified').sev, 'high');
    assert.equal(at(r, 'readme.txt', 'git-modified').sev, 'med');
    assert.equal(at(r, 'lib/util.php', 'git-deleted').sev, 'med');
    assert.equal(at(r, '.htaccess', 'git-deleted').sev, 'high', 'a deleted .htaccess is a server rule gone');
    assert.equal(r.summary.partial, undefined, JSON.stringify(r.summary.partialReasons));
  });

  test('an untouched checkout produces none, and ignored paths are listed, never judged', () => {
    const root = repo(base);
    mkdirSync(join(root, 'cache'));
    writeFileSync(join(root, 'cache/compiled.php'), '<?php return [];\n');
    const r = webroot(() => scanTree(root));
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.git.compared, Object.keys(base).length);
    assert.ok(r.summary.filesScanned > 0);
    assert.deepEqual(r.summary.git.ignored.sample, ['cache/']);
    assert.equal(parseRuleCounts(write(r)).sev, 'ok');
  });

  test('the scanning machine\'s global excludes do not decide what is untracked on the target', () => {
    const root = repo(base);
    writeFileSync(join(root, 'shell.php'), '<?php\n');
    const home = tree({ 'global-ignore': '*.php\n' });
    writeFileSync(join(home, '.gitconfig'), `[core]\n\texcludesFile = ${join(home, 'global-ignore')}\n`);
    const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.GIT_CONFIG_GLOBAL;
    try {
      assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '-q', 'shell.php'], { env: gitChildEnv(process.env) }).status, 0,
        'the global excludes file was not in force, so this test proves nothing');
      assert.ok(at(webroot(() => scanTree(root)), 'shell.php', 'git-untracked-code'));
    } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  });

  test('a control file a tracked, unchanged .gitignore ignores is declared outside the record and only counted', () => {
    const root = repo({ ...base, '.gitignore': 'cache/\n/.user.ini\n' });
    writeFileSync(join(root, '.user.ini'), 'memory_limit = 256M\n');
    const r = webroot(() => scanTree(root));
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.git.untracked.declaredIgnoredControl, 1);
    writeFileSync(join(root, '.gitignore'), 'cache/\n/.user.ini\n# edited\n');
    const e = webroot(() => scanTree(root));
    assert.ok(at(e, '.gitignore', 'git-modified'));
    assert.match(at(e, '.user.ini', 'git-untracked-code').detail, /ignored only by \.gitignore, which is not on the record/,
      'a rule in a modified ignore file is not the record\'s rule');
  });

  test('untracked is measured against HEAD, not the index: a staged drop fires, an unstaged HEAD file does not', () => {
    const root = repo(base);
    writeFileSync(join(root, 'lib/staged.php'), '<?php\n');
    git(root, 'add', 'lib/staged.php');
    git(root, 'rm', '-q', '--cached', 'index.php');
    const r = webroot(() => scanTree(root));
    assert.match(at(r, 'lib/staged.php', 'git-untracked-code').detail, /staged in the index without a commit/, '`git add` alone must not hide a drop');
    assert.deepEqual(r.findings.map((f) => f.path), ['lib/staged.php'], 'index.php is HEAD\'s and unchanged, so it is neither new nor modified');
  });

  test('a line-ending conversion git would undo is not a modification', () => {
    const root = repo({ '.gitattributes': '*.txt text eol=crlf\n', 'a.txt': 'one\ntwo\n', 'b.php': '<?php\n' });
    unlinkSync(join(root, 'a.txt'));
    git(root, 'checkout', '--', 'a.txt');
    assert.ok(readFileSync(join(root, 'a.txt'), 'latin1').includes('\r\n'), 'the checkout did not write CRLF, so this test proves nothing');
    const r = webroot(() => scanTree(root));
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.git.convertedOnly, 1);
  });

  test('a symbolic link retargeted, and a file replaced by one, are modifications', () => {
    const root = tree({ 'a.php': '<?php\n', 'b.php': '<?php\n' });
    symlinkSync('a.php', join(root, 'link.php'));
    git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'deploy');
    unlinkSync(join(root, 'link.php'));
    symlinkSync('/etc/hosts', join(root, 'link.php'));
    unlinkSync(join(root, 'b.php'));
    symlinkSync('a.php', join(root, 'b.php'));
    const r = webroot(() => scanTree(root));
    assert.match(at(r, 'link.php', 'git-modified').detail, /points somewhere other/);
    assert.match(at(r, 'b.php', 'git-modified').detail, /replaced by a symbolic link/);
  });

  test('a sparse checkout\'s absent paths are not deletions', () => {
    const root = repo({ 'keep/a.php': '<?php\n', 'away/b.php': '<?php\n' });
    git(root, 'sparse-checkout', 'set', '--no-cone', '/keep/');
    const r = webroot(() => scanTree(root));
    assert.equal(at(r, 'away/b.php', 'git-deleted'), undefined);
    assert.equal(r.summary.git.sparse, 1);
  });

  test('outside webroot mode the git rules are not applicable, with the reason, on the same drifted tree', () => {
    const root = repo(base);
    writeFileSync(join(root, 'lib/x.php'), '<?php\n');
    unlinkSync(join(root, 'readme.txt'));
    const r = scanTree(root);
    assert.equal(r.summary.mode, 'repo');
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.summary.rulesNotApplicable, [...GIT_RULES, ...RECORD_RULES]);
    assert.match(r.summary.notApplicableReasons.git, /only on a deployed web root/);
    assert.equal(r.summary.applicable, false);
    const p = parseRuleCounts(write(r));
    assert.equal(p.sev, 'skip', 'n/a is neither a pass nor a void');
    assert.match(p.summary, /only on a deployed web root/);
    const x = _treeIntegrityCounts(dirname(write(r)), 'tree-integrity.json');
    assert.equal(x.nosrc, true);
    assert.equal(x.total, 0);
    assert.match(x.reason, /no \*\.dist-info\/RECORD/);
  });

  test('a web root with no record at all is a void, not a pass and not n/a', () => {
    const root = tree({ 'index.php': '<?php\n' });
    const r = webroot(() => scanTree(root));
    assert.match(r.summary.voidReason, /no record to compare/);
    assert.equal(r.summary.applicable, true);
    assert.equal(parseRuleCounts(write(r)).sev, 'noscan');
  });

  test('HEAD with no commit is not applicable; a directory inside another work tree is unmeasured and fails closed', () => {
    const empty = tree({ 'a.php': '<?php\n' });
    git(empty, 'init', '-q');
    assert.match(webroot(() => scanTree(empty)).summary.notApplicableReasons.git, /HEAD names no commit/);
    const outer = repo({ 'site/index.php': '<?php\n' });
    mkdirSync(join(outer, 'site/.git'));
    const r = webroot(() => scanTree(join(outer, 'site')));
    assert.equal(r.summary.git.state, 'unmeasured');
    assert.deepEqual(r.summary.unmeasured, GIT_RULES);
    assert.equal(r.summary.partial, true);
    assert.match(r.summary.partialReasons[0], /git drift unmeasured/);
    assert.equal(parseRuleCounts(write(r)).sev, 'noscan');
  });

  test('an unreadable tracked file is a partial read, never a clean one', (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('root reads a mode-000 file, so the condition cannot be built');
    const root = repo({ 'a.php': '<?php\n', 'b.php': '<?php\n' });
    chmodSync(join(root, 'b.php'), 0o000);
    try {
      const r = webroot(() => scanTree(root));
      assert.equal(r.summary.partial, true);
      assert.ok(r.summary.unreadableFiles.some((u) => u.path === 'b.php'));
      assert.equal(parseRuleCounts(write(r)).sev, 'noscan');
    } finally { chmodSync(join(root, 'b.php'), 0o644); }
  });
});

describe('RECORD verification', () => {
  test('a RECORD that matches the tree verifies every hashed file and produces none', () => {
    const s = site();
    const r = scanTree(s.root);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.record.state, 'measured');
    assert.equal(r.summary.record.verified, 5);
    assert.equal(r.summary.record.unhashed, 2);
    assert.equal(r.summary.record.unhashedAbsent, 1, 'the absent .pyc is unhashed by design and not a finding');
    assert.deepEqual(r.summary.rulesNotApplicable, GIT_RULES, 'git drift stays n/a in repo mode beside a measured RECORD');
    assert.equal(parseRuleCounts(write(r)).sev, 'ok');
  });

  test('a tampered, a missing and an unlisted file each fire; bytecode caches do not', () => {
    const s = site({ 'pkg/backdoor.py': 'import os\n', 'pkg/__pycache__/backdoor.cpython-312.pyc': 'x' });
    const tampered = 'def run():\n    return 1\nCW_TAMPER_MARKER = 2\n';
    writeFileSync(join(s.sp, 'pkg/core.py'), tampered);
    writeFileSync(join(s.sp, 'pkg/data/table.json'), '{"a": 2}\n');
    unlinkSync(join(s.sp, 'pkg/__init__.py'));
    const r = scanTree(s.root);
    const m = at(r, s.rel('pkg/core.py'), 'record-hash-mismatch');
    assert.equal(m.sev, 'high');
    assert.ok(m.detail.endsWith(`sha256 in ${s.rel('pkg-1.0.dist-info/RECORD')} (24 bytes recorded, ${Buffer.byteLength(tampered)} on disk)`), m.detail);
    assert.equal(at(r, s.rel('pkg/data/table.json'), 'record-hash-mismatch').sev, 'med');
    assert.equal(at(r, s.rel('pkg/__init__.py'), 'record-file-missing').sev, 'med');
    assert.equal(at(r, s.rel('pkg/backdoor.py'), 'record-unlisted-file').sev, 'high');
    assert.equal(r.summary.record.bytecodeUnlisted, 1);
    assert.equal(r.findings.length, 4);
    assert.ok(!JSON.stringify(r).includes('CW_TAMPER_MARKER'), 'file content reached the report');
    const x = _treeIntegrityCounts(dirname(write(r)), 'tree-integrity.json');
    assert.equal(x.total, 4);
    assert.equal(x.high, 2);
    assert.deepEqual(Object.keys(x.byRule).sort(), ['record-file-missing', 'record-hash-mismatch', 'record-unlisted-file']);
  });

  test('a listed file replaced by a link or a directory is a mismatch, and the link is not followed', () => {
    const s = site();
    unlinkSync(join(s.sp, 'pkg/core.py'));
    symlinkSync('/etc/hosts', join(s.sp, 'pkg/core.py'));
    unlinkSync(join(s.sp, 'pkg/__init__.py'));
    mkdirSync(join(s.sp, 'pkg/__init__.py'));
    const r = scanTree(s.root);
    assert.match(at(r, s.rel('pkg/core.py'), 'record-hash-mismatch').detail, /symbolic link \(not followed\)/);
    assert.match(at(r, s.rel('pkg/__init__.py'), 'record-hash-mismatch').detail, /directory/);
  });

  test('a namespace directory shared by two distributions is judged against both RECORDs', () => {
    const s = site({ 'ns/a.py': 'A = 1\n', 'ns/b.py': 'B = 1\n', 'nsa-1.dist-info/METADATA': 'Name: nsa\n', 'nsb-1.dist-info/METADATA': 'Name: nsb\n' });
    writeFileSync(join(s.sp, 'nsa-1.dist-info/RECORD'), `ns/a.py,sha256=${b64(Buffer.from('A = 1\n'))},6\nnsa-1.dist-info/METADATA,sha256=${b64(Buffer.from('Name: nsa\n'))},10\nnsa-1.dist-info/RECORD,,\n`);
    writeFileSync(join(s.sp, 'nsb-1.dist-info/RECORD'), `ns/b.py,sha256=${b64(Buffer.from('B = 1\n'))},6\nnsb-1.dist-info/METADATA,sha256=${b64(Buffer.from('Name: nsb\n'))},10\nnsb-1.dist-info/RECORD,,\n`);
    const r = scanTree(s.root);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.record.records, 3);
    writeFileSync(join(s.sp, 'ns/c.py'), 'C = 1\n');
    assert.match(at(scanTree(s.root), s.rel('ns/c.py'), 'record-unlisted-file').detail, /nsa-1, nsb-1 install/);
  });

  test('a distribution installed without a RECORD keeps its files out of the unlisted rule, by top_level.txt or by a stated partial', () => {
    const s = site({ 'pkg/legacy_extra.py': 'x\n', 'legacy-1.egg-info/top_level.txt': 'pkg\n' });
    const r = scanTree(s.root);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.record.foreignUnlisted, 1);
    const t = site({ 'pkg/legacy_extra.py': 'x\n', 'legacy-1.egg-info/PKG-INFO': 'Name: legacy\n' });
    const u = scanTree(t.root);
    assert.deepEqual(u.findings, []);
    assert.equal(u.summary.partial, true);
    assert.match(u.summary.record.unlistedNotJudged[0].reason, /legacy-1\.egg-info/);
  });

  test('a conda-installed distribution is counted and not verified, because conda rewrites prefixes', () => {
    const s = site({}, { installer: 'conda' });
    writeFileSync(join(s.sp, 'pkg/core.py'), 'rewritten by conda\n');
    writeFileSync(join(s.sp, 'pkg/extra.py'), 'x\n');
    const r = scanTree(s.root);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.summary.record.conda, { distributions: 1, names: ['pkg-1.0'] });
    assert.match(r.summary.voidReason, /no file it lists was examined/, 'a RECORD that verified nothing is a void');
  });

  test('a path that leaves the tree is never read; an unparseable or unsupported line is a partial read', () => {
    const outside = tree({ 'secret.txt': 'outside\n' });
    // five levels up from site-packages is the temp directory both trees live in
    const rel = `../../../../../${basename(outside)}/secret.txt`;
    const s = site({}, { recordLines: [`pkg/core.py,sha256=${b64(Buffer.from('def run():\n    return 1\n'))},24`,
      `pkg/data/table.json,sha256=${b64(Buffer.from('{"a": 1}\n'))},9`, `${rel},sha256=AAAA,8`, 'pkg/__init__.py,md5=AAAA,1', '"broken,,'] });
    const r = scanTree(s.root);
    assert.equal(r.summary.record.outOfTree, 1);
    assert.equal(r.summary.record.unsupportedHash, 1);
    assert.equal(r.summary.partial, true);
    assert.ok(r.summary.partialReasons.some((x) => /unparseable/.test(x)));
    assert.ok(r.summary.partialReasons.some((x) => /cannot compute/.test(x)));
    assert.equal(parseRuleCounts(write(r)).sev, 'noscan', 'zero findings beside a partial read is a void');
  });

  test('skips are named and read at call time', () => {
    const s = site();
    const r = scanTree(s.root);
    assert.equal(r.summary.record.records, 1);
    process.env.CW_INTEGRITY_SKIP_DIRS = 'venv';
    try {
      const k = scanTree(s.root);
      assert.ok(k.summary.skippedPaths.includes('venv'));
      assert.equal(k.summary.applicable, false);
    } finally { delete process.env.CW_INTEGRITY_SKIP_DIRS; }
  });
});

describe('the report', () => {
  test('is deterministic over the same tree', () => {
    const s = site({ 'pkg/z.py': 'z\n', 'pkg/a.py': 'a\n' });
    writeFileSync(join(s.sp, 'pkg/core.py'), 'changed\n');
    assert.equal(JSON.stringify(scanTree(s.root)), JSON.stringify(scanTree(s.root)));
    const paths = scanTree(s.root).findings.map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort());
  });

  test('the parser reads rows even when the lane also says it does not apply', () => {
    const dir = tree({});
    const p = join(dir, 'tree-integrity.json');
    writeFileSync(p, JSON.stringify({ tool: 'tree-integrity', summary: { applicable: false, filesScanned: 1 }, findings: [{ rule: 'git-modified', path: 'a', sev: 'high' }] }));
    assert.equal(parseRuleCounts(p).sev, 'high');
  });

  test('the CLI prints the report, reads CW_TARGET_MODE, and exits 2 on a path that is not a directory', () => {
    const root = repo({ 'a.php': '<?php\n' });
    writeFileSync(join(root, 'b.php'), '<?php\n');
    const env = { ...process.env, CW_TARGET_MODE: 'webroot' };
    const out = JSON.parse(execFileSync(process.execPath, [SCANNER, root], { encoding: 'utf8', env, timeout: 60_000 }));
    assert.equal(out.tool, 'tree-integrity');
    assert.ok(at(out, 'b.php', 'git-untracked-code'));
    assert.equal(spawnSync(process.execPath, [SCANNER, join(root, 'a.php')], { timeout: 60_000 }).status, 2);
    assert.equal(spawnSync(process.execPath, [SCANNER, join(root, 'absent')], { timeout: 60_000 }).status, 2);
  });
});

describe('commitwork hands the lane its target mode', () => {
  const baseline = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
  const check = baseline.checks.find((c) => c.id === 'tree-integrity');
  const manifest = (dir) => {
    const mf = join(dir, 'manifest.json');
    writeFileSync(mf, JSON.stringify({ repo: 'fx', checks: [check], groups: { all: ['tree-integrity'] } }));
    return mf;
  };
  const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });

  test('scan --webroot sets webroot, and scan without it pins repo over an exported value', () => {
    const root = repo({ 'index.php': '<?php\n' });
    writeFileSync(join(root, 'shell.php'), '<?php\n');
    const work = tree({});
    const mf = manifest(work);
    const a = cli(['scan', '--manifest', mf, '--root', root, '--webroot', '--out', join(work, 'a')], {});
    assert.equal(a.status, 0, a.stderr);
    const ra = JSON.parse(readFileSync(join(work, 'a', basename(root), 'tree-integrity.json'), 'utf8'));
    assert.equal(ra.summary.mode, 'webroot');
    assert.ok(at(ra, 'shell.php', 'git-untracked-code'));
    const b = cli(['scan', '--manifest', mf, '--root', root, '--out', join(work, 'b')], { CW_TARGET_MODE: 'webroot' });
    assert.equal(b.status, 0, b.stderr);
    const rb = JSON.parse(readFileSync(join(work, 'b', basename(root), 'tree-integrity.json'), 'utf8'));
    assert.equal(rb.summary.mode, 'repo', 'an inherited CW_TARGET_MODE must not turn git drift on in a repository scan');
    assert.deepEqual(rb.findings, []);
  });

  test('the run path pins repo over an exported value', () => {
    const root = repo({ 'index.php': '<?php\n' });
    writeFileSync(join(root, 'shell.php'), '<?php\n');
    const work = tree({});
    const r = cli(['run', 'all', '--manifest', manifest(work), '--repo', root], { CW_TARGET_MODE: 'webroot', CW_REPORT_DIR: join(work, 'out') });
    const rep = JSON.parse(readFileSync(join(work, 'out', 'tree-integrity.json'), 'utf8'));
    assert.equal(rep.summary.mode, 'repo', r.stdout + r.stderr);
    assert.deepEqual(rep.findings, []);
  });
});

function write(report) {
  const dir = tree({}, 'cw-treeint-rep-');
  const p = join(dir, 'tree-integrity.json');
  writeFileSync(p, JSON.stringify(report));
  writeFileSync(`${p}.exit`, '0\n');
  return p;
}
