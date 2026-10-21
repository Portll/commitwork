// Pins the 3.3.8 Accessible Authentication check to the FIELD rather than the document — two
// document-wide regexes once failed any page holding a correct password field and an unrelated
// autocomplete="off". The clean cases are the regression that matters: each FAILED before the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditHtml } from '../a11y-scan.mjs';

const has338 = (html) => (auditHtml(html) || []).some((v) => (v.id || v.criterion) === '3.3.8');

test('3.3.8 fires when the password field itself declares autocomplete=off', () => {
  assert.ok(has338('<input type="password" autocomplete="off">'));
});

test('3.3.8 fires when the password field inherits autocomplete=off from its form', () => {
  assert.ok(has338('<form autocomplete="off"><input type="password"></form>'));
});

test('3.3.8 stays clean when an unrelated field carries autocomplete=off', () => {
  // The exact shape of admin/index.html: a correct password field, and `off` on other fields.
  const html = '<form id="pj-form" autocomplete="off"><input type="text"></form>'
    + '<input id="pf-pass" type="password" autocomplete="current-password">'
    + '<input id="pf-gh-login" type="text" autocomplete="off">';
  assert.equal(has338(html), false, 'document-wide co-occurrence must not be treated as a violation');
});

test('3.3.8 stays clean for autocomplete=new-password', () => {
  assert.equal(has338('<input type="password" autocomplete="new-password">'), false);
});

test('3.3.8 stays clean when the field overrides its form', () => {
  assert.equal(has338('<form autocomplete="off"><input type="password" autocomplete="current-password"></form>'), false);
});

test('3.3.8 stays clean when the document has no password field at all', () => {
  assert.equal(has338('<input type="text" autocomplete="off">'), false);
});

test('N offending fields yield N DISTINCT named findings, not N identical ones', () => {
  // no identifier and no dedup once made N fields produce N byte-identical findings
  const html = '<input id="a" type="password" autocomplete="off">'
    + '<input id="b" type="password" autocomplete="off">'
    + '<input name="c" type="password" autocomplete="off">';
  const found = (auditHtml(html) || []).filter((v) => (v.id || v.criterion) === '3.3.8');
  assert.equal(found.length, 3);
  const details = found.map((f) => f.detail || f.message || '');
  assert.equal(new Set(details).size, 3, 'findings must be distinguishable');
  assert.ok(details.some((d) => d.includes('#a')));
  assert.ok(details.some((d) => d.includes('[name=c]')));
});

test('the same field is reported once, not once per matching rule', () => {
  // A field inside a form[autocomplete=off] that ALSO sets its own off must not be double-counted.
  const html = '<form autocomplete="off"><input id="dup" type="password" autocomplete="off"></form>';
  const found = (auditHtml(html) || []).filter((v) => (v.id || v.criterion) === '3.3.8');
  assert.equal(found.length, 1);
});

test('a password field value never reaches the finding text', () => {
  const html = '<input id="p" type="password" value="hunter2-should-not-leak" autocomplete="off">';
  const found = (auditHtml(html) || []).filter((v) => (v.id || v.criterion) === '3.3.8');
  assert.equal(found.length, 1);
  assert.ok(!JSON.stringify(found).includes('hunter2-should-not-leak'));
});

test('the panel this scanner is pointed at no longer trips 3.3.8', async () => {
  // Reads the real file deliberately: the phantom was only visible against the actual document.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const panel = fileURLToPath(new URL('../../admin/index.html', import.meta.url));
  let html;
  try {
    html = await readFile(panel, 'utf8');
  } catch (e) {
    // Only a genuinely absent panel is a skip; anything else is a real failure, not a pass.
    if (e.code !== 'ENOENT') throw e;
    return;
  }
  assert.equal(has338(html), false);
});
