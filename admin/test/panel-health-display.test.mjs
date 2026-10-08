// node --test admin/test/ — the run-health panel's DISPLAY contract.
//
// WHY THIS FILE EXISTS. "run healthcheck" was a trigger with no display: the only trace a run had
// ever happened was the button's own label, which reverts the instant the run ends. A trigger
// whose result has nowhere to land is the exit-code-with-no-subscriber shape, and the panel is
// where this repo says that shape is not allowed.
//
// WHAT IT ASSERTS, AND WHY IT IS NOT A MARKER TEST. The cheap version of this file would check
// that the markup ships an element with the right id and that a render function exists — both
// true of a panel that renders a blank box forever. Every test below instead names a STATE THAT
// MUST BE DISTINGUISHABLE FROM ANOTHER STATE, and fails when two of them would print the same
// thing. The CSS assertions are here for the same reason: an id-scoped rule that was never
// generalised leaves correct markup rendering as a 0-height invisible element, which is a guard
// whose marker is present and whose mechanism is absent.
//
// THE STATE THIS PANEL EXISTS FOR is the third one. The record is durable now (persistJobs /
// loadPersistedJobs in serve.mjs), so "no record" is no longer scoped to one process's uptime —
// but it is still scoped to the RECORD. Nothing here can speak for runs that predate the store,
// ran on another box, or ran after someone deleted it, so the panel says "on record" and never
// "never ran": the stronger sentence would report a fact about the fleet from a fact about a file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = panelSource('index.html');
const CSS = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8');
const SERVE = serverSource();

/**
 * serve.mjs PLUS the local module it imports initJobs from — the job engine, wherever it
 * currently sits. A failed follow throws rather than returning serve.mjs alone: this function's
 * whole job is finding the engine, and quietly searching the wrong file would report "not persisted"
 * about code it never opened.
 */
function jobEngineSource() {
  const sources = [SERVE];
  const imports = [...SERVE.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"](\.[^'"]+)['"]/g)];
  // fact: serve.mjs boots the engine through initJobs; the routes that read `jobs` import it relative to routes/
  const hit = imports.find(([, names]) => names.split(',').some((n) => n.trim().split(/\s+as\s+/)[0].trim() === 'initJobs'));
  assert.ok(hit, 'serve.mjs imports no local `initJobs` binding — the job engine could not be located, '
    + 'so this assertion has no source to read and must not report on one');
  const resolved = join(HERE, '..', hit[2]);
  sources.push(readFileSync(resolved, 'utf8'));
  return sources.join('\n');
}

/** The body of renderHealth, as source text. */
function renderHealthSource() {
  const i = PANEL.indexOf('function renderHealth(');
  assert.notEqual(i, -1, 'renderHealth is gone — the health panel has no renderer, so its markup is decoration');
  // to the next top-level `async function` / `function` at column 0
  const rest = PANEL.slice(i + 10);
  const end = rest.search(/\n(?:async )?function [A-Za-z_$]/);
  return rest.slice(0, end === -1 ? 6000 : end);
}

test('the panel has somewhere for a health run to land', () => {
  assert.ok(/id="healthbar"/.test(PANEL), 'no #healthbar — the run-health trigger still has no display');
  for (const id of ['hb-ico', 'hb-title', 'hb-sub', 'hb-age', 'hb-prog', 'hb-log']) {
    assert.ok(PANEL.includes(`id="${id}"`), `#${id} is missing from the health panel markup`);
  }
});

test('the progress fill is actually styled — an id-scoped rule that forgot the second panel renders nothing', () => {
  // #sw-prog carried `height:100%` alone for its whole life. A copy-pasted panel with a new id and
  // no rule is markup that looks right and paints a 0-height invisible bar.
  const rule = new RegExp(String.raw`(^|[,\s}])#hb-prog\s*(,[^{]*)?\{[^}]*height\s*:`, 'm');
  assert.ok(rule.test(CSS) || /#sw-prog\s*,\s*#hb-prog\s*\{[^}]*height/.test(CSS),
    '#hb-prog has no height rule: the health panel would render a correct-looking, invisible progress bar');
});

