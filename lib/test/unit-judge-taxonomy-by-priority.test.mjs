// Sorts findings by severity, urgency, size, then original index (lib/judge-taxonomy.mjs byPriority).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byPriority } from '../judge-taxonomy.mjs';

test('returns empty array for empty input', () => {
  const input = [];
  const result = byPriority(input);
  assert.deepEqual(result, []);
});

test('preserves order for single finding', () => {
  const input = [{ severity: 'critical', urgency: 'high', size: 'small' }];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "critical", urgency: "high", size: "small" }]);
});

test('sorts by severity first with critical before low', () => {
  const input = [
    { severity: 'low', urgency: 'low', size: 'small' },
    { severity: 'critical', urgency: 'low', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "critical", urgency: "low", size: "small" }, { severity: "low", urgency: "low", size: "small" }]);
});

test('breaks severity ties by urgency with high before low', () => {
  const input = [
    { severity: 'medium', urgency: 'low', size: 'small' },
    { severity: 'medium', urgency: 'high', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "medium", urgency: "high", size: "small" }, { severity: "medium", urgency: "low", size: "small" }]);
});

test('breaks severity and urgency ties by size with small before large', () => {
  const input = [
    { severity: 'medium', urgency: 'medium', size: 'large' },
    { severity: 'medium', urgency: 'medium', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "medium", urgency: "medium", size: "small" }, { severity: "medium", urgency: "medium", size: "large" }]);
});

test('preserves original index order for identical keys', () => {
  const input = [
    { severity: 'medium', urgency: 'medium', size: 'medium' },
    { severity: 'medium', urgency: 'medium', size: 'medium' },
    { severity: 'medium', urgency: 'medium', size: 'medium' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "medium", urgency: "medium", size: "medium" }, { severity: "medium", urgency: "medium", size: "medium" }, { severity: "medium", urgency: "medium", size: "medium" }]);
});

test('sorts undetermined severity after known severities', () => {
  const input = [
    { severity: 'unknown', urgency: 'low', size: 'small' },
    { severity: 'critical', urgency: 'low', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "critical", urgency: "low", size: "small" }, { severity: "unknown", urgency: "low", size: "small" }]);
});

test('sorts undetermined urgency after known urgencies when severity ties', () => {
  const input = [
    { severity: 'medium', urgency: 'unknown', size: 'small' },
    { severity: 'medium', urgency: 'high', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "medium", urgency: "high", size: "small" }, { severity: "medium", urgency: "unknown", size: "small" }]);
});

test('sorts undetermined size after known sizes when severity and urgency tie', () => {
  const input = [
    { severity: 'medium', urgency: 'medium', size: 'unknown' },
    { severity: 'medium', urgency: 'medium', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "medium", urgency: "medium", size: "small" }, { severity: "medium", urgency: "medium", size: "unknown" }]);
});

test('handles mixed severities with full priority ordering', () => {
  const input = [
    { severity: 'low', urgency: 'high', size: 'large' },
    { severity: 'critical', urgency: 'low', size: 'small' },
    { severity: 'medium', urgency: 'medium', size: 'medium' },
    { severity: 'high', urgency: 'high', size: 'small' }
  ];
  const result = byPriority(input);
  assert.deepEqual(result, [{ severity: "critical", urgency: "low", size: "small" }, { severity: "high", urgency: "high", size: "small" }, { severity: "medium", urgency: "medium", size: "medium" }, { severity: "low", urgency: "high", size: "large" }]);
});
