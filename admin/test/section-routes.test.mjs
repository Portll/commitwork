// Each top-level section has its own route: /section/<id>/. Clicking a section used to land on its
// first tab's path, so the URL named a tab the operator had not chosen and the section itself was
// not linkable.
//
// PREFIXED, not bare. Two group ids collide with live view names — `overview` and `secrets`, the
// latter still resolving to view-secrets alongside the newer `held`. A bare /secrets/ would have
// silently changed what an existing link resolves to, which is the ambiguity this panel has spent
// the day removing (`history` meant three things; `secrets` meant two).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = panelSource('index.html');
const SERVE = serverSource();

const GROUPS = (PANEL.match(/const GROUP_ORDER=\[([^\]]*)\]/) || [])[1]
  .split(',').map((x) => x.replace(/'/g, '').trim()).filter(Boolean);
const VIEWS = new Set([...((PANEL.match(/const NATIVE=\{([\s\S]*?)\};/) || [])[1] || '').matchAll(/(\w+):'/g)].map((m) => m[1]));

test('the extractors found both lists — otherwise every case below is vacuous', () => {
  assert.ok(GROUPS.length >= 8, `GROUP_ORDER yielded ${GROUPS.length} — the extractor is broken, not the list`);
  assert.ok(VIEWS.size >= 20, `NATIVE yielded ${VIEWS.size} views — the extractor is broken`);
});

test('the collision that forced the prefix is real, not hypothetical', () => {
  // If this ever stops holding, option B (bare paths) becomes available and this file should say so.
  const collide = GROUPS.filter((g) => VIEWS.has(g));
  assert.ok(collide.length > 0,
    'no group id collides with a view any more — the prefix may no longer be needed; revisit rather than assuming');
  assert.ok(collide.includes('secrets'),
    'secrets was the collision that decided this; if it is gone, re-read the decision');
});

test('the client recognises /section/<id>/ and nothing wider', () => {
  const re = (PANEL.match(/const SECTION_RE=(\/[^;]+\/);/) || [])[1];
  assert.ok(re, 'SECTION_RE not found — the route shape moved');
  const rx = new RegExp(re.slice(1, re.lastIndexOf('/')), re.slice(re.lastIndexOf('/') + 1));
  assert.ok(rx.test('/section/surface/'), 'the canonical form must match');
  assert.ok(rx.test('/section/surface'), 'the trailing slash must be optional, as it is for view paths');
  assert.ok(!rx.test('/section/'), 'a bare prefix names no section');
  assert.ok(!rx.test('/section/a/b/'), 'a third segment is not a section route');
  assert.ok(!rx.test('/surface/'), 'the bare form must NOT match, or the collision returns');
});

test('an id must be a REAL group — an unknown one falls through, never renders an empty section', () => {
  assert.match(PANEL, /GROUP_ORDER\.includes\(m\[1\]\)/,
    'urlSection must check the id against GROUP_ORDER; without it /section/nonsense/ would claim to be a section');
});

test('setView leaves a section path alone — otherwise the deep link half-works', () => {
  assert.match(PANEL, /if\(sectionPathHolds\(v\)\)\s*return;/,
    'setView writes viewUrl(v), which would replace /section/surface/ with the first tab’s own path');
  const at = PANEL.indexOf('sectionPathHolds(v)) return;');
  const urlWrite = PANEL.indexOf('history[replace?', at);
  assert.ok(at > -1 && urlWrite > at, 'the guard must come BEFORE the URL write, or it guards nothing');
});

test('the server serves the panel document for a section path', () => {
  assert.match(SERVE, /\^\\\/section\\\/\(\[a-z0-9-\]\+\)\\\/\?\$/,
    'serve.mjs must match /section/<id>/ to serve index.html for a cold load or a refresh');
});

test('`section` is a RESERVED first segment, so it cannot be read as a project slug', () => {
  // The two-segment form /<slug>/<view>/ would otherwise parse /section/surface/ as project=section.
  // serve.mjs states the rule itself: any prefix the server owns must be excluded, not merely
  // ordered after — the same collision that once served the panel document at /api/issues.
  const m = SERVE.match(/const RESERVED_FIRST = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'RESERVED_FIRST not found');
  assert.match(m[1], /'section'/, 'section must be reserved, or the project router claims it first');
});

test('legacy sections resolve through the live Map, while child views keep their own URLs', () => {
  const first = PANEL.slice(PANEL.indexOf('function firstViewOfSection('), PANEL.indexOf('// True when the URL'));
  const getFirst = new Function('tabsByGroup', `${first}; return firstViewOfSection;`)(
    () => new Map([['static', [{dataset:{v:'sast'}}, {dataset:{v:'codeql'}}]]])
  );
  assert.equal(getFirst('static'), 'sast');
  assert.equal(getFirst('missing'), null);
  const holds = PANEL.slice(PANEL.indexOf('function sectionPathHolds('), PANEL.indexOf('const urlView='));
  const keep = new Function('urlSection', 'firstViewOfSection', `${holds};return sectionPathHolds;`)(()=>'static',getFirst);
  assert.equal(keep('sast'), true);
  assert.equal(keep('codeql'), false, 'a child view must write its own restorable URL');
});
