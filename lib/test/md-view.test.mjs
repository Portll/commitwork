import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderPage, renderBody, parseMarkdown, contrastRatio, grade, parseColor, sanitizeLockup, scopeCss } from '../md-view.mjs';

const body = (md, opts) => renderBody(md, opts).body;
const count = (s, re) => (s.match(re) || []).length;

describe('block parser — the cases lib/render-markdown.mjs gets wrong', () => {
  test('an indented continuation line stays inside its list item', () => {
    const html = body('- **First.** begins here\n  and wraps onto this line\n- Second');
    assert.equal(count(html, /<ul/g), 1);
    assert.equal(count(html, /<li>/g), 2);
    assert.match(html, /<li><p><strong>First\.<\/strong> begins here\nand wraps onto this line<\/p><\/li>/);
  });

  test('an unindented (lazy) continuation line also stays in the item', () => {
    const html = body('1. one\ncontinues\n2. two');
    assert.equal(count(html, /<ol/g), 1);
    assert.match(html, /one\ncontinues/);
  });

  test('a table indented under a list item renders inside that item', () => {
    const html = body('- intro:\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n\n  after\n- next');
    assert.match(html, /<li><p>intro:<\/p><div class="tw"><table>[\s\S]*<\/table><\/div><p>after<\/p><\/li><li>/);
    assert.equal(count(html, /<ul/g), 1);
  });

  test('an ordered list keeps its start number', () => {
    assert.match(body('3. three\n4. four'), /<ol start="3"/);
  });

  test('a pipe inside a code span does not split the cell', () => {
    const [t] = parseMarkdown('| x | y |\n|---|---|\n| `a|b` | c |');
    assert.deepEqual(t.rows[0], ['`a|b`', 'c']);
  });

  test('duplicate headings get distinct anchors and both reach the contents list', () => {
    const { body: html, st } = renderBody('## Same\n\n## Same');
    assert.match(html, /id="same"/);
    assert.match(html, /id="same-1"/);
    assert.equal(st.toc.length, 2);
  });

  test('HTML comments are dropped, not rendered as text', () => {
    assert.doesNotMatch(body('<!-- verified-against: 2026-01-01 abcdef1 -->\n\ntext'), /verified-against/);
  });
});

