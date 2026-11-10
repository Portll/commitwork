// Reads the minimum Node.js version from a package.json engines.node ">=" range (lib/node-floor.mjs declaredFloor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredFloor } from '../node-floor.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed version object for a valid >= range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: '>=18.0.0' } }));
    const r = declaredFloor(p);
    assert.deepEqual(r, { range: '>=18.0.0', version: [18, 0, 0], text: '18.0.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws with the error code when the package.json file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    assert.throws(() => declaredFloor(p), { name: 'Error', message: `cannot read the Node.js floor from ${p}: ENOENT` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when engines.node is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: 18 } }));
    assert.throws(() => declaredFloor(p), { name: 'Error', message: `${p} engines.node is 18; only ">=X.Y.Z" is understood` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the range uses > instead of >=', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: '>18.0.0' } }));
    assert.throws(() => declaredFloor(p), { name: 'Error', message: `${p} engines.node is ">18.0.0"; only ">=X.Y.Z" is understood` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the version part is not parseable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: '>=abc' } }));
    assert.throws(() => declaredFloor(p), { name: 'Error', message: `${p} engines.node is ">=abc"; only ">=X.Y.Z" is understood` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed version for a range with a v prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: '>=v20.1.3' } }));
    const r = declaredFloor(p);
    assert.deepEqual(r, { range: '>=v20.1.3', version: [20, 1, 3], text: '20.1.3' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed version for a range with a single number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: '>=18' } }));
    const r = declaredFloor(p);
    assert.deepEqual(r, { range: '>=18', version: [18, 0, 0], text: '18.0.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trims the range and allows spaces after >=', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: '  >= 22.5  ' } }));
    const r = declaredFloor(p);
    assert.deepEqual(r, { range: '>= 22.5', version: [22, 5, 0], text: '22.5.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when engines is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredFloor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ name: 'x' }));
    assert.throws(() => declaredFloor(p), { name: 'Error', message: `${p} engines.node is undefined; only ">=X.Y.Z" is understood` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
