// Parses CLI arguments into a config object (bin/memory-query.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../memory-query.mjs';

test('returns defaults for empty input', () => {
  const r = parseArgs([]);
  assert.deepEqual(r, { json: false, content: false, limit: 50, subcommand: null, value: null, help: false });
});

test('sets json flag true', () => {
  const r = parseArgs(['--json']);
  assert.deepEqual(r, { json: true, content: false, limit: 50, subcommand: null, value: null, help: false });
});

test('sets content flag true', () => {
  const r = parseArgs(['--content']);
  assert.deepEqual(r, { json: false, content: true, limit: 50, subcommand: null, value: null, help: false });
});

test('sets help flag true for --help', () => {
  const r = parseArgs(['--help']);
  assert.deepEqual(r, { json: false, content: false, limit: 50, subcommand: null, value: null, help: true });
});

test('sets help flag true for -h', () => {
  const r = parseArgs(['-h']);
  assert.deepEqual(r, { json: false, content: false, limit: 50, subcommand: null, value: null, help: true });
});

test('parses valid limit value', () => {
  const r = parseArgs(['--limit', '10']);
  assert.deepEqual(r, { json: false, content: false, limit: 10, subcommand: null, value: null, help: false });
});

test('throws for non-integer limit', () => {
  assert.throws(() => parseArgs(['--limit', 'abc']), { name: 'Error', message: '--limit needs a positive integer, got "abc"' });
});

test('throws for zero limit', () => {
  assert.throws(() => parseArgs(['--limit', '0']), { name: 'Error', message: '--limit needs a positive integer, got "0"' });
});

test('parses stats subcommand', () => {
  const r = parseArgs(['--stats']);
  assert.deepEqual(r, { json: false, content: false, limit: 50, subcommand: 'stats', value: null, help: false });
});

test('parses tags subcommand with value', () => {
  const r = parseArgs(['--tags', 'foo']);
  assert.deepEqual(r, { json: false, content: false, limit: 50, subcommand: 'tags', value: 'foo', help: false });
});

test('throws for duplicate subcommand', () => {
  assert.throws(() => parseArgs(['--stats', '--adapters']), { name: 'Error', message: 'one subcommand at a time \u2014 already have --stats' });
});

test('throws for unknown argument', () => {
  assert.throws(() => parseArgs(['--unknown']), { name: 'Error', message: 'unknown argument "--unknown"' });
});
