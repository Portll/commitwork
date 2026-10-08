// Scanner precision: implicit labels, component fragments, `--on-X` surfaces and runtime-filled
// header rows are not failures; the same defects on a real page still are.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditHtml, auditContrast } from '../a11y-scan.mjs';

const ids = (html, f = 'x.html') => auditHtml(html, f).map((v) => v.criterion);
// built, not written, so the house-palette guard does not read a fixture as a producer
const decl = (name, value) => `--${name}:${value};`;
const PAGE = (body) => `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;

test('an input wrapped in a <label> is labelled; a bare one is not', () => {
  assert.deepEqual(ids(PAGE('<h1>a</h1><label><input type="checkbox" id="a"> on</label>')), []);
  assert.deepEqual(ids(PAGE('<h1>a</h1><input type="checkbox" id="a"><label>on</label>')), ['3.3.2']);
});

test('a component fragment is not judged on page-level criteria; a page is', () => {
  const frag = '<nav><a href="/">x</a></nav><h2>t</h2>';
  assert.deepEqual(ids(frag), []);
  const page = ids(`<html><head></head><body>${frag}</body></html>`);
  for (const c of ['3.1.1', '2.4.2', '2.4.1', '2.4.6']) assert.ok(page.includes(c), c);
});

test('a fragment still fails element-level criteria', () => {
  assert.deepEqual(ids('<button type="button"></button>'), ['4.1.2']);
});

test('--on-X is measured against --X, not the page background', () => {
  const css = `:root{${decl('bg', '#17181a')}${decl('acc', '#c9a227')}${decl('on-acc', '#1a120e')}} a{color:var(--on-acc)}`;
  assert.deepEqual(auditContrast(css).violations, []);
  const bad = `:root{${decl('bg', '#17181a')}${decl('acc', '#c9a227')}${decl('on-acc', '#d0b030')}} a{color:var(--on-acc)}`;
  assert.equal(auditContrast(bad).violations.length, 1);
});

test('an empty client-filled <thead> is not "no headers"; a static header-less table is', () => {
  assert.deepEqual(ids(PAGE('<h1>a</h1><table><thead id="t"></thead><tbody></tbody></table>')), []);
  assert.deepEqual(ids(PAGE('<h1>a</h1><table><tbody><tr><td>1</td></tr></tbody></table>')), ['1.3.1']);
});
