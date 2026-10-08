// The header's freshness stamp and the tab count badges both work by writing a STATE onto an
// element and letting panel.css render it. That split has one failure mode, and it has already
// happened once in this file's subject matter: setGen() wrote data-state="fresh|stale|old|none"
// for days while panel.css had no rule matching any of them. The attribute was live and inert at
// the same time — which is worse than never having written it, because a wired-looking hook invites
// the reader to assume the signal is being shown. "rollup 4d ago" rendered in the same grey as
// "rollup 4m ago": the header's own false clean.
//
// So this file asserts BOTH halves and, crucially, that they meet:
//   · the JS derives the right state from the data                (behaviour)
//   · every state the JS can write has a rule in panel.css        (the dead-hook guard)
// The second assertion is the one that would have caught the original defect on the day it landed.
//
// setGen/setTabN live inline in admin/index.html, so they are lifted from source — the technique
// used by ansi-console.test.mjs and scanner-tabs.test.mjs for the same reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource, panelScript } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');
const CSS = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8')
  + [...SRC.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

// Brace-matched extraction. A "slice to the next \n}" shortcut silently over-reads: it swallowed
// ABS into AGO (duplicate declaration) and setTabN into CRITICAL_LANE, so the lane list picked up
// the 'crit'/'warn' strings from classList.toggle and asserted them as tab names. Counting braces
// is barely more code and cannot run past the construct it was asked for.
function braceMatch(startIdx) {
  const open = SRC.indexOf('{', startIdx);
  assert.ok(open > -1, 'no opening brace after the declaration');
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(startIdx, i + 1); }
  }
  assert.fail('unbalanced braces while extracting from admin/index.html');
}
const fn = (name) => {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `function ${name}() not found in admin/index.html`);
  return braceMatch(at);
};
/** A single-line `const NAME=…;` declaration, exactly one line, no neighbours. */
const constLine = (name) => {
  const line = SRC.split('\n').find((l) => l.startsWith(`const ${name}=`));
  assert.ok(line, `const ${name} not found in admin/index.html`);
  return line;
};
/** A brace-bodied `const NAME=…{…};` arrow (AGO spans lines). */
const constFn = (name) => {
  const at = SRC.indexOf(`const ${name}=`);
  assert.ok(at > -1, `const ${name} not found in admin/index.html`);
  return `${braceMatch(at)};`;
};

// Minimal element shim: textContent, dataset, title, and a classList that behaves like the real one
// for toggle(force). Nothing here emulates a browser beyond what these two functions touch.
function makeEl(id) {
  const classes = new Set();
  return {
    id, textContent: '', title: undefined, dataset: {},
    removeAttribute(a) { if (a === 'title') this.title = undefined; },
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      has: (n) => classes.has(n),
      get size() { return classes.size; },
      list: () => [...classes].sort(),
    },
  };
}

function badgeHarness() {
  const els = new Map();
  const document = { getElementById: (id) => (els.has(id) ? els.get(id) : (els.set(id, makeEl(id)), els.get(id))) };
  const setTabN = new Function('document', `${constLine('CRITICAL_LANE')}\n${fn('setTabN')}\nreturn setTabN;`)(document);
  return { setTabN, badge: (view) => document.getElementById('vn-' + view) };
}

function genHarness(sched = null, proj = 'alpha') {
  const el = makeEl('gen');
  const $ = () => el;
  // AGO/ABS format the last rollup; schedFor/COUNTDOWN/fleetNextRollup read the schedule.
  const setGen = new Function('$', 'rollupSched', 'curProj', 'projSlug',
    `${constFn('AGO')}\n${constLine('ABS')}\n${fn('schedFor')}\n${fn('COUNTDOWN')}\n${constLine('fleetNextRollup')}\n${fn('setGen')}\nreturn setGen;`)(
    $, sched, proj, (p) => String(p).toLowerCase());
  return { setGen, el };
}

