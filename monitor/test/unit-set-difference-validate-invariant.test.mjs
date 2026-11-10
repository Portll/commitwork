// Validates that a repo-local invariant is a positive, add-only requirement (monitor/set-difference.mjs validateInvariant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInvariant } from '../set-difference.mjs';

test('rejects null input as non-object', () => {
  const r = validateInvariant(null);
  assert.deepEqual(r, { ok: false, errors: ["an invariant must be an object of the shape { set, must }"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects array input as non-object', () => {
  const r = validateInvariant([]);
  assert.deepEqual(r, { ok: false, errors: ["an invariant must be an object of the shape { set, must }"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects unknown key in invariant object', () => {
  const r = validateInvariant({ set: 'handlers', must: 'be tested', exempt: 'true' });
  assert.deepEqual(r, { ok: false, errors: ["unknown key \"exempt\" \u2014 a repo-local invariant is ADD-ONLY and may carry only { set, must, label, id, why, severity, tier }. Exempting/narrowing keys (exempt, except, only, skip, mustNot, override, disable, \u2026) are refused so a repo cannot shrink a fleet check from inside itself."], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects empty set string', () => {
  const r = validateInvariant({ set: '   ', must: 'be tested' });
  assert.deepEqual(r, { ok: false, errors: ["`set` must be a non-empty string selecting the population (e.g. \"handlers under /api/\")"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects negated must text', () => {
  const r = validateInvariant({ set: 'handlers', must: 'not call X' });
  assert.deepEqual(r, { ok: false, errors: ["`must` reads as an exemption (\"not call X\"); an ADD-ONLY invariant states a POSITIVE requirement, never a prohibition that removes members from a check"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('accepts valid invariant with label', () => {
  const r = validateInvariant({ set: 'handlers', must: 'be tested', label: 'My Label' });
  assert.deepEqual(r, { ok: true, errors: [], invariant: { set: "handlers", must: "be tested", label: "My Label", id: null }, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('accepts valid invariant without label', () => {
  const r = validateInvariant({ set: 'handlers', must: 'be tested' });
  assert.deepEqual(r, { ok: true, errors: [], invariant: { set: "handlers", must: "be tested", label: "handlers \u2014 every member must be tested", id: null }, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects non-string set value', () => {
  const r = validateInvariant({ set: 123, must: 'be tested' });
  assert.deepEqual(r, { ok: false, errors: ["`set` must be a non-empty string selecting the population (e.g. \"handlers under /api/\")"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects non-string must value', () => {
  const r = validateInvariant({ set: 'handlers', must: 456 });
  assert.deepEqual(r, { ok: false, errors: ["`must` must be a non-empty string naming the REQUIRED property \u2014 an invariant with no `must` adds nothing and can only be present to narrow, so it is refused"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});

test('rejects empty must string', () => {
  const r = validateInvariant({ set: 'handlers', must: '   ' });
  assert.deepEqual(r, { ok: false, errors: ["`must` must be a non-empty string naming the REQUIRED property \u2014 an invariant with no `must` adds nothing and can only be present to narrow, so it is refused"], invariant: null, addOnly: true, requiresTrust: true, trustFlag: "--trust-repo-manifest (or COMMITWORK_TRUST_REPO_MANIFEST=1)" });
});
