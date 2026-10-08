// Tests for the panel import closure and restart pre-flight (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importClosure } from '../lib/panel-closure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT = join(HERE, '..', 'lib', 'panel-preflight.mjs');

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-closure-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
};

test('the closure follows ./ and ../ imports and reports what it cannot read', () => {
  const root = tree({
    'app/main.mjs': "import { a } from './a.mjs';\nimport '../shared/b.mjs';\nimport { c } from './missing.mjs';\nexport const x = a;\n",
    'app/a.mjs': "import { b } from '../shared/b.mjs';\nexport const a = b;\n",
    'shared/b.mjs': 'export const b = 1;\n',
  });
  const r = importClosure(join(root, 'app', 'main.mjs'));
  assert.deepEqual(r.files.map((f) => f.slice(root.length + 1)), ['app/a.mjs', 'app/main.mjs', 'shared/b.mjs']);
  assert.deepEqual(r.unknown.map((u) => [u.file.slice(root.length + 1), u.reason]), [['app/missing.mjs', 'ENOENT']]);
});

test("the real panel's closure reaches beyond admin/", () => {
  const files = importClosure(join(HERE, '..', 'serve.mjs')).files.map((f) => f.split('/commitwork/').pop());
  for (const want of ['lib/webauthn.mjs', 'monitor/issue-store.mjs', 'lib/html-escape.mjs']) {
    assert.ok(files.some((f) => f.endsWith(want)), `closure must include ${want}`);
  }
});

const preflight = (root, entry) => spawnSync(process.execPath, [PREFLIGHT, join(root, entry)], { encoding: 'utf8' });

test('pre-flight passes a tree that loads and boots', () => {
  const root = tree({ 'm.mjs': "import { a } from './a.mjs';\nconsole.log(`cw-panel-preflight: ready ${JSON.stringify({ ports: [a] })}`);\n", 'a.mjs': 'export const a = 1;\n' });
  const r = preflight(root, 'm.mjs');
  assert.equal(r.status, 0, r.stderr);
});

test('pre-flight refuses a missing export that --check would pass', () => {
  const root = tree({ 'm.mjs': "import { nope } from './a.mjs';\nconsole.log(nope);\n", 'a.mjs': 'export const a = 1;\n' });
  assert.equal(spawnSync(process.execPath, ['--check', join(root, 'm.mjs')]).status, 0, 'control: syntax alone is fine');
  const r = preflight(root, 'm.mjs');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.\/a\.mjs does not export 'nope'/);
});

test('pre-flight refuses a missing module', () => {
  const root = tree({ 'm.mjs': "import { a } from './gone.mjs';\nconsole.log(a);\n" });
  const r = preflight(root, 'm.mjs');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gone\.mjs: could not be read \(ENOENT\)/);
});
