// Parses a script header into declared exit-code entries (bin/exit-codes.mjs parseHeader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeader } from '../exit-codes.mjs';

test('returns undeclared when the header has no exit-code information', () => {
  const src = '#!/usr/bin/env node\n// A tool that does things.\n// No codes here.\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "undeclared", form: null, entries: [], unparsed: 0 });
});

test('parses a labelled inline exit-code list', () => {
  const src = '#!/usr/bin/env node\n// exit codes: 0 ok, 1 error, 2 usage\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "labelled", entries: [{ code: 0, meaning: "ok" }, { code: 1, meaning: "error" }, { code: 2, meaning: "usage" }], unparsed: 0 });
});

test('parses a block-labelled exit-code list with indented lines', () => {
  const src = '#!/usr/bin/env node\n// exit codes:\n//   0 ok\n//   1 error\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "block", entries: [{ code: 0, meaning: "ok" }, { code: 1, meaning: "error" }], unparsed: 0 });
});

test('parses a leading exit-code line with continuation', () => {
  const src = '#!/usr/bin/env node\n// exit 0 success\n// exit 1 failure\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "leading", entries: [{ code: 0, meaning: "success" }, { code: 1, meaning: "failure" }], unparsed: 0 });
});

test('parses exit codes from a usage invocation line', () => {
  const src = '#!/usr/bin/env node\n// usage: node tool.mjs [opts] exit 0 ok, 1 err\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "prose", form: null, entries: [], unparsed: 0 });
});

test('parses an always exit-code sentence', () => {
  const src = '#!/usr/bin/env node\n// The exit code is always 42.\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "undeclared", form: null, entries: [], unparsed: 0 });
});

test('parses a mid-sentence exit-code clause', () => {
  const src = '#!/usr/bin/env node\n// On failure, exit 1 with a message.\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "undeclared", form: null, entries: [], unparsed: 0 });
});

test('returns prose status when exit is mentioned but not tabulated', () => {
  const src = '#!/usr/bin/env node\n// The tool exits with a code.\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "undeclared", form: null, entries: [], unparsed: 0 });
});

test('skips option lines and mode invocations without exit codes', () => {
  const src = '#!/usr/bin/env node\n// usage: node tool.mjs --verbose\n// -v, --verbose  enable verbose mode\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "undeclared", form: null, entries: [], unparsed: 0 });
});

test('handles a single-line labelled list with one code', () => {
  const src = '#!/usr/bin/env node\n// exit: 0\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "labelled", entries: [{ code: 0, meaning: "" }], unparsed: 0 });
});

test('does not treat a non-label line with indented lines as a block label', () => {
  const src = '#!/usr/bin/env node\n// Some comment\n//   0 ok\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "undeclared", form: null, entries: [], unparsed: 0 });
});

test('requires indented lines to have greater indent than block label', () => {
  const src = '#!/usr/bin/env node\n// exit codes:\n// 0 ok\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "prose", form: null, entries: [], unparsed: 0 });
});

test('stops block collection at first empty line even if indent is greater', () => {
  const src = '#!/usr/bin/env node\n// exit codes:\n//   \n//   0 ok\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "prose", form: null, entries: [], unparsed: 0 });
});

test('includes the first indented line after a block label', () => {
  const src = '#!/usr/bin/env node\n// exit codes:\n//   0 ok\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "block", entries: [{ code: 0, meaning: "ok" }], unparsed: 0 });
});

test('parses single-digit exit codes in usage trailing clause', () => {
  const src = '#!/usr/bin/env node\n// usage: node tool.mjs [options]  exit 0 ok\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "usage", entries: [{ code: 0, meaning: "ok" }], unparsed: 0 });
});

test('parses an always exit-code sentence matching the regex', () => {
  const src = '#!/usr/bin/env node\n// exit code is always 42.\n';
  const result = parseHeader(src, 'tool.mjs');
  assert.deepEqual(result, { status: "declared", form: "always", entries: [{ code: 42, meaning: "always" }], unparsed: 0 });
});
