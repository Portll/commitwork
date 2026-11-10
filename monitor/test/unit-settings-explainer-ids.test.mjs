// The cached set of explainer ids from the registry, empty when it is unusable (monitor/settings.mjs explainerIds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainerIds } from '../settings.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RealSet = globalThis.Set;
const savedEnv = process.env.CW_EXPLAINERS;
let first;

function hook(Swap) {
  Object.defineProperty(Array.prototype, '1', {
    configurable: true,
    get() {
      if ((new Error().stack.split('\n')[2] ?? '').includes('settings.mjs')) globalThis.Set = Swap;
      return undefined;
    },
    set(value) {
      Object.defineProperty(this, '1', { value, writable: true, enumerable: true, configurable: true });
    },
  });
}

function unhook() {
  delete Array.prototype[1];
  Array.prototype.length = 0;
  globalThis.Set = RealSet;
}

function restoreEnv() {
  if (savedEnv === undefined) delete process.env.CW_EXPLAINERS;
  else process.env.CW_EXPLAINERS = savedEnv;
}

test('a registry named by CW_EXPLAINERS that parses but fails its schema yields a plain empty set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explainerIds-'));
  class Mismatch extends RealSet {}
  try {
    const p = join(dir, 'explainers.json');
    writeFileSync(p, JSON.stringify(42));
    process.env.CW_EXPLAINERS = p;
    hook(Mismatch);
    const result = explainerIds();
    unhook();
    first = result;
    assert.deepEqual(result, new RealSet());
  } finally {
    unhook();
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a later call returns the cached set even when CW_EXPLAINERS now names a registry with ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explainerIds-'));
  try {
    const p = join(dir, 'explainers.json');
    const explainers = Array.from({ length: 3 }, (_, i) => ({ id: `later-${i}`, title: `T${i}`, body: `B${i}` }));
    writeFileSync(p, JSON.stringify({ version: 1, explainers }));
    process.env.CW_EXPLAINERS = p;
    const result = explainerIds();
    assert.equal(result, first);
    assert.deepEqual(result, new Set());
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a later call returns the cached set when the registry file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explainerIds-'));
  try {
    process.env.CW_EXPLAINERS = join(dir, 'absent.json');
    const result = explainerIds();
    assert.equal(result, first);
    assert.deepEqual(result, new Set());
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a later call returns the cached set when the registry is not JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explainerIds-'));
  try {
    const p = join(dir, 'explainers.json');
    writeFileSync(p, 'not json');
    process.env.CW_EXPLAINERS = p;
    const result = explainerIds();
    assert.equal(result, first);
    assert.deepEqual(result, new Set());
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a later call returns the cached set when CW_EXPLAINERS is unset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explainerIds-'));
  try {
    delete process.env.CW_EXPLAINERS;
    const result = explainerIds();
    assert.equal(result, first);
    assert.deepEqual(result, new Set());
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});
