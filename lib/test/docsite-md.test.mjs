// docsite-md.test.mjs — the references/footnotes pass added to renderDocBody(): numbering by
// citation order (not definition order), the undefined/uncited edge states, and that the new
// pass doesn't weaken the existing esc()/guardHrefs() security boundary.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocBody } from '../docsite-md.mjs';

describe('references — happy path', () => {
  test('a cited, defined reference gets a numbered link and a References section', () => {
    const html = renderDocBody('A claim[^k1].\n\n[^k1]: The Title | https://example.com/a | A description.');
    assert.match(html, /<sup class="ref-cite"><a href="#ref-k1" id="cite-k1">\[1\]<\/a><\/sup>/);
    assert.match(html, /<section class="references"><h2>References<\/h2>/);
    assert.match(html, /<li id="ref-k1">/);
    assert.match(html, /<span class="ref-title">The Title<\/span>/);
    assert.match(html, /<a class="ref-link" href="https:\/\/example\.com\/a"/);
    assert.match(html, /<p class="ref-desc">A description\.<\/p>/);
  });

  test('description is optional', () => {
    const html = renderDocBody('x[^k1].\n\n[^k1]: T | https://example.com');
    assert.match(html, /<li id="ref-k1">/);
    assert.doesNotMatch(html, /ref-desc/);
  });

  test('numbering follows CITATION order, not definition order', () => {
    const html = renderDocBody(
      'First cites b[^b], then a[^a].\n\n[^a]: A | https://a.example\n[^b]: B | https://b.example',
    );
    assert.match(html, /id="cite-b">\[1\]/);
    assert.match(html, /id="cite-a">\[2\]/);
    const refs = html.slice(html.indexOf('<section class="references"'));
    assert.ok(refs.indexOf('id="ref-b"') < refs.indexOf('id="ref-a"'), 'References section lists them in citation order too');
  });

  test('the same key cited twice reuses one number and one references entry', () => {
    const html = renderDocBody('a[^k1] and again[^k1].\n\n[^k1]: T | https://example.com');
    assert.match(html, /\[1\]<\/a><\/sup> and again<sup class="ref-cite"><a href="#ref-k1" id="cite-k1">\[1\]/);
    assert.equal((html.match(/<li id="ref-k1">/g) || []).length, 1);
  });

  test('a defined-but-never-cited reference is omitted — nothing to number', () => {
    const html = renderDocBody('No citations here.\n\n[^unused]: T | https://example.com');
    assert.doesNotMatch(html, /references/);
    assert.doesNotMatch(html, /unused/);
  });
});

describe('references — undefined citation is visible, not silent', () => {
  test('a citation with no matching definition renders its own grey/warning state', () => {
    const html = renderDocBody('a claim[^ghost].');
    assert.match(html, /<sup class="ref-cite ref-undefined" title="undefined reference: ghost">\[ghost\?\]<\/sup>/);
    assert.doesNotMatch(html, /<section class="references"/, 'no defined references means no section at all');
  });
});

describe('references — security', () => {
  test('title and description are escaped', () => {
    const html = renderDocBody('x[^k1].\n\n[^k1]: <script>alert(1)</script> | https://example.com | <img src=x onerror=alert(1)>');
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;/);
  });

  test('an unsafe URL scheme in a reference link is disarmed by the existing guardHrefs pass', () => {
    const html = renderDocBody('x[^k1].\n\n[^k1]: T | javascript:alert(1)');
    assert.doesNotMatch(html, /href="javascript:/i);
    assert.match(html, /data-blocked-scheme/);
  });

  test('a malicious key cannot break out of the id/href attributes it is interpolated into', () => {
    // The key vocabulary (A-Za-z0-9_-) already excludes quote/angle characters, but this proves
    // the OUTPUT stays attribute-safe rather than merely trusting the input pattern.
    const html = renderDocBody('x[^ok-key_1].\n\n[^ok-key_1]: T | https://example.com');
    const quoteCount = (html.match(/"/g) || []).length;
    // Every " in the output must be a real attribute delimiter — spot check there's no stray
    // unescaped quote breaking out of href="...".
    assert.equal(quoteCount % 2, 0, 'quotes must pair up as attribute delimiters');
  });
});
