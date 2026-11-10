// validation of a remediation policy object (monitor/remediation-policy.mjs validatePolicy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, validatePolicy } from '../remediation-policy.mjs';

test('returns error when input is null', () => {
  const { errors, advisories } = validatePolicy(null);
  assert.deepStrictEqual(errors, ['remediation policy is not an object']);
  assert.deepStrictEqual(advisories, []);
});

test('returns error when input is an array', () => {
  const { errors, advisories } = validatePolicy([]);
  assert.deepStrictEqual(errors, ['remediation policy is not an object']);
  assert.deepStrictEqual(advisories, []);
});

test('enum validation adds errors for unknown mode, verification, learning and cadence', () => {
  const doc = {
    mode: 'unknown',
    verification: 'triple',
    learning: 'maybe',
    cadence: 'yearly'
  };
  const { errors, advisories } = validatePolicy(doc);
  assert.ok(errors.includes(`mode must be one of ${MODES.join('|')} (got "unknown")`));
  assert.ok(errors.includes('verification must be one of single|double-arbitrate (got "triple")'));
  assert.ok(errors.includes('learning must be one of off|on (got "maybe")'));
  assert.ok(errors.includes('cadence must be one of daily|72h|weekly|fortnightly|monthly|quarterly|biannual|annual (got "yearly")'));
  assert.deepStrictEqual(advisories, []);
});

test('budget percentage validation rejects non\u2011numeric and out\u2011of\u2011range values', () => {
  const doc = { remediationBudgetPctOfCompute: '50' };
  const { errors, advisories } = validatePolicy(doc);
  assert.ok(errors.includes('remediationBudgetPctOfCompute must be a number in [0,100]'));
  assert.deepStrictEqual(advisories, []);
});

test('budget percentage accepts boundary values 0 and 100', () => {
  const docZero = { remediationBudgetPctOfCompute: 0 };
  const { errors: e0, advisories: a0 } = validatePolicy(docZero);
  assert.ok(!e0.includes('remediationBudgetPctOfCompute must be a number in [0,100]'));
  assert.deepStrictEqual(a0, []);

  const docHundred = { remediationBudgetPctOfCompute: 100 };
  const { errors: e100, advisories: a100 } = validatePolicy(docHundred);
  assert.ok(!e100.includes('remediationBudgetPctOfCompute must be a number in [0,100]'));
  assert.deepStrictEqual(a100, []);
});

test('advisory for full\u2011agentic with autoMerge but no owner', () => {
  const doc = {
    mode: 'full-agentic',
    m3: { autoMerge: true }
  };
  const { errors, advisories } = validatePolicy(doc);
  assert.ok(advisories.includes('mode=full-agentic with m3.autoMerge and no m3.owner \u2014 name an accountable owner (best practice; not forced)'));
  assert.deepStrictEqual(errors, []);
});

test('advisory for hitl\u2011agentic or full\u2011agentic with single verification', () => {
  const doc1 = { mode: 'hitl-agentic', verification: 'single' };
  const { advisories: adv1 } = validatePolicy(doc1);
  assert.ok(adv1.includes('mode=hitl-agentic with verification=single \u2014 agentic remediation on a single check; double-arbitrate is recommended'));

  const doc2 = { mode: 'full-agentic', verification: 'single' };
  const { advisories: adv2 } = validatePolicy(doc2);
  assert.ok(adv2.includes('mode=full-agentic with verification=single \u2014 agentic remediation on a single check; double-arbitrate is recommended'));
});

test('no advisories when conditions are not met', () => {
  const doc = {
    mode: 'report',
    verification: 'double-arbitrate',
    learning: 'on',
    cadence: 'daily',
    remediationBudgetPctOfCompute: 42,
    m3: { autoMerge: false, owner: 'alice' }
  };
  const { errors, advisories } = validatePolicy(doc);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(advisories, []);
});
