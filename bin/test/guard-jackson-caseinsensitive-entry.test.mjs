// bin/guard-jackson-caseinsensitive.mjs, run as the manifest runs it: a root dir, an exit code, a
// line on stdout or stderr. Pins the four outcomes — VIOLATION (exit 1, every hit named by
// path:line), OK (exit 0 with the scanned count), SKIPPED (exit 0, and never worded as OK),
// UNREADABLE / NOT RUN (exit 2: a file, directory or root it could not read, never OK and never
// SKIPPED) — and the two exclusions the walk promises (node_modules/build are not ours; disabling or
// mentioning the feature is not enabling it). Fixture trees are synthetic and live in tmp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(CW, 'bin', 'guard-jackson-caseinsensitive.mjs');

function tree(t, files, { lock = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-jackson-guard-'));
  // rm cannot list a 000 directory, so the modes come back first
  t.after(() => { for (const rel of lock) chmodSync(join(root, rel), 0o700); rmSync(root, { recursive: true, force: true }); });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  for (const rel of lock) chmodSync(join(root, rel), 0o000);
  return root;
}

// NTFS cannot deny the owner by mode, and root reads through a 000 mode anyway.
const CAN_DENY = process.platform !== 'win32' && process.getuid?.() !== 0;
const ON = 'spring:\n  jackson:\n    mapper:\n      accept-case-insensitive-properties: true\n';

const guard = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('enabling the feature in Java or Spring config fails the guard and names every hit by path:line', (t) => {
  const root = tree(t, {
    'src/main/java/app/Config.java': [
      'package app;',
      'class Config {',
      '  void a(ObjectMapper m) { m.configure(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES, true); }',
      '  void b(JsonMapper.Builder b) { b.enable(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES); }',
      '}',
    ].join('\n'),
    'src/main/resources/application.yml': 'spring:\n  jackson:\n    mapper:\n      accept-case-insensitive-properties: true\n',
    'src/main/resources/application.properties': 'spring.jackson.mapper.accept_case_insensitive_properties=true\n',
  });
  const r = guard(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /GUARD FAILED — ACCEPT_CASE_INSENSITIVE_PROPERTIES enabled/);
  assert.match(r.err, /Config\.java:3: .*configure\(MapperFeature\.ACCEPT_CASE_INSENSITIVE_PROPERTIES, true\)/);
  assert.match(r.err, /Config\.java:4: .*\.enable\(MapperFeature\.ACCEPT_CASE_INSENSITIVE_PROPERTIES\)/);
  assert.match(r.err, /application\.yml:4: accept-case-insensitive-properties: true/);
  assert.match(r.err, /application\.properties:1: /);
  assert.equal(r.err.split('\n').filter((l) => /^ {2}\//.test(l)).length, 4, 'exactly the four enabling lines');
});

test('disabling or merely mentioning the feature is clean, and OK carries the scanned count', (t) => {
  const root = tree(t, {
    'src/Config.java': 'm.configure(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES, false);\n// ACCEPT_CASE_INSENSITIVE_PROPERTIES stays off\n',
    'conf/app.yaml': 'accept-case-insensitive-properties: false\n',
    'README.md': 'accept-case-insensitive-properties: true is how you would break it\n',
  });
  const r = guard(root);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /guard-jackson-caseinsensitive: OK — .* not enabled in 2 scanned file\(s\)/, 'the .md is not a scanned type');
  assert.equal(r.err, '');
});

test('node_modules, build, out and .git are not walked — a vendored enablement is not ours', (t) => {
  const on = 'accept-case-insensitive-properties: true\n';
  const root = tree(t, {
    'node_modules/dep/app.yml': on, 'build/app.yml': on, 'out/app.yml': on, '.git/app.yml': on,
    'src/app.yml': 'server:\n  port: 8080\n',
  });
  const r = guard(root);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /OK — .* in 1 scanned file\(s\)/);
});

test('a tree with nothing of the scanned types says SKIPPED, and never OK', (t) => {
  const root = tree(t, { 'README.md': '# nothing to scan\n', 'src/index.js': 'export {};\n' });
  const r = guard(root);
  assert.equal(r.code, 0);
  assert.match(r.out, /SKIPPED — no \.java\/\.yml\/\.properties files under .*this is NOT a clean result/);
  assert.doesNotMatch(r.out, /: OK —/);
});

test('an unreadable config file is named and exits 2 — the guard never says OK over a file it could not read', { skip: !CAN_DENY && 'cannot deny a read here' }, (t) => {
  const root = tree(t, { 'src/main/resources/application.yml': ON, 'src/App.java': 'class App {}\n' },
    { lock: ['src/main/resources/application.yml'] });
  const r = guard(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /guard-jackson-caseinsensitive: UNREADABLE — 1 path\(s\) under .* could not be read/);
  assert.match(r.err, /^ {2}.*src\/main\/resources\/application\.yml: EACCES$/m);
  assert.doesNotMatch(r.out + r.err, /: OK —|SKIPPED/);
});

test('an unreadable directory is named the same way, whatever it holds', { skip: !CAN_DENY && 'cannot deny a read here' }, (t) => {
  const root = tree(t, { 'src/main/resources/application.yml': ON, 'src/App.java': 'class App {}\n' },
    { lock: ['src/main/resources'] });
  const r = guard(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^ {2}.*src\/main\/resources: EACCES$/m);
  assert.doesNotMatch(r.out + r.err, /: OK —|SKIPPED/);
});

test('a violation still fails with exit 1 when something else was unreadable, and the unread path is named too', { skip: !CAN_DENY && 'cannot deny a read here' }, (t) => {
  const root = tree(t, { 'a/application.yml': ON, 'b/application.yml': 'server:\n  port: 8080\n' }, { lock: ['b/application.yml'] });
  const r = guard(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /GUARD FAILED[\s\S]*a\/application\.yml:4: /);
  assert.match(r.err, /UNREADABLE — 1 path\(s\)[\s\S]*b\/application\.yml: EACCES/);
});

test('a root that does not exist is a missing input (exit 2), never SKIPPED and never OK', (t) => {
  const root = join(tree(t, {}), 'nope');
  const r = guard(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /guard-jackson-caseinsensitive: NOT RUN — .*nope could not be read \(ENOENT\)/);
  assert.doesNotMatch(r.out + r.err, /: OK —|SKIPPED/);
});
