// Creates a fresh randomly suffixed env scratch directory under the release scratch root (bin/release-candidate.mjs envScratchDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envScratchDir } from '../release-candidate.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

function withScratch(rootOf, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'envScratchDir-'));
  const prev = process.env.CW_RELEASE_SCRATCH;
  try {
    process.env.CW_RELEASE_SCRATCH = rootOf(dir);
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CW_RELEASE_SCRATCH;
    else process.env.CW_RELEASE_SCRATCH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertMade(result, root, prefix) {
  assert.equal(result.length, join(root, prefix).length + 6);
  assert.equal(result.slice(0, -6), join(root, prefix));
  assert.equal(statSync(result).isDirectory(), true);
  assert.deepEqual(readdirSync(result), []);
}

test('the default project makes an env- directory inside a scratch root created with its missing parents', () => {
  withScratch((d) => join(d, 'deep', 'scratch'), (dir) => {
    const root = join(dir, 'deep', 'scratch');
    const result = envScratchDir();
    assertMade(result, root, 'env-');
    assert.deepEqual(readdirSync(root), [basename(result)]);
  });
});

test('passing commitwork or undefined explicitly uses the plain env- prefix', () => {
  withScratch((d) => join(d, 'scratch'), (dir) => {
    const root = join(dir, 'scratch');
    const a = envScratchDir('commitwork');
    const b = envScratchDir(undefined);
    assertMade(a, root, 'env-');
    assertMade(b, root, 'env-');
    assert.deepEqual(readdirSync(root).sort(), [basename(a), basename(b)].sort());
  });
});

test('a named project gets its name in front of the env- prefix', () => {
  withScratch((d) => join(d, 'deep', 'scratch'), (dir) => {
    const root = join(dir, 'deep', 'scratch');
    const result = envScratchDir('myproject');
    assertMade(result, root, 'myproject-env-');
    assert.deepEqual(readdirSync(root), [basename(result)]);
  });
});

test('an empty project name is not the default and yields a bare -env- prefix', () => {
  withScratch((d) => join(d, 'scratch'), (dir) => {
    const result = envScratchDir('');
    assertMade(result, join(dir, 'scratch'), '-env-');
  });
});

test('a null project is stringified into a null-env- prefix', () => {
  withScratch((d) => join(d, 'scratch'), (dir) => {
    const result = envScratchDir(null);
    assertMade(result, join(dir, 'scratch'), 'null-env-');
  });
});

test('an existing scratch root is reused and keeps its earlier entries', () => {
  withScratch((d) => join(d, 'scratch'), (dir) => {
    const root = join(dir, 'scratch');
    mkdirSync(root);
    writeFileSync(join(root, 'aaa.txt'), 'x');
    const result = envScratchDir('tool');
    assertMade(result, root, 'tool-env-');
    assert.deepEqual(readdirSync(root).sort(), ['aaa.txt', basename(result)].sort());
  });
});

test('the scratch root path is resolved so dot segments are not created on disk', () => {
  withScratch((d) => `${d}/x/../scratch`, (dir) => {
    const result = envScratchDir();
    assertMade(result, join(dir, 'scratch'), 'env-');
    assert.deepEqual(readdirSync(dir), ['scratch']);
  });
});

test('two calls for the same project create two distinct directories', () => {
  withScratch((d) => join(d, 'scratch'), (dir) => {
    const root = join(dir, 'scratch');
    const a = envScratchDir('proj');
    const b = envScratchDir('proj');
    assert.equal(a === b, false);
    assertMade(a, root, 'proj-env-');
    assertMade(b, root, 'proj-env-');
    assert.deepEqual(readdirSync(root).sort(), [basename(a), basename(b)].sort());
  });
});

test('a project name with a slash points into a missing subdirectory and throws ENOENT', () => {
  withScratch((d) => join(d, 'scratch'), (dir) => {
    const root = join(dir, 'scratch');
    assert.throws(() => envScratchDir('a/b'), { name: 'Error', code: 'ENOENT' });
    assert.deepEqual(readdirSync(root), []);
  });
});
