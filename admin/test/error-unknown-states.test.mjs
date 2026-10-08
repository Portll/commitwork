// One error state and one unknown state across the panel (docs/THEME.md §3.6 and Rule 7).
//
// A view whose load failed draws the error box, .pk-err. A value that could not be read wears
// .pill.unk, dashed and colourless. Until 2026-10-07 the same failure was grey .mut prose in one
// view, a red severity pill in another, and the error box only inside the passkey menu; and ten
// "unreadable" states wore crit or high, which publishes an unmeasured value as a finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, panelHtml, panelScript } from './lib/panel-source.mjs';

const JS = panelScript('index.html');
const CSS = readFileSync(join(ADMIN, 'static', 'panel.css'), 'utf8');

test('the error box is styled outside the account menu, from --crit', () => {
  const m = /(?:^|[},])\s*\.pk-err\s*[,{][^{]*\{([^}]*)\}/m.exec(CSS);
  assert.ok(m, 'panel.css styles .pk-err only under .pop, so a view outside the menu draws it unstyled');
  assert.match(m[1], /color-mix\(in srgb, ?var\(--crit\) 8%, ?transparent\)/, 'fill is not --crit at 8% (THEME §3.6)');
  assert.match(m[1], /color-mix\(in srgb, ?var\(--crit\) 35%, ?transparent\)/, 'border is not --crit at 35% (THEME §3.6)');
});

// The load failures, by the words that identify each. Every occurrence must open the error box.
const LOAD_FAILURES = [
  'could not load the audit', 'could not load the posture board', 'could not load triage prompts',
  'could not load the plan', "could not load '+esc(id)", 'health could not be read',
  'could not reach the panel — lane state is UNKNOWN', 'verify failed', 'check failed',
  // the rest of the load failures the 2026-10-07 conformity audit found
  'could not reach the server — exposure is UNKNOWN', 'the per-repository table is UNKNOWN',
  'could not reach the panel — thresholds are UNKNOWN', 'Could not read the store',
  'The ref table could not be read', 'Could not read /api/projects/tree', 'provenance UNKNOWN',
  'the briefs could not be listed', 'UNREACHABLE — the /api/bola route',
];
test('each load failure draws the error box, never grey prose or a severity pill', () => {
  for (const words of LOAD_FAILURES) {
    const hits = [];
    for (let i = JS.indexOf(words); i > -1; i = JS.indexOf(words, i + 1)) hits.push(i);
    assert.ok(hits.length, `"${words}" is no longer in the panel source; update this list`);
    for (const i of hits) {
      assert.match(JS.slice(Math.max(0, i - 24), i), /class="pk-err">$/,
        `"${words}" is drawn without .pk-err: …${JS.slice(Math.max(0, i - 60), i + words.length)}`);
    }
  }
});

test('no unreadable or failed value wears a severity pill', () => {
  const severe = [...JS.matchAll(/class="pill (?:crit|high|med|low)"[^>]*>[^<]*(?:unreadable|probe failed|NOT verified)/g)];
  assert.deepEqual(severe.map((m) => m[0]), [], 'an unmeasured value published as a finding (THEME Rule 7)');
  assert.doesNotMatch(JS, /<td[^>]*class="pill /, 'a table cell wearing a pill class paints the whole cell');
  const area = JS.slice(JS.indexOf("if(a.state!=='ok'){missingAny++"));
  assert.match(area.slice(0, area.indexOf('\n')), /class="pill unk">'\+esc\(a\.state/,
    'an area whose inputs cannot be read is unknown, not high');
});

test('the unknown pill is the dashed, colourless one THEME documents', () => {
  const m = /\.pill\.unk\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'panel.css has no .pill.unk');
  assert.match(m[1], /border-style:dashed/);
  assert.match(m[1], /color:var\(--mut\)/);
  assert.doesNotMatch(m[1], /var\(--(crit|high|med|low|live|part)\)/, 'the unknown pill borrows a state colour');
});

// A save or apply that never reached the server is a transport failure, so its status line becomes
// the error box. A refusal stays a result line, which THEME §7 draws in --crit.
test('a status line whose request never arrived draws the error box', () => {
  const lines = [...JS.matchAll(/msg\.className ?= ?'([^']*)'; ?msg\.textContent ?= ?[`']could not reach the panel/g)];
  assert.ok(lines.length >= 4, `found ${lines.length} transport-failure status lines; the pattern no longer reads the panel`);
  for (const m of lines) assert.match(m[1], /(?:^| )pk-err$/, `drawn as "${m[1]}": ${m[0]}`);
  const rule = /(?:^|\})\s*\.mut\.bad\s*,\s*\.pop \.mut\.bad\s*\{([^}]*)\}/m.exec(CSS);
  assert.ok(rule, 'a .mut.bad result line has no rule, so a refusal renders as grey prose');
  assert.match(rule[1], /color:var\(--crit\)/);
});

test('no view draws an error box of its own beside .pk-err', () => {
  const src = panelHtml('index.html') + JS;
  assert.deepEqual(src.match(/cred-msg cred-bad/g) || [], [], 'a .cred-msg.cred-bad box is a second error box');
  for (const id of ['lm-warn', 'ig-warn', 'as-warn', 'set-store-warn', 'perf-warn', 'lt-warn', 'cmt-warn']) {
    assert.match(src, new RegExp(`<div id="${id}" class="pk-err[ "]`), `#${id} is not the error box`);
  }
  const config = panelHtml('config.html');
  assert.match(config, /<section id="err"[^>]*><div class="pk-err" role="alert">/, "/config's offline card is not the error box");
  assert.doesNotMatch(config.slice(config.indexOf('<section id="err"')).split('</section>')[0], /style="[^"]*--crit/,
    "/config's offline card paints its own red border");
});

test('an unreachable or unreadable BOLA state is unknown, never a plan pill', () => {
  assert.doesNotMatch(JS, /class="pill plan">(?:UNREACHABLE|UNREADABLE)/);
  assert.match(JS, /verdict='<span class="pill unk">UNREADABLE<\/span>/);
});

// THEME §7 names the status pills live, part and plan; there is no .pill.ok, so a chip given it
// rendered unstyled.
test('every pill class the panel draws has a rule', () => {
  const css = CSS + readFileSync(join(ADMIN, 'static', 'panel-light.css'), 'utf8');
  const literal = [...JS.matchAll(/class="pill ([a-z-]+)[ "]/g)].map((m) => m[1]);
  assert.ok(literal.includes('live') && literal.includes('unk'), 'the pill census found nothing to check');
  // a rule on .pill.<cls>, or one that opens on .<cls> itself (.clax-cov); never .x.<cls> on another component
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  const styled = (cls) => new RegExp(`(?:^|[},\\s>+~])\\.(?:pill\\.)?${cls}(?![\\w-])`, 'm').test(css);
  assert.deepEqual([...new Set(literal)].filter((cls) => !styled(cls)), [], 'a pill class with no rule renders unstyled');
  const sync = JS.slice(JS.indexOf('function owRenderSync('));
  assert.match(sync.slice(0, sync.indexOf('\n}')), /r\.verdict==='synced'\?'live'/, 'a synced memory point is not drawn live');
  assert.doesNotMatch(css, /\.pill\.ok\b/, 'THEME documents no .pill.ok; a synced state is .pill.live');
});
