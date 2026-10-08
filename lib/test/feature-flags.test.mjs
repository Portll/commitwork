// lib/test/feature-flags.test.mjs — the experimental flag declaration and its resolution order.
// Every test drives a real settings store in a temp dir, and sets env AFTER import, so a module-load
// env read would fail here rather than pass.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flagTable, routeKey, loadFlagTable } from '../feature-charter.mjs';
import { featureState, flagFor, routeFlagOff, flagEnvVar, offMessage, featureEnabled, featureFlag, gateFeature } from '../feature-flags.mjs';
import { setSettings, resetSettingsWarnings } from '../../monitor/settings.mjs';
import { buildCensus } from '../../bin/feature-census.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHARTER = JSON.parse(readFileSync(join(ROOT, 'manifests', 'feature-charter.json'), 'utf8'));
const TMP = mkdtempSync(join(tmpdir(), 'cw-featflags-'));
const KEYS = ['CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_FC_CHARTER', 'CW_EXPERIMENTAL', 'CW_FEATURE_FEED', 'CW_FEATURE_PALETTE',
  ...Object.keys(CHARTER.experimentalFlags).map(flagEnvVar)];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});
let n = 0;
/** A fresh store and a clean env for each test. */
function fresh() {
  for (const k of KEYS) delete process.env[k];
  process.env.CW_SETTINGS = join(TMP, `settings-${++n}.json`);
  resetSettingsWarnings();
  return process.env.CW_SETTINGS;
}
const state = (id) => featureState().flags.find((f) => f.id === id);
const WHO = { who: 'test@local' };

test('every ring-outward group carries experimental:true and a declared flag; nothing else does', () => {
  const t = flagTable(CHARTER);
  for (const g of CHARTER.groups) {
    if (g.class === 'ring-outward') {
      assert.equal(g.experimental, true, `${g.id} is ring-outward and not marked experimental`);
      assert.ok(t.has(g.flag), `${g.id} names undeclared flag ${g.flag}`);
    } else {
      assert.equal(g.flag, undefined, `${g.id} is ${g.class} and carries a flag`);
    }
  }
});

test('the fragment groups G3 (offbox, docsite endpoints) and G4 (scan-images) are flagged', () => {
  assert.equal(flagFor('http-route', 'offbox').id, 'offbox');
  assert.equal(flagFor('job', 'com.portll.commitwork-offbox-watch').id, 'offbox');
  assert.equal(flagFor('job', 'com.portll.commitwork-offbox-fetch').id, 'offbox');
  assert.equal(routeFlagOff('/api/docsite/publish'), null, 'on by default');
  assert.equal(flagFor('http-route', routeKey('/api/docsite/purge-cache')).id, 'docsite');
  assert.equal(flagFor('cli-command', 'scan-images').id, 'scan-images');
  assert.equal(flagFor('http-route', 'settings'), null, 'a core route has no flag');
});

test('a malformed declaration is refused, never read as "no flags"', () => {
  const base = { experimentalFlags: { x1: { label: 'X', why: 'w' } } };
  const g = (over) => ({ id: 'g', surface: 'http-route', keys: ['k'], class: 'ring-outward', ...over });
  assert.throws(() => flagTable({ ...base, groups: [g({ flag: 'x1' })] }), /both "experimental": true and a "flag"/);
  assert.throws(() => flagTable({ ...base, groups: [g({ experimental: true, flag: 'nope' })] }), /does not declare/);
  assert.throws(() => flagTable({ experimentalFlags: { x1: { label: 'X', why: 'w', views: 'feed' } }, groups: [] }), /views must be an array/);
  assert.throws(() => flagTable({ ...base, groups: [g({ experimental: true, flag: 'x1', class: 'core' })] }), /only ring-outward/);
  assert.throws(() => flagTable({ experimentalFlags: { Bad_Id: { label: 'X', why: 'w' } }, groups: [] }), /kebab-case/);
  assert.equal(flagTable({ groups: [g({})] }).size, 0, 'a charter with no flags at all is valid and empty');
});

test('DEFAULT: every flag is ON with source default, so nothing changes until switched', () => {
  fresh();
  const s = featureState();
  assert.equal(s.ok, true);
  assert.equal(s.flags.length, Object.keys(CHARTER.experimentalFlags).length);
  for (const f of s.flags) {
    assert.equal(f.on, true, `${f.id} is not on by default`);
    assert.equal(f.source, 'default');
  }
});

