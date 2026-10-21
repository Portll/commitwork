// workspaceOf() is an open list whose miss path is Findings, so a typo files a view there and says
// nothing. These read the assembled document and close the set from the page's own declarations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { panelSource } from './lib/panel-source.mjs';

const SRC = panelSource('index.html');

const tabViews = new Set([...SRC.matchAll(/data-v="([a-z0-9-]+)" class="vtab"/g)].map((m) => m[1]));
const routeViews = new Set([...SRC.matchAll(/data-route="([a-z0-9-]+)"/g)].map((m) => m[1]));

const nativeLine = SRC.split('\n').find((l) => l.startsWith('const NATIVE='));
assert.ok(nativeLine, 'const NATIVE= is no longer one line — update this extractor with the router');
const nativeKeys = new Set([...nativeLine.matchAll(/([a-z0-9-]+):'/g)].map((m) => m[1]));

const body = SRC.slice(SRC.indexOf('function workspaceOf(v){'), SRC.indexOf('function findingCategory('));
assert.ok(body.includes('return'), 'workspaceOf moved — update this extractor with it');
// Only the array arms name views; `scopeOf(v)==='fleet'` delegates and names none.
const arms = [...body.matchAll(/\[([^\]]*)\]\.includes\(v\)\)return '([a-z]+)'/g)]
  .map((m) => ({ views: [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]), workspace: m[2] }));
const returned = new Set([...body.matchAll(/return '([a-z]+)'/g)].map((m) => m[1]));

const labelDecl = SRC.match(/const WORKSPACE_LABELS=\{([^}]*)\}/);
assert.ok(labelDecl, 'WORKSPACE_LABELS is gone — update this extractor with it');
const labelled = new Set([...labelDecl[1].matchAll(/([a-z]+):'/g)].map((m) => m[1]));

const defaultsDecl = SRC.match(/const WORKSPACE_DEFAULTS=\{([^}]*)\}/);
assert.ok(defaultsDecl, 'WORKSPACE_DEFAULTS is gone — update this extractor with it');
const defaults = Object.fromEntries([...defaultsDecl[1].matchAll(/([a-z]+):'([a-z0-9-]+)'/g)].map((m) => [m[1], m[2]]));

// A guard that parses nothing passes everything. This fails first if the page's shape moves.
test('the extractors read a page, not an empty string', () => {
  assert.ok(tabViews.size >= 30, `tab buttons: ${tabViews.size}`);
  assert.ok(routeViews.size >= 4, `rail routes: ${routeViews.size}`);
  assert.ok(nativeKeys.size >= 10, `NATIVE keys: ${nativeKeys.size}`);
  assert.ok(arms.length >= 4, `workspaceOf arms: ${arms.length}`);
});

test('every view workspaceOf names exists', () => {
  const known = new Set([...tabViews, ...routeViews, ...nativeKeys]);
  for (const arm of arms) {
    for (const v of arm.views) {
      assert.ok(known.has(v),
        `workspaceOf files '${v}' under ${arm.workspace}, and no tab, rail route or NATIVE view has that name — `
        + 'a typo here is invisible, because the miss path is Findings');
    }
  }
});

test('no view is claimed by two workspaces', () => {
  const seen = new Map();
  for (const arm of arms) {
    for (const v of arm.views) {
      assert.ok(!seen.has(v), `'${v}' is in both the ${seen.get(v)} and ${arm.workspace} arms — the first one wins silently`);
      seen.set(v, arm.workspace);
    }
  }
});

test('every workspace workspaceOf returns can be rendered and entered', () => {
  for (const w of returned) {
    if (w === 'manage' || w === 'fleet') continue; // entered from fixed rail links, not a task button
    assert.ok(labelled.has(w), `workspaceOf returns '${w}', which WORKSPACE_LABELS cannot name`);
    assert.ok(defaults[w], `workspaceOf returns '${w}', which WORKSPACE_DEFAULTS gives no landing view`);
    assert.ok([...tabViews, ...nativeKeys].includes(defaults[w]),
      `the '${w}' task lands on '${defaults[w]}', which is not a view`);
  }
});

test('every rail route is a real view', () => {
  for (const v of routeViews) {
    assert.ok(nativeKeys.has(v) || tabViews.has(v), `the rail routes to '${v}', which is not a view`);
  }
});