// ── the JS half: does the state match the data ───────────────────────────────────────────────
test('freshness state is derived from age, and "never scanned" is its own state', () => {
  const { setGen, el } = genHarness();
  const at = (ms) => new Date(Date.now() - ms).toISOString();

  setGen(at(7 * 60e3));      assert.equal(el.dataset.state, 'fresh');
  setGen(at(6 * 3600e3));    assert.equal(el.dataset.state, 'stale');
  setGen(at(4 * 864e5));     assert.equal(el.dataset.state, 'old');

  // Not "0 minutes ago", and emphatically not clean. It is also the only state with no exact
  // timestamp to offer, so the title must be cleared rather than left pointing at a stale one.
  setGen(at(60e3));
  setGen(null);
  assert.equal(el.dataset.state, 'none');
  assert.match(el.title, /^no rollup yet/);
  assert.doesNotMatch(el.title, /last rollup/, 'a never-scanned stamp must not keep the previous run\'s time');
});

test('the top bar counts down to this project\'s next rollup and the fleet\'s', () => {
  const soon = (s) => new Date(Date.now() + s * 1000 + 400).toISOString();
  const sched = { fleet: { next: { at: soon(600), area: 'beta' } },
    areas: [{ slug: 'alpha', label: 'alpha', schedule: { state: 'scheduled', next: soon(3 * 3600 + 5 * 60 + 7) } }] };
  const { setGen, el } = genHarness(sched);
  setGen(new Date(Date.now() - 60e3).toISOString());
  assert.equal(el.textContent, 'next rollup 03:05:07 : fleet 00:10:00');
  assert.match(el.title, /^last rollup .* · next rollup for this project .* · next rollup in the fleet .*\(beta\)$/);
  const unscheduled = genHarness({ fleet: { next: null }, areas: [{ slug: 'alpha', label: 'alpha', schedule: { state: 'absent', next: null } }] });
  unscheduled.setGen(null);
  assert.equal(unscheduled.el.textContent, 'next rollup not scheduled : fleet —', 'no installed job is said, never a guessed time');
});

test('a critical lane is toned apart from a queue lane', () => {
  const { setTabN, badge } = badgeHarness();
  // Confirmed malware is an incident: any credential the machine that ran install could reach is
  // suspect. It must not render at the same weight as a DAST backlog.
  setTabN('malware', 1);
  assert.deepEqual(badge('malware').classList.list(), ['crit']);
  setTabN('runtime', 11);
  assert.deepEqual(badge('runtime').classList.list(), ['warn']);
});

test('a measured zero stays quiet, and a cleared badge carries no tone at all', () => {
  const { setTabN, badge } = badgeHarness();
  setTabN('runtime', 0);
  assert.equal(badge('runtime').classList.size, 0, 'zero has earned calm — it is the one number that has');
  assert.equal(badge('runtime').textContent, '0');

  setTabN('malware', 0);
  assert.equal(badge('malware').classList.size, 0, 'a critical LANE is not a critical FINDING — 0 malware is good news');

  setTabN('exposure', null);
  assert.equal(badge('exposure').textContent, '', 'absence renders nothing, never a 0');
  assert.equal(badge('exposure').classList.size, 0);
});

test('a tone is removed when the count later drops — the badge cannot keep a stale alarm', () => {
  const { setTabN, badge } = badgeHarness();
  setTabN('malware', 3);
  assert.ok(badge('malware').classList.has('crit'));
  setTabN('malware', 0);
  assert.equal(badge('malware').classList.size, 0, 'a fixed incident must stop shouting on the next poll');
  setTabN('runtime', 5);
  setTabN('runtime', null);
  assert.equal(badge('runtime').classList.size, 0, 'a cleared badge must not keep the tone it had while known');
});

