// The panel's core pattern is derive, never hand-list — PATH_VIEWS is derived, laneColumns comes
// from detailSchema, the Lanes tab reads tuning.scanners. It breaks at micro scale: SCANNER_LABEL,
// SCANNER_TABS and TAB_GROUPS are hand-maintained, and every drift found on 2026-08-25 sat exactly
// there — 15 lanes with no drill-down, a CodeQL C# lane invisible the day it was built, a comments
// view half-landed.
//
// These do not demand a tab per lane. They demand that a lane cannot exist with NOTHING naming it,
// and that no list names a lane the fleet does not declare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCANNER_CHECKS } from '../../monitor/scanner-checks.mjs';
import { panelSchema } from '../../monitor/detail-schema.mjs';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const labels = new Set(
  [...(SRC.match(/const SCANNER_LABEL=\{([\s\S]*?)\};/)?.[1] || '').matchAll(/(\w+):'/g)].map((m) => m[1]),
);
const tabKeys = new Set(
  [...(SRC.match(/const SCANNER_TABS=\[([\s\S]*?)\n\];/)?.[1] || '').matchAll(/key:'(\w+)'/g)].map((m) => m[1]),
);

test('the extractors found their lists — an empty set would pass every assertion below vacuously', () => {
  assert.ok(labels.size > 20, `SCANNER_LABEL yielded ${labels.size} entries; the extractor is broken, not the list`);
  assert.ok(tabKeys.size > 10, `SCANNER_TABS yielded ${tabKeys.size} entries; the extractor is broken, not the list`);
});

test('every declared scanner category has a label — an unlabelled lane renders as its raw key', () => {
  const missing = Object.keys(SCANNER_CHECKS).filter((k) => !labels.has(k));
  assert.deepEqual(missing, [],
    'these categories are declared in SCANNER_CHECKS and named nowhere in the panel. A lane with no '
    + 'label is a lane the reader cannot tell ran from one that found nothing.');
});

test('no label names a category the fleet does not declare', () => {
  const orphan = [...labels].filter((k) => !(k in SCANNER_CHECKS));
  assert.deepEqual(orphan, [],
    'a label survives for a category that no longer exists — it will render a row that can never populate');
});

test('no SCANNER_TABS entry names a category the fleet does not declare', () => {
  const orphan = [...tabKeys].filter((k) => !(k in SCANNER_CHECKS));
  assert.deepEqual(orphan, [],
    'a detail tab is wired to a category the fleet does not produce; it can only ever render empty, '
    + 'which on this panel reads as clean');
});

test('categories without a drill-down tab are counted, so the gap cannot grow unnoticed', () => {
  // A schema-backed category gets a generated tab from addDerivedLaneTabs(); counting only the
  // hand-written bootstrap array misclassified every newly derived tab as an invisible lane.
  const schemas = panelSchema();
  const noTab = Object.keys(SCANNER_CHECKS).filter((k) => !tabKeys.has(k) && !schemas[k]);
  // Not a demand for a tab per lane — the Overview coverage table and /lanes/ already render all of
  // them. This pins the number so adding a lane without a drill-down is a deliberate act, and the
  // count going UP shows in a diff.
  assert.ok(noTab.length <= 17,
    `${noTab.length} categories have no drill-down tab (was 17 on 2026-08-25): ${noTab.join(', ')}. `
    + 'If this is deliberate, raise the pin and say why.');
});

test('a derived lane never duplicates a hand-written tab or remaps its view', () => {
  const body = SRC.match(/function addDerivedLaneTabs\(d\)\{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(body, 'addDerivedLaneTabs not found in the panel document');
  const button = (v) => ({ className: 'vtab', dataset: { v } });
  const strip = { children: [button('bola')], querySelectorAll: () => strip.children, appendChild: (b) => strip.children.push(b) };
  const NATIVE = { bola: 'view-bola' };
  const document = { createElement: () => ({ dataset: {} }) };
  const run = new Function('$', 'document', 'SCANNER_TABS', 'NATIVE', 'VALID_VIEWS', 'TAB_GROUPS_EXTRA', 'LANE_TITLE',
    'rebuildViewPaths', 'renderGroups', `let LANE_TABS_ADDED=false;\n${body}\nreturn addDerivedLaneTabs;`)(
    () => strip, document, [], NATIVE, new Set(), {}, {}, () => {}, () => {});
  run({
    laneTabs: [{ key: 'bola', view: 'bola', label: 'Authz / BOLA' }, { key: 'newLane', view: 'newlane', label: 'New lane' }],
    detailSchema: { bola: { columns: [{ name: 'rule' }] }, newLane: { columns: [{ name: 'rule' }] } },
  });
  assert.deepEqual(strip.children.map((b) => b.dataset.v), ['bola', 'newlane']);
  assert.equal(NATIVE.bola, 'view-bola', 'the hand-written view must keep its own page');
  assert.equal(NATIVE.newlane, 'view-lane');
});
