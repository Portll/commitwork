// Pins the CodeQL js/bad-tag-filter and js/incomplete-multi-character-sanitization fixes in
// bin/a11y-scan.mjs: strip() escapes any '<'/'>' left standing, and stripNonMarkupRegions()
// honours the legacy `--!>` comment terminator and `</script >`. A hostile string must never
// survive into a finding carrying live markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strip, stripNonMarkupRegions, auditHtml } from '../a11y-scan.mjs';

test('strip(): unclosed "<script" with no closing > is escaped, not left raw', () => {
  const out = strip('bad<script text');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!out.includes('<script'), `still contains a live <script: ${out}`);
  assert.equal(out, 'bad&lt;script text');
});

test('strip(): a well-formed tag is still removed as before (no regression)', () => {
  assert.equal(strip('<b>hello</b> world'), 'hello world');
});

test('strip(): --!> alone (no matching <!--) is inert text either way — no crash, no live tag', () => {
  const out = strip('x--!>y');
  assert.ok(!out.includes('<'));
});

test('stripNonMarkupRegions(): --!> terminates a comment same as -->', () => {
  const html = '<div><!-- hidden --!><img src="a.png"></div>';
  const out = stripNonMarkupRegions(html);
  // the comment body (including the "--!>" tail) must be blanked; only the real <img> survives
  assert.ok(!/hidden/.test(out), 'comment content leaked through un-blanked');
  assert.match(out, /<img src="a\.png">/);
});

test('stripNonMarkupRegions(): </script > (space before >) still ends the script body', () => {
  const html = '<script>var x = "<img>";</script ><img src="real.png">';
  const out = stripNonMarkupRegions(html);
  assert.ok(!/<img>/.test(out.replace('<img src="real.png">', '')), 'script body text leaked as markup');
  assert.match(out, /<img src="real\.png">/);
});

test('stripNonMarkupRegions(): newline-preservation contract is unchanged', () => {
  const html = '<!--\nline2\nline3-->\nafter';
  const out = stripNonMarkupRegions(html);
  assert.equal(out.split('\n').length, html.split('\n').length);
});

// ── end-to-end: stripNonMarkupRegions() feeding the markup-shape checks ────────────────────────
test('auditHtml: a --!>-terminated comment cannot smuggle a fake <img> past 1.1.1', () => {
  // a browser considers this comment closed at --!>; a -->-only regex leaves its text scanned as markup
  const html = '<html lang="en"><head><title>t</title></head><body>' +
    '<!-- an <img src="x"> mention inside a comment --!>' +
    '<img src="real.png" alt="ok">' +
    '</body></html>';
  const findings = auditHtml(html, 'hostile.html');
  const img = findings.filter((f) => f.criterion === '1.1.1');
  assert.equal(img.length, 0, `comment content leaked into a 1.1.1 finding: ${JSON.stringify(img)}`);
});

test('auditHtml: an inline <script> closed with </script > (space) is still hidden from 1.1.1', () => {
  const html = '<html lang="en"><head><title>t</title></head><body>' +
    '<script>document.write("<img src=x>");</script >' +
    '<img src="real.png" alt="ok">' +
    '</body></html>';
  const findings = auditHtml(html, 'hostile.html');
  const img = findings.filter((f) => f.criterion === '1.1.1');
  assert.equal(img.length, 0, `script body text leaked into a 1.1.1 finding: ${JSON.stringify(img)}`);
});
