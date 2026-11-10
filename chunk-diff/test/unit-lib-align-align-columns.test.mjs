// Aligns chunk columns into a grid of matched rows and extra rows (chunk-diff/lib/align.mjs alignColumns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignColumns } from '../lib/align.mjs';

test('throws when columns length is below minimum', () => {
  const cols = [{ chunks: [{ src: 'a' }] }];
  assert.throws(() => alignColumns(cols, 0), { name: 'Error', message: 'alignColumns: expected 2-6 columns, got 1' });
});

test('throws when columns length is above maximum', () => {
  const cols = Array.from({ length: 7 }, (_, i) => ({ chunks: [{ src: 'x' }] }));
  assert.throws(() => alignColumns(cols, 0), { name: 'Error', message: 'alignColumns: expected 2-6 columns, got 7' });
});

test('throws when baseIndex is negative', () => {
  const cols = [
    { chunks: [{ src: 'a' }] },
    { chunks: [{ src: 'b' }] }
  ];
  assert.throws(() => alignColumns(cols, -1), { name: 'Error', message: 'alignColumns: baseIndex -1 out of range' });
});

test('throws when baseIndex equals columns length', () => {
  const cols = [
    { chunks: [{ src: 'a' }] },
    { chunks: [{ src: 'b' }] }
  ];
  assert.throws(() => alignColumns(cols, 2), { name: 'Error', message: 'alignColumns: baseIndex 2 out of range' });
});

test('returns empty rows and extraRows when base has zero chunks', () => {
  const cols = [
    { chunks: [] },
    { chunks: [{ src: 'x' }] }
  ];
  const r = alignColumns(cols, 0);
  assert.deepEqual(r, { rows: [], extraRows: [{ colIdx: 1, pair: { state: "ADDED", old: null, new: { src: "x", rawHash: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881", normHash: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881", idx: 0 } } }] });
});

test('marks base column chunks as MATCHED with isBase true', () => {
  const cols = [
    { chunks: [{ src: 'a' }, { src: 'b' }] },
    { chunks: [{ src: 'a' }, { src: 'b' }] }
  ];
  const r = alignColumns(cols, 0);
  assert.deepEqual(r, { rows: [{ perColumn: [{ state: "MATCHED", old: null, new: { src: "a" }, isBase: true }, { state: "MATCHED", old: { src: "a", rawHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", normHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", idx: 0 }, new: { src: "a", rawHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", normHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", idx: 0 } }] }, { perColumn: [{ state: "MATCHED", old: null, new: { src: "b" }, isBase: true }, { state: "MATCHED", old: { src: "b", rawHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", normHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", idx: 1 }, new: { src: "b", rawHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", normHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", idx: 1 } }] }], extraRows: [] });
});

test('places non-added pairs into rows by old reference index', () => {
  const cols = [
    { chunks: [{ src: 'a' }, { src: 'b' }] },
    { chunks: [{ src: 'a' }, { src: 'b' }] }
  ];
  const r = alignColumns(cols, 1);
  assert.deepEqual(r, { rows: [{ perColumn: [{ state: "MATCHED", old: { src: "a", rawHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", normHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", idx: 0 }, new: { src: "a", rawHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", normHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", idx: 0 } }, { state: "MATCHED", old: null, new: { src: "a" }, isBase: true }] }, { perColumn: [{ state: "MATCHED", old: { src: "b", rawHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", normHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", idx: 1 }, new: { src: "b", rawHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", normHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", idx: 1 } }, { state: "MATCHED", old: null, new: { src: "b" }, isBase: true }] }], extraRows: [] });
});

test('pushes ADDED pairs into extraRows', () => {
  const cols = [
    { chunks: [{ src: 'a' }] },
    { chunks: [{ src: 'a' }, { src: 'b' }] }
  ];
  const r = alignColumns(cols, 0);
  assert.deepEqual(r, { rows: [{ perColumn: [{ state: "MATCHED", old: null, new: { src: "a" }, isBase: true }, { state: "MATCHED", old: { src: "a", rawHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", normHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", idx: 0 }, new: { src: "a", rawHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", normHash: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb", idx: 0 } }] }], extraRows: [{ colIdx: 1, pair: { state: "ADDED", old: null, new: { src: "b", rawHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", normHash: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d", idx: 1 } } }] });
});
