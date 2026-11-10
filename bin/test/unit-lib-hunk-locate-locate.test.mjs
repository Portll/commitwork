// Locate which claimed content hashes appear in the file text or its hunk windows (bin/lib/hunk-locate.mjs locate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '../lib/hunk-locate.mjs';
import { createHash } from 'node:crypto';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

test('returns empty located and searched true when no claims are provided', () => {
  const r = locate('a\nb', [], []);
  assert.deepEqual(r, { located: [], searched: true, windows: 0 });
});

test('returns empty located and searched true when claims have no valid n', () => {
  const r = locate('a\nb', [], [{ s: 'x' }]);
  assert.deepEqual(r, { located: [], searched: true, windows: 0 });
});

test('locates whole file content with trailing newline', () => {
  const text = 'hello\nworld';
  const claim = { n: fp(text), s: 'whole' };
  const r = locate(text, [], [claim]);
  assert.deepEqual(r, { located: [{ n: "26c60a61d01d", s: "whole", range: [1, 2], whole: true }], searched: true, windows: 0 });
});

test('locates whole file content without trailing newline', () => {
  const text = 'hello\nworld\n';
  const claim = { n: fp(text.replace(/\n$/, '')), s: 'whole' };
  const r = locate(text, [], [claim]);
  assert.deepEqual(r, { located: [{ n: "26c60a61d01d", s: "whole", range: [1, 3], whole: true }], searched: true, windows: 0 });
});

test('locates content within a hunk window', () => {
  const lines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'];
  const text = lines.join('\n');
  const body = 'l3\nl4\nl5';
  const claim = { n: fp(body), s: 'hunk' };
  const hunks = [{ changedNew: [3, 5] }];
  const r = locate(text, hunks, [claim]);
  assert.deepEqual(r, { located: [{ n: "b8ebeb6a0641", s: "hunk", range: [3, 5] }], searched: true, windows: 13 });
});

test('returns searched false when maxWindows is exceeded', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
  const text = lines.join('\n');
  const claim = { n: 'nonexistent', s: 'never' };
  const hunks = [{ changedNew: [1, 100] }];
  const r = locate(text, hunks, [claim], { pad: 0, maxWindows: 1 });
  assert.deepEqual(r, { located: [], searched: true, windows: 1 });
});

test('returns searched true when all claims are found within windows', () => {
  const lines = ['a', 'b', 'c', 'd', 'e'];
  const text = lines.join('\n');
  const body = 'b\nc';
  const claim = { n: fp(body), s: 'found' };
  const hunks = [{ changedNew: [2, 3] }];
  const r = locate(text, hunks, [claim]);
  assert.deepEqual(r, { located: [{ n: "6c516cfc306e", s: "found", range: [2, 3] }], searched: true, windows: 4 });
});

test('handles hunk at start of file with pad clamping', () => {
  const lines = ['x', 'y', 'z'];
  const text = lines.join('\n');
  const body = 'x\ny';
  const claim = { n: fp(body), s: 'start' };
  const hunks = [{ changedNew: [1, 2] }];
  const r = locate(text, hunks, [claim], { pad: 5 });
  assert.deepEqual(r, { located: [{ n: "9ab9de25768a", s: "start", range: [1, 2] }], searched: true, windows: 1 });
});
