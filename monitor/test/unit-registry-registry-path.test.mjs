// Which registry file path to load (monitor/registry.mjs registryPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryPath } from '../registry.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLE = fileURLToPath(new URL('../projects.example.json', import.meta.url));
const DECLARED = fileURLToPath(new URL('../projects.json', import.meta.url));

function withEnv(value, fn) {
  const saved = process.env.CW_REGISTRY;
  if (value === undefined) delete process.env.CW_REGISTRY;
  else process.env.CW_REGISTRY = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CW_REGISTRY;
    else process.env.CW_REGISTRY = saved;
  }
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'registryPath-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an absolute CW_REGISTRY naming an existing file is returned unchanged', () => {
  withDir((dir) => {
    const target = join(dir, 'custom.json');
    writeFileSync(target, '{}');
    assert.equal(withEnv(target, () => registryPath()), target);
  });
});

test('an explicit CW_REGISTRY naming a missing file is returned without falling back', () => {
  withDir((dir) => {
    const target = join(dir, 'absent.json');
    assert.equal(withEnv(target, () => registryPath()), target);
  });
});

test('a relative CW_REGISTRY pointing into another directory resolves to that absolute path', () => {
  withDir((dir) => {
    const target = join(dir, 'rel.json');
    writeFileSync(target, '{}');
    const value = relative(process.cwd(), target);
    assert.equal(withEnv(value, () => registryPath()), target);
  });
});

test('a bare file name in CW_REGISTRY resolves inside the working directory', () => {
  assert.equal(withEnv('rel.json', () => registryPath()), join(process.cwd(), 'rel.json'));
});

test('dot segments in CW_REGISTRY are collapsed', () => {
  withDir((dir) => {
    const value = `${dir}/nested/../custom.json`;
    assert.equal(withEnv(value, () => registryPath()), join(dir, 'custom.json'));
  });
});

test('a trailing slash on CW_REGISTRY is dropped', () => {
  withDir((dir) => {
    assert.equal(withEnv(`${dir}/`, () => registryPath()), dir);
  });
});

test('the one-character value 0 counts as set because it is a non-empty string', () => {
  assert.equal(withEnv('0', () => registryPath()), join(process.cwd(), '0'));
});

test('with CW_REGISTRY unset the path returned is a file that exists', () => {
  assert.equal(existsSync(withEnv(undefined, () => registryPath())), true);
});

test('with CW_REGISTRY unset the example is not chosen while monitor/projects.json exists', () => {
  const result = withEnv(undefined, () => registryPath());
  assert.equal(result === EXAMPLE && existsSync(DECLARED), false);
});

test('an empty CW_REGISTRY behaves exactly as if it were unset', () => {
  const unset = withEnv(undefined, () => registryPath());
  assert.equal(withEnv('', () => registryPath()), unset);
});
