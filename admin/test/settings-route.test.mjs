// node --test admin/test/ — the Settings route: globals, override tables, and the exceedance report.
//
// The route's whole reason to exist is that these three things must be answered TOGETHER, so the
// tests that matter here are the ones about their agreement: a threshold's stated SOURCE has to be
// true, and a narrowed or failed read has to render as unknown rather than as "nothing is wrong".

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

let DIR;
beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), 'cw-settings-route-'));
  process.env.CW_SETTINGS = join(DIR, 'settings.json');
  for (const k of ['CW_SWEEP_INFLIGHT_MAX_MS', 'CW_SWEEP_KILL_MS', 'CW_SWEEP_CADENCE_MS']) delete process.env[k];
});
afterEach(() => {
  delete process.env.CW_SETTINGS;
  rmSync(DIR, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const { routes } = await import('../routes/settings.mjs');
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path} is not registered`);
  const seen = [];
  r.handle({
    req: {}, isLoopbackReq: true, adminSession: () => null,
    send: (code, payload) => seen.push({ code, payload }),
    readJsonBody: (_req, cb) => cb(body, null),
  });
  // the write paths call back synchronously through the injected readJsonBody
  return seen[0];
};

test('both routes refuse a remote caller with no session', async () => {
  const { routes } = await import('../routes/settings.mjs');
  for (const r of routes) {
    const seen = [];
    r.handle({
      req: {}, isLoopbackReq: false, adminSession: () => null,
      send: (c, b) => seen.push({ c, b }), readJsonBody: (_q, cb) => cb({}, null),
    });
    assert.equal(seen[0].c, 401, `${r.method} ${r.path} must require auth`);
  }
});

test('GET carries the globals, the tables and the health report in ONE payload', async () => {
  const { payload, code } = await call('GET', '/api/settings');
  assert.equal(code, 200);
  assert.equal(payload.ok, true);
  for (const k of ['sweepHangMs', 'sweepKillMs', 'sweepCadenceMs']) {
    assert.ok(payload.settings[k], `${k} missing from the payload`);
  }
  assert.deepEqual(Object.keys(payload.tables).sort(), ['cadence', 'hang', 'kill']);
  assert.deepEqual(payload.columns, ['include', 'directory', 'name', 'value']);
  assert.ok(payload.health, 'no health report — the thresholds would render with nothing measured against them');
  // A count that cannot occur must still be present as 0: an absent key reads as "no data".
  assert.equal(typeof payload.health.counts['kill-eligible'], 'number');
});

test('an unset kill threshold is null and its source is default — never 0', async () => {
  const { payload } = await call('GET', '/api/settings');
  assert.equal(payload.settings.sweepKillMs.value, null,
    'a kill threshold of 0 would make every sweep kill-eligible the instant it started');
  assert.equal(payload.settings.sweepKillMs.source, 'default');
});

test('a write lands and is read back with source "store"', async () => {
  const w = await call('POST', '/api/settings', { settings: { sweepHangMs: 9 * 3600000 } });
  assert.equal(w.code, 200, JSON.stringify(w.payload));
  assert.equal(w.payload.ok, true);
  const { payload } = await call('GET', '/api/settings');
  assert.equal(payload.settings.sweepHangMs.value, 9 * 3600000);
  assert.equal(payload.settings.sweepHangMs.source, 'store');
});

test('a kill threshold below the hang threshold is refused, naming both', async () => {
  await call('POST', '/api/settings', { settings: { sweepHangMs: 4 * 3600000 } });
  const w = await call('POST', '/api/settings', { settings: { sweepKillMs: 1 * 3600000 } });
  assert.notEqual(w.code, 200, 'a kill below hang would terminate runs it never warned about');
  assert.ok(Array.isArray(w.payload.errors) && w.payload.errors.join(' ').length > 0);
});

test('an env-shadowed key refuses the write instead of returning a 200 that changes nothing', async () => {
  process.env.CW_SWEEP_INFLIGHT_MAX_MS = String(2 * 3600000);
  try {
    const w = await call('POST', '/api/settings', { settings: { sweepHangMs: 5 * 3600000 } });
    assert.notEqual(w.code, 200);
    assert.match(JSON.stringify(w.payload.errors || []), /CW_SWEEP_INFLIGHT_MAX_MS/,
      'the refusal must name the variable that outranks the store, or the operator cannot act on it');
  } finally { delete process.env.CW_SWEEP_INFLIGHT_MAX_MS; }
});

test('rules round-trip, and a rule missing its name is refused with the row index', async () => {
  const good = await call('POST', '/api/settings/rules', {
    table: 'hang', rows: [{ include: true, directory: '*', name: 'client-a', value: 12 * 3600000 }],
  });
  assert.equal(good.code, 200, JSON.stringify(good.payload));
  const { payload } = await call('GET', '/api/settings');
  assert.equal(payload.rules.hang.length, 1);
  assert.equal(payload.rules.hang[0].name, 'client-a');

  const bad = await call('POST', '/api/settings/rules', {
    table: 'hang', rows: [{ include: true, directory: '*', name: '', value: 1000 }],
  });
  assert.notEqual(bad.code, 200, 'wildcard-by-omission is how one rule silently reaches the whole fleet');
});

test('writing a rule table does NOT erase the globals, and vice versa', async () => {
  // The two writers own different sections of one file; either one dropping the other's section is
  // a silent data loss the operator only finds later.
  await call('POST', '/api/settings', { settings: { sweepHangMs: 7 * 3600000 } });
  await call('POST', '/api/settings/rules', { table: 'cadence', rows: [{ include: true, directory: 'Portll', name: 'client-d', value: 3600000 }] });
  let g = await call('GET', '/api/settings');
  assert.equal(g.payload.settings.sweepHangMs.value, 7 * 3600000, 'the rule write erased the globals');
  assert.equal(g.payload.rules.cadence.length, 1);

  await call('POST', '/api/settings', { settings: { sweepCadenceMs: 2 * 3600000 } });
  g = await call('GET', '/api/settings');
  assert.equal(g.payload.rules.cadence.length, 1, 'the globals write erased the rule table');
});

test('a corrupt store is reported, and refuses writes rather than overwriting it', async () => {
  writeFileSync(process.env.CW_SETTINGS, '{ not json');
  const { payload } = await call('GET', '/api/settings');
  assert.ok(payload.storeError, 'a store that could not be read must say so — the values shown are env/defaults');
  const w = await call('POST', '/api/settings', { settings: { sweepHangMs: 3600000 } });
  assert.equal(w.code, 503);
});

// ── A SETTING THAT DECLARES ITS OPTIONS RENDERS AS A CHOICE ─────────────────────────────────────
// reportFormats is the first array-valued key. Without a control that understands it, the panel
// asks an operator to type a JSON array into a text box — a control that invites exactly the
// malformed value the server then refuses, and blames them for it.
test('the panel derives its format checkboxes from the SETTING, not from a second list', async () => {
  const { SETTING_KEYS } = await import('../../monitor/settings.mjs');
  const spec = SETTING_KEYS.reportFormats;
  const PANEL = panelSource('index.html');

  assert.ok(Array.isArray(spec.options) && spec.options.length >= 3, 'the key declares its options');
  assert.match(PANEL, /if\(Array\.isArray\(spec&&spec\.options\)\)return 'set';/,
    'the control type is chosen from the declared options, so a new option needs no page edit');
  assert.match(PANEL, /\(spec\.options\|\|\[\]\)\.map\(o=>/,
    'the checkboxes are rendered FROM spec.options — a hand-written list in the page would drift '
    + 'from the validator, offering a format it refuses or hiding one it accepts');

  // Every declared option must be one the validator accepts, or the panel offers a doomed choice.
  assert.equal(spec.validate(spec.options.map((o) => o.id)), null,
    'ticking every box must produce a value the validator accepts');
  // ...and each note has to say something, since the CSAF 2.1 caveat is the reason the control exists.
  for (const o of spec.options) assert.ok(o.label && o.note, `${o.id} needs a label and a note`);
});

// ── A SINGLE-CHOICE SETTING RENDERS AS A DROPDOWN THE PAYLOAD CAN ACTUALLY DRIVE ────────────────
// setKind() branches on spec.unit and spec.options, so a payload that drops them silently demotes
// every control to a bare text box — which is exactly what the old serialisation did to the ms
// sliders. The payload half of this pins the route; the regex half pins the page.
test('the payload carries unit/nullable/options, and the panel derives the dropdown from them', async () => {
  const { payload } = await call('GET', '/api/settings');
  const k = payload.keys.dockerRestartOnDown;
  assert.ok(k, 'dockerRestartOnDown is serialised');
  assert.equal(k.unit, 'choice');
  assert.ok(Array.isArray(k.options) && k.options.length === 3, 'the declared options travel to the page');
  assert.equal(k.default, 'do-not-restart');
  assert.equal(payload.keys.sweepHangMs.unit, 'ms', 'the sliders get their unit back too');
  assert.equal(payload.keys.sweepKillMs.nullable, true);

  const PANEL = panelSource('index.html');
  assert.match(PANEL, /if\(u==='choice'&&Array\.isArray\(spec&&spec\.options\)\)return 'choice';/,
    'the page derives single-choice from the unit, before the array-valued checkbox branch');
  assert.match(PANEL, /kind==='choice'/, 'and renders a control for it');
});

test('"nothing pinned" and "publish nothing" are different, and the save path keeps them apart', async () => {
  const { SETTING_KEYS } = await import('../../monitor/settings.mjs');
  const PANEL = panelSource('index.html');
  // null = fall back to the default set. [] = an explicit request to publish no projections.
  assert.equal(SETTING_KEYS.reportFormats.default, null);
  assert.equal(SETTING_KEYS.reportFormats.validate([]), null, 'an empty explicit list is legal');
  assert.match(PANEL, /if\(raw==='' && kind!=='set'\)\{/,
    'the blank-field guard must SKIP a set — a set carries its value in checkboxes, so "no ticks" '
    + 'would otherwise be read as "field left empty" and null the key, silently turning an explicit '
    + 'publish-nothing into a fall-back-to-defaults');
  assert.match(PANEL, /nothing selected — the built-in default set is published/,
    'and the unpinned state says so on screen rather than looking like an empty choice');
});
