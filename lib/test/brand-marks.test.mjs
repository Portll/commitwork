import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webRoot, missingWebRoot } from '../web-root.mjs';
import { SEAL_SVG, SEAL_FAVICON, MARK_SVG, MARK_COLOURS, MARK_URI, MARK_ICON, KEY_SVG, markRecolourCss } from '../brand-tokens.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const geometry = (svg) => svg.replace(/\s(fill|stroke)="[^"]*"/g, '').replace(/\sxmlns="[^"]*"/, '');
const colours = (svg) => [...svg.matchAll(/\s(fill|stroke)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);

test('the default mark is the seal recoloured, never redrawn', () => {
  assert.equal(geometry(MARK_SVG), geometry(SEAL_SVG));
  assert.equal(geometry(KEY_SVG), geometry(SEAL_SVG));
});

test('the default mark has a white disc, a black ring and a gold key', () => {
  assert.deepEqual(colours(MARK_SVG), [
    'fill=#FFFFFF', 'fill=none', 'stroke=#101011', 'fill=#C9A227', 'fill=none', 'stroke=#C9A227', 'stroke=#C9A227', 'fill=none',
  ]);
  assert.deepEqual(MARK_COLOURS, { disc: '#FFFFFF', ring: '#101011', key: '#C9A227' });
});

for (const file of ['admin/cw-favicon.svg', 'sitemap/cw-favicon.svg']) {
  test(`${file} is the default mark, standalone`, () => {
    const svg = readFileSync(join(REPO, file), 'utf8');
    const shapes = (s) => [...s.matchAll(/<(circle|path)\b[^>]*\/>/g)].map((m) => m[0]);
    assert.deepEqual(shapes(svg), shapes(MARK_SVG));
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
}

// The public origin's pages live in the private commitwork-web repository and cannot import the
// marks, so they carry copies and are held to them here when that checkout is beside this one.
const WEB_ROOT = webRoot();
const WEB_ABSENT = missingWebRoot(WEB_ROOT);
const webPages = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? webPages(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []));
const WEB_PAGES = WEB_ABSENT ? [] : webPages(WEB_ROOT);
test('every page of the public origin is held to the marks', (t) => {
  if (WEB_ABSENT) return t.skip(`${WEB_ABSENT} -- the public origin's marks were NOT checked`);
  assert.ok(WEB_PAGES.includes(join(WEB_ROOT, 'index.html')) && WEB_PAGES.includes(join(WEB_ROOT, '404.html')), WEB_PAGES.join(', '));
});

// Every public page in the tree takes the default mark as its tab icon: each tracked .html under a
// directory named public that declares a document <head>. Tracked, because that is what ships; a
// new public directory is held here without anyone listing it.
const PUBLIC_PAGES = execFileSync('git', ['ls-files', '-z', '--', ':(glob)**/public/**/*.html', ':(glob)**/public/**/*.htm'],
  { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter((f) => /<head[\s>]/i.test(readFileSync(join(REPO, f), 'utf8')));
for (const file of [...PUBLIC_PAGES.map((f) => join(REPO, f)), ...WEB_PAGES]) {
  test(`${file} takes the default mark as its tab icon`, () => {
    const html = readFileSync(file, 'utf8');
    assert.deepEqual(html.match(/<link rel="icon"[^>]*>/g), [MARK_ICON]);
  });
}

for (const file of WEB_PAGES) {
  test(`${file} carries the lockup: the default mark on light, the dark-ground seal on dark`, () => {
    const html = readFileSync(file, 'utf8');
    const lockup = html.match(/<a class="mark"[^>]*>(.*?)<\/a>/);
    assert.ok(lockup, 'no lockup');
    assert.deepEqual([...lockup[1].matchAll(/<img class="seal (seal-[ld])" alt="" src="([^"]+)">/g)].map((m) => [m[1], m[2]]),
      [['seal-l', MARK_URI], ['seal-d', SEAL_FAVICON]]);
    assert.match(lockup[1], /<span class="wordmark">commitwork<\/span>$/);
  });
}

// A data URI under a CSP that refuses it is dropped without an error anywhere: the icon and the
// lockup are images, and the house faces are fonts.
test('the public origin admits the data URIs its pages carry', async (t) => {
  if (WEB_ABSENT) return t.skip(`${WEB_ABSENT} -- the public origin's CSP was NOT checked`);
  const { handle } = await import(pathToFileURL(join(dirname(WEB_ROOT), 'serve.mjs')).href);
  let headers;
  handle({ method: 'HEAD', url: '/' }, { writeHead: (_, h) => { headers = h; }, end: () => {} }, WEB_ROOT);
  const csp = headers['content-security-policy'];
  assert.match(csp, /(^|;)\s*img-src [^;]*\bdata:/);
  const embedsFonts = WEB_PAGES.some((f) => readFileSync(f, 'utf8').includes('data:font/'));
  assert.ok(embedsFonts, 'the pages no longer embed their faces; drop font-src');
  assert.match(csp, /(^|;)\s*font-src [^;]*\bdata:/);
});

// The static light stylesheets cannot import MARK_COLOURS, so they are held to it here.
for (const [file, scope] of [['admin/static/panel-light.css', '.seal'], ['docsite/editor/editor.css', '.brand']]) {
  test(`${file} recolours its inline seal to the default mark`, () => {
    const css = readFileSync(join(REPO, file), 'utf8');
    assert.ok(css.includes(markRecolourCss(scope)), `${file} lacks ${markRecolourCss(scope)}`);
  });
}

// The login page takes its light recolour from panel-light.css, held to the mark above, by linking
// that sheet behind the theme switch. It carries no copy of its own, and none that applies in dark.
test('the login page recolours its seal through panel-light.css only', async () => {
  const { loginPage } = await import('../../admin/lib/login-page.mjs');
  const html = loginPage({ bootstrapOpen: false, localPort: 7878 });
  assert.match(html, /<link id="theme-light" rel="stylesheet" href="\/static\/panel-light\.css"/);
  assert.match(html, /<span class="seal">/, 'the seal the sheet recolours is not on the page');
  assert.ok(!html.includes('circle:first-of-type'), 'the page recolours the seal itself, outside the light sheet');
  const src = readFileSync(join(REPO, 'admin/lib/login-page.mjs'), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/lib\/brand-tokens\.mjs'/);
});