test('"no record" is never written as "never ran" — an absent record is not an absent run', () => {
  const src = renderHealthSource();
  // REWRITTEN 2026-08-29, exactly as the previous version instructed itself to be. jobs{} became
  // durable (loadPersistedJobs/persistJobs in serve.mjs, ~/.commitwork/health-runs.json), so the
  // old "since this server started" hedge stopped being true — and a qualifier that is no longer
  // true is worse than none, because a reader trusts it.
  //
  // REWRITTEN AGAIN 2026-09-09, and this is the change that needs its reasoning left behind. The
  // explanatory subtitle ("an absent record is still not proof that none ever ran") is gone by
  // operator instruction; the state now reads "no healthcheck on record" and nothing else. This
  // assertion USED TO PIN THAT SENTENCE, which made it a test of the mechanism rather than of the
  // claim: delete the prose and the guard dies with it, having certified nothing about what the
  // panel actually says. What has teeth is the SCOPE, and the scope survives the cut — "on record"
  // is a statement about the store, "never run" is a statement about the fleet, and only the first
  // is one this panel may make. So the assertion moved onto the words that carry it.
  //
  // WHAT DID NOT CHANGE is the claim the panel still cannot make. Persistence proves nothing about
  // runs that predate the store, happened on another machine, or ran after someone deleted it.
  assert.equal(/>\s*never run\b|'never run|"never run|never ran/.test(src), false,
    'the panel claims a health run NEVER happened; it can only know that none is recorded here');
  assert.ok(/no healthcheck on record/.test(src),
    'the no-record state no longer scopes its claim to the RECORD — whatever it says instead must say WHERE the absence is, or it reports the fleet from a fact about a file');
  assert.equal(/since this server started/.test(src), false,
    'the process-scoped hedge outlived the in-memory store it described; a stale qualifier reads as a current one');
  // The durable premise this now rests on. If the store is ever removed and jobs goes back to
  // process memory, this test must fail and be rewritten AGAIN rather than keep a false claim —
  // the same instruction the in-memory version left for whoever made it durable.
  //
  // FOLLOWED, NOT PINNED (2026-09-04). This grepped serve.mjs directly until 50daf6a moved the
  // 316-line job engine into admin/lib/jobs.mjs, and the assertion went red while the premise it
  // guards was untouched: persistJobs() is still called on every job transition and initJobs()
  // still seeds from the store. That is a location standing in for a premise — the same shape as
  // keying a finding's identity on a line number, where code moving for unrelated reasons is read
  // as a change of state. So resolve the module serve.mjs actually gets `jobs` from and look there.
  const engine = jobEngineSource();
  assert.ok(/function persistJobs\(/.test(engine) && /function loadPersistedJobs\(/.test(engine),
    'the health record is no longer persisted by the job engine — re-derive the no-record wording '
    + 'against however it is stored now');
});

// The second witness for the sentence above. "no healthcheck on record" is only honest to leave
// unexplained because the box carries the answer to it — the reader's next move is to press run,
// not to work out what the absence proves. That makes the button part of the claim's support, so
// it is asserted here rather than in a markup test: if the trigger goes, the wording has to go back.
test('the reading is actionable from the box it appears in, and a refused start is not silent', () => {
  assert.ok(/id="hb-run"/.test(PANEL),
    'the health box has no trigger of its own: the operator reads "no healthcheck on record" and has to go find the menu to act on it');
  const i = PANEL.indexOf('async function startHealth(');
  assert.notEqual(i, -1, 'there is no shared start path — two triggers with two copies of the logic can disagree about what they ran');
  const start = PANEL.slice(i, i + 1400);
  // cwPost resolves on 403/500; only a transport failure rejects. A start path that reads neither
  // the status nor the body turns "already running" and "unknown job" into a press that appears to
  // work while the box goes on rendering the PREVIOUS run at its old age.
  assert.ok(/resp\.ok|resp\.status/.test(start),
    'the start path ignores the HTTP status: a 403 or 500 would be treated as a started run');
  assert.ok(/\.started/.test(start),
    'the start path ignores {started:false, reason} — a refused trigger is indistinguishable from one that ran');
  // one path, both presses
  assert.ok(/\$\('health'\)[^\n]*onclick\s*=\s*startHealth/.test(PANEL),
    'the menu item no longer shares the start path');
  assert.ok(/\$\('hb-run'\)[^\n]*onclick\s*=\s*startHealth/.test(PANEL),
    'the in-box button no longer shares the start path');
  // and the button's state is DERIVED, not merely toggled by whoever clicked it: a run started in
  // another tab must disable it here, and a failed status read must not strand it disabled.
  assert.ok(/hb-run/.test(renderHealthSource()),
    'renderHealth does not own the run button state — it would stay enabled through another tab\'s run, or stuck disabled after a read failure');
});

test('an unreadable status is its own state, not a stale success left on screen', () => {
  const src = renderHealthSource();
  assert.ok(/unreadable/.test(src), 'no unreadable state in the renderer');
  // the specific regression: `catch(e){return;}` leaves the previous render in place, so a dead
  // server shows the last good result, quietly ageing.
  const poll = PANEL.slice(PANEL.indexOf('async function pollHealth('), PANEL.indexOf('async function pollHealth(') + 1200);
  assert.equal(/catch\(e\)\{return;\}/.test(poll), false,
    'pollHealth still swallows a failed status read: the last good render stays on screen and a dead server is indistinguishable from an idle one');
  assert.ok(/renderHealth\(null\s*,/.test(poll),
    'the catch does not render the unreadable state');
});

test('a run that was STOPPED or SIGNALLED never wears a completion tick', () => {
  const src = renderHealthSource();
  assert.ok(/stoppedAt/.test(src), 'a stopped run is not distinguished — it would render as whatever its exitCode implies');
  assert.ok(/signal/.test(src), 'a signalled run is not distinguished; a killed job exits with code null');
  // the tick must be reachable only when neither happened
  assert.ok(/!h\.stoppedAt\s*&&\s*!h\.signal\s*&&\s*h\.exitCode\s*===\s*0/.test(src),
    'the success colour is not gated on the run having actually finished');
});

test('the AGE of the last run is shown, not only its verdict', () => {
  const src = renderHealthSource();
  assert.ok(/AGO\(/.test(src),
    'no elapsed-age stamp: a nine-day-old health verdict and a nine-second-old one are the same words');
  assert.ok(/ABS\(/.test(src), 'the absolute time is not carried in title= for when the reader needs it');
  assert.ok(/HEALTH_STALE_MS|dataset\.state\s*=/.test(src),
    'nothing marks a stale result as stale — the reader is left to do the arithmetic');
});

test('the panel is populated on load, before anyone presses anything', () => {
  // a health run started from the CLI or another tab must be visible here without a click, and the
  // resting state has to say something rather than being an empty box.
  // The boot read is attachJobs(), which also re-attaches when the selection changes.
  const at = PANEL.indexOf('on load, attach to any sweep already in progress');
  assert.match(PANEL.slice(at, at + 1400), /\nattachJobs\(\);/, 'the boot no longer reads the job status');
  const fn = PANEL.indexOf('async function attachJobs(');
  const boot = PANEL.slice(fn, PANEL.indexOf('\n}\n', fn));
  assert.ok(/renderHealth\(st\.health,null\)/.test(boot),
    'the boot status read does not render the health panel: its resting state would be blank until the button is pressed');
  assert.equal(/catch\(e\)\{\}/.test(boot), false,
    'the boot read swallows its own failure — the panel would sit blank with no indication that the status could not be read');
});
