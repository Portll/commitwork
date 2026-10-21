// node --test admin/test/ — the CRA countdown's classes must actually RENDER differently.
//
// WHY THIS EXISTS. cra-panel-clock.test.mjs asserts craBand() returns 'p50' / 'p90' / 'overdue'.
// That is the MARKER, not the EFFECT: delete every .cra-* rule from panel.css and those tests stay
// green while an overdue legal deadline renders identically to one with 12 days left. Another
// session hit the same shape in the login CSS — a test asserting `hidden` was in the markup,
// green for the whole life of a button that was visible in every browser — and their generalisation
// is the one this file applies: if a test asserts a flag or attribute IS SET, it is probably not
// asserting that anything obeys it.
//
// Classes are DERIVED from the page, never hand-listed, so a band added tomorrow is covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = panelSource('index.html');
const CSS = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8');

/** The band keys craBand() can return, read out of its own body. */
function bandKeys() {
  const m = PANEL.match(/function craBand\([^)]*\)\{([\s\S]*?)\n\}/);
  assert.ok(m, 'craBand() is gone or renamed — update this extractor with the renderer');
  const keys = [...m[1].matchAll(/k:\s*(?:[^,{}]*\?)?\s*'([a-z0-9]+)'/g)].map((x) => x[1]);
  const all = [...new Set([...keys, ...[...m[1].matchAll(/'(p\d+|ok|overdue)'/g)].map((x) => x[1])])];
  assert.ok(all.length >= 4, `band-key extraction degenerated (${all.length}) — the assertions below would pass vacuously`);
  return all;
}

test('every band class craRenderTick can assign has a rule in panel.css', () => {
  // craRenderTick does `el.className = 'mono cra-' + b.k`, so each band key becomes a class.
  for (const k of bandKeys()) {
    assert.ok(new RegExp(`\\.cra-${k}\\b`).test(CSS),
      `craBand can return '${k}', so craRenderTick assigns .cra-${k}, and panel.css has no rule for it — `
      + 'the band would render identically to every other and the countdown would carry no state');
  }
});

test('the bands are visually DISTINCT — no two resolve to the same declaration', () => {
  // The point of a band is that an operator can tell 50% elapsed from overdue at a glance. Two
  // bands with the same body is a rule that exists and communicates nothing, which passes a
  // "does it have a rule" check while failing the only thing the rule is for.
  const bodies = new Map();
  for (const k of bandKeys()) {
    const m = CSS.match(new RegExp(`#view-cra \\.cra-${k}\\{([^}]*)\\}`));
    assert.ok(m, `no #view-cra .cra-${k} rule`);
    const body = m[1].replace(/\s+/g, '');
    const clash = [...bodies.entries()].find(([, b]) => b === body);
    assert.ok(!clash, `.cra-${k} and .cra-${clash?.[0]} declare exactly '${body}' — two bands an operator cannot tell apart`);
    bodies.set(k, body);
  }
});

test('OVERDUE is the loudest band — it must not be quieter than a running one', () => {
  const weight = (k) => {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
    const m = CSS.match(new RegExp(`#view-cra \\.cra-${k}\\{([^}]*)\\}`));
    const w = m && m[1].match(/font-weight:\s*(\d+)/);
    return w ? Number(w[1]) : 400;
  };
  assert.ok(weight('overdue') >= weight('p90'), 'an overdue deadline renders lighter than a 90%-elapsed one');
  assert.ok(weight('overdue') > weight('ok'), 'an overdue deadline renders no louder than a healthy one');
});

test('a case CARD carries its state — .case and .case.ok are not the same rule', () => {
  // craCard emits class="case" for a case with overdue clocks and "case ok" otherwise. If the two
  // resolve identically the border communicates nothing and the overdue card is unfindable.
  const base = CSS.match(/#view-cra \.case\{([^}]*)\}/);
  const ok = CSS.match(/#view-cra \.case\.ok\{([^}]*)\}/);
  assert.ok(base, 'no #view-cra .case rule — craCard emits the class and nothing styles it');
  assert.ok(ok, 'no #view-cra .case.ok rule — an overdue card would look like a healthy one');
  assert.notEqual(base[1].replace(/\s+/g, ''), ok[1].replace(/\s+/g, ''));
});

test('the classes the renderer emits are the classes the CSS scopes — no orphan rules', () => {
  // The mirror direction: a .cra-* rule for a band craBand can never return is dead weight that
  // reads as coverage.
  const declared = [...CSS.matchAll(/#view-cra \.cra-([a-z0-9]+)\{/g)].map((m) => m[1]);
    assert.ok(declared.length > 0, 'panel.css declares no .cra-* rules at all — the orphan-rule check below would pass having compared nothing');
  const emitted = new Set(bandKeys());
  for (const d of declared) {
    assert.ok(emitted.has(d), `panel.css styles .cra-${d} but craBand can never return '${d}' — a dead rule reading as coverage`);
  }
});
