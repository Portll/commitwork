// Lists credential-shaped env keys not declared by the check, excluding harness keys (bin/lib/scanner-env.mjs withheldCredentials).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withheldCredentials } from '../lib/scanner-env.mjs';

test('returns empty array when check executes repo code', () => {
  const r = withheldCredentials({ executesRepoCode: true }, { GITHUB_TOKEN: 'x', HOME: '/h' });
  assert.deepEqual(r, []);
});

test('returns empty array when check is null and no credential keys exist', () => {
  const r = withheldCredentials(null, { HOME: '/h', PATH: '/usr/bin' });
  assert.deepEqual(r, []);
});

test('returns sorted credential keys when check is null', () => {
  const r = withheldCredentials(null, { GITHUB_TOKEN: 'x', HOME: '/h', DB_PASSWORD: 'y' });
  assert.deepEqual(r, ["DB_PASSWORD", "GITHUB_TOKEN"]);
});

test('excludes credential keys declared via requires.secrets', () => {
  const r = withheldCredentials({ requires: { secrets: ['GITHUB_TOKEN'] } }, { GITHUB_TOKEN: 'x', DB_PASSWORD: 'y' });
  assert.deepEqual(r, ["DB_PASSWORD"]);
});

test('excludes credential keys declared via envPassthrough exact match', () => {
  const r = withheldCredentials({ envPassthrough: ['DB_PASSWORD'] }, { GITHUB_TOKEN: 'x', DB_PASSWORD: 'y' });
  assert.deepEqual(r, ["GITHUB_TOKEN"]);
});

test('excludes credential keys declared via envPassthrough wildcard', () => {
  const r = withheldCredentials({ envPassthrough: ['DB_*'] }, { GITHUB_TOKEN: 'x', DB_PASSWORD: 'y' });
  assert.deepEqual(r, ["GITHUB_TOKEN"]);
});

test('excludes credential keys declared via sandboxExtraReads for GH names', () => {
  const r = withheldCredentials({ sandboxExtraReads: ['~/.config/gh'] }, { GITHUB_TOKEN: 'x', DB_PASSWORD: 'y' });
  assert.deepEqual(r, ["DB_PASSWORD"]);
});

test('returns empty array when check executes repo code is false', () => {
  const r = withheldCredentials({ executesRepoCode: false }, { GITHUB_TOKEN: 'x', HOME: '/h' });
  assert.deepEqual(r, ["GITHUB_TOKEN"]);
});

test('returns empty array when check is empty object and no credential keys', () => {
  const r = withheldCredentials({}, { HOME: '/h', PATH: '/usr/bin' });
  assert.deepEqual(r, []);
});
