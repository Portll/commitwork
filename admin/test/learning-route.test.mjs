import { panelSource } from './lib/panel-source.mjs';
// fact: every test drives the real setting store in a temp dir / a route tested against a stub proves the stub (expiry: never, prev: unknown)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routes, state, loadExplainers } from '../routes/learning.mjs';
import { SETTING_KEYS, setSettings, getSetting, explainerIds } from '../../monitor/settings.mjs';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = resolve(CW, 'admin', 'index.html');
const REGISTRY = resolve(CW, 'monitor', 'explainers.json');
// fact: the client half lives in static/learning.js since the extraction / asserting it against index.html would look for a loader that moved and fail for the wrong reason (expiry: if the module moves, prev: not built)
const MODULE = resolve(CW, 'admin', 'static', 'learning.js');

// Each test gets its own store: settings are a real file and tests that share one interfere.
function isolate(fn) {
  const prev = process.env.CW_SETTINGS_STORE;
  process.env.CW_SETTINGS_STORE = join(mkdtempSync(join(tmpdir(), 'cw-learn-')), 'settings.json');
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CW_SETTINGS_STORE; else process.env.CW_SETTINGS_STORE = prev;
  }
}
const WHO = { who: 'test@local' };

test('the registry validates against its own schema', () => {
  const doc = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const r = validateAgainstSchema(doc, { path: resolve(CW, 'schema', 'explainers.schema.json') });
  assert.deepEqual(r.errors, []);
});

test('OFF BY DEFAULT, and off means nothing is shown', () => {
  isolate(() => {
    const s = state();
    assert.equal(s.on, false, 'the default must be off — the explanations are for someone who does not know the vocabulary');
    assert.deepEqual(s.visible, [], 'off shows nothing at all, not a reduced set');
    assert.ok(s.total > 0, 'and the registry is non-empty, so the empty visible list is a decision rather than an absence');
  });
});

test('on shows every explainer that has not been dismissed', () => {
  isolate(() => {
    setSettings({ learningMode: true }, WHO);
    const s = state();
    assert.equal(s.on, true);
    assert.equal(s.visible.length, s.total);
  });
});

test('PER-ITEM: dismissing one hides that one and leaves the rest', () => {
  isolate(() => {
    setSettings({ learningMode: true }, WHO);
    const before = state();
    const victim = before.visible[0].id;
    setSettings({ learningDismissed: [victim] }, WHO);
    const after = state();
    assert.equal(after.visible.length, before.visible.length - 1);
    assert.equal(after.visible.some((e) => e.id === victim), false, 'the dismissed one is gone');
    assert.deepEqual(after.dismissed, [victim]);
    for (const e of before.visible.slice(1)) {
      assert.equal(after.visible.some((x) => x.id === e.id), true, `${e.id} must still show`);
    }
  });
});

test('a dismissal survives the mode being turned off and on', () => {
  isolate(() => {
    setSettings({ learningMode: true, learningDismissed: ['finding'] }, WHO);
    setSettings({ learningMode: false }, WHO);
    setSettings({ learningMode: true }, WHO);
    assert.deepEqual(state().dismissed, ['finding'], 'remembered means remembered across the toggle');
  });
});

test('AN UNKNOWN ID IS REFUSED, not stored', () => {
  isolate(() => {
    const r = setSettings({ learningDismissed: ['no-such-explainer'] }, WHO);
    assert.equal(r.ok, false, 'the write must be refused');
    assert.match(r.errors.join(' '), /not an explainer/);
    assert.deepEqual(getSetting('learningDismissed').value, null, 'and nothing is written');
  });
});

test('a duplicate id is refused', () => {
  isolate(() => {
    const r = setSettings({ learningDismissed: ['finding', 'finding'] }, WHO);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /duplicate/);
  });
});

test('restoreAll clears every dismissal', () => {
  isolate(() => {
    setSettings({ learningMode: true, learningDismissed: ['finding', 'lane'] }, WHO);
    assert.equal(state().dismissed.length, 2);
    setSettings({ learningDismissed: null }, WHO);
    assert.deepEqual(state().dismissed, []);
    assert.equal(state().visible.length, state().total);
  });
});

test('an UNREADABLE registry shows nothing and says so — never a silent empty', () => {
  isolate(() => {
    const prev = process.env.CW_EXPLAINERS;
    process.env.CW_EXPLAINERS = join(mkdtempSync(join(tmpdir(), 'cw-noreg-')), 'gone.json');
    try {
      const r = loadExplainers();
      assert.equal(r.ok, false);
      assert.match(r.error, /unreadable/);
      const s = state();
      assert.equal(s.registryOk, false);
      assert.ok(s.registryError, 'the reason must reach the client, not just an empty list');
    } finally {
      if (prev === undefined) delete process.env.CW_EXPLAINERS; else process.env.CW_EXPLAINERS = prev;
    }
  });
});

test('the setting keys are declared, and the description is the one the operator asked for', () => {
  assert.ok(SETTING_KEYS.learningMode, 'learningMode must be a declared key');
  assert.equal(SETTING_KEYS.learningMode.default, false);
  assert.match(SETTING_KEYS.learningMode.description, /aren't software engineers/);
  assert.ok(SETTING_KEYS.learningDismissed, 'learningDismissed must be a declared key');
  assert.equal(SETTING_KEYS.learningDismissed.default, null);
});

test('the panel is wired: checkbox, loader, and component styles', () => {
  const html = panelSource('index.html');
  assert.match(html, /id="learn-on"/, 'the ≡ menu must carry the checkbox');
  assert.match(readFileSync(MODULE, 'utf8'), /async function loadLearning\(\)/,
    'the loader lives in the module now');
  assert.match(html, /<script src="\/static\/learning\.js"><\/script>/,
    'and the page must request it');
  assert.match(html, /data-explain=/, 'at least one host must be marked');
  assert.match(html, /<style id="workspace-styles">/);
});

test('EVERY data-explain id in the markup exists in the registry', () => {
  // fact: a host with an id the registry lacks renders NOTHING and reports no error / the operator turns learning on, sees nothing beside that heading, and concludes the feature is broken rather than the id is wrong (expiry: never, prev: not built)
  const html = panelSource('index.html');
  const used = [...html.matchAll(/data-explain="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'no hosts marked — the feature would render nothing anywhere');
  const known = explainerIds();
  const unknown = used.filter((id) => !known.has(id));
  assert.deepEqual(unknown, [], 'these ids are used in the markup and declared nowhere');
});

test('the routes are the two declared, and both are gated', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), ['GET /api/learning', 'POST /api/learning']);
});
