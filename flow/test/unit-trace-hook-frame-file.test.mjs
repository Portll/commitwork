// The hook's attribution parts: which file a stack frame names, and where that file sits under the
// root. Windows frames are tested on every platform through the `win` argument, because the defect
// these guard was invisible from POSIX: on Windows every actor came back null.
// Loaded with CW_FLOW_TRACE unset, so nothing is patched in this process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hookPath } from '../runtime.mjs';

const saved = process.env.CW_FLOW_TRACE;
delete process.env.CW_FLOW_TRACE;
const hook = createRequire(import.meta.url)(hookPath());
if (saved !== undefined) process.env.CW_FLOW_TRACE = saved;

test('frameFile reads POSIX frames, named and anonymous, CommonJS and ESM', () => {
  // Arrange
  const cases = [
    ['    at go (/repo/bin/deep.js:2:30)', '/repo/bin/deep.js'],
    ['    at /repo/bin/entry.cjs:1:1', '/repo/bin/entry.cjs'],
    ['    at Object.<anonymous> (/a dir/x.mjs:4:5)', '/a dir/x.mjs'],
  ];
  // Act / Assert
  for (const [line, want] of cases) assert.equal(hook.frameFile(line), want, line);
});

test('frameFile reads Windows frames: a drive path, and an ESM file URL without losing its drive', () => {
  // Arrange — the two shapes Node prints on Windows, measured on Node 24.14
  const cjs = '    at go (C:\\repo\\bin\\deep.js:2:30)';
  const bare = '    at c:\\repo\\bin\\entry.cjs:1:1';
  // Act / Assert
  assert.equal(hook.frameFile(cjs), 'C:\\repo\\bin\\deep.js');
  assert.equal(hook.frameFile(bare), 'c:\\repo\\bin\\entry.cjs');
  if (process.platform === 'win32') {
    assert.equal(hook.frameFile('    at go (file:///C:/repo/bin/deep.mjs:2:30)'), 'C:\\repo\\bin\\deep.mjs',
      'the old pattern matched from the slash after the drive and returned /repo/bin/deep.mjs');
  }
});

test('frameFile converts this platform\'s own file URL back to the path it came from', () => {
  // Arrange
  const file = hookPath();
  const line = `    at x (${pathToFileURL(file).href}:10:3)`;
  // Act / Assert
  assert.equal(hook.frameFile(line), file);
});

test('frameFile names no file for internal, anonymous and non-script frames', () => {
  // Arrange
  const lines = ['    at Module._compile (node:internal/modules/cjs/loader:1554:14)', '    at <anonymous>',
    '    at new Promise (<anonymous>)', '    at read (/repo/data.json:1:1)', 'Error', ''];
  // Act / Assert
  for (const l of lines) assert.equal(hook.frameFile(l), null, l);
});

test('relUnder on POSIX: a descendant is relative, the root is empty, a sibling prefix is outside', () => {
  // Arrange
  const roots = ['/tmp/repo'];
  // Act / Assert
  assert.equal(hook.relUnder(roots, '/tmp/repo/bin/a.mjs', false), 'bin/a.mjs');
  assert.equal(hook.relUnder(roots, '/tmp/repo', false), '');
  assert.equal(hook.relUnder(roots, '/tmp/repo-other/a.mjs', false), null, 'a shared prefix is not containment');
  assert.equal(hook.relUnder(roots, '/tmp/Repo/a.mjs', false), null, 'POSIX compares with case');
  assert.equal(hook.relUnder(['/'], '/etc/x', false), 'etc/x');
});

test('relUnder on Windows: backslashes, either drive-letter case, and a `/`-separated result', () => {
  // Arrange — the root as an editor's terminal spawns it, the file as Node resolved it
  const roots = ['c:\\Repositories\\fx'];
  // Act / Assert
  assert.equal(hook.relUnder(roots, 'C:\\Repositories\\fx\\bin\\deep.mjs', true), 'bin/deep.mjs');
  assert.equal(hook.relUnder(roots, 'c:\\repositories\\FX\\bin\\deep.mjs', true), 'bin/deep.mjs',
    'Windows paths compare without case; the result keeps the file\'s own spelling below the root');
  assert.equal(hook.relUnder(roots, 'C:\\Repositories\\fx2\\a.mjs', true), null);
  assert.equal(hook.relUnder(roots, 'D:\\Repositories\\fx\\a.mjs', true), null, 'another drive is outside');
  assert.equal(hook.relUnder(['C:\\'], 'C:\\x\\a.mjs', true), 'x/a.mjs');
});

test('canon only rewrites on Windows: a backslash is a legal POSIX file-name character', () => {
  // Act / Assert
  assert.equal(hook.canon('C:\\a\\b', true), 'c:/a/b');
  assert.equal(hook.canon('/a\\b', false), '/a\\b');
});
