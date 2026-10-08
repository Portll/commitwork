// bin/test/feature-census.test.mjs — the census's membership tests, pinned.
//
// The census's whole value is that two raters applying it get the same answer, so the tests here are
// about the BOUNDARIES rather than about today's counts (a pinned count over a tree eight sessions
// are editing goes stale within the hour). Each one fixes a way the classification could go lenient:
// an unmeasured field reading as a gap, an unnamed group reading as core, a charter claiming a
// feature twice, and an unreadable input reading as an empty census.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCensus, groupKey, orphanReason, fragmentReason, documented, charterPath } from '../feature-census.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHARTER = JSON.parse(readFileSync(join(ROOT, 'manifests', 'feature-charter.json'), 'utf8'));

const feat = (over) => ({
  id: 'x', surface: 'cli-script', name: 'bin/x.mjs', file: 'bin/x.mjs', line: 1,
  tests: ['bin/test/x.test.mjs'], docs: ['bin/README.md'], coverageMeasured: true,
  entryKind: 'shebang', referencedFrom: ['package.json'], ...over,
});
const inv = (features) => ({ schema: 'commitwork.feature-inventory/1', generatedAt: 'T', features });

test('the shipped charter is well-formed and claims nothing twice', () => {
  assert.ok(Array.isArray(CHARTER.charter) && CHARTER.charter.length >= 3, 'the charter needs the product description the classes are judged against');
  assert.ok(Array.isArray(CHARTER.censusPopulation) && CHARTER.censusPopulation.length > 0);
  for (const k of ['core', 'extension', 'ring-outward', 'fragment', 'orphan']) {
    assert.ok(typeof CHARTER.membershipTests[k] === 'string' && CHARTER.membershipTests[k].length > 20,
      `${k} needs a membership test a second rater can apply`);
  }
  const seen = new Set();
  for (const g of CHARTER.groups) {
    assert.ok(g.id && g.surface && Array.isArray(g.keys) && g.class && g.why, `group ${g.id} is incomplete`);
    for (const k of g.keys) {
      const id = `${g.surface}\u0000${k}`;
      assert.ok(!seen.has(id), `${g.surface}/${k} is claimed twice`);
      seen.add(id);
    }
  }
});

test('a charter that claims a feature twice is REFUSED, not averaged', () => {
  const bad = {
    charterVersion: 'x', censusPopulation: ['cli-script'], membershipTests: {},
    groups: [{ id: 'a', surface: 'cli-script', keys: ['bin'], class: 'core', why: 'w' },
      { id: 'b', surface: 'cli-script', keys: ['bin'], class: 'extension', why: 'w' }],
  };
  assert.throws(() => buildCensus({ inventory: inv([feat()]), charter: bad, now: 'T' }),
    /claims cli-script\/bin twice/);
});

test('a surface and key the charter does not name comes out unclassified, never core', () => {
  const c = buildCensus({
    inventory: inv([feat({ id: 'cli-script:zzz/x.mjs', name: 'zzz/x.mjs' })]),
    charter: { charterVersion: 'x', censusPopulation: ['cli-script'], membershipTests: {}, groups: [] },
    now: 'T',
  });
  assert.equal(c.rows[0].class, 'unclassified');
  assert.equal(c.rows[0].declaredClass, null);
});

test('UNMEASURED coverage is not a fragment', () => {
  assert.equal(fragmentReason(feat({ coverageMeasured: false, tests: [], docs: [] })), null,
    'a surface with no probe has not been measured, so it cannot have failed');
  assert.equal(documented(feat({ coverageMeasured: false, docs: [] })), null);
  assert.match(fragmentReason(feat({ coverageMeasured: true, tests: [] })), /no test/);
});

test('a missing DOC never produces a fragment verdict on its own', () => {
  // The rule it would otherwise fire on is true of ~half of two surfaces because this repository has
  // no per-route reference by design. Recorded as a field, never as a class.
  assert.equal(fragmentReason(feat({ docs: [] })), null);
  assert.equal(documented(feat({ docs: [] })), false);
  assert.equal(documented(feat({ docs: ['README.md'] })), true);
});

