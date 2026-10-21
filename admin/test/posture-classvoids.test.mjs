// Lane E · the weakness-class VOID strip, rendered. renderClassVoids is LIFTED from admin/index.html
// source (a restated copy would keep passing after the real strip changed) and run against a DOM
// shim. The judgement — WHICH classes are void — lives server-side in weaknessClassVoids
// (monitor/test/coverage-manifest-voids + the posture route); this asserts the RENDER obeys both
// halves of the house rule: a void is unmeasured AND it says so in words.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const escLine = SRC.split('\n').find((l) => l.startsWith('const esc='));
const fnAt = SRC.indexOf('function renderClassVoids(d){');
assert.ok(escLine && fnAt > -1, 'renderClassVoids / esc not found in admin/index.html — the extraction anchor moved');
const FN_SRC = SRC.slice(fnAt, SRC.indexOf('\n}', fnAt) + 2);
// eslint-disable-next-line no-eval
// nosemgrep: javascript.browser.security.eval-detected.eval-detected -- test harness evaluating an esc() helper extracted from panel source under test, no external input
const esc = eval(`(${escLine.slice(escLine.indexOf('=') + 1).replace(/;$/, '')})`);

// $ returns one shim element whose innerHTML we can read back.
function render(d) {
  let html = '';
  const box = { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
  const $ = (id) => (id === 'po-classvoids' ? box : null);
  // eslint-disable-next-line no-new-func
  const fn = new Function('$', 'esc', `${FN_SRC}; return renderClassVoids;`)($, esc);
  fn(d);
  return html;
}

// The two classes NOTHING in the roster looks for — the set monitor/coverage-manifest.mjs pins.
const VOIDS = [
  { class: 'cwe-840-business-logic', kind: 'no-tool-class', label: 'business-logic flaw', cwes: ['CWE-840'], why: 'no in-scope lane declares it — a weakness class nothing looks for reads exactly like a clean one' },
  { class: 'cwe-362-race', kind: 'no-tool-class', label: 'race condition / TOCTOU', cwes: ['CWE-362', 'CWE-367'], why: 'no in-scope lane declares it — a weakness class nothing looks for reads exactly like a clean one' },
];
const COVERED = [
  { class: 'cwe-89-injection', label: 'SQL / query injection' },
  { class: 'cwe-79-xss', label: 'cross-site scripting' },
  { class: 'cwe-284-authz', label: 'broken access control / authorization (BOLA, IDOR, cross-tenant)' },
];
const payload = (over = {}) => ({ classVoids: VOIDS, classesCovered: COVERED, ...over });

describe('renderClassVoids — the weakness-class VOID strip', () => {
  test('each void renders in the board unmeasured state (.pill.plan)', () => {
    const h = render(payload());
    for (const label of ['business-logic flaw', 'race condition / TOCTOU']) {
      const re = new RegExp('<span class="pill plan[^"]*"[^>]*>[^<]*' + label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
      assert.match(h, re, `${label} must render on a grey .pill.plan chip`);
    }
    assert.ok(!/pill (?:live|green)\b/.test(h), 'explicit uncertainty: a void must not wear the clean/green pill');
    assert.ok(!/pill (?:high|crit|med|low)\b/.test(h), 'explicit uncertainty: a void must not wear a severity/finding pill');
  });

  test('the void says "nothing looked" in WORDS — the meaning never rests on colour alone', () => {
    const h = render(payload());
    assert.ok((h.match(/nothing looked/g) || []).length >= 2, 'both voids state it in words');
    assert.match(h, /have NO lane in scope/, 'the count sentence names the gap out loud');
    assert.match(h, /2 of 5 declared classes/, '2 void of (2 void + 3 covered) = 2 of 5');
  });

  test('a covered class is present but painted as NEITHER a void NOR clean-green', () => {
    const h = render(payload());
    assert.match(h, /class="pill clax-cov"/, 'covered classes render as neutral chips');
    assert.match(h, />injection</, 'the covered injection class is shown (short label)');
    assert.ok(!/clax-cov[^>]*>[^<]*nothing looked/.test(h), 'a covered chip never says nothing looked');
    assert.ok(!/pill live/.test(h), 'covered ≠ clean: no green pill on a covered class');
  });

  test('FAIL CLOSED: an {error} classVoids renders unreadable+grey, never "every class covered"', () => {
    const h = render(payload({ classVoids: { error: 'taxonomy has no weaknessClassVocab' } }));
    assert.match(h, /unreadable/, 'an unreadable axis says so');
    assert.match(h, /class="pill plan clax-void"/, 'and shows it in the grey state, not as a pass');
    assert.ok(!/every declared class has a lane/.test(h), 'an unreadable axis must NOT claim full coverage');
    assert.match(h, /taxonomy has no weaknessClassVocab/, 'the underlying reason survives to the reader');
  });

  test('an empty void set (all covered) says so honestly — a lane looking is not clean', () => {
    const h = render(payload({ classVoids: [] }));
    assert.match(h, /every declared class has a lane/);
    assert.ok(!/nothing looked/.test(h), 'no void is asserted when there are none');
    assert.match(h, /not the same as clean/, 'covered ≠ clean is stated');
  });

  test('a payload carrying no class axis renders nothing, not a fabricated all-clear', () => {
    assert.equal(render({}), '', 'absence of the field is not "every class covered"');
  });

  test('hostile server strings reach innerHTML escaped', () => {
    const bad = '"><img src=x onerror=alert(1)>';
    const h = render(payload({ classVoids: [{ class: bad, label: bad, why: bad, kind: 'no-tool-class', cwes: [] }] }));
    assert.ok(!h.includes('<img src=x'), 'no unescaped tag may reach the DOM');
    assert.ok(h.includes('&lt;img src=x'), 'and the text is still shown, escaped');
  });
});
