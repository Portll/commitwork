// Extracts and validates the model completion text from an envelope (bin/lib/security-work-queue.mjs completionText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionText } from '../lib/security-work-queue.mjs';

test('returns the result field when present', () => {
  const envelope = { result: 'Hello world' };
  assert.equal(completionText(envelope), 'Hello world');
});

test('returns the choices message content when result is missing', () => {
  const envelope = { choices: [{ message: { content: 'From choices' } }] };
  assert.equal(completionText(envelope), 'From choices');
});

test('throws when is_error is true', () => {
  const envelope = { is_error: true, subtype: 'rate_limit' };
  assert.throws(() => completionText(envelope), /model execution failed: rate_limit/);
});

test('throws with unknown subtype when is_error is true and subtype is missing', () => {
  const envelope = { is_error: true };
  assert.throws(() => completionText(envelope), /model execution failed: unknown/);
});

test('throws when finish_reason is not stop', () => {
  const envelope = { result: 'text', choices: [{ finish_reason: 'length' }] };
  assert.throws(() => completionText(envelope), /incomplete completion: length/);
});

test('returns text when finish_reason is stop', () => {
  const envelope = { result: 'done', choices: [{ finish_reason: 'stop' }] };
  assert.equal(completionText(envelope), 'done');
});

test('throws when text is empty string', () => {
  const envelope = { result: '' };
  assert.throws(() => completionText(envelope), /empty model completion/);
});

test('throws when text is whitespace only', () => {
  const envelope = { result: '   ' };
  assert.throws(() => completionText(envelope), /empty model completion/);
});

test('throws when text is not a string', () => {
  const envelope = { result: 123 };
  assert.throws(() => completionText(envelope), /empty model completion/);
});

test('throws when envelope is null', () => {
  assert.throws(() => completionText(null), /empty model completion/);
});
