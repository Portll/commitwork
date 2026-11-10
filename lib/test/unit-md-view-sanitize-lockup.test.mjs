// Strips disallowed tags and attributes from HTML, keeping a safe subset (lib/md-view.mjs sanitizeLockup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLockup } from '../md-view.mjs';

test('keeps allowed tags and escapes text content', () => {
  const r = sanitizeLockup('<div>hello</div>');
  assert.equal(r, "<div>hello</div>");
});

test('drops script tags and their content', () => {
  const r = sanitizeLockup('<div>before<script>alert(1)</script>after</div>');
  assert.equal(r, "<div>beforeafter</div>");
});

test('handles void elements without closing tags', () => {
  const r = sanitizeLockup('<div><br></div>');
  assert.equal(r, "<div><br></div>");
});

test('filters attributes to allowed list only', () => {
  const r = sanitizeLockup('<div class="a" onclick="evil()" id="x">text</div>');
  assert.equal(r, "<div class=\"a\" id=\"x\">text</div>");
});

test('allows hash hrefs but drops external links', () => {
  const r = sanitizeLockup('<a href="#section">link</a><a href="https://evil.com">bad</a>');
  assert.equal(r, "<a href=\"#section\">link</a><a>bad</a>");
});

test('allows data URI images with valid base64', () => {
  const r = sanitizeLockup('<img src="data:image/png;base64,iVBORw0KGgo=" alt="pic">');
  assert.equal(r, "<img src=\"data:image/png;base64,iVBORw0KGgo=\" alt=\"pic\">");
});

test('drops invalid data URI images', () => {
  const r = sanitizeLockup('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="bad">');
  assert.equal(r, "<img alt=\"bad\">");
});

test('replaces cw-seal tag with seal SVG', () => {
  const r = sanitizeLockup('<div><cw-seal></cw-seal></div>');
  assert.equal(r, "<div><svg viewBox=\"0 0 32 32\" aria-hidden=\"true\" focusable=\"false\"><circle cx=\"16\" cy=\"16\" r=\"16\" fill=\"#14161A\"/><circle cx=\"16\" cy=\"16\" r=\"14.5\" fill=\"none\" stroke=\"#C9A227\" stroke-width=\"1\"/><circle cx=\"12\" cy=\"20\" r=\"2.4\" fill=\"#C9A227\"/><circle cx=\"21\" cy=\"11\" r=\"2.4\" fill=\"none\" stroke=\"#C9A227\" stroke-width=\"1.3\"/><path d=\"M13.7 18.3 L19.3 12.7\" stroke=\"#C9A227\" stroke-width=\"1.3\" fill=\"none\"/></svg></div>");
});

test('strips comments from output', () => {
  const r = sanitizeLockup('<div><!-- secret -->visible</div>');
  assert.equal(r, "<div>visible</div>");
});

test('handles nested allowed elements', () => {
  const r = sanitizeLockup('<ul><li>one</li><li>two</li></ul>');
  assert.equal(r, "<ul><li>one</li><li>two</li></ul>");
});
