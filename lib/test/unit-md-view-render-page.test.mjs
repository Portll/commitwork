// The full standalone HTML viewer page and its stats for a markdown document (lib/md-view.mjs renderPage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../md-view.mjs';
import { createHash } from 'node:crypto';

const MARKS = /^<header class="top"><span class="mark"><img class="seal seal-l" alt="" src="[^"]*"><img class="seal seal-d" alt="" src="[^"]*">/;
const headerOf = (h) => {
  const s = h.indexOf('</head><body>\n') + 14;
  return h.slice(s, h.indexOf('\n', s)).replace(MARKS, '<MARKS>');
};
const b64 = (x) => createHash('sha256').update(x, 'utf8').digest('base64');

test('the title is the first h1, else the source basename, else Markdown', () => {
  assert.deepEqual(renderPage({ md: '# Hello', source: 'a/b.md' }).stats, { title: 'Hello', tokens: 0, colours: 0, headings: 0 });
  assert.equal(renderPage({ md: '# Hello' }).stats.title, 'Hello');
  assert.equal(renderPage({ md: '# One\n\n# Two', source: 'x/y.md' }).stats.title, 'One');
  assert.deepEqual(renderPage({ md: '## Section', source: 'docs/readme.md' }).stats, { title: 'readme.md', tokens: 0, colours: 0, headings: 1 });
  assert.equal(renderPage({ md: '## Section', source: 'docs/' }).stats.title, 'Markdown');
  assert.equal(renderPage({ md: '## Section' }).stats.title, 'Markdown');
  assert.deepEqual(renderPage().stats, { title: 'Markdown', tokens: 0, colours: 0, headings: 0 });
});

test('the page opens with doctype, charset, viewport and a CSP hashing the style and both scripts', () => {
  const h = renderPage({ md: '## S', source: 'docs/readme.md' }).html;
  const css = h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>'));
  const s1 = h.slice(h.indexOf('<script>') + 8, h.indexOf('</script>'));
  const s2 = h.slice(h.lastIndexOf('<script>') + 8, h.lastIndexOf('</script>'));
  const csp = `default-src 'none'; img-src data:; font-src data:; style-src 'sha256-${b64(css)}'; script-src 'sha256-${b64(s1)}' 'sha256-${b64(s2)}'; base-uri 'none'; form-action 'none'`;
  const prefix = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  assert.equal(h.slice(0, prefix.length), prefix);
});

test('the head holds the escaped title, the follower script and the style sheet before the body opens', () => {
  const h = renderPage({ md: '## S', source: 'a&b/c<d.md' }).html;
  const s1 = h.slice(h.indexOf('<script>') + 8, h.indexOf('</script>'));
  const css = h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>'));
  const from = h.indexOf('\n<title>');
  assert.equal(h.slice(from, h.indexOf('<header')), `\n<title>c&lt;d.md</title>\n<script>${s1}</script>\n<style>${css}</style>\n</head><body>\n`);
});

test('each font becomes an inline font-face at the top of the style sheet', () => {
  const fonts = [
    { family: 'Ink', style: 'normal', weight: 400, data: 'AAAA', format: 'truetype' },
    { family: 'Ink', style: 'italic', weight: 700, data: 'BBBB' },
  ];
  const h = renderPage({ md: '## S', fonts }).html;
  const css = h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>'));
  const faces = '@font-face{font-family:"Ink";font-style:normal;font-weight:400;font-display:swap;src:url(data:font/ttf;base64,AAAA) format("truetype")}\n'
    + '@font-face{font-family:"Ink";font-style:italic;font-weight:700;font-display:swap;src:url(data:font/woff2;base64,BBBB) format("woff2")}\n';
  assert.equal(css.slice(0, faces.length), faces);
});

test('the header shows the marks, wordmark, title, source and theme button', () => {
  const h = renderPage({ md: '## S', source: 'docs/readme.md' }).html;
  assert.equal(headerOf(h), '<MARKS><span class="wm">commitwork</span></span><span class="ttl">readme.md</span><span class="src">docs/readme.md</span><button id="theme" type="button"></button></header>');
  const e = renderPage({ md: '## S', source: 'a&b/c<d.md' }).html;
  assert.equal(headerOf(e), '<MARKS><span class="wm">commitwork</span></span><span class="ttl">c&lt;d.md</span><span class="src">a&amp;b/c&lt;d.md</span><button id="theme" type="button"></button></header>');
});

test('a verified-against comment adds a stamp with the date and an optional 7+ hex commit', () => {
  const withSha = renderPage({ md: '<!-- verified-against: 2026-03-04 abc1234 -->\n\n## S' }).html;
  assert.equal(headerOf(withSha), '<MARKS><span class="wm">commitwork</span></span><span class="ttl">Markdown</span><span class="stamp" title="verified-against stamp">verified 2026-03-04 \u00b7 abc1234</span><button id="theme" type="button"></button></header>');
  const dateOnly = renderPage({ md: '<!-- verified-against: 2026-03-04 -->\n\n## S' }).html;
  assert.equal(headerOf(dateOnly), '<MARKS><span class="wm">commitwork</span></span><span class="ttl">Markdown</span><span class="stamp" title="verified-against stamp">verified 2026-03-04</span><button id="theme" type="button"></button></header>');
  const shortSha = renderPage({ md: '<!-- verified-against: 2026-03-04 abc123 -->\n\n## S' }).html;
  assert.equal(headerOf(shortSha), '<MARKS><span class="wm">commitwork</span></span><span class="ttl">Markdown</span><button id="theme" type="button"></button></header>');
});

test('the layout holds a contents nav linking each h2 and h3 by level before the main column', () => {
  const r = renderPage({ md: '## Alpha\n\n### Beta' });
  const h = r.html;
  const id2 = /<h2 id="([^"]*)">/.exec(h)[1];
  const id3 = /<h3 id="([^"]*)">/.exec(h)[1];
  const start = h.indexOf('</header>\n');
  const expected = `</header>\n<div class="layout"><nav class="toc" aria-label="Contents"><a class="l2" href="#${id2}">Alpha</a><a class="l3" href="#${id3}">Beta</a></nav><main class="doc">`;
  assert.equal(h.slice(start, start + expected.length), expected);
  assert.equal(r.stats.headings, 2);
});

test('the main column closes before a footer with source, digest and counts, then the toggle script', () => {
  const md = '## Alpha';
  const digest = createHash('sha256').update(md, 'utf8').digest('hex').slice(0, 12);
  const h = renderPage({ md, source: 'docs/readme.md' }).html;
  const s2 = h.slice(h.lastIndexOf('<script>') + 8, h.lastIndexOf('</script>'));
  assert.equal(h.slice(h.indexOf('</main>')), `</main></div>\n<footer class="foot">docs/readme.md \u00b7 sha256 ${digest} \u00b7 0 tokens \u00b7 0 colours \u00b7 rendered by bin/md-view.mjs</footer>\n<script>${s2}</script>\n</body></html>\n`);
  const n = renderPage({ md }).html;
  const t2 = n.slice(n.lastIndexOf('<script>') + 8, n.lastIndexOf('</script>'));
  assert.equal(n.slice(n.indexOf('</main>')), `</main></div>\n<footer class="foot">markdown \u00b7 sha256 ${digest} \u00b7 0 tokens \u00b7 0 colours \u00b7 rendered by bin/md-view.mjs</footer>\n<script>${t2}</script>\n</body></html>\n`);
});
