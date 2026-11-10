// Computes the verdict step for a receipt (admin/lib/memory-view.mjs verdictStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictStep } from '../lib/memory-view.mjs';

test('returns grey when state and storedForm are absent', () => {
  const input = {};
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "grey", tone: "grey", fields: [{ label: "state", state: "grey", value: null, note: null, tone: "grey", reason: "this receipt carries no state \u2014 the outcome of the write was never recorded" }, { label: "storedForm", state: "grey", value: null, note: null, tone: "grey", reason: "this receipt carries no stored form \u2014 whether the backend holds a copy was never determined" }], reason: "nothing in this step was observable from the evidence on this box", observedFields: 0, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: null, tone: "grey", meaning: null, reason: "this receipt carries no state \u2014 the outcome of the write was never recorded", declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: null, tone: "grey", meaning: null, reason: "this receipt carries no stored form \u2014 whether the backend holds a copy was never determined", declared: false }], notes: [] });
});

test('returns ok tone when state is VERIFIED and storedForm is STORED_FULL', () => {
  const input = { state: 'VERIFIED', storedForm: 'STORED_FULL' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "VERIFIED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_FULL", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "VERIFIED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_FULL", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('returns warn tone when state is ACCEPTED_UNVERIFIED and storedForm is STORED_PREVIEW', () => {
  const input = { state: 'ACCEPTED_UNVERIFIED', storedForm: 'STORED_PREVIEW' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "ACCEPTED_UNVERIFIED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_PREVIEW", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "ACCEPTED_UNVERIFIED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_PREVIEW", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('returns alarm tone when storedForm is STORED_DIVERGENT', () => {
  const input = { state: 'VERIFIED', storedForm: 'STORED_DIVERGENT' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "VERIFIED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_DIVERGENT", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "VERIFIED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_DIVERGENT", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('returns grey tone when state is NOT_ATTEMPTED', () => {
  const input = { state: 'NOT_ATTEMPTED', storedForm: 'STORED_FULL' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "NOT_ATTEMPTED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_FULL", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "NOT_ATTEMPTED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_FULL", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('adds a note when a degraded state has no reason', () => {
  const input = { state: 'FAILED', storedForm: 'STORED_FULL' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "FAILED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_FULL", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "FAILED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_FULL", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('adds a note when a degraded state has a reason', () => {
  const input = { state: 'FAILED', storedForm: 'STORED_FULL', reason: 'disk full' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "FAILED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_FULL", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "FAILED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_FULL", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["reason recorded: disk full"] });
});

test('returns alarm tone when state is FAILED and storedForm is STORED_DIVERGENT', () => {
  const input = { state: 'FAILED', storedForm: 'STORED_DIVERGENT' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "FAILED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_DIVERGENT", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "FAILED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_DIVERGENT", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('returns ok tone when state is VERIFIED and storedForm is STORED_UNKNOWN', () => {
  const input = { state: 'VERIFIED', storedForm: 'STORED_UNKNOWN' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "VERIFIED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_UNKNOWN", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "VERIFIED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_UNKNOWN", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});

test('returns warn tone when state is ACCEPTED_UNVERIFIED and storedForm is STORED_FULL', () => {
  const input = { state: 'ACCEPTED_UNVERIFIED', storedForm: 'STORED_FULL' };
  const result = verdictStep(input);
  assert.deepEqual(result, { n: 8, key: "verdict", title: "VERDICT", state: "observed", tone: "grey", fields: [{ label: "state", state: "observed", value: "ACCEPTED_UNVERIFIED", note: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", tone: "grey", reason: null }, { label: "storedForm", state: "observed", value: "STORED_FULL", note: "no stored form was recorded", tone: "grey", reason: null }], reason: null, observedFields: 2, totalFields: 2, axes: [{ axis: "state", question: "Did the write happen?", value: "ACCEPTED_UNVERIFIED", tone: "grey", meaning: "a state this panel does not declare \u2014 counted on its own axis, never binned into failed", reason: null, declared: false }, { axis: "storedForm", question: "Is what the backend holds a durable copy?", value: "STORED_FULL", tone: "grey", meaning: "no stored form was recorded", reason: null, declared: false }], notes: ["A degraded state with NO stated reason \u2014 the contract requires one, and its absence is itself the finding."] });
});
