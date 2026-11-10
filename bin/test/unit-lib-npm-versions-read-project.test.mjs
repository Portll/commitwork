// Reads a project's package.json and package-lock.json into a normalized dependency summary (bin/lib/npm-versions.mjs readProject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProject } from '../lib/npm-versions.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'readProject-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns an error when package.json is missing', () => {
  const { dir, cleanup } = setup();
  try {
    const r = readProject(dir);
    assert.deepEqual(r, { error: "package.json not found" });
  } finally { cleanup(); }
});

test('returns an error when package-lock.json is absent and no other lockfile exists', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { a: '^1.0.0' } }));
    const r = readProject(dir);
    assert.deepEqual(r, { error: "package-lock.json not found: npm audits and updates the lockfile, so there is nothing to measure without one" });
  } finally { cleanup(); }
});

test('reports the ecosystem when package-lock.json is absent but yarn.lock exists', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { a: '^1.0.0' } }));
    writeFileSync(join(dir, 'yarn.lock'), '');
    const r = readProject(dir);
    assert.deepEqual(r, { error: "not measured: this project is locked by yarn (yarn.lock), and this audit reads npm's package-lock.json only", ecosystem: "yarn" });
  } finally { cleanup(); }
});

test('returns an error when package-lock.json is present but not valid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { a: '^1.0.0' } }));
    writeFileSync(join(dir, 'package-lock.json'), 'not json');
    const r = readProject(dir);
    assert.deepEqual(r, { error: "package-lock.json is not JSON (Unexpected token 'o', \"not json\" is not valid JSON)" });
  } finally { cleanup(); }
});

test('returns an error when lockfileVersion is below 2', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { a: '^1.0.0' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1, packages: { 'node_modules/a': { version: '1.0.0' } } }));
    const r = readProject(dir);
    assert.deepEqual(r, { error: "package-lock.json is lockfileVersion 1; this reads version 2 or 3 (npm 7 and later)" });
  } finally { cleanup(); }
});

test('returns an error when lockfileVersion is exactly 2', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { a: '^1.0.0' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 2, packages: { 'node_modules/a': { version: '1.0.0' } } }));
    const r = readProject(dir);
    assert.deepEqual(r, { name: "x", direct: [{ name: "a", kind: "dependencies", spec: "^1.0.0", locked: "1.0.0", linked: false }], runtimeDependencies: 1, workspaces: null, overrides: [], lock: { lockfileVersion: 2, packages: { "node_modules/a": { version: "1.0.0" } } } });
  } finally { cleanup(); }
});

test('returns an error when dependencies is an array', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: ['a'] }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0' } } }));
    const r = readProject(dir);
    assert.deepEqual(r, { error: "package.json dependencies is not an object" });
  } finally { cleanup(); }
});

test('returns a full summary with sorted overrides and linked dependency', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'proj',
      dependencies: { b: '^2.0.0', a: '^1.0.0' },
      devDependencies: { c: '^3.0.0' },
      overrides: { z: '1.0.0', a: '2.0.0' },
      workspaces: ['packages/*']
    }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/a': { version: '1.2.3', link: true },
        'node_modules/b': { version: '2.0.1' },
        'node_modules/c': { version: '3.1.0' }
      }
    }));
    const r = readProject(dir);
    assert.deepEqual(r, { name: "proj", direct: [{ name: "a", kind: "dependencies", spec: "^1.0.0", locked: null, linked: true }, { name: "b", kind: "dependencies", spec: "^2.0.0", locked: "2.0.1", linked: false }, { name: "c", kind: "devDependencies", spec: "^3.0.0", locked: "3.1.0", linked: false }], runtimeDependencies: 2, workspaces: ["packages/*"], overrides: ["a", "z"], lock: { lockfileVersion: 3, packages: { "node_modules/a": { version: "1.2.3", link: true }, "node_modules/b": { version: "2.0.1" }, "node_modules/c": { version: "3.1.0" } } } });
  } finally { cleanup(); }
});
