// Computes the stable group key for a scanner row (monitor/issue-store.mjs scannerGroupKeyFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerGroupKeyFor } from '../issue-store.mjs';

test('returns rule-based key when row has a rule', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', rule: 'R1' }, 'cat1');
  assert.equal(r, "gs:r1|cat1|R1");
});

test('returns identity-based key when rule is absent and identity fields are present', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', component: 'c1', id: 'i1' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|undefined");
});

test('returns undefined-discriminator key when rule is absent and identity fields are missing', () => {
  const r = scannerGroupKeyFor({ repo: 'r1' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|undefined");
});

test('returns rule-based key when rule is present even if identity fields are also present', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', rule: 'R1', component: 'c1', id: 'i1' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|R1");
});

test('returns undefined-discriminator key when rule is empty string and identity fields are missing', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', rule: '' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|undefined");
});

test('returns identity-based key when rule is null and identity fields are present', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', rule: null, component: 'c1', id: 'i1' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|undefined");
});

test('returns undefined-discriminator key when rule is undefined and identity fields are partially present', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', component: 'c1' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|undefined");
});

test('returns identity-based key when rule is 0 and identity fields are present', () => {
  const r = scannerGroupKeyFor({ repo: 'r1', rule: 0, component: 'c1', id: 'i1' }, 'retire.js');
  assert.equal(r, "gs:r1|retire.js|0");
});