test('every lane named critical is a real tab with a real badge span', () => {
  // The defect this whole file guards, in its other direction: a lane list that names a tab which
  // does not exist would grade nothing, silently, and look wired.
  const lanes = [...constLine('CRITICAL_LANE').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(lanes.length, 'CRITICAL_LANE parsed as empty — update this test');
  for (const lane of lanes) {
    assert.ok(SRC.includes(`data-v="${lane}"`), `CRITICAL_LANE names '${lane}', which is not a tab`);
    assert.ok(SRC.includes(`id="vn-${lane}"`), `CRITICAL_LANE names '${lane}', which has no badge span to colour`);
  }
});

// ── the CSS half: is anything the JS writes actually rendered ────────────────────────────────
// This is the assertion that would have caught the original dead hook.
test('every data-state setGen can write has a rule in panel.css', () => {
  // [^;]+ not .+ — the assignment, not the rest of the line. `.+` ran past the semicolon and
  // scooped 'title' out of the removeAttribute() call that follows it, asserting a DOM attribute
  // name as a freshness state.
  const written = [...fn('setGen').matchAll(/dataset\.state\s*=\s*([^;]+)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]));
  const states = [...new Set(written)];
  assert.deepEqual(states.sort(), ['fresh', 'none', 'old', 'stale'], 'the state vocabulary changed — update the CSS and this test together');
  for (const s of states) {
    assert.ok(CSS.includes(`[data-state=${s}]`) || CSS.includes(`[data-state="${s}"]`),
      `setGen writes data-state="${s}" and panel.css has no rule for it — the attribute would be live and inert, which is the defect this test exists to prevent`);
  }
});

