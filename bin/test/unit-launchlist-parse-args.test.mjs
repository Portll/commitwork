// Parses CLI argv into command, positional args, and flags (bin/launchlist.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../launchlist.mjs';

test('returns empty positional and flags for empty argv', () => {
  const result = parseArgs([]);
  assert.deepEqual(result, { cmd: undefined, positional: [], flags: {} });
});

test('sets cmd to first arg and leaves rest empty', () => {
  const result = parseArgs(['scan']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: {} });
});

test('collects non-dash args into positional array', () => {
  const result = parseArgs(['scan', 'repo1', 'repo2']);
  assert.deepEqual(result, { cmd: 'scan', positional: ['repo1', 'repo2'], flags: {} });
});

test('sets boolean flag true for --all', () => {
  const result = parseArgs(['scan', '--all']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: { all: true } });
});

test('sets boolean flag true for --history', () => {
  const result = parseArgs(['scan', '--history']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: { history: true } });
});

test('sets boolean flag true for --tests', () => {
  const result = parseArgs(['scan', '--tests']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: { tests: true } });
});

test('sets boolean flag true for --json', () => {
  const result = parseArgs(['scan', '--json']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: { json: true } });
});

test('sets boolean flag true for --help', () => {
  const result = parseArgs(['scan', '--help']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: { help: true } });
});

test('returns error when value flag is last arg', () => {
  const result = parseArgs(['scan', '--name']);
  assert.deepEqual(result, { error: '--name needs a value' });
});

test('returns error when value flag followed by another flag', () => {
  const result = parseArgs(['scan', '--name', '--all']);
  assert.deepEqual(result, { error: '--name needs a value' });
});

test('assigns next arg as value for non-boolean flag', () => {
  const result = parseArgs(['scan', '--name', 'myrepo']);
  assert.deepEqual(result, { cmd: 'scan', positional: [], flags: { name: 'myrepo' } });
});

test('mixes positional args and flags correctly', () => {
  const result = parseArgs(['scan', 'repo1', '--all', 'repo2', '--name', 'x']);
  assert.deepEqual(result, { cmd: 'scan', positional: ['repo1', 'repo2'], flags: { all: true, name: 'x' } });
});
