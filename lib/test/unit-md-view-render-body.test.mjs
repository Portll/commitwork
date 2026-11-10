// Renders a markdown document into an HTML body with a style sheet and token palette (lib/md-view.mjs renderBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBody } from '../md-view.mjs';

test('palette is emitted before the first h2 when tokens are present', () => {
  const md = [
    '| Token | Dark | Light |',
    '| --- | --- | --- |',
    '| `--bg` | `#000` | `#fff` |',
    '',
    '## Section',
    '',
    'Body text',
  ].join('\n');
  const r = renderBody(md);
  assert.deepEqual(r.body, "<div class=\"tw\"><table><thead><tr><th>Token</th><th>Dark</th><th>Light</th></tr></thead><tbody><tr><td><span class=\"tk v0\" title=\"--bg \u00b7 dark #000 \u00b7 light #fff\"></span><code>--bg</code></td><td><span class=\"gnd gnd-dark v1\" title=\"#000 on the dark ground #17181a: 1.18:1 (fail)\"><span class=\"sw\"></span><b>Aa</b></span><code>#000</code></td><td><span class=\"gnd gnd-light v2\" title=\"#fff on the light ground #f4f3ef: 1.11:1 (fail)\"><span class=\"sw\"></span><b>Aa</b></span><code>#fff</code></td></tr></tbody></table></div><details class=\"palette\" open><summary>Colour tokens defined in this document (1) \u2014 dark ground, then light ground</summary><div class=\"pgrid\"><div class=\"prow\"><code>--bg</code><span class=\"pchip gnd-dark v1\" title=\"1.18:1 on #17181a (fail)\"><span class=\"sw\"></span><b>Aa</b><code>#000</code></span><span class=\"pchip gnd-light v2\" title=\"1.11:1 on #f4f3ef (fail)\"><span class=\"sw\"></span><b>Aa</b><code>#fff</code></span></div></div></details><h2 id=\"section\">Section<a class=\"anchor\" href=\"#section\" aria-label=\"Link to this section\">#</a></h2><p>Body text</p>");
});

test('palette is emitted at the end when no h2 appears', () => {
  const md = [
    '| Token | Dark | Light |',
    '| --- | --- | --- |',
    '| `--bg` | `#000` | `#fff` |',
    '',
    'Just a paragraph',
  ].join('\n');
  const r = renderBody(md);
  assert.deepEqual(r.body, "<details class=\"palette\" open><summary>Colour tokens defined in this document (1) \u2014 dark ground, then light ground</summary><div class=\"pgrid\"><div class=\"prow\"><code>--bg</code><span class=\"pchip gnd-dark v1\" title=\"1.18:1 on #17181a (fail)\"><span class=\"sw\"></span><b>Aa</b><code>#000</code></span><span class=\"pchip gnd-light v2\" title=\"1.11:1 on #f4f3ef (fail)\"><span class=\"sw\"></span><b>Aa</b><code>#fff</code></span></div></div></details><div class=\"tw\"><table><thead><tr><th>Token</th><th>Dark</th><th>Light</th></tr></thead><tbody><tr><td><span class=\"tk v0\" title=\"--bg \u00b7 dark #000 \u00b7 light #fff\"></span><code>--bg</code></td><td><span class=\"gnd gnd-dark v1\" title=\"#000 on the dark ground #17181a: 1.18:1 (fail)\"><span class=\"sw\"></span><b>Aa</b></span><code>#000</code></td><td><span class=\"gnd gnd-light v2\" title=\"#fff on the light ground #f4f3ef: 1.11:1 (fail)\"><span class=\"sw\"></span><b>Aa</b></span><code>#fff</code></td></tr></tbody></table></div><p>Just a paragraph</p>");
});

test('custom resolveHref result with a scheme is sanitized to a hash', () => {
  const md = 'See [link](page.html)';
  const r = renderBody(md, { resolveHref: () => 'javascript:alert(1)' });
  assert.deepEqual(r.body, "<p>See <a href=\"#\">link</a></p>");
});

test('custom resolveHref result with a file scheme is kept', () => {
  const md = 'See [link](page.html)';
  const r = renderBody(md, { resolveHref: () => 'file:///tmp/x' });
  assert.deepEqual(r.body, "<p>See <a href=\"file:///tmp/x\">link</a></p>");
});

test('cw:mark image renders the brand mark uri', () => {
  const md = '![mark](cw:mark)';
  const r = renderBody(md);
  assert.deepEqual(r.body, "<p><img alt=\"mark\" src=\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgYXJpYS1oaWRkZW49InRydWUiIGZvY3VzYWJsZT0iZmFsc2UiPjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjE2IiBmaWxsPSIjRkZGRkZGIi8+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTQuNSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTAxMDExIiBzdHJva2Utd2lkdGg9IjEiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjIwIiByPSIyLjQiIGZpbGw9IiNDOUEyMjciLz48Y2lyY2xlIGN4PSIyMSIgY3k9IjExIiByPSIyLjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M5QTIyNyIgc3Ryb2tlLXdpZHRoPSIxLjMiLz48cGF0aCBkPSJNMTMuNyAxOC4zIEwxOS4zIDEyLjciIHN0cm9rZT0iI0M5QTIyNyIgc3Ryb2tlLXdpZHRoPSIxLjMiIGZpbGw9Im5vbmUiLz48L3N2Zz4=\"></p>");
});

test('valid base64 data uri image is embedded', () => {
  const md = '![pic](data:image/png;base64,iVBORw0KGgo=)';
  const r = renderBody(md);
  assert.deepEqual(r.body, "<p><img alt=\"pic\" src=\"data:image/png;base64,iVBORw0KGgo=\"></p>");
});

test('invalid base64 data uri image falls back to missing span', () => {
  const md = '![pic](data:image/png;base64,not-valid-base64!)';
  const r = renderBody(md);
  assert.deepEqual(r.body, "<p><span class=\"missing\" title=\"data:image/png;base64,not-valid-base64!\">[image not embedded: pic]</span></p>");
});

test('readImage returning data embeds the image', () => {
  const md = '![pic](img.png)';
  const r = renderBody(md, { readImage: () => 'data:image/png;base64,AAAA' });
  assert.deepEqual(r.body, "<p><img alt=\"pic\" src=\"data:image/png;base64,AAAA\"></p>");
});

test('missing image with empty alt uses the src in the message', () => {
  const md = '![](img.png)';
  const r = renderBody(md, { readImage: () => null });
  assert.deepEqual(r.body, "<p><span class=\"missing\" title=\"img.png\">[image not embedded: img.png]</span></p>");
});

test('missing image with alt text uses the alt in the message', () => {
  const md = '![diagram](img.png)';
  const r = renderBody(md, { readImage: () => null });
  assert.deepEqual(r.body, "<p><span class=\"missing\" title=\"img.png\">[image not embedded: diagram]</span></p>");
});
