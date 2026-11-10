// Detects credential keys paired with server file paths in JSON (bin/webshell-detect.mjs dropperState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropperState } from '../webshell-detect.mjs';

test('returns null for invalid JSON', () => {
  assert.equal(dropperState('not json'), null);
});

test('returns null for JSON array', () => {
  assert.equal(dropperState('[1, 2, 3]'), null);
});

test('returns null for JSON primitive', () => {
  assert.equal(dropperState('"hello"'), null);
});

test('returns null when no credential keys present', () => {
  const input = JSON.stringify({ username: 'admin', file: 'shell.php' });
  assert.equal(dropperState(input), null);
});

test('returns null when no server file values present', () => {
  const input = JSON.stringify({ password: 'secret123', name: 'bob' });
  assert.equal(dropperState(input), null);
});

test('returns null when credential value is too short', () => {
  const input = JSON.stringify({ password: 'abc', file: 'shell.php' });
  assert.equal(dropperState(input), null);
});

test('returns null when credential value is not a string', () => {
  const input = JSON.stringify({ password: 123456, file: 'shell.php' });
  assert.equal(dropperState(input), null);
});

test('returns state with credential keys and sanitized filenames', () => {
  const input = JSON.stringify({ password: 'secret123', file: 'uploads/shell.php' });
  const result = dropperState(input);
  assert.deepEqual(result, { credKeys: ['password'], named: ['shell.php'] });
});

test('returns state with multiple credential keys and files', () => {
  const input = JSON.stringify({ 
    token: 'abcdef123', 
    key: 'xyz789', 
    target: 'admin/index.aspx', 
    payload: 'data/shell.phtml' 
  });
  const result = dropperState(input);
  assert.deepEqual(result, { credKeys: ['token', 'key'], named: ['index.aspx', 'shell.phtml'] });
});

test('sanitizes non-alphanumeric characters in filenames', () => {
  const input = JSON.stringify({ secret: 'longpassword', file: 'my file.php' });
  const result = dropperState(input);
  assert.deepEqual(result, null);
});
