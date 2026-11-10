import { test } from 'node:test';
import assert from 'node:assert/strict';
import { severityFromScore, normSeverity, normUrgency, normSize, priorityKey, byPriority, classify, UNDETERMINED } from '../judge-taxonomy.mjs';

test('severityFromScore buckets CVSS, rejects out of range', () => {
  assert.equal(severityFromScore(9.8), 'crit');
  assert.equal(severityFromScore(7), 'high');
  assert.equal(severityFromScore(4), 'med');
  assert.equal(severityFromScore(3.9), 'low');
  assert.equal(severityFromScore(11), null);
  assert.equal(severityFromScore('nope'), null);
});

test('normSeverity reads scores, aliases, else undetermined', () => {
  assert.equal(normSeverity(9.1), 'crit');
  assert.equal(normSeverity('Critical'), 'crit');
  assert.equal(normSeverity('warning'), 'med');
  assert.equal(normSeverity('info'), 'low');
  assert.equal(normSeverity('banana'), UNDETERMINED);
  assert.equal(normSeverity(null), UNDETERMINED);
});

test('normUrgency does not borrow score semantics', () => {
  assert.equal(normUrgency('high'), 'high');
  assert.equal(normUrgency(9.9), UNDETERMINED); // a number is not an urgency word
});

test('normSize normalises t-shirt sizes', () => {
  assert.equal(normSize('xl'), 'XL');
  assert.equal(normSize('Small'), 'S');
  assert.equal(normSize('M'), 'M');
  assert.equal(normSize('huge'), UNDETERMINED);
});

test('priorityKey: severity dominates, then urgency, then smaller size first', () => {
  const crit = priorityKey({ severity: 'crit', urgency: 'low', size: 'XL' });
  const high = priorityKey({ severity: 'high', urgency: 'crit', size: 'XS' });
  assert.ok(crit[0] < high[0], 'crit severity outranks high regardless of urgency');
  const a = priorityKey({ severity: 'high', urgency: 'high', size: 'S' });
  const b = priorityKey({ severity: 'high', urgency: 'high', size: 'L' });
  assert.ok(a[2] < b[2], 'smaller fix sorts first at equal risk');
});

test('undetermined risk sorts after every known bucket', () => {
  const ordered = byPriority([
    { id: 'u', severity: 'banana', urgency: 'banana', size: 'M' },
    { id: 'low', severity: 'low', urgency: 'low', size: 'M' },
    { id: 'crit', severity: 'crit', urgency: 'crit', size: 'M' },
  ]);
  assert.deepEqual(ordered.map((x) => x.id), ['crit', 'low', 'u']);
});

test('byPriority is stable within equal keys', () => {
  const ordered = byPriority([
    { id: 'a', severity: 'high', urgency: 'high', size: 'M' },
    { id: 'b', severity: 'high', urgency: 'high', size: 'M' },
  ]);
  assert.deepEqual(ordered.map((x) => x.id), ['a', 'b']);
});

test('classify fills all three axes explicitly', () => {
  assert.deepEqual(classify({ score: 9.5, size: 'L' }), { severity: 'crit', urgency: UNDETERMINED, size: 'L' });
  assert.deepEqual(classify({ severity: 'high', urgency: 'low', size: 's' }), { severity: 'high', urgency: 'low', size: 'S' });
});
