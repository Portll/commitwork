// Maps a raw scanner severity term to a CSAF qualitative severity rating with provenance (cra/vex-formats.mjs mapQualitativeSeverity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapQualitativeSeverity } from '../vex-formats.mjs';

test('returns exact rating for canonical critical input', () => {
  const r = mapQualitativeSeverity('critical');
  assert.deepEqual(r, { rating: "critical", source: "exact" });
});

test('returns exact rating for canonical high input', () => {
  const r = mapQualitativeSeverity('high');
  assert.deepEqual(r, { rating: "high", source: "exact" });
});

test('returns exact rating for canonical medium input', () => {
  const r = mapQualitativeSeverity('medium');
  assert.deepEqual(r, { rating: "medium", source: "exact" });
});

test('returns exact rating for canonical low input', () => {
  const r = mapQualitativeSeverity('low');
  assert.deepEqual(r, { rating: "low", source: "exact" });
});

test('returns exact rating for canonical none input', () => {
  const r = mapQualitativeSeverity('none');
  assert.deepEqual(r, { rating: "none", source: "exact" });
});

test('maps synonym crit to critical with mapped source', () => {
  const r = mapQualitativeSeverity('crit');
  assert.deepEqual(r, { rating: "critical", source: "mapped" });
});

test('maps synonym severe to critical with mapped source', () => {
  const r = mapQualitativeSeverity('severe');
  assert.deepEqual(r, { rating: "critical", source: "mapped" });
});

test('maps synonym emergency to critical with mapped source', () => {
  const r = mapQualitativeSeverity('emergency');
  assert.deepEqual(r, { rating: "critical", source: "mapped" });
});

test('maps synonym important to high with mapped source', () => {
  const r = mapQualitativeSeverity('important');
  assert.deepEqual(r, { rating: "high", source: "mapped" });
});

test('maps synonym error to high with mapped source', () => {
  const r = mapQualitativeSeverity('error');
  assert.deepEqual(r, { rating: "high", source: "mapped" });
});

test('maps synonym med to medium with mapped source', () => {
  const r = mapQualitativeSeverity('med');
  assert.deepEqual(r, { rating: "medium", source: "mapped" });
});

test('maps synonym moderate to medium with mapped source', () => {
  const r = mapQualitativeSeverity('moderate');
  assert.deepEqual(r, { rating: "medium", source: "mapped" });
});

test('maps synonym warning to medium with mapped source', () => {
  const r = mapQualitativeSeverity('warning');
  assert.deepEqual(r, { rating: "medium", source: "mapped" });
});

test('maps synonym warn to medium with mapped source', () => {
  const r = mapQualitativeSeverity('warn');
  assert.deepEqual(r, { rating: "medium", source: "mapped" });
});

test('maps synonym minor to low with mapped source', () => {
  const r = mapQualitativeSeverity('minor');
  assert.deepEqual(r, { rating: "low", source: "mapped" });
});

test('maps synonym note to low with mapped source', () => {
  const r = mapQualitativeSeverity('note');
  assert.deepEqual(r, { rating: "low", source: "mapped" });
});

test('maps synonym info to low with mapped source', () => {
  const r = mapQualitativeSeverity('info');
  assert.deepEqual(r, { rating: "low", source: "mapped" });
});

test('maps synonym informational to low with mapped source', () => {
  const r = mapQualitativeSeverity('informational');
  assert.deepEqual(r, { rating: "low", source: "mapped" });
});

test('maps synonym negligible to none with mapped source', () => {
  const r = mapQualitativeSeverity('negligible');
  assert.deepEqual(r, { rating: "none", source: "mapped" });
});

test('returns null rating with unmapped source for unknown term', () => {
  const r = mapQualitativeSeverity('unknown');
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('returns null rating with unmapped source for unspecified term', () => {
  const r = mapQualitativeSeverity('unspecified');
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('returns null rating with unmapped source for unrecognized term', () => {
  const r = mapQualitativeSeverity('bogus');
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('returns null rating with unmapped source for empty string', () => {
  const r = mapQualitativeSeverity('');
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('returns null rating with unmapped source for null input', () => {
  const r = mapQualitativeSeverity(null);
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('returns null rating with unmapped source for undefined input', () => {
  const r = mapQualitativeSeverity(undefined);
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('returns null rating with unmapped source for zero input', () => {
  const r = mapQualitativeSeverity(0);
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('trims and lowercases input before matching', () => {
  const r = mapQualitativeSeverity('  CRITICAL  ');
  assert.deepEqual(r, { rating: "critical", source: "exact" });
});

test('trims and lowercases synonym input before matching', () => {
  const r = mapQualitativeSeverity('  Severe  ');
  assert.deepEqual(r, { rating: "critical", source: "mapped" });
});

test('handles non-string input by converting to string', () => {
  const r = mapQualitativeSeverity(123);
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('handles boolean input by converting to string', () => {
  const r = mapQualitativeSeverity(true);
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('handles object input by converting to string', () => {
  const r = mapQualitativeSeverity({});
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('handles array input by converting to string', () => {
  const r = mapQualitativeSeverity([]);
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('handles long repeated input that does not match any term', () => {
  const r = mapQualitativeSeverity('x'.repeat(100));
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('handles input with only whitespace', () => {
  const r = mapQualitativeSeverity('   ');
  assert.deepEqual(r, { rating: null, source: "unmapped" });
});

test('handles input with tabs and newlines around term', () => {
  const r = mapQualitativeSeverity('\t\nhigh\n\t');
  assert.deepEqual(r, { rating: "high", source: "exact" });
});

test('handles input with mixed case synonym', () => {
  const r = mapQualitativeSeverity('InFo');
  assert.deepEqual(r, { rating: "low", source: "mapped" });
});

test('handles input with mixed case canonical term', () => {
  const r = mapQualitativeSeverity('MeDiUm');
  assert.deepEqual(r, { rating: "medium", source: "exact" });
});

test('handles input with mixed case none term', () => {
  const r = mapQualitativeSeverity('NoNe');
  assert.deepEqual(r, { rating: "none", source: "exact" });
});

test('handles input with mixed case low term', () => {
  const r = mapQualitativeSeverity('LoW');
  assert.deepEqual(r, { rating: "low", source: "exact" });
});

test('handles input with mixed case high term', () => {
  const r = mapQualitativeSeverity('HiGh');
  assert.deepEqual(r, { rating: "high", source: "exact" });
});

test('handles input with mixed case critical term', () => {
  const r = mapQualitativeSeverity('CrItIcAl');
  assert.deepEqual(r, { rating: "critical", source: "exact" });
});
