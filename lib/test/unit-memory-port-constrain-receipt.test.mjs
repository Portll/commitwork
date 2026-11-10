// Constrains a receipt against a capability, downgrading unverifiable states and flagging contradictions (lib/memory-port.mjs constrainReceipt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constrainReceipt, STORED_FULL, STORED_PREVIEW, STORED_UNKNOWN } from '../memory-port.mjs';

test('leaves a failed receipt untouched when the capability is full and the receipt is preview', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_FULL, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'failed', storedForm: STORED_PREVIEW, storedCoverage: 0.5 };
  const r = constrainReceipt(cap, receipt);
  assert.deepEqual(r, { state: "failed", storedForm: "preview", storedCoverage: 0.5, capabilityContradiction: "c1 declares storedFormGuarantee 'full' but this receipt reports 'preview' \u2014 the declaration is stale, and the OBSERVATION is what stands" });
});

test('leaves a failed receipt untouched when the capability is full and the receipt is full', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_FULL, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'failed', storedForm: STORED_FULL, storedCoverage: 1 };
  const r = constrainReceipt(cap, receipt);
  assert.deepEqual(r, { state: "failed", storedForm: "full", storedCoverage: 1, capabilityContradiction: null });
});

test('leaves a failed receipt untouched when the capability is preview and the receipt is preview', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_PREVIEW, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'failed', storedForm: STORED_PREVIEW, storedCoverage: 0.5 };
  const r = constrainReceipt(cap, receipt);
  assert.deepEqual(r, { state: "failed", storedForm: "preview", storedCoverage: 0.5, capabilityContradiction: null });
});

test('downgrades a verified receipt to accepted-unverified when the capability has no readback', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_FULL, supportsReadback: false, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_FULL, storedCoverage: 1 };
  const r = constrainReceipt(cap, receipt);
  assert.deepEqual(r, { state: "accepted-unverified", storedForm: "unknown", storedCoverage: null, capabilityContradiction: null, reason: "c1 declares no readback, so 'verified' cannot be earned \u2014 nothing read the record back" });
});

test('downgrades a verified receipt to accepted-unverified when the capability makes no stored-form guarantee', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_UNKNOWN, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_FULL, storedCoverage: 1 };
  const r = constrainReceipt(cap, receipt);
  assert.deepEqual(r, { state: "accepted-unverified", storedForm: "unknown", storedCoverage: null, capabilityContradiction: null, reason: "c1 makes no stored-form guarantee \u2014 the write was accepted and what the store kept is not established" });
});

test('downgrades a verified receipt to accepted-unverified when the capability is preview and no source size is supplied', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_PREVIEW, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_PREVIEW, storedCoverage: 0.5 };
  const r = constrainReceipt(cap, receipt);
  assert.deepEqual(r, { state: "accepted-unverified", storedForm: "unknown", storedCoverage: null, capabilityContradiction: null, reason: "c1 stores a ~100-byte preview and no source size was supplied, so 'verified' cannot be judged" });
});

test('downgrades a verified receipt to accepted-unverified when the source exceeds the preview budget and the receipt is full', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_PREVIEW, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_FULL, storedCoverage: 1 };
  const r = constrainReceipt(cap, receipt, { sourceBytes: 101 });
  assert.deepEqual(r, { state: "accepted-unverified", storedForm: "preview", storedCoverage: 1, capabilityContradiction: "c1 returned storedForm 'full' for a 101-byte document against a 100-byte budget \u2014 either the budget moved or the measurement is wrong; both need a human", reason: "c1 keeps at most ~100 bytes and the source is 101 \u2014 the write succeeded and the record is NOT a durable copy" });
});

test('downgrades a verified receipt to accepted-unverified when the source exceeds the preview budget and the receipt is preview', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_PREVIEW, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_PREVIEW, storedCoverage: 0.5 };
  const r = constrainReceipt(cap, receipt, { sourceBytes: 101 });
  assert.deepEqual(r, { state: "accepted-unverified", storedForm: "preview", storedCoverage: 0.5, capabilityContradiction: null, reason: "c1 keeps at most ~100 bytes and the source is 101 \u2014 the write succeeded and the record is NOT a durable copy" });
});

test('leaves a verified receipt untouched when the source equals the preview budget', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_PREVIEW, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_PREVIEW, storedCoverage: 0.5 };
  const r = constrainReceipt(cap, receipt, { sourceBytes: 100 });
  assert.deepEqual(r, { state: "verified", storedForm: "preview", storedCoverage: 0.5, capabilityContradiction: null });
});

test('leaves a verified receipt untouched when the source is one byte under the preview budget', () => {
  const cap = { name: 'c1', storedFormGuarantee: STORED_PREVIEW, supportsReadback: true, previewBytes: 100 };
  const receipt = { state: 'verified', storedForm: STORED_PREVIEW, storedCoverage: 0.5 };
  const r = constrainReceipt(cap, receipt, { sourceBytes: 99 });
  assert.deepEqual(r, { state: "verified", storedForm: "preview", storedCoverage: 0.5, capabilityContradiction: null });
});
