// Parses ledgers.json text into validated fixed and moved row arrays with compiled match regexes (bin/reconcile-findings.mjs loadLedgers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLedgers } from '../reconcile-findings.mjs';

test('returns empty fixed and moved arrays for a minimal valid document', () => {
  const text = JSON.stringify({ schema: 1, fixed: [], moved: [] });
  const result = loadLedgers(text);
  assert.deepEqual(result, { fixed: [], moved: [] });
});

test('throws when schema is not 1', () => {
  const text = JSON.stringify({ schema: 2, fixed: [], moved: [] });
  assert.throws(() => loadLedgers(text), /schema must be 1/);
});

test('throws when doc is null', () => {
  assert.throws(() => loadLedgers('null'), /schema must be 1/);
});

test('throws when fixed is not an array', () => {
  const text = JSON.stringify({ schema: 1, fixed: {}, moved: [] });
  assert.throws(() => loadLedgers(text), /fixed must be an array/);
});

test('throws when a fixed group lacks rows array', () => {
  const text = JSON.stringify({ schema: 1, fixed: [{ about: 'note' }], moved: [] });
  assert.throws(() => loadLedgers(text), /every fixed group needs rows\[\]/);
});

test('throws when a fixed row has a line property', () => {
  const text = JSON.stringify({
    schema: 1,
    fixed: [{ about: 'note', rows: [{ item: 'x', file: 'a.js', note: 'n', match: { source: 'foo', flags: '' }, line: 5 }] }],
    moved: []
  });
  assert.throws(() => loadLedgers(text), /carries a line/);
});

test('throws when a fixed row has duplicate file and match', () => {
  const text = JSON.stringify({
    schema: 1,
    fixed: [{
      about: 'note',
      rows: [
        { item: 'a', file: 'a.js', note: 'n1', match: { source: 'foo', flags: '' } },
        { item: 'b', file: 'a.js', note: 'n2', match: { source: 'foo', flags: '' } }
      ]
    }],
    moved: []
  });
  assert.throws(() => loadLedgers(text), /shares \(file, match\)/);
});

test('throws when a moved row is missing the to field', () => {
  const text = JSON.stringify({
    schema: 1,
    fixed: [],
    moved: [{ about: 'note', rows: [{ item: 'x', file: 'a.js', note: 'n', match: { source: 'foo', flags: '' }, at: 'abc' }] }]
  });
  assert.throws(() => loadLedgers(text), /to must be a non-empty string/);
});

test('throws when a moved row is missing the at field', () => {
  const text = JSON.stringify({
    schema: 1,
    fixed: [],
    moved: [{ about: 'note', rows: [{ item: 'x', file: 'a.js', note: 'n', match: { source: 'foo', flags: '' }, to: 'b.js:1' }] }]
  });
  assert.throws(() => loadLedgers(text), /at must be a non-empty string/);
});

test('returns parsed rows with compiled RegExp objects for valid fixed and moved entries', () => {
  const text = JSON.stringify({
    schema: 1,
    fixed: [{
      about: 'batch 1',
      rows: [
        { item: 'anchor re-read 0050', file: 'src/a.js', note: 'defect A', match: { source: 'badCall\\(', flags: 'g' } }
      ]
    }],
    moved: [{
      about: 'batch 2',
      rows: [
        { item: 'anchor move 0100', file: 'src/b.js', note: 'defect B', match: { source: 'oldRef', flags: '' }, to: 'src/c.js:42', at: 'deadbeef' }
      ]
    }]
  });
  const result = loadLedgers(text);
  assert.equal(result.fixed.length, 1);
  assert.equal(result.moved.length, 1);
  assert.equal(result.fixed[0].item, 'anchor re-read 0050');
  assert.equal(result.fixed[0].file, 'src/a.js');
  assert.equal(result.fixed[0].note, 'defect A');
  assert.ok(result.fixed[0].match instanceof RegExp);
  assert.equal(result.fixed[0].match.source, 'badCall\\(');
  assert.equal(result.fixed[0].match.flags, 'g');
  assert.equal(result.moved[0].item, 'anchor move 0100');
  assert.equal(result.moved[0].file, 'src/b.js');
  assert.equal(result.moved[0].to, 'src/c.js:42');
  assert.equal(result.moved[0].at, 'deadbeef');
  assert.ok(result.moved[0].match instanceof RegExp);
  assert.equal(result.moved[0].match.source, 'oldRef');
  assert.equal(result.moved[0].match.flags, '');
});