test('every badge tone setTabN can add has a rule in panel.css', () => {
  const toned = [...fn('setTabN').matchAll(/classList\.toggle\('([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(toned.length >= 2, 'expected at least the crit and warn tones');
  for (const cls of [...new Set(toned)]) {
    assert.ok(new RegExp(`\\.vn\\.${cls}\\b`).test(CSS),
      `setTabN can add .${cls} to a badge and panel.css has no .vn.${cls} rule — the tone would never render`);
  }
});

// ── the cascade, not the presence of a rule ─────────────────────────────────────────────────────
// A presence check on the enforcing rule is still a presence check. `CSS.includes('[data-state=x]')`
// passes while the declaration it names LOSES: a later rule of equal specificity beats it on source
// order, every state paints the same colour, and the test stays green throughout.
//
// So resolve it instead. Collect every rule whose selector can match the element, rank by
// specificity then source order, and read the property off the WINNER.
//
// Credit to another session, which found this shape in `[hidden]`: an author `display` rule beats the
// UA stylesheet on ORIGIN whatever its specificity, and their first version asserted the reset
// EXISTED rather than that it won. Existence does not pin the outcome.
//
// Specificity is the standard (a,b,c) — ids / classes+attributes+pseudo-classes / elements+pseudo-
// elements. That is enough for this stylesheet, and the guards below assert the simplifying
// assumptions rather than assuming them, so the model fails loudly when it stops being true.
const specOf = (sel) => [
  (sel.match(/#[\w-]+/g) || []).length,
  (sel.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length,
  (sel.match(/::[\w-]+/g) || []).length,
];
const outranks = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

/** The declaration that actually paints `prop` on an element the given selectors all match. */
function paints(css, selectors, prop) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  const rules = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, order) => ({
    selectors: m[1].split(',').map((x) => x.trim()).filter(Boolean), body: m[2], order,
  }));
  let best = null;
  for (const r of rules) {
    for (const sel of r.selectors) {
      if (!selectors.includes(sel)) continue;
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
      const d = r.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (!d) continue;
      const sp = specOf(sel);
      const value = d[1].trim();
      // !important OUTRANKS SPECIFICITY OUTRIGHT — it is not a bonus on top of it. Modelled rather
      // than refused: this stylesheet is edited by a dozen sessions, and asserting the whole file
      // contains no `!important` would fail on a legitimate one in an unrelated rule, which is a
      // false alarm about freshness dots. Another session found the inverse in its resolver, where
      // ranking by specificity alone reported a reset winning that a LOWER-specificity
      // `!important` actually beat — a false clean inside the test written to refuse false cleans.
      const imp = /!important\s*$/.test(value);
      const wins = !best
        || (imp && !best.imp)
        || (imp === best.imp && (outranks(sp, best.spec) || (!outranks(best.spec, sp) && r.order >= best.order)));
      if (wins) best = { value, spec: sp, order: r.order, sel, imp };
    }
  }
  return best;
}

/** What the cascade paints on each freshness dot, for an arbitrary stylesheet. */
const paintedStates = (css) => Object.fromEntries(
  ['fresh', 'stale', 'old', 'none'].map((st) => {
    const w = paints(css, ['.gen::before', `.gen[data-state=${st}]::before`], 'background');
    return [st, w ? w.value : null];
  }));

/** The property this file is really pinning: four states, four different dots, `none` unfilled. */
const statesAreDistinct = (css) => {
  const p = paintedStates(css);
  if (!Object.values(p).every(Boolean)) return false;
  if (new Set(Object.values(p)).size !== 4) return false;
  if (!/transparent/.test(p.none)) return false;
  // AND the winner must be the STATE'S OWN rule. Distinctness alone was too weak: delete a state's
  // rule and it inherits `.gen::before`, which is a different colour from the other three — four
  // distinct values over a dot that no longer responds to its state. My own negative control caught
  // that, which is the argument for writing the control before trusting the property.
  return ['fresh', 'stale', 'old', 'none'].every((st) => {
    const w = paints(css, ['.gen::before', `.gen[data-state=${st}]::before`], 'background');
    return w && w.sel.includes(`[data-state=${st}]`);
  });
};

test('the resolver still models this stylesheet — no @layer', () => {
  // The assumptions the specificity model rests on. If one stops holding, this fails HERE rather
  // than letting the resolver quietly return the wrong winner everywhere else.
  // Comment-stripped: every `!important` in panel.css sits inside prose explaining why it is NOT
  // used. Testing the raw file failed on its own documentation — a check that reads commentary as
  // code is the same class of error as a test that reads a marker as an outcome.
  const live = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  // `!important` is MODELLED now, so its presence is no longer a limit — only @layer is, and a
  // cascade layer would silently invert every verdict this file reports.
  assert.ok(!/@layer/.test(live), 'panel.css gained @layer — the resolver does not model cascade layers, so its verdicts are not trustworthy until it does');
});

test('the four freshness states resolve to four DIFFERENT painted colours', () => {
  const painted = paintedStates(CSS);
  for (const [st, v] of Object.entries(painted)) {
    assert.ok(v, `nothing paints a background on .gen[data-state=${st}]::before`);
  }
  assert.equal(new Set(Object.values(painted)).size, 4,
    `two freshness states paint the same colour, so 4 minutes and 4 days look alike: ${JSON.stringify(painted)}`);
  // `none` must carry no fill: never-scanned is not a point on the fresh→old scale, and colouring
  // it puts it on that scale. Asserted on the WINNER, so a later fill fails here.
  assert.match(painted.none, /transparent/,
    `never-scanned resolves to ${painted.none} — grey is still a value on the scale`);
});

test('an OUTRANKED state rule does not count as present — the control a presence check passes', () => {
  // Two mutations of the real stylesheet, both of which must fail:
  //   1. the rule removed            → the original dead-hook case
  //   2. the rule kept, but beaten by a LATER equal-specificity rule → what `includes()` cannot see
  assert.ok(statesAreDistinct(CSS), 'the real stylesheet must pass, or the controls below prove nothing');

  const removed = CSS.replace(/\.gen\[data-state=stale\]::before\{[^}]*\}\n?/, '');
  assert.notEqual(removed, CSS, 'the stale rule was not found to remove — update this control');
  assert.ok(!statesAreDistinct(removed),
    'removing a state rule must fail — that is the dead-hook case this file was written for');

  const outranked = `${CSS}\n.gen[data-state=stale]::before{background:var(--live)}`;
  assert.ok(!statesAreDistinct(outranked),
    'a state rule beaten by a LATER equal-specificity rule must fail — a presence check passes this, '
    + 'which is precisely why presence is not the assertion');

  // Third control, from another session: a LOWER-specificity rule with !important beats a higher one
  // without. `.gen::before` is (0,1,1) against the state rule's (0,2,1) and still wins. A resolver
  // that ranks by specificity alone reports the state rule winning and paints the wrong colour.
  const important = `${CSS}\n.gen::before{background:var(--live) !important}`;
  assert.ok(!statesAreDistinct(important),
    'a LOWER-specificity !important must beat a higher-specificity state rule — you cannot '
    + 'out-specify an !important, so "raise the specificity" would be the wrong remedy here');
});

// ── the general rule, not one per widget ────────────────────────────────────────────────────────
// The two assertions above are scoped to setGen and setTabN — the widgets that existed when they
// were written. Everything else assigning a class is uncovered, and that is how a new /cra/ view
// shipped five state-carrying band classes with nothing checking any of them (since fixed, but
// only because a peer sent the pattern). A house idiom enforced for the classes that happened to
// exist is unenforceable for classes added later.
//
// So: derive EVERY class the panel script can assign, and require a rule for each. Two live gaps
// are declared below rather than silently excluded — a deferral that names its reason is debt; an
// unnamed exclusion is the defect this file exists to catch, applied to itself.
// `mono` WAS DEFERRED HERE, and the deferral described exactly what then happened. It read: the
// class is inert, those elements render monospace only because body{font-family:var(--mono)} makes
// everything monospace, and "the day body moves to --sans … every one of them silently becomes
// proportional". Body moved to --sans. The prediction was the whole value of writing the deferral
// down instead of excluding the class quietly — panel.css now carries `.mono{font-family:var(--mono)}`
// and the entry is gone rather than left as debt that has been paid.
const DEFERRED_CLASSES = {
  'set-rule': 'index.html:4402 does className=\'set-rule\' and only .set-rules-msg is styled. '
    + 'Fixing it means editing panel.css, which was ownership-undetermined when this was written.',
};

function assignedClasses() {
  // The panel's JS moved to static/panel.js on 2026-09-04, so "the biggest inline <script> block"
  // now selects an empty string and this degenerates to zero classes — which the vacuity assert
  // below caught. panelScript() is the same JS wherever it lives.
  const main = panelScript('index.html');
  const out = new Set();
  for (const m of main.matchAll(/classList\.(?:add|toggle|remove)\(\s*'([a-zA-Z][\w-]*)'/g)) out.add(m[1]);
  for (const m of main.matchAll(/className\s*=\s*'([^']*)'/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) out.add(c);
  }
  return out;
}

test('EVERY class the panel script assigns has a rule — not just the two widgets someone checked', () => {
  const classes = assignedClasses();
  assert.ok(classes.size >= 15, `class extraction degenerated (${classes.size}) — this would pass vacuously`);
  const undeclared = [...classes]
    .filter((c) => !(c in DEFERRED_CLASSES))
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
    .filter((c) => !new RegExp(`\\.${c}\\b`).test(CSS));
  assert.deepEqual(undeclared, [],
    'the panel script assigns these classes and no served CSS has a rule for any of them — each is a '
    + 'marker with nothing obeying it. Add a rule, or declare it in DEFERRED_CLASSES with the reason.');
});

test('a deferral must still be REAL — a fixed gap cannot sit in the list pretending to be debt', () => {
  // The mirror direction. A deferral for a class that now HAS a rule is stale debt reading as
  // known-and-accepted, which is how a list like this rots into an exclusion nobody rechecks.
  for (const [cls, why] of Object.entries(DEFERRED_CLASSES)) {
    assert.ok(why && why.length > 40, `${cls} is deferred without a real reason`);
    assert.ok(!new RegExp(`\\.${cls}\\b`).test(CSS),
      `.${cls} now HAS a rule in panel.css — remove it from DEFERRED_CLASSES rather than leaving stale debt`);
    assert.ok(assignedClasses().has(cls), `.${cls} is deferred but the script no longer assigns it — drop the entry`);
  }
});
