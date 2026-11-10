// Picks an experience's stored text from its content or its decompressed blob (lib/memory-layer-client.mjs storedText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedText } from '../memory-layer-client.mjs';

const blob = (s) => {
  const lit = Buffer.from(s, 'latin1');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(lit.length);
  return Buffer.concat([size, Buffer.from([lit.length << 4]), lit]).toString('base64');
};
const withBlob = (content, decoded) => ({ content, metadata: { compressed_data: blob(decoded) } });
const pick = (r) => ({ text: r.text, source: r.source, contentBytes: r.contentBytes, recoveredBytes: r.recoveredBytes });

test('a flat experience with string content reports that content and its byte length', () => {
  assert.deepEqual(storedText({ content: 'hello' }), {
    text: 'hello',
    source: 'content',
    contentBytes: 5,
    recoveredBytes: null,
    attempts: [],
  });
});

test('a nested experience field is read instead of the outer object', () => {
  assert.deepEqual(storedText({ content: 'outer', experience: { content: 'caf\u00e9' } }), {
    text: 'caf\u00e9',
    source: 'content',
    contentBytes: 5,
    recoveredBytes: null,
    attempts: [],
  });
});

test('missing input or non-string content yields no text', () => {
  const none = { text: null, source: 'none', contentBytes: null, recoveredBytes: null, attempts: [] };
  assert.deepEqual(storedText(null), none);
  assert.deepEqual(storedText(undefined), none);
  assert.deepEqual(storedText({ content: 123 }), none);
});

test('an empty compressed_data string is skipped and content is kept', () => {
  assert.deepEqual(storedText({ content: 'text', metadata: { compressed_data: '' } }), {
    text: 'text',
    source: 'content',
    contentBytes: 4,
    recoveredBytes: null,
    attempts: [],
  });
});

test('a decoded blob exactly 90 percent printable is accepted and preferred over shorter content', () => {
  assert.deepEqual(pick(storedText(withBlob('abc', 'a'.repeat(9) + '\x01'))), {
    text: 'a'.repeat(9) + '\x01',
    source: 'compressed',
    contentBytes: 3,
    recoveredBytes: 10,
  });
});

test('a decoded blob just under 90 percent printable is rejected and content is kept', () => {
  assert.deepEqual(pick(storedText(withBlob('abc', 'a'.repeat(8) + '\x01'))), {
    text: 'abc',
    source: 'content',
    contentBytes: 3,
    recoveredBytes: null,
  });
});

test('a one-character decoded blob is used when there is no content', () => {
  assert.deepEqual(pick(storedText(withBlob(undefined, 'Q'))), {
    text: 'Q',
    source: 'compressed',
    contentBytes: null,
    recoveredBytes: 1,
  });
});

test('recovered text that is not longer than content after normalising leaves content in place', () => {
  assert.deepEqual(pick(storedText(withBlob('vwxyz', 'abcde'))), {
    text: 'vwxyz',
    source: 'content',
    contentBytes: 5,
    recoveredBytes: 5,
  });
  assert.deepEqual(pick(storedText(withBlob('vwxyz', 'abcd'))), {
    text: 'vwxyz',
    source: 'content',
    contentBytes: 5,
    recoveredBytes: 4,
  });
  assert.deepEqual(pick(storedText(withBlob('vwxyz', 'a  b  c'))), {
    text: 'vwxyz',
    source: 'content',
    contentBytes: 5,
    recoveredBytes: 7,
  });
});

test('recovered text one character longer than whitespace-collapsed content replaces it', () => {
  assert.deepEqual(pick(storedText(withBlob('  ab  cd  ', 'abcdef'))), {
    text: 'abcdef',
    source: 'compressed',
    contentBytes: 10,
    recoveredBytes: 6,
  });
});
