import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { alignColumns, MIN_COLUMNS, MAX_COLUMNS } from '../lib/align.mjs';
import { STATE } from '../lib/chunk-identity.mjs';

const col = (label, ...chunks) => ({ label, chunks: chunks.map((src) => ({ src })) });

describe('alignColumns', () => {
  test('rejects fewer than MIN_COLUMNS or more than MAX_COLUMNS', () => {
    assert.throws(() => alignColumns([col('a', 'x')], 0));
    const seven = Array.from({ length: 7 }, (_, i) => col(`c${i}`, 'x'));
    assert.throws(() => alignColumns(seven, 0));
  });

  test('base column is marked isBase and MATCHED on every row', () => {
    const { rows } = alignColumns([col('base', 'one', 'two'), col('other', 'one', 'two')], 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].perColumn[0].isBase, true);
    assert.equal(rows[0].perColumn[0].state, STATE.MATCHED);
  });

  test('a non-base column with a chunk the base does not have becomes an extra row, not a row overwriting a base index', () => {
    const { rows, extraRows } = alignColumns([col('base', 'shared'), col('other', 'shared', 'extra only here')], 0);
    assert.equal(rows.length, 1);
    assert.equal(extraRows.length, 1);
    assert.equal(extraRows[0].colIdx, 1);
    assert.equal(extraRows[0].pair.state, STATE.ADDED);
  });

  test('3 columns: each non-base column judged independently against the same base row', () => {
    const columns = [col('base', 'alpha'), col('b', 'alpha edited slightly'), col('c', 'alpha')];
    const { rows } = alignColumns(columns, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].perColumn[0].isBase, true);
    assert.equal(rows[0].perColumn[2].state, STATE.MATCHED);
    // column b diverges from base — must not be forced to match column c's judgment.
    assert.notEqual(rows[0].perColumn[1].state, undefined);
  });

  test('a different base index re-judges everything relative to the new reference', () => {
    const columns = [col('a', 'one'), col('b', 'one changed')];
    const asA = alignColumns(columns, 0);
    const asB = alignColumns(columns, 1);
    assert.equal(asA.rows[0].perColumn[0].isBase, true);
    assert.equal(asB.rows[0].perColumn[1].isBase, true);
  });
});
