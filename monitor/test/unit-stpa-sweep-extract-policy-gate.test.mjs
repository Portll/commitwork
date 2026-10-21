// Extracts policy gate configuration from source text (monitor/stpa-sweep.mjs extractPolicyGate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPolicyGate } from '../stpa-sweep.mjs';

test('returns null settableModes and detail message when API_SETTABLE_MODES is absent', () => {
  const source = `
    if (doc.mode !== undefined) {
      return send(403);
    }
    if (m3 && config.autoMerge === true) {
      merge();
    }
  `;
  const result = extractPolicyGate(source);
  assert.deepEqual(result, {
    settableModes: null,
    modeEscalationGated: true,
    autoMergeGated: true,
    detail: 'API_SETTABLE_MODES not found \u2014 this file does not match the known policy-gate shape at all',
  });
});

test('extracts settable modes and detects gates when all patterns are present', () => {
  const source = `
    const API_SETTABLE_MODES = new Set(['read', 'write', 'admin']);
    if (doc.mode !== undefined) {
      return send(403);
    }
    if (m3 && x.autoMerge === true) {
      merge();
    }
  `;
  const result = extractPolicyGate(source);
  assert.deepEqual(result, {
    settableModes: ['read', 'write', 'admin'],
    modeEscalationGated: true,
    autoMergeGated: true,
    detail: null,
  });
});

test('detects autoMerge gate via m3.autoMerge pattern', () => {
  const source = `
    const API_SETTABLE_MODES = new Set(['mode1']);
    if (doc.mode !== undefined) {
      return send(403);
    }
    if (m3.autoMerge === true) {
      merge();
    }
  `;
  const result = extractPolicyGate(source);
  assert.equal(result.autoMergeGated, true);
  assert.equal(result.modeEscalationGated, true);
  assert.deepEqual(result.settableModes, ['mode1']);
  assert.equal(result.detail, null);
});

test('returns false for modeEscalationGated when doc.mode check is missing', () => {
  const source = `
    const API_SETTABLE_MODES = new Set(['a']);
    if (m3 && y.autoMerge === true) {
      merge();
    }
  `;
  const result = extractPolicyGate(source);
  assert.equal(result.modeEscalationGated, false);
  assert.equal(result.autoMergeGated, true);
  assert.deepEqual(result.settableModes, ['a']);
  assert.equal(result.detail, null);
});

test('returns false for modeEscalationGated when send(403) is missing', () => {
  const source = `
    const API_SETTABLE_MODES = new Set(['b']);
    if (doc.mode !== undefined) {
      return send(200);
    }
  `;
  const result = extractPolicyGate(source);
  assert.equal(result.modeEscalationGated, false);
  assert.equal(result.autoMergeGated, false);
  assert.deepEqual(result.settableModes, ['b']);
  assert.equal(result.detail, null);
});

test('returns false for autoMergeGated when no autoMerge pattern matches', () => {
  const source = `
    const API_SETTABLE_MODES = new Set(['c']);
    if (doc.mode !== undefined) {
      return send(403);
    }
    if (m3 && z.autoMerge === false) {
      merge();
    }
  `;
  const result = extractPolicyGate(source);
  assert.equal(result.autoMergeGated, false);
  assert.equal(result.modeEscalationGated, true);
  assert.deepEqual(result.settableModes, ['c']);
  assert.equal(result.detail, null);
});

test('handles empty Set with no modes', () => {
  const source = `
    const API_SETTABLE_MODES = new Set([]);
    if (doc.mode !== undefined) {
      return send(403);
    }
  `;
  const result = extractPolicyGate(source);
  assert.deepEqual(result.settableModes, []);
  assert.equal(result.modeEscalationGated, true);
  assert.equal(result.autoMergeGated, false);
  assert.equal(result.detail, null);
});

test('extracts modes with underscores and hyphens', () => {
  const source = `
    const API_SETTABLE_MODES = new Set(['read-only', 'write_all', 'admin']);
    if (doc.mode !== undefined) {
      return send(403);
    }
    if (m3 && q.autoMerge === true) {
      merge();
    }
  `;
  const result = extractPolicyGate(source);
  assert.deepEqual(result.settableModes, ['read-only', 'write_all', 'admin']);
  assert.equal(result.modeEscalationGated, true);
  assert.equal(result.autoMergeGated, true);
  assert.equal(result.detail, null);
});
