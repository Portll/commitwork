// Parses CLI argv into an options object or an error (bin/secrets-sweep.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../secrets-sweep.mjs';

test('empty argv returns default opts with json false and failOnContext false', () => {
  assert.deepEqual(parseArgs([]), { paths: null, json: false, all: false, failOnContext: false, head: null });
});

test('the --json flag sets json to true', () => {
  assert.deepEqual(parseArgs(['--json']), { paths: null, json: true, all: false, failOnContext: false, head: null });
});

test('the --fail-on-context flag sets failOnContext to true', () => {
  assert.deepEqual(parseArgs(['--fail-on-context']), { paths: null, json: false, all: false, failOnContext: true, head: null });
});

test('the --no-fixture-exempt flag sets noFixtureExempt to true', () => {
  assert.deepEqual(parseArgs(['--no-fixture-exempt']), { paths: null, json: false, all: false, failOnContext: false, head: null, noFixtureExempt: true });
});

test('a positional path is collected into the paths array', () => {
  assert.deepEqual(parseArgs(['src']), { paths: ["src"], json: false, all: false, failOnContext: false, head: null });
});

test('an unknown flag returns an error naming the flag', () => {
  assert.deepEqual(parseArgs(['--bogus']), { error: "unknown flag: --bogus" });
});

test('--head with no following flag defaults head to HEAD', () => {
  assert.deepEqual(parseArgs(['--head']), { paths: null, json: false, all: false, failOnContext: false, head: "HEAD" });
});

test('--head followed by a non-flag token uses that token as the ref', () => {
  assert.deepEqual(parseArgs(['--head', 'main']), { paths: null, json: false, all: false, failOnContext: false, head: "main" });
});

test('--paths with a missing value returns an error', () => {
  assert.deepEqual(parseArgs(['--paths']), { error: "--paths needs a value" });
});

test('--max-bytes with a non-numeric value returns an error', () => {
  assert.deepEqual(parseArgs(['--max-bytes', 'abc']), { error: "--max-bytes needs a number" });
});

test('--help sets help to true', () => {
  assert.deepEqual(parseArgs(['--help']), { paths: null, json: false, all: false, failOnContext: false, head: null, help: true });
});

test('-h sets help to true', () => {
  assert.deepEqual(parseArgs(['-h']), { paths: null, json: false, all: false, failOnContext: false, head: null, help: true });
});
