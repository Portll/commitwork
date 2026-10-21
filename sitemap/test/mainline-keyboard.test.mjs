// WCAG 2.1.1 on the commit-history viewer: pan, rotate and zoom from the keyboard, and the hover
// tooltip's content reachable as text. Pinned at the source; the page needs WebGL to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../mainline.html', import.meta.url), 'utf8');

test('the canvas takes focus and moves from the keyboard', () => {
  assert.match(SRC, /renderer\.domElement\.tabIndex=0/);
  assert.match(SRC, /renderer\.domElement\.setAttribute\('role','application'\)/);
  assert.match(SRC, /controls\.listenToKeyEvents\(renderer\.domElement\)/);
  assert.match(SRC, /e\.key==='\+'[\s\S]*?clamp\([\s\S]*?controls\.minDistance,controls\.maxDistance\)/);
  assert.match(SRC, /#stage canvas:focus-visible/);
});

test('every commit the tooltip describes is also listed as escaped text', () => {
  assert.match(SRC, /<details id="commits" hidden><summary>commit list<\/summary><ol id="commit-list"><\/ol><\/details>/);
  const fill = SRC.match(/\$\('commit-list'\)\.innerHTML=[\s\S]*?\.join\(''\);/)?.[0];
  assert.ok(fill, 'the commit list is never filled');
  for (const field of ['subject', 'short', 'author']) assert.match(fill, new RegExp(`esc\\(c\\.${field}\\)`), `${field} must be escaped: harvested commit strings are untrusted`);
});

test('toggles announce whether they are on', () => {
  for (const id of ['t-labels', 't-signs', 't-spin']) assert.match(SRC, new RegExp(`id="${id}" aria-pressed="(true|false)"`));
  assert.match(SRC, /function wire\(id,fn\)\{[^\n]*setAttribute\('aria-pressed'/);
});
