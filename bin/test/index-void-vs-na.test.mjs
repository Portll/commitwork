// An n/a cell (sev 'skip') is never listed as a coverage void, and a void (sev 'noscan') is never
// dropped from the list: summary.md and index.md must agree on the same cell.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageVoidRows, degradedLaneRows } from '../commitwork.mjs';

const ids = ['sast-go-gosec', 'dast-nuclei', 'npm-audit'];
const ranked = [{
  slug: 'r',
  cells: {
    'sast-go-gosec': { sev: 'skip', summary: 'none of go.mod present' },
    'dast-nuclei': { sev: 'noscan', summary: 'runtime scanner did not run' },
    'npm-audit': { sev: 'ok', summary: '0' },
  },
}];

test('n/a is not a void', () => {
  const [row] = coverageVoidRows(ranked, ids);
  assert.ok(!row.voids.some((v) => v.startsWith('sast-go-gosec')));
});

test('a noscan cell is a void', () => {
  const [row] = coverageVoidRows(ranked, ids);
  assert.deepEqual(row.voids, ['dast-nuclei (⬜ runtime scanner did not run)']);
});

test('a repo with only n/a cells has no void row', () => {
  assert.deepEqual(coverageVoidRows([{ slug: 'r', cells: { 'sast-go-gosec': { sev: 'skip', summary: 'x' } } }], ids), []);
});

test('a void is not also listed as a degraded lane, but a lane with output is', () => {
  const rows = [{ slug: 'r', cells: {
    a: { sev: 'noscan', summary: 'x', coverage: 'unknown', coverageReason: 'never written' },
    b: { sev: 'med', summary: 'y', coverage: 'reduced', coverageReason: 'half' },
  } }];
  assert.deepEqual(degradedLaneRows(rows, ['a', 'b']), [{ slug: 'r', lanes: ['b (reduced — half)'] }]);
});
