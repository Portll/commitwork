// Whether a check declares a credential name (bin/lib/scanner-env.mjs declaresCredential).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaresCredential } from '../lib/scanner-env.mjs';

test('returns false when check is null', () => {
  assert.equal(declaresCredential(null, 'GH_TOKEN'), false);
});

test('returns false when check is undefined', () => {
  assert.equal(declaresCredential(undefined, 'GH_TOKEN'), false);
});

test('returns true when name is in requires.secrets', () => {
  const check = { requires: { secrets: ['GH_TOKEN'] } };
  assert.equal(declaresCredential(check, 'GH_TOKEN'), true);
});

test('returns false when requires exists but secrets is missing', () => {
  const check = { requires: { other: ['GH_TOKEN'] } };
  assert.equal(declaresCredential(check, 'GH_TOKEN'), false);
});

test('returns true when sandboxExtraReads has GH_STORE and name is a GH name', () => {
  const check = { sandboxExtraReads: ['~/.config/gh'] };
  assert.equal(declaresCredential(check, 'GITHUB_TOKEN'), true);
});

test('returns false when sandboxExtraReads has GH_STORE but name is not a GH name', () => {
  const check = { sandboxExtraReads: ['~/.config/gh'] };
  assert.equal(declaresCredential(check, 'MY_TOKEN'), false);
});

test('returns true when envPassthrough has exact match', () => {
  const check = { envPassthrough: ['MY_TOKEN'] };
  assert.equal(declaresCredential(check, 'MY_TOKEN'), true);
});

test('returns true when envPassthrough has wildcard prefix match', () => {
  const check = { envPassthrough: ['GH_*'] };
  assert.equal(declaresCredential(check, 'GH_TOKEN'), true);
});

test('returns false when envPassthrough wildcard does not match', () => {
  const check = { envPassthrough: ['GH_*'] };
  assert.equal(declaresCredential(check, 'MY_TOKEN'), false);
});

test('returns false when no branch matches', () => {
  const check = { requires: { secrets: ['OTHER'] }, sandboxExtraReads: ['/other'], envPassthrough: ['X_*'] };
  assert.equal(declaresCredential(check, 'GH_TOKEN'), false);
});
