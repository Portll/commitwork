// Detects shell commands that read credential files or keychains (bin/agent-config.mjs credentialRead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialRead } from '../agent-config.mjs';

test('returns empty string for null input', () => {
  assert.equal(credentialRead(null), '');
});

test('returns empty string for empty string input', () => {
  assert.equal(credentialRead(''), '');
});

test('returns empty string for plain text without tools or credentials', () => {
  assert.equal(credentialRead('echo hello world'), '');
});

test('returns empty string when tool is present but no credential path', () => {
  assert.equal(credentialRead('cat /etc/hosts'), '');
});

test('returns empty string when credential path is present but no read tool', () => {
  assert.equal(credentialRead('ls ~/.ssh/id_rsa'), '');
});

test('returns message when cat reads ssh private key', () => {
  assert.equal(credentialRead('cat ~/.ssh/id_rsa'), 'reads a credential path');
});

test('returns message when grep reads aws credentials', () => {
  assert.equal(credentialRead('grep secret ~/.aws/credentials'), 'reads a credential path');
});

test('returns message when keychain lookup is used', () => {
  assert.equal(credentialRead('security find-generic-password -s myapp'), 'reads a credential path');
});

test('returns empty string when cp copies env file to env file', () => {
  assert.equal(credentialRead('cp .env .env.backup'), '');
});

test('returns empty string for env example files after replacement', () => {
  assert.equal(credentialRead('cat .env.example'), '');
});