test('the store switches one flag off and leaves the rest on', () => {
  fresh();
  const r = setSettings({ experimentalFeatures: { docsite: 'off' } }, WHO);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([state('docsite').on, state('docsite').source], [false, 'store']);
  assert.equal(routeFlagOff('/api/docsite/list').id, 'docsite');
  assert.equal(routeFlagOff('/docsite/edit').id, 'docsite');
  assert.equal(state('offbox').on, true);
});

test('the store refuses an undeclared flag id or a third state', () => {
  fresh();
  assert.equal(setSettings({ experimentalFeatures: { 'no-such-flag': 'off' } }, WHO).ok, false);
  assert.equal(setSettings({ experimentalFeatures: { docsite: 'maybe' } }, WHO).ok, false);
});

test('ENV BEATS STORE: CW_EXPERIMENTAL overrides the store, and CW_FEATURE_<ID> overrides both', () => {
  fresh();
  setSettings({ experimentalFeatures: { docsite: 'on', offbox: 'on' } }, WHO);
  process.env.CW_EXPERIMENTAL = 'off';
  assert.deepEqual([state('docsite').on, state('docsite').source], [false, 'env:CW_EXPERIMENTAL']);
  process.env.CW_FEATURE_DOCSITE = 'on';
  assert.deepEqual([state('docsite').on, state('docsite').source], [true, 'env:CW_FEATURE_DOCSITE']);
  assert.equal(state('offbox').on, false, 'the global override still holds for the flag the per-flag var does not name');
  process.env.CW_FEATURE_OFFBOX = 'off';
  delete process.env.CW_EXPERIMENTAL;
  assert.deepEqual([state('offbox').on, state('offbox').source], [false, 'env:CW_FEATURE_OFFBOX']);
});

test('an env value that is not on|off is ignored and reported, never guessed', () => {
  fresh();
  process.env.CW_FEATURE_LAUNCHLIST = '0';
  const f = state('launchlist');
  assert.equal(f.on, true);
  assert.match(f.notes.join(' '), /CW_FEATURE_LAUNCHLIST="0" is not on or off/);
});

test('UNREADABLE STORE: the learningMode convention — env > default (ON), reported, writes refused', () => {
  const p = fresh();
  writeFileSync(p, '{ not json');
  const s = featureState();
  assert.equal(s.ok, false);
  assert.match(s.storeError, /unparseable JSON/);
  for (const f of s.flags) assert.deepEqual([f.on, f.source], [true, 'corrupt-store-fallback'], f.id);
  process.env.CW_EXPERIMENTAL = 'off';
  assert.equal(state('docsite').on, false, 'an env override still applies over an unreadable store');
  const w = setSettings({ experimentalFeatures: { docsite: 'on' } }, WHO);
  assert.equal(w.ok, false);
  assert.equal(readFileSync(p, 'utf8'), '{ not json', 'the unreadable store is not overwritten');
});

test('UNREADABLE CHARTER: nothing is gated and the state says why', () => {
  fresh();
  process.env.CW_FC_CHARTER = join(TMP, 'no-charter.json');
  const s = featureState();
  assert.equal(s.ok, false);
  assert.match(s.charterError, /feature charter unreadable/);
  assert.equal(routeFlagOff('/api/docsite/list'), null);
  assert.equal(loadFlagTable().ok, false);
  delete process.env.CW_FC_CHARTER;
});

test('the refusal names the flag and the way back on', () => {
  fresh();
  setSettings({ experimentalFeatures: { offbox: 'off' } }, WHO);
  assert.match(offMessage(state('offbox')), /"offbox".*switched off.*CW_FEATURE_OFFBOX=on/);
  process.env.CW_FEATURE_OFFBOX = 'off';
  assert.match(offMessage(state('offbox')), /set by CW_FEATURE_OFFBOX; set CW_FEATURE_OFFBOX=on or unset it/);
});

