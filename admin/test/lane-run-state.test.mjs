// The browser half of per-lane run state. admin/test/lane-events.test.mjs proves the frames reach
// the page; this proves the page does the right thing with them.
//
// Two behaviours carry the weight, and both are the kind that fail silently:
//   · FIRST RUN is decided once, at start. Deciding it at paint time reads a `scanners` block the
//     completing sweep is about to fill in, so the marker would disappear at the moment the
//     operator is watching for it — the one case they pressed a button and are waiting.
//   · A lane still marked running when the sweep is gone spins forever. The tab must clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const grab = (marker, endMarker) => {
  const a = SRC.indexOf(marker);
  assert.ok(a > -1, `${marker} not found in admin/index.html`);
  const b = SRC.indexOf(endMarker, a);
  assert.ok(b > -1, `${endMarker} not found after ${marker}`);
  return SRC.slice(a, b);
};

/** A minimal element with just the classList/attribute surface the painter uses. */
function fakeBtn() {
  const cls = new Set();
  const attrs = {};
  return {
    classList: {
      toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); },
      contains: (c) => cls.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    attrs, cls,
  };
}

/**
 * Evaluate the lane-state block with everything it reaches for injected. Nothing is stubbed that
 * the block itself defines — the point is to run the shipped code, not a paraphrase of it.
 */
function harness({ scanners = {}, registry = [], tabs = [], openView = 'overview' } = {}) {
  const block = grab('let laneRun={};', '// The live console: EventSource first');
  const btns = {};
  const document = {
    querySelector: (sel) => {
      const m = /\.vtab\[data-v="(.*)"\]/.exec(sel);
      if (!m) return null;
      return (btns[m[1]] ||= fakeBtn());
    },
    createElement: () => ({ className: '', id: '', textContent: '', setAttribute() {}, appendChild() {}, remove() {} }),
    body: { appendChild() {} },
  };
  const toasts = [];
  const redraws = [];
  const fn = new Function('document', 'CSS', 'lastState', 'SCANNER_TABS', 'LANE_TITLE', '$', 'setTimeout',
    'curView', 'renderScannerTabs', '__toasts',
    `${block}
     // toastLane's DOM path is exercised elsewhere; here the message and tone are the assertion.
     toastLane = (msg, tone) => __toasts.push({ msg, tone });
     return { applyLaneEvent, seedLanes, paintLaneTab, laneViewForCheck, laneCatForCheck,
              refreshOpenLaneVoid,
              get laneRun(){ return laneRun; } };`);
  const api = fn(document, { escape: (x) => x }, { scanners, scannerRegistry: registry },
    tabs, {}, () => null, (f) => { f(); return 0; }, openView, () => redraws.push(1), toasts);
  return { ...api, btns, toasts, redraws };
}

const REG = [{ key: 'depsOsv', check: 'deps-osv' }, { key: 'sast', check: 'sast' }];
const TABS = [{ key: 'depsOsv', view: 'depsosv' }, { key: 'sast', view: 'sast' }];

test('a running lane marks its tab, and the tab says so to a screen reader too', () => {
  const h = harness({ registry: REG, tabs: TABS });
  h.applyLaneEvent({ check: 'deps-osv', event: 'start', repo: 'r', rec: { running: ['r'], done: 0 } });
  const btn = h.btns.depsosv;
  assert.ok(btn.classList.contains('lane-running'));
  assert.equal(btn.attrs['aria-busy'], 'true', 'the marker is a spinning border; without aria-busy '
    + 'the state is carried by animation alone and reaches nobody using a screen reader');
});

test('FIRST run is its own state — a lane with no prior result pulses, one with a result does not', () => {
  const fresh = harness({ registry: REG, tabs: TABS, scanners: {} });
  fresh.applyLaneEvent({ check: 'deps-osv', event: 'start', repo: 'r', rec: { running: ['r'] } });
  assert.ok(fresh.btns.depsosv.classList.contains('lane-first-run'),
    'a lane that has never run here is the case the operator is watching for');

  const seen = harness({ registry: REG, tabs: TABS, scanners: { depsOsv: { total: 3, ran: 3 } } });
  seen.applyLaneEvent({ check: 'deps-osv', event: 'start', repo: 'r', rec: { running: ['r'] } });
  assert.ok(seen.btns.depsosv.classList.contains('lane-running'));
  assert.ok(!seen.btns.depsosv.classList.contains('lane-first-run'),
    're-running a lane that already has results is progress, not the first-result question');
});

test('first-run is decided ONCE and survives the state arriving mid-run', () => {
  // The live regression this guards: the sweep publishes its rollup, `scanners` gains the lane, and
  // a paint-time decision would drop the marker at exactly the moment it means something.
  const h = harness({ registry: REG, tabs: TABS, scanners: {} });
  h.applyLaneEvent({ check: 'deps-osv', event: 'start', repo: 'r', rec: { running: ['r'] } });
  assert.equal(h.laneRun['deps-osv'].firstRun, true);
  h.applyLaneEvent({ check: 'deps-osv', event: 'start', repo: 'r2', rec: { running: ['r', 'r2'] } });
  assert.equal(h.laneRun['deps-osv'].firstRun, true, 'the answer changed under a later event');
});

