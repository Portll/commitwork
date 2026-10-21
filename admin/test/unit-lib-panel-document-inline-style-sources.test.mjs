// Computes space-separated sha256 hashes of inline style contents (admin/lib/panel-document.mjs inlineStyleSources).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineStyleSources } from '../lib/panel-document.mjs';

test('returns empty string when no style tags are present', () => {
  const html = '<html><body><p>text</p></body></html>';
  assert.equal(inlineStyleSources(html), '');
});

test('returns empty string for empty input', () => {
  assert.equal(inlineStyleSources(''), '');
});

test('returns empty string for null input', () => {
  assert.equal(inlineStyleSources(null), '');
});

test('returns empty string for undefined input', () => {
  assert.equal(inlineStyleSources(undefined), '');
});

test('computes sha256 hash for a single style tag with empty content', () => {
  const html = '<style></style>';
  const expected = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";
  assert.equal(inlineStyleSources(html), expected);
});

test('computes sha256 hash for a single style tag with content', () => {
  const html = '<style>body { color: red; }</style>';
  const expected = "'sha256-XeYlw2NVzOfB1UCIJqCyGr+0n7bA4fFslFpvKu84IAw='";
  assert.equal(inlineStyleSources(html), expected);
});

test('computes multiple hashes for multiple style tags', () => {
  const html = '<style>a</style><style>b</style>';
  const expected = "'sha256-ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs=' 'sha256-PiPoFgA5WUoziU9lZOGxNIu9egCI1CxKy3PurtWcAJ0='";
  assert.equal(inlineStyleSources(html), expected);
});

test('handles style tags with attributes', () => {
  const html = '<style type="text/css">.x { }</style>';
  const expected = "'sha256-dCRh4UMnKqVoHHtdCeU4CHRLC2Okb4qYN1ze/ekiW0k='";
  assert.equal(inlineStyleSources(html), expected);
});

test('handles multiline style content', () => {
  const content = 'body {\n  margin: 0;\n}';
  const html = `<style>${content}</style>`;
  const expected = "'sha256-67XvTj71R319Bg3nv/q34GcxFQVJ8EX2hFqEmTBygTQ='";
  assert.equal(inlineStyleSources(html), expected);
});

test('handles case-insensitive style tag matching', () => {
  const html = '<STYLE>body { }</STYLE>';
  const expected = "'sha256-nmpJdp24UbQBvNho6Tvkwq5N8noUYjl6vFs2kgJLqsM='";
  assert.equal(inlineStyleSources(html), expected);
});
