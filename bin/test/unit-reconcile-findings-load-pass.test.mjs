// Flattens a JSON array of areas into a list of findings and missed items tagged with pass and area (bin/reconcile-findings.mjs loadPass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPass } from '../reconcile-findings.mjs';

test('throws when input is not an array', () => {
  assert.throws(() => loadPass('{"area":"a"}', 'p1'), /p1: expected an array of areas/);
});

test('returns empty array for empty areas list', () => {
  assert.deepEqual(loadPass('[]', 'p1'), []);
});

test('flattens findings with pass, area, and source fields', () => {
  const text = JSON.stringify([{ area: 'auth', findings: [{ id: 'f1', msg: 'bad' }], missed: [] }]);
  const result = loadPass(text, 'pass1');
  assert.deepEqual(result, [{ id: 'f1', msg: 'bad', pass: 'pass1', area: 'auth', source: 'findings' }]);
});

test('flattens missed items with source set to missed', () => {
  const text = JSON.stringify([{ area: 'db', findings: [], missed: [{ id: 'm1', note: 'gap' }] }]);
  const result = loadPass(text, 'pass2');
  assert.deepEqual(result, [{ id: 'm1', note: 'gap', pass: 'pass2', area: 'db', source: 'missed' }]);
});

test('handles area with no findings or missed keys', () => {
  const text = JSON.stringify([{ area: 'empty' }]);
  assert.deepEqual(loadPass(text, 'p'), []);
});

test('processes multiple areas in order', () => {
  const text = JSON.stringify([
    { area: 'a1', findings: [{ id: 'x' }], missed: [{ id: 'y' }] },
    { area: 'a2', findings: [{ id: 'z' }], missed: [] }
  ]);
  const result = loadPass(text, 'p');
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { id: 'x', pass: 'p', area: 'a1', source: 'findings' });
  assert.deepEqual(result[1], { id: 'y', pass: 'p', area: 'a1', source: 'missed' });
  assert.deepEqual(result[2], { id: 'z', pass: 'p', area: 'a2', source: 'findings' });
});

test('preserves original finding properties alongside added fields', () => {
  const text = JSON.stringify([{ area: 'sec', findings: [{ id: 'f1', severity: 'high', detail: 'leak' }], missed: [] }]);
  const result = loadPass(text, 'p');
  assert.equal(result[0].id, 'f1');
  assert.equal(result[0].severity, 'high');
  assert.equal(result[0].detail, 'leak');
  assert.equal(result[0].pass, 'p');
  assert.equal(result[0].area, 'sec');
  assert.equal(result[0].source, 'findings');
});

test('throws with correct passId in error message', () => {
  assert.throws(() => loadPass('null', 'second'), /second: expected an array of areas/);
});