test('a script tested only through its -core sibling says exactly that', () => {
  const why = fragmentReason(feat({ tests: [], coreSibling: 'bin/x-core.mjs', coreSiblingTests: ['bin/test/x.test.mjs'] }));
  assert.match(why, /tested through bin\/x-core\.mjs/);
  assert.match(why, /nothing tests the entry point itself/);
});

test('orphan reads one named wiring field per surface, and nothing else', () => {
  assert.match(orphanReason({ surface: 'http-route', wired: false }), /MODULAR_ROUTES/);
  assert.equal(orphanReason({ surface: 'http-route', wired: true }), null);
  assert.match(orphanReason({ surface: 'ui-view', uiReachable: false }), /rail link/);
  assert.match(orphanReason({ surface: 'mcp-tool', hasHandler: false }), /no handler/);
  assert.match(orphanReason({ surface: 'cli-script', entryKind: 'guard', referencedFrom: [] }), /names it/);
  assert.equal(orphanReason({ surface: 'cli-script', entryKind: 'shebang', referencedFrom: [] }), null,
    'a shebang IS an entry point — a human runs it');
  assert.equal(orphanReason({ surface: 'cli-command', name: 'run' }), null, 'a dispatch entry is wired by definition');
});

test('orphan outranks fragment, and both keep the would-be class on the row', () => {
  const c = buildCensus({
    inventory: inv([{ id: 'http-route:GET /api/cra/x', surface: 'http-route', name: 'GET /api/cra/x',
      file: 'admin/routes/cra.mjs', line: 9, wired: false, tests: [], docs: [], coverageMeasured: true }]),
    charter: CHARTER, now: 'T',
  });
  assert.equal(c.rows[0].class, 'orphan', 'an unwired route is an orphan even though it also has no test');
  assert.equal(c.rows[0].declaredClass, 'extension', 'the charter class it WOULD be is kept');
});

test('the grouping key is derived the same way for every rater', () => {
  assert.equal(groupKey({ surface: 'http-route', name: 'GET /api/perf/preview' }), 'perf');
  assert.equal(groupKey({ surface: 'http-route', name: 'GET /launchlist/' }), 'launchlist');
  assert.equal(groupKey({ surface: 'cli-script', name: 'monitor/sweep.mjs' }), 'monitor');
  assert.equal(groupKey({ surface: 'ui-view', name: 'codeql', navGroup: 'static' }), 'static');
  assert.equal(groupKey({ surface: 'ui-view', name: 'settings', navGroup: null }), 'chrome');
});

test('config-flag is inventoried but not censused, and its gap is still counted', () => {
  const c = buildCensus({
    inventory: inv([feat(), { id: 'config-flag:CW_X', surface: 'config-flag', name: 'CW_X', readSites: 0, docs: [], tests: [], coverageMeasured: true }]),
    charter: CHARTER, now: 'T',
  });
  assert.equal(c.rows.filter((r) => r.surface === 'config-flag').length, 0, 'flags are not census rows');
  assert.equal(c.notCensused['config-flag'].total, 1);
  assert.equal(c.notCensused['config-flag'].readOnlyFromTests, 1, 'excluding it from the class map must not hide it');
});

test('a malformed input is refused — it is never an empty census', () => {
  assert.throws(() => buildCensus({ inventory: {}, charter: CHARTER, now: 'T' }), /no features array/);
  assert.throws(() => buildCensus({ inventory: inv([]), charter: {}, now: 'T' }), /no groups array/);
});

test('the charter path is read at CALL time', () => {
  const prev = process.env.CW_FC_CHARTER;
  process.env.CW_FC_CHARTER = '/tmp/does-not-exist-charter.json';
  try { assert.equal(charterPath(), resolve('/tmp/does-not-exist-charter.json')); }
  finally { if (prev === undefined) delete process.env.CW_FC_CHARTER; else process.env.CW_FC_CHARTER = prev; }
});
