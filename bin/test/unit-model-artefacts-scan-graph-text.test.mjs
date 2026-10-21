// Counts ops and flags file/python ops in protobuf text (bin/model-artefacts.mjs scanGraphText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanGraphText } from '../model-artefacts.mjs';

test('returns zero ops and empty hits for empty text', () => {
  const result = scanGraphText('');
  assert.deepEqual(result, { opsSeen: 0, hits: {} });
});

test('counts a single ReadFile op as one op seen and one hit', () => {
  const text = 'node {\n  op: "ReadFile"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { ReadFile: 1 } });
});

test('counts a single WriteFile op as one op seen and one hit', () => {
  const text = 'node {\n  op: "WriteFile"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { WriteFile: 1 } });
});

test('counts a single PyFunc op as one op seen and one hit', () => {
  const text = 'node {\n  op: "PyFunc"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { PyFunc: 1 } });
});

test('counts a single PyFuncStateless op as one op seen and one hit', () => {
  const text = 'node {\n  op: "PyFuncStateless"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { PyFuncStateless: 1 } });
});

test('counts a single EagerPyFunc op as one op seen and one hit', () => {
  const text = 'node {\n  op: "EagerPyFunc"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { EagerPyFunc: 1 } });
});

test('counts a non-flagged op as one op seen with no hits', () => {
  const text = 'node {\n  op: "Add"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: {} });
});

test('counts multiple ops and accumulates hits for repeated flagged ops', () => {
  const text = 'node {\n  op: "ReadFile"\n}\nnode {\n  op: "ReadFile"\n}\nnode {\n  op: "Add"\n}\nnode {\n  op: "WriteFile"\n}';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 4, hits: { ReadFile: 2, WriteFile: 1 } });
});

test('handles leading whitespace before op keyword', () => {
  const text = '  op: "ReadFile"';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { ReadFile: 1 } });
});

test('handles extra spaces around op keyword and value', () => {
  const text = 'op   :   "ReadFile"';
  const result = scanGraphText(text);
  assert.deepEqual(result, { opsSeen: 1, hits: { ReadFile: 1 } });
});
