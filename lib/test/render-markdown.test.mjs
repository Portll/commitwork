// The href-escaping test exists because breakers' design pass flagged it explicitly: esc() covers
// text nodes by construction, but attribute values (href) are a classic renderer gap and had to be
// re-verified, not assumed safe by association with bin/render-report.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inline, renderMarkdown, esc } from '../render-markdown.mjs';

describe('inline() — link href is escaped, not just link text', () => {
  test('a quote-breaking href cannot escape the attribute', () => {
    const html = inline('[click](" onmouseover="alert(1)")');
    // The only two literal `"` characters allowed anywhere in the output are the template's own
    // href delimiters (`href="...">`) — every quote that came from user content must have been
    // turned into an entity. If a raw `"` from the input survived, this count would be higher and
    // the attribute boundary would be escapable.
    const quoteCount = (html.match(/"/g) || []).length;
    assert.equal(quoteCount, 2, `expected exactly the 2 template quote delimiters, got ${quoteCount} in: ${html}`);
  });

  test('link text itself is escaped', () => {
    const html = inline('[<img src=x onerror=alert(1)>](https://example.com)');
    assert.doesNotMatch(html, /<img/);
  });
});

describe('inline() — strikethrough, underline, superscript, subscript', () => {
  test('strikethrough ~~x~~', () => {
    assert.equal(inline('a ~~gone~~ word'), 'a <s>gone</s> word');
  });
  test('underline __x__', () => {
    assert.equal(inline('an __underlined__ word'), 'an <u>underlined</u> word');
  });
  test('superscript ^x^', () => {
    assert.equal(inline('x^2^ plus one'), 'x<sup>2</sup> plus one');
  });
  test('subscript ~x~ (single tilde, not the strikethrough pair)', () => {
    assert.equal(inline('H~2~O'), 'H<sub>2</sub>O');
  });
  test('strikethrough and subscript coexist without one eating the other\'s delimiters', () => {
    assert.equal(inline('~~old~~ H~2~O'), '<s>old</s> H<sub>2</sub>O');
  });
  test('bold, italic, strike, underline, sup, sub all combine in one line', () => {
    assert.equal(
      inline('**b** *i* ~~s~~ __u__ x^2^ H~2~O'),
      '<strong>b</strong> <em>i</em> <s>s</s> <u>u</u> x<sup>2</sup> H<sub>2</sub>O',
    );
  });
  test('a lone unpaired ~ or ^ is left as plain text, not misparsed', () => {
    assert.equal(inline('a ~ b and c ^ d'), 'a ~ b and c ^ d');
  });
  test('marks insert only fixed tag names — content that looks like a tag cannot inject one', () => {
    const html = inline('~~<img src=x onerror=alert(1)>~~');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /<s>&lt;img/);
  });
});

describe('renderMarkdown() — untrusted content stays inert', () => {
  test('a raw <script> tag in prose is escaped, not executed', () => {
    const html = renderMarkdown('Some text <script>alert(1)</script> more text.');
    assert.doesNotMatch(html, /<script\b/i);
    assert.match(html, /&lt;script&gt;/);
  });

  test('esc() covers the standard five characters', () => {
    assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });
});

// Sibling items once closed their own list, so every second item nested inside its predecessor and
// a flat list rendered with alternating indents. No list was under test until then.
describe('renderMarkdown() — lists', () => {
  test('a flat list is one list with every item a sibling', () => {
    assert.equal(renderMarkdown('- a\n- b\n- c\n- d'), '<ul><li>a</li><li>b</li><li>c</li><li>d</li></ul>');
  });

  test('a numbered list stays flat too', () => {
    assert.equal(renderMarkdown('1. a\n2. b\n3. c'), '<ol><li>a</li><li>b</li><li>c</li></ol>');
  });

  test('a list after a paragraph', () => {
    assert.equal(renderMarkdown('Intro:\n\n- a\n- b\n- c'), '<p>Intro:</p><ul><li>a</li><li>b</li><li>c</li></ul>');
  });

  test('a nested list closes back to its parent level', () => {
    assert.equal(renderMarkdown('- a\n  1. x\n  2. y\n- b'), '<ul><li>a<ol><li>x</li><li>y</li></ol></li><li>b</li></ul>');
  });

  test('a change of list type at the same level starts a new list', () => {
    assert.equal(renderMarkdown('- a\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  test('tags balance for any run of siblings', () => {
    const html = renderMarkdown(Array.from({ length: 9 }, (_, i) => `- item ${i}`).join('\n'));
    assert.equal((html.match(/<li>/g) || []).length, (html.match(/<\/li>/g) || []).length);
    assert.equal((html.match(/<ul>/g) || []).length, 1);
  });
});
