// Extracts pinned action references from workflow text (bin/pin-actions.mjs parseWorkflow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflow } from '../pin-actions.mjs';

test('parses a simple pinned action with no comment', () => {
  const text = '  - uses: actions/checkout@v4';
  const result = parseWorkflow(text);
  assert.deepEqual(result, [
    { line: 0, action: 'actions/checkout', ref: 'v4', comment: null, prefix: '  - uses: ' }
  ]);
});

test('parses a pinned action with a trailing comment', () => {
  const text = '  - uses: actions/checkout@v4 # main';
  const result = parseWorkflow(text);
  assert.deepEqual(result, [
    { line: 0, action: 'actions/checkout', ref: 'v4', comment: 'main', prefix: '  - uses: ' }
  ]);
});

test('parses a subpath action with a pinned ref', () => {
  const text = '  - uses: github/codeql-action/init@v3';
  const result = parseWorkflow(text);
  assert.deepEqual(result, [
    { line: 0, action: 'github/codeql-action/init', ref: 'v3', comment: null, prefix: '  - uses: ' }
  ]);
});

test('ignores local composite actions starting with dot', () => {
  const text = '  - uses: ./local-action@v1';
  const result = parseWorkflow(text);
  assert.deepEqual(result, []);
});

test('ignores docker references', () => {
  const text = '  - uses: docker://alpine:latest';
  const result = parseWorkflow(text);
  assert.deepEqual(result, []);
});

test('ignores lines without a uses directive', () => {
  const text = '  - run: echo hello';
  const result = parseWorkflow(text);
  assert.deepEqual(result, []);
});

test('parses multiple actions across multiple lines', () => {
  const text = [
    '  - uses: actions/checkout@v4',
    '  - uses: actions/setup-node@v4',
    '  - uses: github/codeql-action/init@v3'
  ].join('\n');
  const result = parseWorkflow(text);
  assert.deepEqual(result, [
    { line: 0, action: 'actions/checkout', ref: 'v4', comment: null, prefix: '  - uses: ' },
    { line: 1, action: 'actions/setup-node', ref: 'v4', comment: null, prefix: '  - uses: ' },
    { line: 2, action: 'github/codeql-action/init', ref: 'v3', comment: null, prefix: '  - uses: ' }
  ]);
});

test('parses a pinned action with a sha ref', () => {
  const text = '  - uses: actions/checkout@8e5e7e5ab8b370d6c9eb4cbcc5014f99837aedeb';
  const result = parseWorkflow(text);
  assert.deepEqual(result, [
    { line: 0, action: 'actions/checkout', ref: '8e5e7e5ab8b370d6c9eb4cbcc5014f99837aedeb', comment: null, prefix: '  - uses: ' }
  ]);
});

test('parses a pinned action with a branch ref containing slashes', () => {
  const text = '  - uses: actions/checkout@feature/branch';
  const result = parseWorkflow(text);
  assert.deepEqual(result, [
    { line: 0, action: 'actions/checkout', ref: 'feature/branch', comment: null, prefix: '  - uses: ' }
  ]);
});

test('returns empty array for empty input', () => {
  const result = parseWorkflow('');
  assert.deepEqual(result, []);
});
