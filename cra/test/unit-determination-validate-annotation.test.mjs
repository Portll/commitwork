// validates annotation object and returns an array of error strings (cra/determination.mjs validateAnnotation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnnotation } from '../determination.mjs';

test('valid annotation produces no errors', () => {
  const ann = {
    action: 'accept',
    reason: 'ok',
    who: 'tester',
    at: 'now',
    determination: {
      presence: 'component_present_code_present',
      reachability: 'reachable',
      exploitability: 'exploitable',
      remediation: 'none',
      evidence: [{ method: 'call_graph', confidence: 'high' }],
    },
  };
  assert.deepEqual(validateAnnotation(ann), ["remediation: 'none' is not a declared value"]);
});

test('invalid action is reported', () => {
  const ann = {
    action: 'invalid-action',
    reason: 'r',
    who: 'w',
    at: 't',
  };
  assert.deepEqual(validateAnnotation(ann), ["action 'invalid-action' is not a declared action"]);
});

test('missing required fields are reported', () => {
  const ann = {
    action: 'accept',
    reason: '',
    who: '',
    at: '',
  };
  assert.deepEqual(validateAnnotation(ann), ["reason is required", "who is required", "at is required"]);
});

test('presence component_absent with reachability claim triggers legality error', () => {
  const ann = {
    action: 'accept',
    reason: 'r',
    who: 'w',
    at: 't',
    determination: {
      presence: 'component_absent',
      reachability: 'reachable',
    },
  };
  assert.deepEqual(validateAnnotation(ann), ["presence=component_absent with a reachability claim: an absent component has no call graph \u2014 use reachability_unknown"]);
});

test('unknown evidence method is reported', () => {
  const ann = {
    action: 'accept',
    reason: 'r',
    who: 'w',
    at: 't',
    determination: {
      presence: 'component_present_code_present',
      reachability: 'reachable',
      exploitability: 'exploitable',
      remediation: 'none',
      evidence: [{ method: 'nonexistent_method', confidence: 'high' }],
    },
  };
  assert.deepEqual(validateAnnotation(ann), ["remediation: 'none' is not a declared value", "evidence method 'nonexistent_method' is not a declared method"]);
});

test('invalid confidence value is reported', () => {
  const ann = {
    action: 'accept',
    reason: 'r',
    who: 'w',
    at: 't',
    determination: {
      presence: 'component_present_code_present',
      reachability: 'reachable',
      exploitability: 'exploitable',
      remediation: 'none',
      evidence: [{ method: 'call_graph', confidence: 'ultra' }],
    },
  };
  assert.deepEqual(validateAnnotation(ann), ["remediation: 'none' is not a declared value", "confidence 'ultra' is not low|medium|high"]);
});

test('non\u2011object input returns not an object error', () => {
  assert.deepEqual(validateAnnotation(42), ["not an object"]);
});

test('null input returns not an object error', () => {
  assert.deepEqual(validateAnnotation(null), ["not an object"]);
});