test('the census reads the flags and reports one per row', () => {
  const inv = { generatedAt: 'T', features: [
    { id: 'r1', surface: 'http-route', name: 'GET /api/docsite/list', coverageMeasured: false },
    { id: 'r2', surface: 'http-route', name: 'GET /api/settings', coverageMeasured: false },
    { id: 'r3', surface: 'cli-script', name: 'flow/lexer.mjs', coverageMeasured: false },
  ] };
  const c = buildCensus({ inventory: inv, charter: CHARTER, now: 'T' });
  const row = (id) => c.rows.find((r) => r.id === id);
  assert.deepEqual([row('r1').experimental, row('r1').flag, row('r1').flagEnforcedBy], [true, 'docsite', 'admin/serve.mjs route dispatcher']);
  assert.deepEqual([row('r2').experimental, row('r2').flag], [false, null]);
  assert.deepEqual([row('r3').flag, row('r3').flagEnforcedBy], ['flow', null], 'a script flag is reported unenforced');
  const fl = c.experimentalFlags.find((f) => f.id === 'flow');
  assert.deepEqual(fl.unenforcedSurfaces, ['cli-script']);
  assert.ok(c.experimentalFlags.find((f) => f.id === 'agents').enforcedBy.includes('panel navigation'));
});

// ── the read API another session gates on ──────────────────────────────────────────────────────

test('featureEnabled / featureFlag / gateFeature: env object first, then the store, then ON', () => {
  fresh();
  assert.equal(featureEnabled('docsite'), true);
  assert.equal(gateFeature('docsite'), null);
  setSettings({ experimentalFeatures: { docsite: 'off' } }, WHO);
  assert.equal(featureEnabled('docsite'), false);
  const g = gateFeature('docsite');
  assert.equal(g.status, 404);
  assert.deepEqual([g.body.flag, g.body.featureOff, g.body.enable], ['docsite', true, 'CW_FEATURE_DOCSITE']);
  // A caller-supplied env and settings are honoured instead of process.env and the store.
  assert.equal(featureEnabled('docsite', { env: { CW_FEATURE_DOCSITE: 'on' } }), true);
  assert.equal(featureEnabled('docsite', { env: { CW_EXPERIMENTAL: 'on' } }), true);
  assert.equal(featureEnabled('offbox', { env: {}, settings: { offbox: 'off' } }), false);
  assert.equal(featureFlag('offbox', { env: { CW_EXPERIMENTAL: 'off', CW_FEATURE_OFFBOX: 'on' } }).source, 'env:CW_FEATURE_OFFBOX');
  // Read at call time: set after import, takes effect.
  process.env.CW_FEATURE_DOCSITE = 'on';
  assert.equal(featureEnabled('docsite'), true);
});

test('an undeclared id throws rather than reading ON', () => {
  fresh();
  assert.throws(() => featureEnabled('no-such-flag'), /not declared in manifests\/feature-charter.json/);
  assert.throws(() => gateFeature('no-such-flag'), /not declared/);
});

test('ONE DECLARATION: a new flag in experimentalFlags alone is resolved, stored, overridden and hides its views', () => {
  fresh();
  const charter = JSON.parse(JSON.stringify(CHARTER));
  charter.experimentalFlags.feed = { label: 'Findings feed', why: 'a feed entry point', views: ['feed'] };
  charter.experimentalFlags.palette = { label: 'Command palette', why: 'a keyboard palette' };
  const path = join(TMP, 'charter-plus.json');
  writeFileSync(path, JSON.stringify(charter));
  process.env.CW_FC_CHARTER = path;
  try {
    assert.equal(featureEnabled('feed'), true, 'on by default');
    assert.equal(featureEnabled('palette'), true);
    assert.equal(setSettings({ experimentalFeatures: { palette: 'off' } }, WHO).ok, true, 'the store accepts the new id');
    assert.equal(featureEnabled('palette'), false);
    process.env.CW_FEATURE_FEED = 'off';
    assert.equal(featureEnabled('feed'), false, 'CW_FEATURE_FEED works with no code change');
    const feed = featureState().flags.find((f) => f.id === 'feed');
    assert.deepEqual(feed.surfaces.view, ['feed'], 'the panel hides the declared view');
    const c = buildCensus({ inventory: { generatedAt: 'T', features: [] }, charter, now: 'T' });
    assert.ok(c.experimentalFlags.find((f) => f.id === 'palette').enforcedBy[0].startsWith('code'));
  } finally { delete process.env.CW_FC_CHARTER; }
});
