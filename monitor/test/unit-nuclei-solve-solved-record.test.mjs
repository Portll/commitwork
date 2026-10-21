// Builds a normalized record object from a raw nuclei result and a verdict (monitor/nuclei-solve.mjs solvedRecord).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solvedRecord } from '../nuclei-solve.mjs';

test('maps template-id and basic fields with empty verdict extras', () => {
  const rec = {
    'template-id': 'tpl-1',
    host: 'example.com',
    port: 80,
    type: 'http',
    info: { severity: 'high' }
  };
  const verdict = {
    confirmation: 'confirmed',
    signals: ['sig-b', 'sig-a'],
    rule: { id: 'rule-1', digest: 'abc' }
  };
  const result = solvedRecord(rec, verdict);
  assert.deepEqual(result, {
    templateId: 'tpl-1',
    host: 'example.com',
    port: '80',
    proto: 'http',
    severity: 'high',
    confirmation: 'confirmed',
    signals: ['sig-a', 'sig-b'],
    ruleId: 'rule-1',
    ruleDigest: 'abc'
  });
});

test('falls back to templateID when template-id is missing', () => {
  const rec = {
    templateID: 'tpl-2',
    host: 'test.org',
    port: 443,
    type: 'https',
    info: { severity: 'medium' }
  };
  const verdict = {
    confirmation: 'pending',
    signals: [],
    rule: null
  };
  const result = solvedRecord(rec, verdict);
  assert.deepEqual(result, {
    templateId: 'tpl-2',
    host: 'test.org',
    port: '443',
    proto: 'https',
    severity: 'medium',
    confirmation: 'pending',
    signals: [],
    ruleId: '',
    ruleDigest: null
  });
});

test('returns empty strings for missing optional fields', () => {
  const rec = {};
  const verdict = {
    confirmation: 'unknown',
    signals: ['x'],
    rule: null
  };
  const result = solvedRecord(rec, verdict);
  assert.deepEqual(result, {
    templateId: '',
    host: '',
    port: '',
    proto: '',
    severity: '',
    confirmation: 'unknown',
    signals: ['x'],
    ruleId: '',
    ruleDigest: null
  });
});

test('includes contradictor and why when present in verdict', () => {
  const rec = {
    'template-id': 'tpl-3',
    host: 'a.com',
    port: 8080,
    type: 'http',
    info: { severity: 'low' }
  };
  const verdict = {
    confirmation: 'denied',
    signals: ['s1', 's2'],
    rule: { id: 'r2', digest: 'def' },
    contradictor: 'other-rule',
    why: 'reason text'
  };
  const result = solvedRecord(rec, verdict);
  assert.deepEqual(result, {
    templateId: 'tpl-3',
    host: 'a.com',
    port: '8080',
    proto: 'http',
    severity: 'low',
    confirmation: 'denied',
    signals: ['s1', 's2'],
    ruleId: 'r2',
    ruleDigest: 'def',
    contradictor: 'other-rule',
    why: 'reason text'
  });
});

test('omits contradictor and why keys when not in verdict', () => {
  const rec = {
    'template-id': 'tpl-4',
    host: 'b.com',
    port: 22,
    type: 'ssh',
    info: { severity: 'critical' }
  };
  const verdict = {
    confirmation: 'confirmed',
    signals: ['z'],
    rule: { id: 'r3', digest: 'ghi' }
  };
  const result = solvedRecord(rec, verdict);
  assert.ok(!('contradictor' in result));
  assert.ok(!('why' in result));
  assert.equal(result.templateId, 'tpl-4');
  assert.equal(result.ruleId, 'r3');
});

test('sorts signals alphabetically', () => {
  const rec = { 'template-id': 'tpl-5' };
  const verdict = {
    confirmation: 'c',
    signals: ['banana', 'apple', 'cherry'],
    rule: null
  };
  const result = solvedRecord(rec, verdict);
  assert.deepEqual(result.signals, ['apple', 'banana', 'cherry']);
});

test('handles missing info object gracefully', () => {
  const rec = {
    'template-id': 'tpl-6',
    host: 'c.com',
    port: 80,
    type: 'http'
  };
  const verdict = {
    confirmation: 'ok',
    signals: [],
    rule: { id: 'r4', digest: 'jkl' }
  };
  const result = solvedRecord(rec, verdict);
  assert.equal(result.severity, '');
  assert.equal(result.templateId, 'tpl-6');
});

test('converts numeric port to string', () => {
  const rec = {
    'template-id': 'tpl-7',
    host: 'd.com',
    port: 12345,
    type: 'tcp',
    info: { severity: 'info' }
  };
  const verdict = {
    confirmation: 'x',
    signals: ['a'],
    rule: null
  };
  const result = solvedRecord(rec, verdict);
  assert.equal(result.port, '12345');
  assert.equal(typeof result.port, 'string');
});
