// Formats event fields into a newline-delimited body with absent placeholders (bin/upstream-fetch.mjs eventBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventBody } from '../upstream-fetch.mjs';

test('null field renders as absent', () => {
  const r = eventBody({ at: null, id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' });
  assert.equal(r, "absent\ni\nr\nt\na\ns\np");
});

test('undefined field renders as absent', () => {
  const r = eventBody({ at: undefined, id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' });
  assert.equal(r, "absent\ni\nr\nt\na\ns\np");
});

test('empty string field renders as absent', () => {
  const r = eventBody({ at: '', id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' });
  assert.equal(r, "absent\ni\nr\nt\na\ns\np");
});

test('non-empty string field renders as itself', () => {
  const r = eventBody({ at: 'x', id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' });
  assert.equal(r, "x\ni\nr\nt\na\ns\np");
});

test('zero number field renders as string zero', () => {
  const r = eventBody({ at: 0, id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' });
  assert.equal(r, "0\ni\nr\nt\na\ns\np");
});

test('false boolean field renders as string false', () => {
  const r = eventBody({ at: false, id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' });
  assert.equal(r, "false\ni\nr\nt\na\ns\np");
});

test('all fields absent produces seven absent lines', () => {
  const r = eventBody({ at: null, id: undefined, repo: '', tag: null, asset: undefined, sha256: '', publisherChecksums: null });
  assert.equal(r, "absent\nabsent\nabsent\nabsent\nabsent\nabsent\nabsent");
});

test('all fields present produces seven value lines', () => {
  const r = eventBody({ at: 'a', id: 'b', repo: 'c', tag: 'd', asset: 'e', sha256: 'f', publisherChecksums: 'g' });
  assert.equal(r, "a\nb\nc\nd\ne\nf\ng");
});
