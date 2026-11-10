// path to the chain file inside a history directory (monitor/history-chain.mjs chainPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainPath } from '../history-chain.mjs';

test('joins a simple history directory with chain.jsonl', () => {
  const r = chainPath('/tmp/hist');
  assert.equal(r, "/tmp/hist/chain.jsonl");
});

test('joins a nested history directory with chain.jsonl', () => {
  const r = chainPath('/a/b/c');
  assert.equal(r, "/a/b/c/chain.jsonl");
});

test('joins a dot directory with chain.jsonl', () => {
  const r = chainPath('.');
  assert.equal(r, "chain.jsonl");
});

test('joins a trailing slash directory with chain.jsonl', () => {
  const r = chainPath('/tmp/hist/');
  assert.equal(r, "/tmp/hist/chain.jsonl");
});

test('joins a long repeated directory with chain.jsonl', () => {
  const r = chainPath('x'.repeat(100));
  assert.equal(r, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/chain.jsonl");
});

test('joins an empty directory with chain.jsonl', () => {
  const r = chainPath('');
  assert.equal(r, "chain.jsonl");
});

test('joins a directory with spaces with chain.jsonl', () => {
  const r = chainPath('my hist');
  assert.equal(r, "my hist/chain.jsonl");
});

test('joins a directory with unicode with chain.jsonl', () => {
  const r = chainPath('h\u00e9\u00e9');
  assert.equal(r, "h\u00e9\u00e9/chain.jsonl");
});
