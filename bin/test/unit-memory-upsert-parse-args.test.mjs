// Parses CLI arguments into a config object (bin/memory-upsert.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../memory-upsert.mjs';

test('returns defaults for empty argv', () => {
  const r = parseArgs([]);
  assert.deepEqual(r, { file: null, externalId: null, scope: null, project: null, tags: "", type: "Context", json: false, help: false });
});

test('sets json flag to true when --json is present', () => {
  const r = parseArgs(['--json']);
  assert.deepEqual(r, { file: null, externalId: null, scope: null, project: null, tags: "", type: "Context", json: true, help: false });
});

test('sets help flag to true when --help is present', () => {
  const r = parseArgs(['--help']);
  assert.deepEqual(r, { file: null, externalId: null, scope: null, project: null, tags: "", type: "Context", json: false, help: true });
});

test('sets help flag to true when -h is present', () => {
  const r = parseArgs(['-h']);
  assert.deepEqual(r, { file: null, externalId: null, scope: null, project: null, tags: "", type: "Context", json: false, help: true });
});

test('assigns value to file when --file is provided', () => {
  const r = parseArgs(['--file', 'test.txt']);
  assert.deepEqual(r, { file: "test.txt", externalId: null, scope: null, project: null, tags: "", type: "Context", json: false, help: false });
});

test('throws when --file is missing its value', () => {
  assert.throws(() => parseArgs(['--file']), { name: 'Error', message: '--file needs a value' });
});

test('throws when --file value starts with --', () => {
  assert.throws(() => parseArgs(['--file', '--other']), { name: 'Error', message: '--file needs a value' });
});

test('accepts single dash as a valid value', () => {
  const r = parseArgs(['--file', '-']);
  assert.deepEqual(r, { file: "-", externalId: null, scope: null, project: null, tags: "", type: "Context", json: false, help: false });
});

test('throws for unknown argument', () => {
  assert.throws(() => parseArgs(['--unknown']), { name: 'Error', message: 'unknown argument "--unknown"' });
});

test('parses multiple valued arguments correctly', () => {
  const r = parseArgs(['--file', 'a.txt', '--external-id', 'ext1', '--scope', 's1', '--project', 'p1', '--tags', 't1,t2', '--type', 'Note']);
  assert.deepEqual(r, { file: "a.txt", externalId: "ext1", scope: "s1", project: "p1", tags: "t1,t2", type: "Note", json: false, help: false });
});
