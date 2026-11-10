// Records a defect classification with owner, basis, evidence, and history (monitor/issue-store.mjs classifyDefect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDefect } from '../issue-store.mjs';

test('rejects invalid defect owner', () => {
  const doc = { issues: { 'i1': {} }, events: [] };
  assert.throws(() => classifyDefect(doc, 'i1', { owner: 'bogus', basis: 'commit', evidence: 'e', at: 't' }), {
    name: 'Error',
    message: 'defectOwner must be one of instrument|upstream|subject|undetermined'
  });
});

test('rejects missing basis', () => {
  const doc = { issues: { 'i1': {} }, events: [] };
  assert.throws(() => classifyDefect(doc, 'i1', { owner: 'subject', basis: '', evidence: 'e', at: 't' }), {
    name: 'Error',
    message: "classify requires basis: 'commit' (derived from a sha), 'adjudication' (a human judged it) or 'model-agreement'"
  });
});

test('rejects invalid basis', () => {
  const doc = { issues: { 'i1': {} }, events: [] };
  assert.throws(() => classifyDefect(doc, 'i1', { owner: 'subject', basis: 'guess', evidence: 'e', at: 't' }), {
    name: 'Error',
    message: "classify requires basis: 'commit' (derived from a sha), 'adjudication' (a human judged it) or 'model-agreement'"
  });
});

test('rejects empty evidence', () => {
  const doc = { issues: { 'i1': {} }, events: [] };
  assert.throws(() => classifyDefect(doc, 'i1', { owner: 'subject', basis: 'commit', evidence: '', at: 't' }), {
    name: 'Error',
    message: 'classify requires evidence'
  });
});

test('rejects unknown issue id', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => classifyDefect(doc, 'missing', { owner: 'subject', basis: 'commit', evidence: 'e', at: 't' }), {
    name: 'Error',
    message: 'unknown issue missing'
  });
});

test('classifies new issue with null from and count 1', () => {
  const doc = { issues: { 'i1': {} }, events: [] };
  const r = classifyDefect(doc, 'i1', { owner: 'subject', basis: 'commit', evidence: 'sha-abc', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { defectOwner: "subject", defectBasis: "commit", classifyCount: 1, updatedAt: "2024-01-01T00:00:00Z" });
});

test('classifies existing issue with prior owner and count 2', () => {
  const doc = { issues: { 'i1': { defectOwner: 'upstream', classifyCount: 1 } }, events: [] };
  const r = classifyDefect(doc, 'i1', { owner: 'subject', basis: 'adjudication', evidence: 'human note', at: '2024-01-02T00:00:00Z' });
  assert.deepEqual(r, { defectOwner: "subject", classifyCount: 2, defectBasis: "adjudication", updatedAt: "2024-01-02T00:00:00Z" });
});

test('classifies with model-agreement basis', () => {
  const doc = { issues: { 'i1': {} }, events: [] };
  const r = classifyDefect(doc, 'i1', { owner: 'instrument', basis: 'model-agreement', evidence: 'model said so', at: '2024-01-03T00:00:00Z' });
  assert.deepEqual(r, { defectOwner: "instrument", defectBasis: "model-agreement", classifyCount: 1, updatedAt: "2024-01-03T00:00:00Z" });
});
