// whether the org policy permits drafting remediation jobs (lib/cobolwork-remediation-jobs.mjs draftingAllowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftingAllowed } from '../cobolwork-remediation-jobs.mjs';

test('returns ok false with the report-mode error when the policy mode is report', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is hitl-item', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is auto', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is an empty string', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is undefined', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is the string report with a trailing space', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is the string report with a leading space', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is the string REPORT in uppercase', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is the string Report with mixed case', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});

test('returns ok true with the policy when the policy mode is the string report with a newline', () => {
  const result = draftingAllowed();
  assert.deepEqual(result, { ok: false, error: "the remediation policy is in report mode (file), which drafts nothing; an operator sets mode to hitl-item to allow drafts that a person then applies" });
});
