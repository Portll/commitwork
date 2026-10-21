// Parses CLI arguments into an options object or an error (bin/release-terms.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../release-terms.mjs';

test('returns defaults for empty argv', () => {
  assert.deepEqual(parseArgs([]), { ref: null, root: null, json: false, showPaths: false });
});

test('sets ref when --ref is provided with a value', () => {
  assert.deepEqual(parseArgs(['--ref', 'v1.0.0']), { ref: 'v1.0.0', root: null, json: false, showPaths: false });
});

test('sets root when --root is provided with a value', () => {
  assert.deepEqual(parseArgs(['--root', '/tmp/repo']), { ref: null, root: '/tmp/repo', json: false, showPaths: false });
});

test('sets json to true when --json is provided', () => {
  assert.deepEqual(parseArgs(['--json']), { ref: null, root: null, json: true, showPaths: false });
});

test('sets showPaths to true when --show-paths is provided', () => {
  assert.deepEqual(parseArgs(['--show-paths']), { ref: null, root: null, json: false, showPaths: true });
});

test('returns error when --ref is missing its value', () => {
  assert.deepEqual(parseArgs(['--ref']), { error: '--ref needs a value' });
});

test('returns error when --root is missing its value', () => {
  assert.deepEqual(parseArgs(['--root']), { error: '--root needs a value' });
});

test('returns error when --ref value starts with --', () => {
  assert.deepEqual(parseArgs(['--ref', '--json']), { error: '--ref needs a value' });
});

test('returns error when --root value starts with --', () => {
  assert.deepEqual(parseArgs(['--root', '--show-paths']), { error: '--root needs a value' });
});

test('returns error for unknown argument', () => {
  assert.deepEqual(parseArgs(['--unknown']), { error: 'unknown argument --unknown' });
});

test('returns error when both --ref and --root are provided', () => {
  assert.deepEqual(parseArgs(['--ref', 'v1', '--root', '/tmp']), { error: '--ref and --root are alternatives' });
});

test('combines multiple valid flags', () => {
  assert.deepEqual(parseArgs(['--ref', 'v2', '--json', '--show-paths']), { ref: 'v2', root: null, json: true, showPaths: true });
});
