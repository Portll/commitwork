// Detects trust_remote_code usage and unpinned or non-literal HF model/dataset revisions (bin/model-artefacts.mjs scanPython).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPython } from '../model-artefacts.mjs';

test('returns empty results for source with no HF calls or trust flags', () => {
  const src = 'import os\nprint("hello")\n';
  assert.deepEqual(scanPython(src), { trust: [], unpinned: [], nonLiteral: 0 });
});

test('records trust_remote_code=True on the correct line number', () => {
  const src = 'x = 1\nmodel = AutoModel.from_pretrained("bert", trust_remote_code=True)\n';
  const r = scanPython(src);
  assert.deepEqual(r.trust, [2]);
  assert.deepEqual(r.unpinned, ['from_pretrained line 2 (no revision=)']);
  assert.equal(r.nonLiteral, 0);
});

test('ignores trust_remote_code inside string literals', () => {
  const src = 's = "trust_remote_code=True"\n';
  assert.deepEqual(scanPython(src), { trust: [], unpinned: [], nonLiteral: 0 });
});

test('ignores trust_remote_code on comment-only lines', () => {
  const src = '# trust_remote_code=True\nx = 1\n';
  assert.deepEqual(scanPython(src), { trust: [], unpinned: [], nonLiteral: 0 });
});

test('skips HF calls that appear on comment lines', () => {
  const src = '# from_pretrained("bert")\nx = 1\n';
  assert.deepEqual(scanPython(src), { trust: [], unpinned: [], nonLiteral: 0 });
});

test('accepts a 40-hex revision as pinned and reports no issues', () => {
  const sha = 'a'.repeat(40);
  const src = `m = AutoModel.from_pretrained("bert", revision="${sha}")\n`;
  assert.deepEqual(scanPython(src), { trust: [], unpinned: [], nonLiteral: 0 });
});

test('flags revision set to a branch name as unpinned', () => {
  const src = 'm = AutoModel.from_pretrained("bert", revision="main")\n';
  const r = scanPython(src);
  assert.deepEqual(r.unpinned, ['from_pretrained line 1 (revision is a branch or tag, not a commit sha)']);
  assert.equal(r.nonLiteral, 0);
  assert.deepEqual(r.trust, []);
});

test('counts revision set to a non-literal expression as nonLiteral', () => {
  const src = 'm = AutoModel.from_pretrained("bert", revision=REV)\n';
  const r = scanPython(src);
  assert.equal(r.nonLiteral, 1);
  assert.deepEqual(r.unpinned, []);
  assert.deepEqual(r.trust, []);
});

test('flags a call with no revision keyword as unpinned', () => {
  const src = 'm = AutoModel.from_pretrained("bert")\n';
  const r = scanPython(src);
  assert.deepEqual(r.unpinned, ['from_pretrained line 1 (no revision=)']);
  assert.equal(r.nonLiteral, 0);
  assert.deepEqual(r.trust, []);
});

test('detects multiple HF call types and aggregates their findings', () => {
  const src = 'a = load_dataset("x")\nb = hf_hub_download("y", revision="main")\n';
  const r = scanPython(src);
  assert.deepEqual(r.unpinned, [
    'load_dataset line 1 (no revision=)',
    'hf_hub_download line 2 (revision is a branch or tag, not a commit sha)',
  ]);
  assert.equal(r.nonLiteral, 0);
  assert.deepEqual(r.trust, []);
});
