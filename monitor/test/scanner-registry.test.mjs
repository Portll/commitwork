// The panel once derived its category set from its own label map and fell thirteen categories
// behind — missing categories vanished from the table AND its denominator. Pins: a scanner cannot
// be ADDED without being NAMED, and the panel's bundled fallback cannot drift from the registry.
import { panelSource } from '../../admin/test/lib/panel-source.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCANNER_SPECS, SCANNER_LABELS } from '../extractors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// panelSource(): see the note in bin/test/build-health-vocabulary.test.mjs — the panel client
// moved out of index.html in 54dd4bb and this file reads the client, not the markup.
const PANEL = panelSource('index.html');

const specKeys = SCANNER_SPECS.map(([k]) => k);

describe('the scanner registry is the single source of truth for categories', () => {
  test('every SCANNER_SPECS entry has a display name', () => {
    const unnamed = specKeys.filter((k) => !SCANNER_LABELS[k]);
    assert.deepEqual(unnamed, [],
      `these scanners would render under their raw key: ${unnamed.join(', ')}`);
  });

  test('every display name belongs to a real scanner — no names for categories that do not exist', () => {
    const orphans = Object.keys(SCANNER_LABELS).filter((k) => !specKeys.includes(k));
    assert.deepEqual(orphans, [],
      `these names have no SCANNER_SPECS row, so they would show as permanently ABSENT: ${orphans.join(', ')}`);
  });

  test('the panel ships a fallback covering every category, for rollups written before the registry', () => {
    // The fallback is only reached for a rollup with no scannerRegistry. It must still be complete:
    // an incomplete fallback is exactly the 12-of-25 bug, just narrowed to old rollups.
    const m = PANEL.match(/const SCANNER_LABEL=\{[\s\S]*?\};/);
    assert.ok(m, 'admin/index.html no longer declares SCANNER_LABEL — if the fallback was removed, delete this test with it');
    const panelKeys = [...m[0].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*'/g)].map((x) => x[1]);
    const missing = specKeys.filter((k) => !panelKeys.includes(k));
    assert.deepEqual(missing, [],
      `the panel's fallback is behind the registry by: ${missing.join(', ')} — these categories lose their names on an old rollup`);
  });

  test('the panel derives its category set by UNION, so an unregistered category can never vanish', () => {
    // a shape assertion — the payload's own keys must be added to whatever the list is called
    assert.match(PANEL, /const ALL=\[\.\.\.Object\.keys\(REG\),\.\.\.Object\.keys\(sc\)\.filter\(k=>!\(k in REG\)\)\]/,
      'the coverage table must union the registry with the payload keys, never derive the set from the registry alone');
  });
});
