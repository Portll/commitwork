// Checks whether a deny list contains a Read or Bash rule that matches credential paths (bin/agent-config.mjs denyCoversCredentials).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { denyCoversCredentials } from '../agent-config.mjs';

test('returns false when deny is not an array', () => {
  assert.equal(denyCoversCredentials(null), false);
  assert.equal(denyCoversCredentials(undefined), false);
  assert.equal(denyCoversCredentials('Read(/.ssh)'), false);
  assert.equal(denyCoversCredentials({}), false);
});

test('returns false when deny is an empty array', () => {
  assert.equal(denyCoversCredentials([]), false);
});

test('returns false when entries do not start with Read( or Bash(', () => {
  assert.equal(denyCoversCredentials(['Write(/.ssh)']), false);
  assert.equal(denyCoversCredentials(['read(/.ssh)']), false);
  assert.equal(denyCoversCredentials(['bash(/.ssh)']), false);
  assert.equal(denyCoversCredentials(['Read /.ssh']), false);
  assert.equal(denyCoversCredentials(['Bash /.ssh']), false);
});

test('returns true when a Read rule matches .ssh', () => {
  assert.equal(denyCoversCredentials(['Read(/.ssh)']), true);
  assert.equal(denyCoversCredentials(['Read(/.ssh/**)']), true);
});

test('returns true when a Bash rule matches .aws', () => {
  assert.equal(denyCoversCredentials(['Bash(/.aws)']), true);
  assert.equal(denyCoversCredentials(['Bash(/.aws/**)']), true);
});

test('returns true when a Read rule matches .netrc', () => {
  assert.equal(denyCoversCredentials(['Read(/.netrc)']), true);
});

test('returns true when a Read rule matches .npmrc', () => {
  assert.equal(denyCoversCredentials(['Read(/.npmrc)']), true);
});

test('returns true when a Read rule matches .git-credentials', () => {
  assert.equal(denyCoversCredentials(['Read(/.git-credentials)']), true);
});

test('returns true when a Read rule matches .docker/config', () => {
  assert.equal(denyCoversCredentials(['Read(/.docker/config)']), true);
});

test('returns true when a Read rule matches .kube/config', () => {
  assert.equal(denyCoversCredentials(['Read(/.kube/config)']), true);
});

test('returns true when a Read rule matches .gnupg', () => {
  assert.equal(denyCoversCredentials(['Read(/.gnupg)']), true);
});

test('returns true when a Read rule matches .env at start of string', () => {
  assert.equal(denyCoversCredentials(['Read(/.env)']), true);
});

test('returns true when a Read rule matches .env after whitespace', () => {
  assert.equal(denyCoversCredentials(['Read(/.env file)']), true);
});

test('returns true when a Read rule matches .env after slash', () => {
  assert.equal(denyCoversCredentials(['Read(/.env/secret)']), true);
});

test('returns true when a Read rule matches .env after opening paren', () => {
  assert.equal(denyCoversCredentials(['Read(/.env(.*)']), true);
});

test('returns false when .env is part of a longer word', () => {
  assert.equal(denyCoversCredentials(['Read(/.environment)']), false);
  assert.equal(denyCoversCredentials(['Read(/.env.example)']), true);
});

test('returns true when any entry in a multi-entry list matches credentials', () => {
  assert.equal(denyCoversCredentials(['Read(/src/**)', 'Read(/.ssh)']), true);
  assert.equal(denyCoversCredentials(['Read(/.ssh)', 'Read(/src/**)']), true);
});

test('returns false when no entry matches credentials', () => {
  assert.equal(denyCoversCredentials(['Read(/src/**)', 'Read(/lib/**)']), false);
  assert.equal(denyCoversCredentials(['Bash(ls)', 'Read(/docs/**)']), false);
});

test('handles non-string entries by converting to string', () => {
  assert.equal(denyCoversCredentials([123]), false);
  assert.equal(denyCoversCredentials([null]), false);
  assert.equal(denyCoversCredentials([{}]), false);
});

test('returns true for Bash rule matching .docker/config', () => {
  assert.equal(denyCoversCredentials(['Bash(/.docker/config)']), true);
});

test('returns true for Bash rule matching .kube/config', () => {
  assert.equal(denyCoversCredentials(['Bash(/.kube/config)']), true);
});

test('returns true for Bash rule matching .gnupg', () => {
  assert.equal(denyCoversCredentials(['Bash(/.gnupg)']), true);
});

test('returns true for Bash rule matching .env', () => {
  assert.equal(denyCoversCredentials(['Bash(/.env)']), true);
});

test('returns false for Read rule with .ssh not at word boundary', () => {
  assert.equal(denyCoversCredentials(['Read(/.sshkey)']), false);
});

test('returns false for Read rule with .aws not at word boundary', () => {
  assert.equal(denyCoversCredentials(['Read(/.awsome)']), false);
});

test('returns false for Read rule with .netrc not at word boundary', () => {
  assert.equal(denyCoversCredentials(['Read(/.netrcs)']), false);
});

test('returns false for Read rule with .npmrc not at word boundary', () => {
  assert.equal(denyCoversCredentials(['Read(/.npmrcs)']), false);
});

test('returns false for Read rule with .git-credentials not at word boundary', () => {
  assert.equal(denyCoversCredentials(['Read(/.git-credentials2)']), false);
});

test('returns false for Read rule with .gnupg not at word boundary', () => {
  assert.equal(denyCoversCredentials(['Read(/.gnupgs)']), false);
});
