// Reads a palette map file and returns an array of check objects with id, description, and groups. (admin/lib/palette-index.mjs readChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChecks } from '../lib/palette-index.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'readChecks-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns empty array when byId is empty object', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'map.json');
    writeFileSync(p, JSON.stringify({ byId: {} }));
    assert.deepEqual(readChecks(p), []);
  } finally { cleanup(); }
});

test('returns check with description and groups from byId entry', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'map.json');
    writeFileSync(p, JSON.stringify({ byId: { a: { description: 'desc', groups: ['g1', 'g2'] } } }));
    assert.deepEqual(readChecks(p), [{ id: 'a', description: 'desc', groups: ['g1', 'g2'] }]);
  } finally { cleanup(); }
});

test('returns empty description when description is missing', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'map.json');
    writeFileSync(p, JSON.stringify({ byId: { b: { groups: ['x'] } } }));
    assert.deepEqual(readChecks(p), [{ id: 'b', description: '', groups: ['x'] }]);
  } finally { cleanup(); }
});

test('returns empty groups array when groups is not an array', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'map.json');
    writeFileSync(p, JSON.stringify({ byId: { c: { description: 'd', groups: 'notarray' } } }));
    assert.deepEqual(readChecks(p), [{ id: 'c', description: 'd', groups: [] }]);
  } finally { cleanup(); }
});

test('returns empty groups array when groups is missing', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'map.json');
    writeFileSync(p, JSON.stringify({ byId: { d: { description: 'd' } } }));
    assert.deepEqual(readChecks(p), [{ id: 'd', description: 'd', groups: [] }]);
  } finally { cleanup(); }
});

test('throws when file does not exist', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'missing.json');
    assert.throws(() => readChecks(p), /palette: cannot read/);
  } finally { cleanup(); }
});

test('throws when file is not valid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    assert.throws(() => readChecks(p), /palette: .* is not JSON/);
  } finally { cleanup(); }
});

test('throws when byId is missing from parsed JSON', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'nobyid.json');
    writeFileSync(p, JSON.stringify({ other: 1 }));
    assert.throws(() => readChecks(p), /palette: .* has no byId/);
  } finally { cleanup(); }
});

test('throws when byId is not an object', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'badbyid.json');
    writeFileSync(p, JSON.stringify({ byId: 'string' }));
    assert.throws(() => readChecks(p), /palette: .* has no byId/);
  } finally { cleanup(); }
});

test('handles multiple entries in byId preserving order', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'multi.json');
    const byId = {};
    for (let i = 0; i < 3; i++) byId['k' + i] = { description: 'd' + i, groups: ['g' + i] };
    writeFileSync(p, JSON.stringify({ byId }));
    const result = readChecks(p);
    assert.equal(result.length, 3);
    assert.deepEqual(result[0], { id: 'k0', description: 'd0', groups: ['g0'] });
    assert.deepEqual(result[2], { id: 'k2', description: 'd2', groups: ['g2'] });
  } finally { cleanup(); }
});
