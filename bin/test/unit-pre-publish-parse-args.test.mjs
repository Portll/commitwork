// Parses CLI flags into an options object or an error (bin/pre-publish.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../pre-publish.mjs';

test('empty argv returns defaults', () => {
  assert.deepEqual(parseArgs([]), { paths: null, ref: null, json: false, journalIt: true, draft: false });
});

test('json flag sets json true', () => {
  assert.deepEqual(parseArgs(['--json']), { paths: null, ref: null, json: true, journalIt: true, draft: false });
});

test('no-journal flag sets journalIt false', () => {
  assert.deepEqual(parseArgs(['--no-journal']), { paths: null, ref: null, json: false, journalIt: false, draft: false });
});

test('draft-reviews flag sets draft true', () => {
  assert.deepEqual(parseArgs(['--draft-reviews']), { paths: null, ref: null, json: false, journalIt: true, draft: true });
});

test('paths flag parses comma list', () => {
  assert.deepEqual(parseArgs(['--paths', 'a, b ,c']), { paths: ["a", "b", "c"], ref: null, json: false, journalIt: true, draft: false });
});

test('ref flag sets ref', () => {
  assert.deepEqual(parseArgs(['--ref', 'main']), { paths: null, ref: "main", json: false, journalIt: true, draft: false });
});

test('help flag sets help true', () => {
  assert.deepEqual(parseArgs(['--help']), { paths: null, ref: null, json: false, journalIt: true, draft: false, help: true });
});

test('short help flag sets help true', () => {
  assert.deepEqual(parseArgs(['-h']), { paths: null, ref: null, json: false, journalIt: true, draft: false, help: true });
});

test('unknown flag returns error', () => {
  assert.deepEqual(parseArgs(['--bogus']), { error: "unknown flag: --bogus" });
});

test('paths and ref together returns error', () => {
  assert.deepEqual(parseArgs(['--paths', 'a', '--ref', 'main']), { error: "--paths and --ref name different worlds; pick one" });
});
