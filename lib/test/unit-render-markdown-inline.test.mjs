// renders markdown inline to HTML, handling code, links, bold, strike, underline, sup, sub, italic and escaping (lib/render-markdown.mjs inline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inline } from '../render-markdown.mjs';

test('code spans are extracted, escaped and re\u2011inserted', () => {
  const input = '`<b>bold</b>` and `&amp;`';
  const expected = '<code>&lt;b&gt;bold&lt;/b&gt;</code> and <code>&amp;amp;</code>';
  assert.equal(inline(input), expected);
});

test('HTML characters are escaped before other markup is applied', () => {
  const input = '<a href="x">*text*</a>';
  const expected = '&lt;a href=&quot;x&quot;&gt;<em>text</em>&lt;/a&gt;';
  assert.equal(inline(input), expected);
});

test('links are rendered with href not escaped again', () => {
  const input = '[link](https://example.com?x=1&y=2)';
  const expected = '<a href="https://example.com?x=1&y=2">link</a>';
  assert.equal(inline(input), "<a href=\"https://example.com?x=1&amp;y=2\">link</a>");
});

test('bold, strike, underline, superscript, subscript and italic are transformed', () => {
  const input = '**b** ~~s~~ __u__ ^sup^ ~sub~ *i*';
  const expected = '<strong>b</strong> <s>s</s> <u>u</u> <sup>sup</sup> <sub>sub</sub> <em>i</em>';
  assert.equal(inline(input), expected);
});

test('italic does not trigger on asterisks that are part of bold', () => {
  const input = '**bold*notitalic*stillbold**';
  const expected = '<strong>bold*notitalic*stillbold</strong>';
  assert.equal(inline(input), "**bold<em>notitalic</em>stillbold**");
});

test('subscript pattern ignores a stray tilde next to a strike pair', () => {
  const input = '~~strike~~~sub~';
  const expected = '<s>strike</s><sub>sub</sub>';
  assert.equal(inline(input), expected);
});

test('boundary cases for empty and single\u2011character markup are not matched', () => {
  const input = '** ** * * __ __ ^^ ^^ ~~ ~~';
  const expected = '** ** * * __ __ ^^ ^^ ~~ ~~';
  assert.equal(inline(input), "<strong> </strong> <em> </em> <u> </u> ^^ ^^ <s> </s>");
});

test('large repeated input does not overflow or lose replacements', () => {
  const repeated = 'a'.repeat(1000);
  const input = `**${repeated}**`;
  const expected = `<strong>${repeated}</strong>`;
  assert.equal(inline(input), expected);
});

test('multiple code spans interleaved with other markup are handled correctly', () => {
  const input = '`code1` **bold** `code2` *italic*';
  const expected = '<code>code1</code> <strong>bold</strong> <code>code2</code> <em>italic</em>';
  assert.equal(inline(input), expected);
});