describe('colour', () => {
  test('contrast ratio matches the WCAG definition at its extremes and composites alpha', () => {
    assert.equal(contrastRatio('#ffffff', '#000000').toFixed(2), '21.00');
    assert.equal(contrastRatio('rgba(0,0,0,0)', '#ffffff').toFixed(2), '1.00');
    assert.equal(contrastRatio('#c9a227', '#17181a').toFixed(2), '7.34');
  });

  test('grades on the unrounded ratio, so 4.496 fails AA', () => {
    assert.equal(grade(7), 'aaa');
    assert.equal(grade(4.5), 'aa');
    assert.equal(grade(4.496), 'large');
    assert.equal(grade(2.99), 'fail');
  });

  test('parses short hex, alpha hex, rgba and hsl', () => {
    assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
    assert.equal(parseColor('#00000080')[3].toFixed(2), '0.50');
    assert.deepEqual(parseColor('rgba(201,162,39,.10)'), [201, 162, 39, 0.1]);
    assert.deepEqual(parseColor('hsl(0 100% 50%)').map(Math.round), [255, 0, 0, 1]);
    assert.equal(parseColor('#12345'), null);
  });

  test('a colour literal in code gets a swatch, and the swatch colour is a generated class', () => {
    const { body: html, st } = renderBody('Use `#c9a227` here.');
    assert.match(html, /<code><span class="sw v0" title="#c9a227 · 7\.34:1 on #17181a/);
    assert.match(st.sheet.css(), /^\.v0\{--c:rgba\(201,162,39,1\)\}$/);
  });

  test('a token declared in a Dark/Light table resolves wherever it is named', () => {
    const md = '| Token | Dark | Light |\n|---|---|---|\n| `--acc` | `#c9a227` | `#96702e` |\n\nSee `--acc`.';
    const { body: html, st } = renderBody(md);
    assert.equal(st.tokens.get('--acc').light, '#96702e');
    assert.match(html, /<p>See <span class="tk v\w+" title="--acc · dark #c9a227 · light #96702e"><\/span><code>--acc<\/code>\.<\/p>/);
  });

  test('a Dark or Light column draws the colour on that ground, with its ratio', () => {
    const html = body('| Token | Dark |\n|---|---|\n| `--x` | `#5fd08a`, 9.20 |');
    assert.match(html, /class="gnd gnd-dark v\w+" title="#5fd08a on the dark ground #17181a: 9\.20:1 \(AAA\)"/);
    assert.match(html, /9\.20<span class="cr cr-aaa"/);
  });

  test('an N:1 ratio in prose is graded', () => {
    assert.match(body('It measures 4.48:1.'), /4\.48:1<span class="cr cr-large"/);
  });

  test('a fenced block carries swatches inside the code', () => {
    const html = body('```css\na{color:#96702e}\n```');
    assert.match(html, /<pre class="cb" data-lang="css"><code>a\{color:<span class="sw /);
  });
});

describe('context decides what a number means', () => {
  test('a bare weight in prose draws nothing; in a Weight column it draws a sample', () => {
    assert.doesNotMatch(body('Use 400 here.'), /wsmp/);
    assert.match(body('| Face | Weights |\n|---|---|\n| Sans | 400, 600 |'), /400<span class="wsmp [^"]+">Ag<\/span>, 600<span class="wsmp/);
  });

  test('radius, padding, opacity, timing, measure and type-size columns each draw their own demo', () => {
    const md = [
      '| Radius | Padding | Opacity | Timing | Measure | rem |',
      '|---|---|---|---|---|---|',
      '| 3px | .375rem .75rem | .55 | .14s linear | 62ch | .75 |',
    ].join('\n');
    const { body: html, st } = renderBody(md);
    for (const c of ['rbox', 'pbox', 'osmp', 'mv', 'mbar', 'tsz']) assert.match(html, new RegExp(`class="${c} `), c);
    const css = st.sheet.css();
    for (const d of ['border-radius:3px', 'padding:.375rem .75rem', 'opacity:.55', '--dur:.14s;--ease:linear', 'width:62ch', 'font-size:.75rem']) {
      assert.ok(css.includes(d), d);
    }
  });

  test('a shadow and a font stack in code are drawn', () => {
    const html = body('`0 8px 24px rgba(0,0,0,.35)` and `"IBM Plex Sans",-apple-system,sans-serif`');
    assert.match(html, /class="shd /);
    assert.match(html, /class="fsmp /);
  });

  test('a run of steps under a spacing heading becomes a ladder; a padding shorthand does not', () => {
    assert.match(body('## Spacing\n\n`.25 · .5 · 1 · 2` rem'), /class="ladder"/);
    assert.doesNotMatch(body('## Spacing\n\n`padding:0 1.25rem 5rem`'), /class="ladder"/);
  });
});

describe('specimens', () => {
  const sheet = (md) => { const r = renderBody(md); return { html: r.body, css: r.st.sheet.css() }; };

  test('a Specimen column is set in the row\'s own face, size, weight, tracking, case and colour', () => {
    const { html, css } = sheet('| Face | Size | Weight | Tracking | Case | Colour | Specimen |\n|---|---|---|---|---|---|---|\n| IBM Plex Sans | .78rem | 700 | .16em | uppercase | `--ink` | commitwork |');
    assert.match(html, /<td class="spec-cell"><span class="spec v\w+ spec-inline">commitwork<\/span><\/td>/);
    assert.ok(css.includes('font-family:var(--sans);font-size:.78rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--ink)'), css);
  });

  test('the Element cell decides the markup: a heading is a styled block, never an outline heading', () => {
    const { html } = sheet('| Element | Size | Specimen |\n|---|---|---|\n| `h2` | 1.28rem | Heading two |');
    assert.match(html, /<span class="spec v\w+ spec-block">Heading two<\/span>/);
    assert.doesNotMatch(html.slice(html.indexOf('<tbody>')), /<h2/);
  });

  test('ul li li nests a second list, and its Marker and Indent style the inner level', () => {
    const { html, css } = sheet('| Element | Marker | Indent | Specimen |\n|---|---|---|---|\n| `ul li li` | circle | 1.4rem | A nested item |');
    assert.match(html, /<ul class="spec-list"><li class="spec">First level<ul class="spec-list v\w+"><li class="spec">A nested item<\/li>/);
    assert.ok(css.includes('list-style-type:circle;padding-left:1.4rem'));
  });

  test('div p is a paragraph inside a division', () => {
    assert.match(sheet('| Element | Specimen |\n|---|---|\n| `div p` | Text |').html, /<div class="spec-div"><p class="spec">Text<\/p><\/div>/);
  });

  test('a document token that is not a page variable follows the page theme through a light/dark pair', () => {
    const md = '| Token | Dark | Light |\n|---|---|---|\n| `--machine` | `#8a9a5b` | `#5c6b33` |\n\n| Colour | Specimen |\n|---|---|\n| `--machine` | olive |';
    const { html, css } = sheet(md);
    assert.match(html, /class="spec v\w+ spec-tc spec-inline"/);
    assert.ok(css.includes('--sl:rgba(92,107,51,1);--sd:rgba(138,154,91,1)'));
  });

  test('the house marks come from lib/brand-tokens.mjs, and a Size cell sets their height', () => {
    const { html, css } = sheet('| Size | Specimen |\n|---|---|\n| 1.5rem | ![seal](cw:seal) |');
    assert.match(html, /<img class="spec-img v\w+" alt="seal" src="data:image\/svg\+xml;base64,/);
    assert.ok(css.includes('height:1.5rem'));
  });

  test('a font family named in prose is set in that family, and one not embedded says so', () => {
    const { body: html } = renderBody('Body text is IBM Plex Mono; reports once used Georgia.', { families: ['IBM Plex Mono'] });
    assert.match(html, /<span class="ff v\w+">IBM Plex Mono<\/span>/);
    assert.match(html, /<span class="ff v\w+" title="Georgia is not embedded; shown only if installed here">Georgia<\/span>/);
  });

  test('numbers in a specimen table\'s value cells are not also drawn as separate demos', () => {
    const { html } = sheet('| Weight | Size | Specimen |\n|---|---|---|\n| 700 | .78rem | x |');
    assert.doesNotMatch(html, /class="(wsmp|tsz) /);
  });

  test('a variable TrueType face is embedded with its weight range and format', () => {
    const { html } = renderPage({ md: 'x', fonts: [{ family: 'Quicksand', weight: '300 700', style: 'normal', format: 'truetype', data: 'AAAA' }] });
    assert.match(html, /@font-face\{font-family:"Quicksand";font-style:normal;font-weight:300 700;font-display:swap;src:url\(data:font\/ttf;base64,AAAA\) format\("truetype"\)\}/);
  });
});

describe('lockups', () => {
  test('the sanitiser keeps panel markup and drops everything that could act', () => {
    const out = sanitizeLockup('<div class="pill crit" data-s="x" aria-label="c" style="color:red" onclick="alert(1)">crit</div>'
      + '<script>alert(1)</script><style>body{display:none}</style><a href="javascript:alert(1)">x</a><a href="#ok">y</a>'
      + '<img src="https://example.com/x.png"><img alt="seal" src="cw:seal"><svg onload="alert(1)"><circle/></svg><iframe src="x"></iframe>');
    assert.match(out, /^<div class="pill crit" data-s="x" aria-label="c">crit<\/div>/);
    assert.doesNotMatch(out, /script|style=|onclick|onload|javascript|display:none|example\.com|<svg|<iframe|alert/);
    assert.match(out, /<a>x<\/a><a href="#ok">y<\/a>/);
    assert.match(out, /<img alt="seal" src="data:image\/svg\+xml;base64,/);
  });

  test('<cw-seal> becomes the trusted inline seal, so a light sheet can recolour it', () => {
    const out = sanitizeLockup('<span class="seal"><cw-seal></cw-seal></span>');
    assert.match(out, /^<span class="seal"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="16" fill="#14161A"\/>/);
    assert.match(out, /<\/svg><\/span>$/);
  });

  test('text is escaped once, and entities written in the markup survive as characters', () => {
    assert.equal(sanitizeLockup('<b>Decisions &amp; reviews < 3</b>'), '<b>Decisions &amp; reviews &lt; 3</b>');
  });

  test('the scoper puts every rule under its container and keeps the sheets cascading in their own order', () => {
    const css = scopeCss(`:root{--bg:#000}
body{margin:0}
.workspace-shell .bar{background:var(--bg)}
.pill,.gtab:is(.a,.b){color:red}
.cw-light .cw-btn{color:#fff}
@media (max-width:640px){.kpi{padding:0}}
@font-face{font-family:"X";src:url(x.woff2)}
@keyframes spin{to{transform:rotate(1turn)}}`, '.lk');
    assert.match(css, /^\.lk\{--bg:#000\}/m);
    assert.match(css, /^\.lk\{margin:0\}/m);
    assert.match(css, /^\.lk\.lk \.bar\{background:var\(--bg\)\}/m);
    assert.match(css, /^\.lk \.pill,\.lk \.gtab:is\(\.a,\.b\)\{color:red\}/m);
    assert.match(css, /^\.lk-light \.cw-surface \.cw-btn\{color:#fff\}/m);
    assert.match(css, /@media \(max-width:640px\)\{\.lk \.kpi\{padding:0\}\}/);
    assert.doesNotMatch(css, /font-face/);
    assert.match(css, /@keyframes spin\{to\{transform:rotate\(1turn\)\}\}/);
  });

  test('a lockup fence renders dark and light containers styled by the scoped sheets, under the same CSP', () => {
    const { html } = renderPage({
      md: '```lockup\n<span class="pill crit">critical</span>\n```',
      lockupSheets: { base: [':root{--crit:#fe5b66}.pill.crit{color:var(--crit)}'], light: [':root{--crit:#c32b25}'] },
    });
    assert.match(html, /<div class="lk lk-dark"><span class="lk-cap">Dark<\/span><span class="pill crit">critical<\/span><\/div><div class="lk lk-light">/);
    assert.match(html, /\.lk \.pill\.crit\{color:var\(--crit\)\}/);
    assert.match(html, /\.lk-light\{--crit:#c32b25\}/);
    assert.doesNotMatch(html, /\sstyle=|unsafe-inline/);
  });

  test('a document without lockups carries none of the panel stylesheet', () => {
    const { html } = renderPage({ md: '# x', lockupSheets: { base: ['.pill{color:red}'], light: [] } });
    assert.doesNotMatch(html, /\.lk \.pill/);
  });
});

describe('hostile input', () => {
  test('raw HTML is escaped, not rendered', () => {
    const html = body('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    assert.doesNotMatch(html, /<script|<img/);
  });

  test('a javascript: link is disarmed', () => {
    assert.match(body('[x](javascript:alert(1))'), /href="#"/);
  });

  test('a code span cannot smuggle CSS past the colour grammar', () => {
    const { st } = renderBody('`#fff;}body{display:none}` `a, b}</style><script>x</script>, serif`');
    const css = st.sheet.css();
    assert.doesNotMatch(css, /display:none|<\/style|script/);
  });

  test('a remote image is never fetched or embedded', () => {
    let asked = false;
    const html = body('![logo](https://example.com/x.png)', { readImage: () => { asked = true; return 'data:image/png;base64,AAAA'; } });
    assert.equal(asked, false);
    assert.match(html, /class="missing"/);
  });

  test('an svg fence becomes an inert image, never live markup', () => {
    const { html } = renderPage({ md: '```svg\n<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>\n```' });
    assert.doesNotMatch(html.slice(html.indexOf('<main')), /<svg/);
    assert.match(html, /<img alt="figure" src="data:image\/svg\+xml;base64,/);
  });
});

describe('page', () => {
  const md = '# Title\n\n<!-- verified-against: 2026-09-27 0f1e2d3 -->\n\n## A\n\n`#c9a227` and 4.06:1';

  test('carries no style attribute, and its CSP hashes match its own inline style and scripts', () => {
    const { html } = renderPage({ md });
    assert.doesNotMatch(html, /\sstyle=/);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    assert.doesNotMatch(csp, /unsafe-inline/);
    const hash = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
    assert.ok(csp.includes(hash(/<style>([\s\S]*?)<\/style>/.exec(html)[1])));
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script\b[^>]*>/gi)) assert.ok(csp.includes(hash(m[1])));
  });

  test('is byte-identical across renders of the same input', () => {
    assert.equal(renderPage({ md, source: 'x.md' }).html, renderPage({ md, source: 'x.md' }).html);
  });

  test('shows the verified-against stamp and takes its title from the h1', () => {
    const { html, stats } = renderPage({ md });
    assert.equal(stats.title, 'Title');
    assert.match(html, /verified 2026-09-27 · 0f1e2d3/);
  });

  test('embeds the fonts it is given as data URIs and nothing from the network', () => {
    const { html } = renderPage({ md, fonts: [{ family: 'IBM Plex Sans', weight: 400, style: 'normal', data: 'AAAA' }] });
    assert.match(html, /src:url\(data:font\/woff2;base64,AAAA\)/);
    assert.doesNotMatch(html, /(src|href)="https?:/);
  });

  // docs/THEME.md §3.6: a contrast grade is a status pill, its token at 12% fill and 28% border.
  // Solid fills under white ink were a second status palette that held on both grounds.
  test('the contrast grades take the status tokens on the pill recipe, with no literal colour', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(renderPage({ md }).html)[1];
    const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]).filter(([sel]) => /\.cr\b/.test(sel));
    assert.ok(rules.length >= 4, `found only ${rules.length} .cr rules`);
    for (const [sel, decls] of rules) assert.doesNotMatch(decls, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${sel} carries a literal colour`);
    const mix = (t, p) => `color-mix(in srgb,var(--${t}) ${p}%,transparent)`;
    for (const [sel, token] of [['.cr-aaa,.cr-aa', 'live'], ['.cr-large', 'part'], ['.cr-fail', 'crit']]) {
      const hit = rules.find(([s]) => s === sel);
      assert.ok(hit, `no ${sel} rule`);
      assert.equal(hit[1], `color:var(--${token});background:${mix(token, 12)};border-color:${mix(token, 28)}`, sel);
    }
  });
});
