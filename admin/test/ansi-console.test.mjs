// ansiHtml() — the boundary where untrusted sweep output stops being data and starts being markup.
// It lives inline in admin/index.html, so it is extracted from source here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

function extract(name) {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name}() not found in admin/index.html`);
  const end = SRC.indexOf('\n}', at);
  assert.ok(end > -1, `could not find the end of ${name}()`);
  return SRC.slice(at, end + 2);
}

// esc() is a one-liner arrow; ansiHtml() depends on it.
const escLine = SRC.split('\n').find((l) => l.startsWith('const esc='));
assert.ok(escLine, 'esc() not found in admin/index.html');
const ansiHtml = new Function(`${escLine}\n${extract('ansiHtml')}\nreturn ansiHtml;`)();

const ESC = '\x1b[';
const orange = `${ESC}38;2;232;115;12m`;
const reset = `${ESC}0m`;

test('truecolor becomes an inline span in the same rgb', () => {
  const html = ansiHtml(`${orange}[sweep]${reset} rollup`);
  assert.match(html, /<span style="color:rgb\(232,115,12\)">\[sweep\]<\/span> rollup/);
});

test('bold is rendered as weight, not dropped', () => {
  assert.match(ansiHtml(`${ESC}1mcommitwork${reset}`), /<span style="font-weight:600">commitwork<\/span>/);
});

test('unrecognised sequences are dropped, never printed as text', () => {
  const html = ansiHtml(`${ESC}2K${ESC}31mred-16-colour${reset} done`);
  assert.ok(!html.includes('['), `a raw SGR sequence leaked into the output: ${html}`);
  assert.ok(html.includes('red-16-colour'), 'the text inside an unhandled code must survive');
});

// A finding whose file name or matched source contains markup must not inject it into the panel.
test('scanner output is escaped before any span wrapping — no markup can be injected', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const html = ansiHtml(`${orange}finding${reset} in ${hostile}`);
  assert.ok(!html.includes('<img'), `unescaped markup reached the output: ${html}`);
  assert.ok(html.includes('&lt;img'), 'the hostile text should still be visible, escaped');
});

test('markup inside a coloured run is escaped too', () => {
  const html = ansiHtml(`${orange}<script>bad()</script>${reset}`);
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!html.includes('<script>'), `unescaped script tag reached the output: ${html}`);
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form should be present');
});

test('unterminated colour runs are closed, so one line cannot restyle the rest of the log', () => {
  const html = ansiHtml(`${orange}no reset here`);
  const opens = (html.match(/<span/g) || []).length;
  const closes = (html.match(/<\/span>/g) || []).length;
  assert.equal(opens, closes, `unbalanced spans: ${html}`);
});

test('plain output is returned unchanged apart from escaping', () => {
  assert.equal(ansiHtml('[sweep] rollup'), '[sweep] rollup');
  assert.equal(ansiHtml(''), '');
  assert.equal(ansiHtml(null), '');
});
