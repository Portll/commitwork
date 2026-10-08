// Pins the CodeQL js/bad-tag-filter and js/incomplete-multi-character-sanitization fixes in
// bin/render-report.mjs's stripComments(), and the href-attribute-breakout fix in esc()/inline().
// A hostile scanner-controlled string must never survive into the generated HTML as a live tag,
// an un-terminated comment, or a broken-out attribute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = join(HERE, '..', 'render-report.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-render-report-'));

function render(md) {
  const inPath = join(T, `${Math.random().toString(36).slice(2)}.md`);
  const outPath = inPath.replace(/\.md$/, '.html');
  writeFileSync(inPath, md);
  execFileSync(process.execPath, [SCRIPT, inPath, outPath], { encoding: 'utf8' });
  return readFileSync(outPath, 'utf8');
}

test('a hostile advisory/package name in body text cannot inject a live tag or unterminated comment', () => {
  const hostile = 'evil<!--x--!>name and </script >tail and back\\slash';
  const html = render(`# Report\n\nfinding: ${hostile}\n`);

  // no live comment opener/closer or script-close survives un-escaped
  assert.ok(!html.includes('<!--x'), 'raw <!-- survived into the output');
  assert.ok(!html.includes('--!>'), 'raw --!> survived into the output');
  assert.ok(!html.includes('</script >'), 'raw </script > survived into the output');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!/<script\b/i.test(html), 'a live <script tag appeared');

  // the backslash and the rest of the text still render as inert, visible text
  assert.match(html, /back\\slash|back&#92;slash|back\\\\slash/);
});

// The renderer only ever emits `<a href="...">` from one template literal, so the href VALUE is
// exactly what's captured up to the first '">' — a raw '"' inside it means the attribute broke out.
function hrefValue(html) {
  const m = html.match(/<a href="([\s\S]*?)">/);
  assert.ok(m, `no <a href="..."> tag found in: ${html}`);
  return m[1];
}

test('a hostile link target cannot break out of the double-quoted href attribute', () => {
  // esc() once escaped &/</> but not '"' — a link target with a bare double quote injected a live attribute
  const html = render('[click](x" onmouseover="alert(1))\n');
  assert.ok(!hrefValue(html).includes('"'), `attribute broke out: ${html}`);
  assert.ok(!/<a[^>]*"\s+onmouseover=/i.test(html), `onmouseover escaped into a live attribute: ${html}`);
});

test('a link target combining <!--, --!>, </script > and a quote cannot inject anything live', () => {
  const hostile = 'x" onmouseover="alert(1)<!--y--!></script >';
  const html = render(`[pkg](${hostile})\n`);
  assert.ok(!hrefValue(html).includes('"'), `attribute broke out from the link target: ${html}`);
  assert.ok(!/<a[^>]*"\s+onmouseover=/i.test(html), 'attribute breakout via the link target');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!/<script\b/i.test(html), 'a live <script tag appeared from the link target');
  assert.ok(!html.includes('<!--y'), 'raw <!-- survived from the link target');
});

test('report title (used unescaped elsewhere in many renderers) is escaped in <title>', () => {
  const html = render('# a" onmouseover="x<script>alert(1)</script>\n\nbody\n');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!/<title>[^<]*<script/i.test(html), 'title context carries a live <script');
  assert.match(html, /<title>.*&quot;.*<\/title>/);
});
