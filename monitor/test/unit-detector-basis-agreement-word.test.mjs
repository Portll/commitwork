// Maps a set of detectors to a single agreement word (monitor/detector-basis.mjs agreementWord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreementWord } from '../detector-basis.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'agreementWord-'));
const basisFile = join(dir, 'detector-basis.json');
writeFileSync(basisFile, JSON.stringify({
  classes: { a: {}, b: {} },
  detectors: { d1: 'a', d2: 'b', d3: 'a' }
}));
const map = { classes: { a: {}, b: {} }, detectors: { d1: 'a', d2: 'b', d3: 'a' } };

try {
  test('returns single for empty input', () => {
    assert.equal(agreementWord([]), "single");
  });

  test('returns single for one detector', () => {
    assert.equal(agreementWord(['d1']), "single");
  });

  test('returns same-basis for two detectors in same class', () => {
    assert.equal(agreementWord(['d1', 'd3'], map), "same-basis");
  });

  test('returns corroborated for two detectors in different classes', () => {
    assert.equal(agreementWord(['d1', 'd2'], map), "corroborated");
  });

  test('returns same-basis for three detectors in same class', () => {
    assert.equal(agreementWord(['d1', 'd3', 'd1'], map), "same-basis");
  });

  test('returns corroborated for three detectors with two distinct classes', () => {
    assert.equal(agreementWord(['d1', 'd2', 'd3'], map), "corroborated");
  });

  test('returns same-basis for two unclassified detectors', () => {
    assert.equal(agreementWord(['x', 'y'], map), "same-basis");
  });

  test('returns corroborated for three detectors with three distinct classes', () => {
    const m3 = { classes: { a: {}, b: {}, c: {} }, detectors: { d1: 'a', d2: 'b', d3: 'c' } };
    assert.equal(agreementWord(['d1', 'd2', 'd3'], m3), "corroborated");
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
