// Redacts embedded secrets and credential slots from a rule string (lib/security-agent-effective-config.mjs redactRule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactRule } from '../security-agent-effective-config.mjs';

test('returns the input unchanged and redacted false when no redaction markers are present', () => {
  const r = redactRule('hello world');
  assert.deepEqual(r, { text: "hello world", redacted: false });
});

test('returns the input unchanged and redacted true when no redaction markers are present', () => {
  const r = redactRule('hello world');
  assert.deepEqual(r, { text: "hello world", redacted: false });
});

test('returns the input unchanged and redacted false when redaction markers are present but no secret shapes match', () => {
  const r = redactRule('Authorization: Bearer abc123');
  assert.deepEqual(r, { text: "Authorization: Bearer [redacted]", redacted: true });
});

test('replaces a GitHub personal access token with the redacted placeholder', () => {
  const r = redactRule('token: ghp_' + 'a'.repeat(20));
  assert.deepEqual(r, { text: "token: [redacted]", redacted: true });
});

test('replaces a Slack webhook URL path with the redacted placeholder', () => {
  const r = redactRule('https://hooks.slack.com/services/T000/B000/' + 'x'.repeat(24));
  assert.deepEqual(r, { text: "https://hooks.slack.com/services/[redacted]", redacted: true });
});

test('replaces a credential slot value with the redacted placeholder when it is not a variable reference', () => {
  const r = redactRule('Authorization: Bearer abc123def456');
  assert.deepEqual(r, { text: "Authorization: Bearer [redacted]", redacted: true });
});

test('keeps a credential slot value when it is a whole variable reference', () => {
  const r = redactRule('Authorization: Bearer ${MY_TOKEN}');
  assert.deepEqual(r, { text: "Authorization: Bearer ${MY_TOKEN}", redacted: false });
});

test('replaces a credential slot value with the redacted placeholder when it is already the redacted placeholder', () => {
  const r = redactRule('Authorization: Bearer [redacted]');
  assert.deepEqual(r, { text: "Authorization: Bearer [redacted]", redacted: false });
});

test('reports redacted true when the output differs from the input', () => {
  const r = redactRule('Authorization: Bearer abc123def456');
  assert.deepEqual(r, { text: "Authorization: Bearer [redacted]", redacted: true });
});

test('reports redacted false when the output equals the input', () => {
  const r = redactRule('hello world');
  assert.deepEqual(r, { text: "hello world", redacted: false });
});
