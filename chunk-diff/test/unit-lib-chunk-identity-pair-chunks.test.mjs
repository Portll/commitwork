// Pairs old and new chunks into diff states (chunk-diff/lib/chunk-identity.mjs pairChunks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairChunks } from '../lib/chunk-identity.mjs';

test('returns noBaseline true with all new chunks as ADDED when old is empty', () => {
  const r = pairChunks([], [{ src: 'hello' }, { src: 'world' }]);
  assert.deepEqual(r, { noBaseline: true, pairs: [{ state: "ADDED", old: null, new: { src: "hello", rawHash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", normHash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", idx: 0 } }, { state: "ADDED", old: null, new: { src: "world", rawHash: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7", normHash: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7", idx: 1 } }] });
});

test('returns noBaseline false with empty pairs when both old and new are empty', () => {
  const r = pairChunks([], []);
  assert.deepEqual(r, { noBaseline: true, pairs: [] });
});

test('marks identical chunks as MATCHED with no moved hint when positions align', () => {
  const r = pairChunks([{ src: 'alpha' }, { src: 'beta' }], [{ src: 'alpha' }, { src: 'beta' }]);
  assert.deepEqual(r, { noBaseline: false, pairs: [{ state: "MATCHED", old: { src: "alpha", rawHash: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8", normHash: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8", idx: 0 }, new: { src: "alpha", rawHash: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8", normHash: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8", idx: 0 } }, { state: "MATCHED", old: { src: "beta", rawHash: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753", normHash: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753", idx: 1 }, new: { src: "beta", rawHash: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753", normHash: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753", idx: 1 } }] });
});

test('marks whitespace-only differences as WHITESPACE_ONLY', () => {
  const r = pairChunks([{ src: 'hello world' }], [{ src: 'hello  world' }]);
  assert.deepEqual(r, { noBaseline: false, pairs: [{ state: "WHITESPACE_ONLY", old: { src: "hello world", rawHash: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", normHash: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", idx: 0 }, new: { src: "hello  world", rawHash: "e519e9540ff8a84d732c6f6e8db424d9abf4125078130221763fa573067a9059", normHash: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", idx: 0 } }] });
});

test('marks edited chunks as EDITED when similarity exceeds threshold', () => {
  const r = pairChunks([{ src: 'the quick brown fox jumps over the lazy dog' }], [{ src: 'the quick brown fox leaps over the lazy dog' }]);
  assert.deepEqual(r, { noBaseline: false, pairs: [{ state: "EDITED", old: { src: "the quick brown fox jumps over the lazy dog", rawHash: "05c6e08f1d9fdafa03147fcb8f82f124c76d2f70e3d989dc8aadb5e7d7450bec", normHash: "05c6e08f1d9fdafa03147fcb8f82f124c76d2f70e3d989dc8aadb5e7d7450bec", idx: 0 }, new: { src: "the quick brown fox leaps over the lazy dog", rawHash: "e835c7bd2adc251db767e6e61af2f85b779dbfdc410bd6e66ba63f19c451063e", normHash: "e835c7bd2adc251db767e6e61af2f85b779dbfdc410bd6e66ba63f19c451063e", idx: 0 }, similarity: 0.8888888888888888 }] });
});

test('marks unmatched old chunks as DELETED and unmatched new as ADDED', () => {
  const r = pairChunks([{ src: 'unique old content here' }], [{ src: 'completely different new text' }]);
  assert.deepEqual(r, { noBaseline: false, pairs: [{ state: "DELETED", old: { src: "unique old content here", rawHash: "7dbb1c8246b6173e9ca0838c48ee583959c415865f339ec03d3fa2f03ffe007c", normHash: "7dbb1c8246b6173e9ca0838c48ee583959c415865f339ec03d3fa2f03ffe007c", idx: 0 }, new: null }, { state: "ADDED", old: null, new: { src: "completely different new text", rawHash: "d88ed01b8a3e998e98215308d0118f5a77342de8477db4dc48f0eda6c6a1881a", normHash: "d88ed01b8a3e998e98215308d0118f5a77342de8477db4dc48f0eda6c6a1881a", idx: 0 } }] });
});

test('marks duplicate content as AMBIGUOUS when key appears multiple times', () => {
  const r = pairChunks([{ src: 'dup' }, { src: 'dup' }], [{ src: 'dup' }, { src: 'dup' }]);
  assert.deepEqual(r, { noBaseline: false, pairs: [{ state: "AMBIGUOUS", old: { src: "dup", rawHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", normHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", idx: 0 }, new: { src: "dup", rawHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", normHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", idx: 0 } }, { state: "AMBIGUOUS", old: { src: "dup", rawHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", normHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", idx: 1 }, new: { src: "dup", rawHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", normHash: "9eb6203435cb3e0033f544e3bf6f1b74b138c765fc489a38a092e8f7adbd9638", idx: 1 } }] });
});

test('groups leftover chunks sharing vocabulary as UNRESOLVED split/merge', () => {
  const r = pairChunks(
    [{ src: 'the cat sat on the mat' }, { src: 'the dog played in the yard' }],
    [{ src: 'the cat sat on the mat and the dog played' }, { src: 'in the yard with the cat' }]
  );
  assert.deepEqual(r, { noBaseline: false, pairs: [{ state: "EDITED", old: { src: "the cat sat on the mat", rawHash: "9ac66dfb23e682b5675f13973be587176834e3e88d886d655d1a9ad7fa27e0d3", normHash: "9ac66dfb23e682b5675f13973be587176834e3e88d886d655d1a9ad7fa27e0d3", idx: 0 }, new: { src: "the cat sat on the mat and the dog played", rawHash: "70f8fa822bc7e084cd4f4f2d5c1d44e474127fdfd831402541b8bd0ede302ac6", normHash: "70f8fa822bc7e084cd4f4f2d5c1d44e474127fdfd831402541b8bd0ede302ac6", idx: 0 }, similarity: 0.75 }, { state: "EDITED", old: { src: "the dog played in the yard", rawHash: "9fc697858a7e9feae41f95639cbe8438b2799bfbe4a6d7c3ddf4a74bd4e32943", normHash: "9fc697858a7e9feae41f95639cbe8438b2799bfbe4a6d7c3ddf4a74bd4e32943", idx: 1 }, new: { src: "in the yard with the cat", rawHash: "dbc9682e6ac830c7705c991617bcf438a0c9402b7ffb48ac78c07cfa971f3268", normHash: "dbc9682e6ac830c7705c991617bcf438a0c9402b7ffb48ac78c07cfa971f3268", idx: 1 }, similarity: 0.5 }] });
});
