// The page banner's statement of what a producer could not read (lib/dfd-render.mjs unknownBanner):
// unknown is never clean, so each count is stated, zero included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknownBanner, renderHtml } from '../dfd-render.mjs';

test('unknownBanner states every count and names the unread files, the rest counted', () => {
  // arrange
  const u = { files: 9, unanalysable: 2, byState: { unparseable: 1, 'unsupported-language': 1 }, unsupportedLanguages: { python: 3 },
    computedSites: 2, computedSitesByKind: { 'endpoint: computed call': 2 }, filesUnread: ['a.ts: unparseable', 'b<x>.tsx: unsupported-language'], filesUnreadNotListed: 4 };

  // act
  const html = unknownBanner(u);

  // assert
  assert.match(html, /^<strong>Unknown, not clean:<\/strong> 2 of 9 source file\(s\) not analysed \(unparseable 1, unsupported-language 1\)/);
  assert.match(html, /files in languages this pass does not read: python 3/);
  assert.match(html, /2 call site\(s\) whose path, endpoint, database or script is computed and could not be named \(endpoint: computed call 2\)/);
  assert.match(html, /Not analysed: a\.ts: unparseable; b&lt;x&gt;\.tsx: unsupported-language; and 4 more\./);
});

test('unknownBanner with nothing unread still says so, and an empty block reads as zeros', () => {
  // arrange
  const blocks = [{ files: 3, unanalysable: 0, unsupportedLanguages: {}, computedSites: 0, filesUnread: [] }, {}];

  // act
  const got = blocks.map(unknownBanner);

  // assert
  assert.match(got[0], /0 of 3 source file\(s\) not analysed; no tracked file in a language this pass does not read; 0 call site\(s\)/);
  assert.doesNotMatch(got[0], /Not analysed:/);
  assert.match(got[1], /0 of 0 source file\(s\)/);
});

test('the page banner carries the unknown block of the model\'s source', () => {
  // arrange
  const model = { v: 1, kind: 'dfd', title: 't', source: { producer: 'flow-graph', unknown: { files: 1, unanalysable: 1, byState: { unparseable: 1 }, filesUnread: ['x.js: unparseable'] } },
    nodes: [{ id: 'a', kind: 'process', label: 'a' }, { id: 'b', kind: 'store', label: 'b' }], flows: [{ from: 'a', to: 'b', label: 'w', mode: 'sync' }] };

  // act
  const { html } = renderHtml(model, { fonts: 'none' });

  // assert
  assert.match(html, /<p class="banner">[^]*Unknown, not clean:[^]*x\.js: unparseable[^]*<\/p>/);
});
