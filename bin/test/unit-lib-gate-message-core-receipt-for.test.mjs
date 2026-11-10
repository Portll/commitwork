// Computes an attribution receipt for a message that claims authorship (bin/lib/gate-message-core.mjs receiptFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptFor } from '../lib/gate-message-core.mjs';

test('returns empty string when text does not claim attribution', () => {
  const r = receiptFor('hello world', () => ({ basis: 'write', session: 's1' }));
  assert.equal(r, "");
});

test('returns no-path receipt when attribution is claimed but no path is named', () => {
  const r = receiptFor('you touched the code', () => ({ basis: 'write', session: 's1' }));
  assert.equal(r, "\n\n[attribution receipt] This message asserts authorship but names no path, so nothing here can be checked. Say which file, or say that you are asking rather than telling.");
});

test('returns write evidence row when authorFor returns write basis', () => {
  const r = receiptFor('you touched src/lib/foo.mjs', () => ({ basis: 'write', session: 'sess-abc' }));
  assert.equal(r, "\n\n[attribution receipt] all 1 claim(s) below rest on write evidence:\n  src/lib/foo.mjs \u2014 write evidence: sess-abc");
});

test('returns contested row when authorFor returns contested basis with sessions', () => {
  const r = receiptFor('you touched src/lib/foo.mjs', () => ({ basis: 'contested', sessions: ['a', 'b'] }));
  assert.equal(r, "\n\n[attribution receipt] all 1 claim(s) below rest on write evidence:\n  src/lib/foo.mjs \u2014 CONTESTED: a, b");
});

test('returns no write evidence row when authorFor returns unknown basis', () => {
  const r = receiptFor('you touched src/lib/foo.mjs', () => ({ basis: 'unknown' }));
  assert.equal(r, "\n\n[attribution receipt] 1 of 1 claim(s) below rest on NO write evidence. Asking is fine; telling is not:\n  src/lib/foo.mjs \u2014 NO WRITE EVIDENCE. Nothing shows who wrote this.");
});

test('returns no write evidence row when authorFor returns null', () => {
  const r = receiptFor('you touched src/lib/foo.mjs', () => null);
  assert.equal(r, "\n\n[attribution receipt] all 1 claim(s) below rest on write evidence:\n  src/lib/foo.mjs \u2014 NO WRITE EVIDENCE. Nothing shows who wrote this.");
});

test('returns all-proven head when all paths have write evidence', () => {
  const r = receiptFor('you touched src/lib/foo.mjs and src/lib/bar.mjs', () => ({ basis: 'write', session: 's1' }));
  assert.equal(r, "\n\n[attribution receipt] all 2 claim(s) below rest on write evidence:\n  src/lib/foo.mjs \u2014 write evidence: s1\n  src/lib/bar.mjs \u2014 write evidence: s1");
});

test('returns unproven head when some paths have unknown basis', () => {
  const r = receiptFor('you touched src/lib/foo.mjs and src/lib/bar.mjs', (p) => p.includes('foo') ? { basis: 'write', session: 's1' } : { basis: 'unknown' });
  assert.equal(r, "\n\n[attribution receipt] 1 of 2 claim(s) below rest on NO write evidence. Asking is fine; telling is not:\n  src/lib/foo.mjs \u2014 write evidence: s1\n  src/lib/bar.mjs \u2014 NO WRITE EVIDENCE. Nothing shows who wrote this.");
});
