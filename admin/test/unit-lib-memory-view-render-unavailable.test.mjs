// Renders a static HTML page explaining the memory view is unavailable (admin/lib/memory-view.mjs renderUnavailable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUnavailable } from '../lib/memory-view.mjs';

test('returns a full HTML document with doctype and lang attribute', () => {
  const out = renderUnavailable('test reason');
  assert.ok(out.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8">'));
  assert.ok(out.includes('<meta name="viewport" content="width=device-width,initial-scale=1">'));
  assert.ok(out.includes('<title>Memory visualiser \u2014 unavailable</title>'));
});

test('escapes the why parameter in the paragraph', () => {
  const out = renderUnavailable('<script>alert("xss")</script>');
  assert.ok(out.includes('<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>'));
  assert.ok(!out.includes('<script>alert("xss")</script>'));
});

test('includes the unknown pill in the heading', () => {
  const out = renderUnavailable('any reason');
  assert.ok(out.includes('<span class="pill unk">unknown</span>'));
  assert.ok(out.includes('The memory view could not be assembled'));
});

test('includes the note paragraph with exact text', () => {
  const out = renderUnavailable('some error');
  assert.ok(out.includes('<p class="note">This is an UNKNOWN, not an empty store. Nothing below this line should be read as evidence that no write happened.</p>'));
});

test('includes the unavail CSS class styles', () => {
  const out = renderUnavailable('reason');
  assert.ok(out.includes('.unavail{max-width:48rem;margin:1.5rem auto;padding:1rem 1.25rem;background:var(--panel);border:1px dashed var(--line2);border-radius:.5rem}'));
  assert.ok(out.includes('.unavail h1{font-size:1.125rem;margin:0 0 .5rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}'));
  assert.ok(out.includes('.unavail p{margin:0}.unavail .note{margin-top:.5rem;font-size:.8125rem;color:var(--mut)}'));
});

test('handles empty string why without error', () => {
  const out = renderUnavailable('');
  assert.ok(out.includes('<p></p>'));
  assert.ok(out.includes('<!doctype html>'));
});

test('handles long why input with repeated characters', () => {
  const why = 'x'.repeat(200);
  const out = renderUnavailable(why);
  assert.ok(out.includes(`<p>${why}</p>`));
  assert.ok(out.length > 500);
});

test('handles why with special HTML entities', () => {
  const out = renderUnavailable('a & b < c > d " e \' f');
  assert.ok(out.includes('<p>a &amp; b &lt; c &gt; d &quot; e &#39; f</p>'));
});

test('output ends with closing html tag', () => {
  const out = renderUnavailable('final reason');
  assert.ok(out.endsWith('</div></body></html>'));
});

test('includes the body tag and div structure', () => {
  const out = renderUnavailable('test');
  assert.ok(out.includes('<body><div class="unavail">'));
  assert.ok(out.includes('</div></body></html>'));
});

test('includes the style tag opening and closing', () => {
  const out = renderUnavailable('test');
  assert.ok(out.includes('<style>'));
  assert.ok(out.includes('</style></head>'));
});

test('includes the head closing and body opening sequence', () => {
  const out = renderUnavailable('test');
  assert.ok(out.includes('</style></head><body>'));
});
