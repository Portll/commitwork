// Extracts meta, link, script, a, html, title tags with attributes and the title text (lib/launchlist-checks.mjs parseTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags } from '../launchlist-checks.mjs';

test('returns empty tags and empty title for empty string', () => {
  const result = parseTags('');
  assert.deepEqual(result, { tags: [], title: '' });
});

test('parses a single meta tag with double-quoted attributes', () => {
  const html = '<meta charset="UTF-8">';
  const result = parseTags(html);
  assert.equal(result.title, '');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'meta');
  assert.deepEqual(result.tags[0].attrs, { charset: 'UTF-8' });
});

test('parses a single link tag with single-quoted attributes', () => {
  const html = "<link rel='stylesheet' href='/style.css'>";
  const result = parseTags(html);
  assert.equal(result.title, '');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'link');
  assert.deepEqual(result.tags[0].attrs, { rel: 'stylesheet', href: '/style.css' });
});

test('parses a single script tag with unquoted attribute', () => {
  const html = '<script src=app.js>';
  const result = parseTags(html);
  assert.equal(result.title, '');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'script');
  assert.deepEqual(result.tags[0].attrs, { src: 'app.js' });
});

test('parses a single a tag with multiple attributes', () => {
  const html = '<a href="https://example.com" target="_blank">';
  const result = parseTags(html);
  assert.equal(result.title, '');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'a');
  assert.deepEqual(result.tags[0].attrs, { href: 'https://example.com', target: '_blank' });
});

test('parses a single html tag with no attributes', () => {
  const html = '<html>';
  const result = parseTags(html);
  assert.equal(result.title, '');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'html');
  assert.deepEqual(result.tags[0].attrs, {});
});

test('parses a single title tag and extracts its text content', () => {
  const html = '<title>My Page</title>';
  const result = parseTags(html);
  assert.equal(result.title, 'My Page');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'title');
  assert.deepEqual(result.tags[0].attrs, {});
});

test('parses multiple tags in order and extracts title text', () => {
  const html = '<html><head><title>Home</title><meta charset="utf-8"></head><body><a href="/x">link</a></body></html>';
  const result = parseTags(html);
  assert.equal(result.title, 'Home');
  assert.equal(result.tags.length, 4);
  assert.equal(result.tags[0].tag, 'html');
  assert.equal(result.tags[1].tag, 'title');
  assert.equal(result.tags[2].tag, 'meta');
  assert.equal(result.tags[3].tag, 'a');
  assert.deepEqual(result.tags[2].attrs, { charset: 'utf-8' });
  assert.deepEqual(result.tags[3].attrs, { href: '/x' });
});

test('ignores tags not in the allowed list', () => {
  const html = '<div class="foo"><span>bar</span></div>';
  const result = parseTags(html);
  assert.equal(result.title, '');
  assert.equal(result.tags.length, 0);
});

test('handles title with leading and trailing whitespace in content', () => {
  const html = '<title>  Spaced Title  </title>';
  const result = parseTags(html);
  assert.equal(result.title, 'Spaced Title');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].tag, 'title');
});
