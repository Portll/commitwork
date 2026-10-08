// Section badge counts LANES carrying findings; tab badges count FINDINGS. Rendered `n(total)`.
// badgeModel() is inline in the panel document, lifted and run directly; a second test asserts
// that what renders it targets elements the page creates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const fnAt = SRC.indexOf('function badgeModel(tabs){');
assert.ok(fnAt > -1, 'badgeModel was not found in the panel document — the extraction anchor moved');
const FN_SRC = SRC.slice(fnAt, SRC.indexOf('\n}', fnAt) + 2);
// eslint-disable-next-line no-new-func
const badgeModel = new Function(`${FN_SRC}; return badgeModel;`)();

function runBadge(tabValues) {
  const m = badgeModel(tabValues.map((v) => ({
    querySelector: () => (v === null ? null : { textContent: v.txt, classList: { contains: () => !!v.crit } }),
  })));
  return { textContent: m.text, title: m.title, classList: { has: (c) => !!m[c] } };
}

// The model above is pure, so it would keep passing if nothing on the page ever displayed it. That
// is how the section badges went dark: the renderer wrote to `gn-<group>` elements the markup had
// stopped creating, and `if(!el)continue` skipped every one of them without a word.
test('the badge model is rendered into elements the page actually creates', () => {
  const at = SRC.indexOf('function refreshGroupBadges(){');
  assert.ok(at > -1, 'refreshGroupBadges is gone');
  const body = SRC.slice(at, SRC.indexOf('\n}', at));
  assert.match(body, /setNavBadge\(/, 'refreshGroupBadges no longer renders the model');
  assert.doesNotMatch(body, /getElementById\('gn-/, 'the badge target gn-<group> is not in the markup');
  for (const [target, proof] of [
    ['[data-workspace="findings"]', /const WORKSPACE_LABELS=\{[^}]*\bfindings:/],
    ['#groups [data-category]', /<nav id="groups"/],
    ["$('check-picker')", /<select id="check-picker"/],
  ]) {
    assert.ok(body.includes(target), `refreshGroupBadges no longer targets ${target}`);
    assert.match(SRC, proof, `${target} is targeted, and nothing in the page creates it`);
  }
  assert.match(SRC, /refreshGroupBadges\(\);\n  syncScopeChrome\(v\);/, 'applyGroup must refresh the badges after it rebuilds the category buttons');
});

test('the operator-reported case: SAST 3 + Minified 4 renders 2(7), not a bare 2', () => {
  const el = runBadge([{ txt: '3' }, { txt: '4' }]);
  assert.equal(el.textContent, '2(7)');
  assert.ok(el.textContent.includes('7'), 'the summed findings count must be visible in the badge');
});

test('the bracketed total is the SUM of findings, never the lane count', () => {
  const el = runBadge([{ txt: '10' }, { txt: '10' }, { txt: '10' }]);
  assert.equal(el.textContent, '3(30)');
});

test('a measured zero renders 0(0) — it is a result, and stays distinct from absence', () => {
  const el = runBadge([{ txt: '0' }, { txt: '0' }]);
  assert.equal(el.textContent, '0(0)');
});

test('nothing known clears the badge entirely rather than writing a fabricated zero', () => {
  // Empty text = a cleared badge (never scanned). `0(0)` here would assert a clean sweep of lanes
  // that were never read.
  const el = runBadge([{ txt: '' }, { txt: '' }]);
  assert.equal(el.textContent, '');
  assert.match(el.title, /nothing known/);
});

test('unknown lanes are excluded from the total, not counted as zero', () => {
  const el = runBadge([{ txt: '5' }, { txt: '' }, { txt: '0' }]);
  assert.equal(el.textContent, '1(5)');
  assert.match(el.title, /1 of 2 checks with a result/);
});

test('the title names both units, so the two numbers can never be read as one quantity', () => {
  const el = runBadge([{ txt: '3' }, { txt: '4' }]);
  assert.match(el.title, /checks/, 'the title must say the leading number counts CHECKS');
  assert.match(el.title, /7 finding/, 'the title must say the bracketed number counts FINDINGS');
});

test('a critical lane still tints the section, and tone is derived from the members', () => {
  const el = runBadge([{ txt: '1', crit: true }, { txt: '2' }]);
  assert.ok(el.classList.has('crit'), 'a critical member must tint the section badge');
  assert.ok(!el.classList.has('warn'), 'crit and warn must not both apply — crit outranks');
});