test('an end clears the tab and announces the outcome without translating it into a verdict', () => {
  const h = harness({ registry: REG, tabs: TABS });
  h.applyLaneEvent({ check: 'sast', event: 'start', repo: 'r', rec: { running: ['r'] } });
  h.applyLaneEvent({ check: 'sast', event: 'end', repo: 'r', status: 'noscan', ms: 250,
    project: 'fixarea', rec: { running: [], done: 1, void: 1 } });
  assert.ok(!h.btns.sast.classList.contains('lane-running'), 'the marker outlived the run');
  assert.equal(h.btns.sast.attrs['aria-busy'], undefined);
  const t = h.toasts.pop();
  assert.equal(t.tone, 'grey', 'noscan is neither a pass nor a failure, and a two-tone notice would '
    + 'have to make it one of them');
  assert.match(t.msg, /noscan/, 'the status is quoted, not paraphrased');
  assert.match(t.msg, /fixarea/, 'the area is named — a finished lane must not be read as this project\'s');
});

test('pass and fail get their own tone, so grey is a real third state rather than a default', () => {
  const h = harness({ registry: REG, tabs: TABS });
  h.applyLaneEvent({ check: 'sast', event: 'end', repo: 'r', status: 'pass', ms: 1, rec: { running: [] } });
  assert.equal(h.toasts.pop().tone, 'ok');
  h.applyLaneEvent({ check: 'sast', event: 'end', repo: 'r', status: 'fail', ms: 1, rec: { running: [] } });
  assert.equal(h.toasts.pop().tone, 'bad');
});

test('an abandoned lane says it published nothing — not that it found nothing', () => {
  const h = harness({ registry: REG, tabs: TABS });
  h.applyLaneEvent({ check: 'sast', event: 'start', repo: 'r', rec: { running: ['r'] } });
  h.applyLaneEvent({ check: 'sast', event: 'abandoned', repo: null, status: null, ms: null,
    rec: { running: [], done: 0, abandoned: 1 } });
  assert.ok(!h.btns.sast.classList.contains('lane-running'), 'a killed sweep left the tab spinning');
  const t = h.toasts.pop();
  assert.equal(t.tone, 'grey');
  assert.match(t.msg, /published nothing/);
  assert.ok(!/finished/.test(t.msg), 'a run that died must not be worded as a completion');
});

test('a client connecting mid-sweep sees the lanes already running', () => {
  // Without the seed, only lanes that start AFTER the subscription would ever be marked — so
  // opening the panel during a long sweep would show a live console and a still tab strip.
  const h = harness({ registry: REG, tabs: TABS });
  h.seedLanes({ lanes: { 'deps-osv': { running: ['r1', 'r2'], done: 4 }, sast: { running: [], done: 9 } } });
  assert.ok(h.btns.depsosv.classList.contains('lane-running'));
  assert.ok(!h.btns.sast.classList.contains('lane-running'), 'a lane with nothing in flight was marked running');
});

test('a check the registry cannot place marks NO tab rather than a guessed one', () => {
  const h = harness({ registry: REG, tabs: TABS });
  assert.equal(h.laneViewForCheck('some-check-nobody-declared'), null);
  h.applyLaneEvent({ check: 'some-check-nobody-declared', event: 'start', repo: 'r', rec: { running: ['r'] } });
  assert.deepEqual(Object.keys(h.btns), [], 'marking the wrong tab as running is worse than marking none');
});

test('a category with a registry entry but no TAB resolves to no view, and does not throw', () => {
  const h = harness({ registry: [...REG, { key: 'ghost', check: 'ghost-check' }], tabs: TABS });
  assert.equal(h.laneCatForCheck('ghost-check'), 'ghost');
  assert.equal(h.laneViewForCheck('ghost-check'), null);
  h.applyLaneEvent({ check: 'ghost-check', event: 'end', repo: 'r', status: 'pass', ms: 1, rec: { running: [] } });
  assert.equal(h.toasts.length, 1, 'a lane with no tab still completes, and the operator still hears about it');
});

test('only the lane being looked at is redrawn', () => {
  // renderScannerTabs redraws the whole strip. A fleet sweep completes thousands of lanes, and
  // calling it per event would spend the browser on tabs nobody has open.
  const away = harness({ registry: REG, tabs: TABS, openView: 'overview' });
  away.applyLaneEvent({ check: 'sast', event: 'end', repo: 'r', status: 'pass', ms: 1, rec: { running: [] } });
  assert.equal(away.redraws.length, 0, 'a lane on a tab nobody has open redrew the strip');

  const here = harness({ registry: REG, tabs: TABS, openView: 'sast' });
  here.applyLaneEvent({ check: 'sast', event: 'end', repo: 'r', status: 'pass', ms: 1, rec: { running: [] } });
  assert.equal(here.redraws.length, 1, 'the open lane must refresh, or its panel keeps offering a '
    + 'button for a run that has already finished');
});
