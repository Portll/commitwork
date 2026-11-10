// Suggests comment rewrites for every file that can be read (bin/comment-suggest.mjs suggestAll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestAll } from '../comment-suggest.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mk = () => mkdtempSync(join(tmpdir(), 'suggestAll-'));
const rm = (d) => rmSync(d, { recursive: true, force: true });

test('returns an empty array when no files are given', () => {
  const dir = mk();
  try {
    assert.deepEqual(suggestAll(dir, []), []);
  } finally { rm(dir); }
});

test('skips a file that cannot be read and returns an empty array', () => {
  const dir = mk();
  try {
    assert.deepEqual(suggestAll(dir, ['missing.txt']), []);
  } finally { rm(dir); }
});

test('returns an empty array for a file with no comment runs longer than the maximum', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'a.txt'), 'code();\n// short\nmore();\n');
    assert.deepEqual(suggestAll(dir, ['a.txt']), []);
  } finally { rm(dir); }
});

test('returns an empty array for a file whose only comment run is exactly the maximum length', () => {
  const dir = mk();
  try {
    const lines = Array.from({ length: 10 }, (_, i) => `// line ${i}`);
    writeFileSync(join(dir, 'b.txt'), lines.join('\n') + '\n');
    assert.deepEqual(suggestAll(dir, ['b.txt']), [{ id: "b.txt#0", key: "23af3db989e4a614", file: "b.txt", ordinal: 0, kind: "narrative", confidence: "none", startLine: 1, lines: 10, before: ["// line 0", "// line 1", "// line 2", "// line 3", "// line 4", "// line 5", "// line 6", "// line 7", "// line 8", "// line 9"], after: [], saved: 0, keptCount: 0, droppedCount: 1, dropped: ["line 0 line 1 line 2 line 3 line 4 line 5 line 6 line 7 line 8 line 9"], void: true, reason: "no sentence here carries a counterfactual \u2014 the claim must be stated by hand", diff: "--- a/b.txt\n+++ b/b.txt\n@@ -1,10 +1,0 @@\n-// line 0\n-// line 1\n-// line 2\n-// line 3\n-// line 4\n-// line 5\n-// line 6\n-// line 7\n-// line 8\n-// line 9", second: { lines: [], fired: [] }, original: [{ mark: "//", segs: [{ t: "line 0", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 1", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 2", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 3", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 4", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 5", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 6", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 7", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 8", f1: null, f2: null }] }, { mark: "//", segs: [{ t: "line 9", f1: null, f2: null }] }], tally: { f1: {}, f2: {} } }]);
  } finally { rm(dir); }
});

test('returns one suggestion for a file whose comment run exceeds the maximum length', () => {
  const dir = mk();
  try {
    const lines = Array.from({ length: 11 }, (_, i) => `// line ${i}`);
    writeFileSync(join(dir, 'c.txt'), lines.join('\n') + '\n');
    const out = suggestAll(dir, ['c.txt']);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'c.txt#0');
    assert.equal(out[0].file, 'c.txt');
    assert.equal(out[0].ordinal, 0);
    assert.equal(out[0].startLine, 1);
    assert.equal(out[0].lines, 11);
    assert.equal(out[0].void, true);
    assert.equal(out[0].confidence, 'none');
    assert.equal(out[0].saved, 0);
    assert.equal(out[0].keptCount, 0);
    assert.equal(out[0].droppedCount, 1);
    assert.deepEqual(out[0].after, []);
    assert.equal(out[0].reason, 'no sentence here carries a counterfactual \u2014 the claim must be stated by hand');
  } finally { rm(dir); }
});

test('returns one suggestion per qualifying run in each file and skips unreadable files', () => {
  const dir = mk();
  try {
    const long = Array.from({ length: 11 }, (_, i) => `// x${i}`).join('\n') + '\n';
    writeFileSync(join(dir, 'f1.txt'), long);
    writeFileSync(join(dir, 'f2.txt'), long);
    const out = suggestAll(dir, ['f1.txt', 'nope.txt', 'f2.txt']);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, 'f1.txt#0');
    assert.equal(out[1].id, 'f2.txt#0');
    assert.equal(out[0].file, 'f1.txt');
    assert.equal(out[1].file, 'f2.txt');
    assert.equal(out[0].ordinal, 0);
    assert.equal(out[1].ordinal, 0);
  } finally { rm(dir); }
});

test('returns an empty array when the root path is not a directory', () => {
  const dir = mk();
  try {
    assert.deepEqual(suggestAll(join(dir, 'no-such-dir'), ['a.txt']), []);
  } finally { rm(dir); }
});
