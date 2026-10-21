// WCAG 2.1.1: everything the pointer can do on the site map, the keyboard can do. Pinned at the
// source because the page needs a sitemap payload and a WebGL context to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../demo.html', import.meta.url), 'utf8');

test('no label is clickable without being a keyboard button', () => {
  assert.doesNotMatch(SRC, /el\.onclick=\(\)=>show/, 'a label click handler must go through keyLabel()');
  assert.ok((SRC.match(/keyLabel\(el,/g) || []).length >= 2, 'both service label kinds must be keyboard buttons');
  const fn = SRC.match(/function keyLabel\(el,act\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'keyLabel not found');
  assert.match(fn, /tabIndex=0/);
  assert.match(fn, /role','button'/);
  assert.match(fn, /e\.key==='Enter'\|\|e\.key===' '/);
});

test('the view pans from the keyboard and Escape closes the detail panel', () => {
  assert.match(SRC, /controls\.listenToKeyEvents\(renderer\.domElement\)/);
  assert.match(SRC, /renderer\.domElement\.tabIndex=0/);
  assert.match(SRC, /e\.key==='Escape'&&side\.classList\.contains\('open'\)\)closeSide\(\)/);
});

test('a service is found by name: Enter frames it and opens its card, and a label click frames too', () => {
  assert.match(SRC, /<input id="svc-find" list="svc-names"[^>]*aria-label="find a service/);
  assert.match(SRC, /\$\('svc-find'\)\.addEventListener\('keydown',\(e\)=>\{\n\s*if\(e\.key!=='Enter'\)return;/);
  const find = SRC.match(/function findService\(q\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(find, 'findService not found');
  assert.match(find, /frameService\(s\);showService\(s\)/);
  assert.match(SRC, /keyLabel\(el,\(\)=>\{frameService\(a\.svc\);showService\(a\.svc\);\}\)/);
  assert.match(SRC, /buildScene\(\);\n\s*fillFind\(\);/, 'the name list is refilled whenever the scene is built');
});

test('focus is visible on every keyboard target', () => {
  assert.match(SRC, /\.svclabel:focus-visible/);
  assert.match(SRC, /#stage canvas:focus-visible/);
});

test('zoom has a keyboard route, bounded like the wheel', () => {
  assert.match(SRC, /renderer\.domElement\.setAttribute\('role','application'\)/);
  const zoom = SRC.match(/renderer\.domElement\.addEventListener\('keydown',\(e\)=>\{[\s\S]*?\n {2}\}\);/)?.[0];
  assert.ok(zoom, 'the canvas zoom handler is gone');
  assert.match(zoom, /e\.key==='\+'/);
  assert.match(zoom, /e\.key==='-'/);
  assert.match(zoom, /clamp\([\s\S]*?controls\.minDistance,controls\.maxDistance\)/, 'keyboard zoom must obey the same limits as the wheel');
});

test('files and vulnerabilities the pointer picks by ray are listed as buttons on the service card', () => {
  const card = SRC.match(/function serviceDetailHtml\(s\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(card, 'serviceDetailHtml not found');
  assert.match(card, /<button type="button" data-glow=/);
  assert.match(card, /<button type="button" data-file=/);
  assert.match(SRC, /sideBody\.addEventListener\('click',[\s\S]*?showFile\(fileMeta\[b\.dataset\.file\]\)[\s\S]*?showFileFromVuln\(glowNodes\[b\.dataset\.glow\]\)/);
  assert.match(SRC, /e\.svcIds\.add\(sid\)/, 'a glow must know its service, or the card cannot list it');
});

test('a panel opened from the keyboard takes focus and gives it back on close', () => {
  assert.match(SRC, /function openByKey\(act\)\{sideOpener=document\.activeElement;act\(\);/);
  assert.match(SRC, /el\.onkeydown=\(e\)=>\{if\(e\.key==='Enter'\|\|e\.key===' '\)\{e\.preventDefault\(\);openByKey\(act\);\}\};/);
  const close = SRC.match(/function closeSide\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(close, /sideOpener\.focus\(\)|o\.focus\(\)/);
  assert.match(SRC, /\.kb-list button:focus-visible/);
});
