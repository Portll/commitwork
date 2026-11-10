// Tallies vulnerability rows by severity, fix status, and KEV membership (monitor/update-vulns.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../update-vulns.mjs';

test('empty rows yields zero counts and empty collections', () => {
  assert.deepEqual(tally([]), { count: 0, published: {}, undetermined: 0, noFixRecorded: 0, kev: [] });
});

test('single severity row with null fix and true kev', () => {
  assert.deepEqual(tally([{ publish: 'severity', severity: 'high', fix: null, kev: true, id: 'a' }]), { count: 1, published: { high: 1 }, undetermined: 0, noFixRecorded: 1, kev: ["a"] });
});

test('single non-severity row with string fix and false kev', () => {
  assert.deepEqual(tally([{ publish: 'other', fix: 'patched', kev: false, id: 'b' }]), { count: 1, published: {}, undetermined: 1, noFixRecorded: 0, kev: [] });
});

test('severity row with undefined severity uses Unknown bucket', () => {
  assert.deepEqual(tally([{ publish: 'severity', fix: 'x', kev: false, id: 'c' }]), { count: 1, published: { Unknown: 1 }, undetermined: 0, noFixRecorded: 0, kev: [] });
});

test('two identical severity rows increment count twice', () => {
  assert.deepEqual(tally([
    { publish: 'severity', severity: 'low', fix: null, kev: true, id: 'd1' },
    { publish: 'severity', severity: 'low', fix: null, kev: true, id: 'd2' }
  ]), { count: 2, published: { low: 2 }, undetermined: 0, noFixRecorded: 2, kev: ["d1", "d2"] });
});

test('duplicate kev ids are deduplicated and sorted', () => {
  assert.deepEqual(tally([
    { publish: 'severity', severity: 'med', fix: 'y', kev: true, id: 'z' },
    { publish: 'severity', severity: 'med', fix: 'y', kev: true, id: 'a' },
    { publish: 'severity', severity: 'med', fix: 'y', kev: true, id: 'z' }
  ]), { count: 3, published: { med: 3 }, undetermined: 0, noFixRecorded: 0, kev: ["a", "z"] });
});

test('mixed publish values and fix null vs non-null across rows', () => {
  assert.deepEqual(tally([
    { publish: 'severity', severity: 'crit', fix: null, kev: true, id: 'k1' },
    { publish: 'severity', severity: 'crit', fix: 'done', kev: false, id: 'k2' },
    { publish: 'unknown', fix: null, kev: true, id: 'k3' },
    { publish: 'unknown', fix: 'done', kev: false, id: 'k4' }
  ]), { count: 4, published: { crit: 2 }, undetermined: 2, noFixRecorded: 2, kev: ["k1", "k3"] });
});

test('kev true with undefined id still pushes undefined into set', () => {
  assert.deepEqual(tally([{ publish: 'severity', severity: 'low', fix: null, kev: true }]), { count: 1, published: { low: 1 }, undetermined: 0, noFixRecorded: 1, kev: [undefined] });
});
