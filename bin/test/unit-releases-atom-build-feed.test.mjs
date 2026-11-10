// Builds an Atom XML feed string from release tags (bin/releases-atom.mjs buildFeed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed } from '../releases-atom.mjs';

test('returns empty feed with sentinel date when no tags', () => {
  const r = buildFeed({ tags: [], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 0, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>No releases are tagged in this repository yet. This feed is current and deliberately empty.</subtitle>\n  <updated>1970-01-01T00:00:00Z</updated>\n</feed>\n");
});

test('returns single release feed with correct subtitle', () => {
  const r = buildFeed({ tags: [{ tag: 'v1.0.0', sha: 'abc123', date: '2024-01-01T00:00:00Z', subject: 'Initial release' }], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 0, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>1 release.</subtitle>\n  <updated>2024-01-01T00:00:00Z</updated>\n  <entry>\n    <title>v1.0.0</title>\n    <id>urn:portll:commitwork:release:v1.0.0:abc123</id>\n    <updated>2024-01-01T00:00:00Z</updated>\n    <content type=\"text\">Initial release</content>\n  </entry>\n</feed>\n");
});

test('returns two releases feed with plural subtitle', () => {
  const r = buildFeed({ tags: [{ tag: 'v2.0.0', sha: 'def456', date: '2024-02-01T00:00:00Z', subject: 'Second release' }, { tag: 'v1.0.0', sha: 'abc123', date: '2024-01-01T00:00:00Z', subject: 'Initial release' }], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 0, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>2 releases.</subtitle>\n  <updated>2024-02-01T00:00:00Z</updated>\n  <entry>\n    <title>v2.0.0</title>\n    <id>urn:portll:commitwork:release:v2.0.0:def456</id>\n    <updated>2024-02-01T00:00:00Z</updated>\n    <content type=\"text\">Second release</content>\n  </entry>\n  <entry>\n    <title>v1.0.0</title>\n    <id>urn:portll:commitwork:release:v1.0.0:abc123</id>\n    <updated>2024-01-01T00:00:00Z</updated>\n    <content type=\"text\">Initial release</content>\n  </entry>\n</feed>\n");
});

test('limits entries when limit is set', () => {
  const r = buildFeed({ tags: [{ tag: 'v3.0.0', sha: 'ghi789', date: '2024-03-01T00:00:00Z', subject: 'Third' }, { tag: 'v2.0.0', sha: 'def456', date: '2024-02-01T00:00:00Z', subject: 'Second' }, { tag: 'v1.0.0', sha: 'abc123', date: '2024-01-01T00:00:00Z', subject: 'First' }], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 2, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>2 of 3 releases shown; 1 older entries omitted by --limit.</subtitle>\n  <updated>2024-03-01T00:00:00Z</updated>\n  <entry>\n    <title>v3.0.0</title>\n    <id>urn:portll:commitwork:release:v3.0.0:ghi789</id>\n    <updated>2024-03-01T00:00:00Z</updated>\n    <content type=\"text\">Third</content>\n  </entry>\n  <entry>\n    <title>v2.0.0</title>\n    <id>urn:portll:commitwork:release:v2.0.0:def456</id>\n    <updated>2024-02-01T00:00:00Z</updated>\n    <content type=\"text\">Second</content>\n  </entry>\n</feed>\n");
});

test('includes pattern message in subtitle when no tags match', () => {
  const r = buildFeed({ tags: [], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 0, pattern: 'v9.*' });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>No releases are tagged in this repository yet. No tag matches v9.*. This feed is current and deliberately empty.</subtitle>\n  <updated>1970-01-01T00:00:00Z</updated>\n</feed>\n");
});

test('escapes XML special characters in tag names', () => {
  const r = buildFeed({ tags: [{ tag: 'a<b>&"c', sha: 'x1y2', date: '2024-01-01T00:00:00Z', subject: 'test' }], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 0, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>1 release.</subtitle>\n  <updated>2024-01-01T00:00:00Z</updated>\n  <entry>\n    <title>a&lt;b&gt;&amp;&quot;c</title>\n    <id>urn:portll:commitwork:release:a&lt;b&gt;&amp;&quot;c:x1y2</id>\n    <updated>2024-01-01T00:00:00Z</updated>\n    <content type=\"text\">test</content>\n  </entry>\n</feed>\n");
});

test('strips illegal XML control characters from content', () => {
  const r = buildFeed({ tags: [{ tag: 'v1.0.0', sha: 'abc123', date: '2024-01-01T00:00:00Z', subject: 'bad\x00char' }], now: '2024-01-01T00:00:00Z', self: 'https://example.com/feed', limit: 0, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://example.com/feed\"/>\n  <subtitle>1 release.</subtitle>\n  <updated>2024-01-01T00:00:00Z</updated>\n  <entry>\n    <title>v1.0.0</title>\n    <id>urn:portll:commitwork:release:v1.0.0:abc123</id>\n    <updated>2024-01-01T00:00:00Z</updated>\n    <content type=\"text\">badchar</content>\n  </entry>\n</feed>\n");
});

test('uses provided self URL in link element', () => {
  const r = buildFeed({ tags: [{ tag: 'v1.0.0', sha: 'abc123', date: '2024-01-01T00:00:00Z', subject: 'test' }], now: '2024-01-01T00:00:00Z', self: 'https://custom.example.com/myfeed', limit: 0, pattern: null });
  assert.equal(r, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>commitwork releases</title>\n  <id>urn:portll:commitwork:releases</id>\n  <link rel=\"self\" href=\"https://custom.example.com/myfeed\"/>\n  <subtitle>1 release.</subtitle>\n  <updated>2024-01-01T00:00:00Z</updated>\n  <entry>\n    <title>v1.0.0</title>\n    <id>urn:portll:commitwork:release:v1.0.0:abc123</id>\n    <updated>2024-01-01T00:00:00Z</updated>\n    <content type=\"text\">test</content>\n  </entry>\n</feed>\n");
});
