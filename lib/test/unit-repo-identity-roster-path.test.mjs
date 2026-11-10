// The roster JSON path, from the env override or the repo monitor default (lib/repo-identity.mjs rosterPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterPath } from '../repo-identity.mjs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT = join(REPO, 'monitor', 'repo-identity.json');

test('returns the env roster path when CW_REPO_IDENTITY_ROSTER is an absolute path', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: '/custom/roster.json' });
  assert.equal(r, '/custom/roster.json');
});

test('returns the default repo monitor path when env has no override', () => {
  const r = rosterPath({});
  assert.equal(r, DEFAULT);
});

test('returns the default repo monitor path when CW_REPO_IDENTITY_ROSTER is undefined', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: undefined });
  assert.equal(r, DEFAULT);
});

test('returns the default repo monitor path when CW_REPO_IDENTITY_ROSTER is an empty string', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: '' });
  assert.equal(r, DEFAULT);
});

test('returns a relative override unchanged without joining it to the repo', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: 'relative/path.json' });
  assert.equal(r, 'relative/path.json');
});

test('returns the default repo monitor path when CW_REPO_IDENTITY_ROSTER is zero', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: 0 });
  assert.equal(r, DEFAULT);
});

test('returns the default repo monitor path when CW_REPO_IDENTITY_ROSTER is false', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: false });
  assert.equal(r, DEFAULT);
});

test('returns a truthy non-string override as is', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: 123 });
  assert.equal(r, 123);
});

test('returns a single-character override unchanged', () => {
  const r = rosterPath({ CW_REPO_IDENTITY_ROSTER: 'x' });
  assert.equal(r, 'x');
});
