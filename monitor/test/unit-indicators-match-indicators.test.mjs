// Matches observables against indicator sets, returning hits, counts, and completeness (monitor/indicators.mjs matchIndicators).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchIndicators } from '../indicators.mjs';

test('returns empty results when no indicators or observables are provided', () => {
  const r = matchIndicators([], []);
  assert.deepEqual(r, { matches: [], matchCount: 0, truncated: 0, observablesChecked: 0, indicatorsApplied: 0, indicatorsRejected: 0, indicatorSetsUnreadable: 0, appliedFraction: null, complete: true, rejected: [], unreadableSets: [] });
});

test('matches a domain indicator against a matching observed domain', () => {
  const r = matchIndicators(
    [{ indicators: [{ type: 'domain', value: 'example.com', id: 'i1' }] }],
    [{ type: 'domain', value: 'example.com', where: 'w1' }]
  );
  assert.deepEqual(r, { matches: [{ indicator: { id: "i1", name: undefined, type: "domain", value: "example.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w1"] }], matchCount: 1, truncated: 0, observablesChecked: 1, indicatorsApplied: 1, indicatorsRejected: 0, indicatorSetsUnreadable: 0, appliedFraction: 1, complete: true, rejected: [], unreadableSets: [] });
});

test('matches a domain indicator against an observed URL with matching host', () => {
  const r = matchIndicators(
    [{ indicators: [{ type: 'domain', value: 'example.com', id: 'i1' }] }],
    [{ type: 'url', value: 'https://example.com/path', where: 'w1' }]
  );
  assert.deepEqual(r, { matches: [{ indicator: { id: "i1", name: undefined, type: "domain", value: "example.com", source: undefined }, observedType: "url", occurrences: 1, where: ["w1"] }], matchCount: 1, truncated: 0, observablesChecked: 1, indicatorsApplied: 1, indicatorsRejected: 0, indicatorSetsUnreadable: 0, appliedFraction: 1, complete: true, rejected: [], unreadableSets: [] });
});

test('does not match a domain indicator against a non-matching observed domain', () => {
  const r = matchIndicators(
    [{ indicators: [{ type: 'domain', value: 'example.com', id: 'i1' }] }],
    [{ type: 'domain', value: 'other.com', where: 'w1' }]
  );
  assert.deepEqual(r, { matches: [], matchCount: 0, truncated: 0, observablesChecked: 1, indicatorsApplied: 1, indicatorsRejected: 0, indicatorSetsUnreadable: 0, appliedFraction: 1, complete: true, rejected: [], unreadableSets: [] });
});

test('reports rejected indicators and incomplete status', () => {
  const r = matchIndicators(
    [
      { indicators: [{ type: 'domain', value: 'example.com', id: 'i1' }], rejected: [{ type: 'domain', value: 'bad.com', reason: 'r' }] },
      { unknown: true, source: 's2', unknownReason: 'parse error' }
    ],
    [{ type: 'domain', value: 'example.com', where: 'w1' }]
  );
  assert.deepEqual(r, { matches: [{ indicator: { id: "i1", name: undefined, type: "domain", value: "example.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w1"] }], matchCount: 1, truncated: 0, observablesChecked: 1, indicatorsApplied: 1, indicatorsRejected: 1, indicatorSetsUnreadable: 1, appliedFraction: 0.5, complete: false, rejected: [{ type: "domain", value: "bad.com", reason: "r", source: null }], unreadableSets: [{ source: "s2", unknownReason: "parse error", unknownDetail: null }] });
});

test('truncates matches when count exceeds cap', () => {
  const indicators = Array.from({ length: 5 }, (_, i) => ({ type: 'domain', value: `d${i}.com`, id: `id${i}` }));
  const observables = Array.from({ length: 5 }, (_, i) => ({ type: 'domain', value: `d${i}.com`, where: `w${i}` }));
  const r = matchIndicators([{ indicators }], observables, { cap: 3 });
  assert.deepEqual(r, { matches: [{ indicator: { id: "id0", name: undefined, type: "domain", value: "d0.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w0"] }, { indicator: { id: "id1", name: undefined, type: "domain", value: "d1.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w1"] }, { indicator: { id: "id2", name: undefined, type: "domain", value: "d2.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w2"] }], matchCount: 5, truncated: 2, observablesChecked: 5, indicatorsApplied: 5, indicatorsRejected: 0, indicatorSetsUnreadable: 0, appliedFraction: 1, complete: true, rejected: [], unreadableSets: [] });
});

test('sorts matches by occurrence count descending then value ascending', () => {
  const r = matchIndicators(
    [{ indicators: [
      { type: 'domain', value: 'b.com', id: 'ib' },
      { type: 'domain', value: 'a.com', id: 'ia' },
      { type: 'domain', value: 'c.com', id: 'ic' }
    ] }],
    [
      { type: 'domain', value: 'b.com', where: 'w1' },
      { type: 'domain', value: 'b.com', where: 'w2' },
      { type: 'domain', value: 'a.com', where: 'w3' },
      { type: 'domain', value: 'c.com', where: 'w4' }
    ]
  );
  assert.deepEqual(r, { matches: [{ indicator: { id: "ib", name: undefined, type: "domain", value: "b.com", source: undefined }, observedType: "domain", occurrences: 2, where: ["w1", "w2"] }, { indicator: { id: "ia", name: undefined, type: "domain", value: "a.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w3"] }, { indicator: { id: "ic", name: undefined, type: "domain", value: "c.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w4"] }], matchCount: 3, truncated: 0, observablesChecked: 4, indicatorsApplied: 3, indicatorsRejected: 0, indicatorSetsUnreadable: 0, appliedFraction: 1, complete: true, rejected: [], unreadableSets: [] });
});

test('handles unreadable indicator sets in output', () => {
  const r = matchIndicators(
    [
      { indicators: [{ type: 'domain', value: 'example.com', id: 'i1' }] },
      { unknown: true, source: 's2', unknownReason: 'read error', unknownDetail: 'detail' }
    ],
    [{ type: 'domain', value: 'example.com', where: 'w1' }]
  );
  assert.deepEqual(r, { matches: [{ indicator: { id: "i1", name: undefined, type: "domain", value: "example.com", source: undefined }, observedType: "domain", occurrences: 1, where: ["w1"] }], matchCount: 1, truncated: 0, observablesChecked: 1, indicatorsApplied: 1, indicatorsRejected: 0, indicatorSetsUnreadable: 1, appliedFraction: 1, complete: false, rejected: [], unreadableSets: [{ source: "s2", unknownReason: "read error", unknownDetail: "detail" }] });
});
