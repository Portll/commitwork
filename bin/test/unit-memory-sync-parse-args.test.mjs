// Parses CLI flags into a config object (bin/memory-sync.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../memory-sync.mjs';

test('empty argv returns defaults', () => {
  assert.deepEqual(parseArgs([]), { mode: null, json: false, help: false, dir: null, limit: null });
});

test('json flag sets json true', () => {
  assert.deepEqual(parseArgs(['--json']), { mode: null, json: true, help: false, dir: null, limit: null });
});

test('help flag sets help true', () => {
  assert.deepEqual(parseArgs(['--help']), { mode: null, json: false, help: true, dir: null, limit: null });
});

test('short help flag sets help true', () => {
  assert.deepEqual(parseArgs(['-h']), { mode: null, json: false, help: true, dir: null, limit: null });
});

test('coverage flag sets mode to coverage', () => {
  assert.deepEqual(parseArgs(['--coverage']), { mode: "coverage", json: false, help: false, dir: null, limit: null });
});

test('dry flag sets mode to dry', () => {
  assert.deepEqual(parseArgs(['--dry']), { mode: "dry", json: false, help: false, dir: null, limit: null });
});

test('apply flag sets mode to apply', () => {
  assert.deepEqual(parseArgs(['--apply']), { mode: "apply", json: false, help: false, dir: null, limit: null });
});

test('dir flag consumes next arg', () => {
  assert.deepEqual(parseArgs(['--dir', '/tmp/x']), { mode: null, json: false, help: false, dir: "/tmp/x", limit: null });
});

test('limit flag consumes next arg as number', () => {
  assert.deepEqual(parseArgs(['--limit', '5']), { mode: null, json: false, help: false, dir: null, limit: 5 });
});

test('unknown flag throws error', () => {
  assert.throws(() => parseArgs(['--bogus']), { name: 'Error', message: 'unknown argument: --bogus' });
});
