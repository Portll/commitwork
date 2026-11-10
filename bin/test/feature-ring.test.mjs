// feat.ring — "ring-outward features gated and labelled experimental", held as a property of the
// three places that have to agree: the charter (which class), the code (which gate runs), and the
// census (which number gets reported).
//
// WHY A THIRD WITNESS WAS NEEDED. The charter already refuses a flag on a non-ring group and a group
// naming an undeclared flag (lib/feature-charter.mjs), and the panel already hides and labels a
// flagged view (admin/static/features.js). Both were true while the census filed `feed`, `inbox` and
// `journey` as CORE: their charter groups did not exist, so each view was classed by the nav section
// it sits in, and the route dispatcher was answering 404 for a feature the census called core. Every
// local check passed; the two sources simply never compared answers. feat.ring is ticked off the
// census, so the disagreement read as "nothing left to gate".
//
// THE DIRECTIONS ARE ASSERTED SEPARATELY, because only one of them lies to you. A flag declared and
// enforced nowhere renders a switch in Settings that does nothing — that is the direction that reads
// clean. A flag enforced in code and undeclared throws at the call, which is noisy and self-
// reporting. Both are checked; they do not share a failure mode.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../feature-inventory.mjs';
import { buildCensus } from '../feature-census.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHARTER = JSON.parse(readFileSync(join(ROOT, 'manifests', 'feature-charter.json'), 'utf8'));
const FLAGS = CHARTER.experimentalFlags;

// Directories whose code can hold a runtime gate. A gate outside these is still found by the
// census's own enforcement map; this walk is about the CALL SITES, which is the fact the charter
// cannot see.
const GATE_DIRS = ['admin/routes', 'admin', 'bin', 'monitor', 'mcp', 'lib'];
const GATE_CALL = /(?:gateFeature|featureEnabled)\(\s*'([a-z0-9][a-z0-9-]*)'/g;

/** Every (flag, file) pair where code asks whether a flag is on. Tests and the resolver itself are
 *  excluded: a call inside lib/feature-flags.mjs is the mechanism, not a use of it. */
function gateCallSites(root = ROOT) {
  const out = new Map();
  const skip = (p) => /(^|\/)(test|node_modules|\.git)(\/|$)/.test(p) || p.endsWith('lib/feature-flags.mjs') || p.endsWith('lib/feature-charter.mjs');
  const walk = (rel, depth) => {
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (skip(p)) continue;
      if (e.isDirectory()) { if (depth > 0) walk(p, depth - 1); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      const src = readFileSync(join(root, p), 'utf8');
      let m;
      GATE_CALL.lastIndex = 0;
      while ((m = GATE_CALL.exec(src))) {
        if (!out.has(m[1])) out.set(m[1], new Set());
        out.get(m[1]).add(p);
      }
    }
  };
  for (const d of GATE_DIRS) walk(d, 2);
  return out;
}

let inventory;
let census;
let sites;
before(() => {
  inventory = buildInventory({ root: ROOT, now: 'T' });
  census = buildCensus({ inventory, charter: CHARTER, now: 'T' });
  sites = gateCallSites(ROOT);
});

describe('feat.ring — the charter half', () => {
  test('every ring-outward group is experimental and carries a declared flag', () => {
    const bad = CHARTER.groups.filter((g) => g.class === 'ring-outward')
      .filter((g) => g.experimental !== true || !g.flag || !FLAGS[g.flag])
      .map((g) => g.id);
    assert.deepEqual(bad, [], 'a ring-outward group with no switch is a speculative feature nobody can turn off');
  });

  test('every flagged group is ring-outward — a flag is not a way to soften a core feature', () => {
    const bad = CHARTER.groups.filter((g) => g.flag && g.class !== 'ring-outward').map((g) => `${g.id}:${g.class}`);
    assert.deepEqual(bad, []);
  });
});

describe('feat.ring — the code half, both directions', () => {
  test('every flag a gate asks about is declared in the charter', () => {
    const undeclared = [...sites].filter(([id]) => !FLAGS[id]).map(([id, f]) => `${id} (${[...f].join(', ')})`);
    assert.deepEqual(undeclared, [], 'a gate on an id the charter does not declare throws at the call');
  });

  test('every declared flag reaches at least one enforcement point', () => {
    const grouped = new Set(CHARTER.groups.filter((g) => g.flag).map((g) => g.flag));
    const viewed = new Set(Object.entries(FLAGS).filter(([, f]) => (f.views || []).length).map(([id]) => id));
    const inert = Object.keys(FLAGS).filter((id) => !grouped.has(id) && !viewed.has(id) && !sites.has(id));
    assert.deepEqual(inert, [],
      'a declared flag no group covers, no view names and no gate asks about draws a switch in Settings that changes nothing');
  });

  test('POSITIVE CONTROL: the call-site walk finds a real gate and rejects a fabricated id', () => {
    assert.ok(sites.has('feed'), 'the walk missed admin/routes/feed.mjs — it is reading nothing');
    assert.ok(sites.has('palette') && sites.has('pull-request'), 'the walk missed a known code-only gate');
    assert.ok(!sites.has('no-such-flag-xyz'), 'the walk invented a call site');
    // The walk must not be satisfied by the resolver's own source, where both names are defined.
    for (const files of sites.values()) {
      for (const f of files) assert.ok(!f.endsWith('lib/feature-flags.mjs'), 'the walk counted the resolver as a caller');
    }
  });
});

describe('feat.ring — the census half: no feature is core in one place and experimental in another', () => {
  // A gated route the census classes core. `POST /api/issue/pr` is the one standing instance: the
  // census keys an http-route row on routeKey(), which coarsens /api/issue/pr to `issue` — a key
  // http.remediation (core) already claims, and route paths are not this charter's key space to
  // re-cut. Listed, not waived: the assertion below is exact, so a second instance fails.
  const KNOWN_DISAGREEMENT = ['http-route POST /api/issue/pr [pull-request] admin/routes/pull-request.mjs'];

  test('a row a flag covers is never core or extension', () => {
    const bad = census.rows.filter((r) => r.flag && ['core', 'extension'].includes(r.class))
      .map((r) => `${r.surface} ${r.name} [${r.flag}]`);
    assert.deepEqual(bad, []);
  });

  test('a row served by a gated module is never core or extension, beyond the listed instance', () => {
    const byFile = new Map();
    for (const [flag, files] of sites) for (const f of files) byFile.set(f, flag);
    const bad = census.rows
      .filter((r) => r.location && ['core', 'extension'].includes(r.class))
      .map((r) => ({ r, file: r.location.split(':')[0] }))
      .filter((x) => byFile.has(x.file))
      .map((x) => `${x.r.surface} ${x.r.name} [${byFile.get(x.file)}] ${x.file}`)
      .sort();
    assert.deepEqual(bad, KNOWN_DISAGREEMENT,
      'a feature the code gates on an experimental flag is being counted as core — the census and the dispatcher disagree');
  });

  test('every panel view a flag owns is censused ring-outward, so the panel label and the count agree', () => {
    const owned = new Set();
    for (const g of CHARTER.groups) for (const v of g.views || []) owned.add(v);
    for (const f of Object.values(FLAGS)) for (const v of f.views || []) owned.add(v);
    assert.ok(owned.size >= 4, `only ${owned.size} views are flag-owned; the charter may have lost its views lists`);
    const wrong = census.rows.filter((r) => r.surface === 'ui-view' && owned.has(r.name) && r.class !== 'ring-outward')
      .map((r) => `${r.name}:${r.class}`);
    assert.deepEqual(wrong, [], 'the panel labels this view experimental and the census does not');
  });

  test('POSITIVE CONTROL: dropping a views list puts the view back in its nav section', () => {
    const charter = JSON.parse(JSON.stringify(CHARTER));
    const g = charter.groups.find((x) => x.id === 'http.feed');
    assert.ok(g && (g.views || []).includes('feed'), 'the fixture premise is gone');
    delete g.views;
    const c = buildCensus({ inventory, charter, now: 'T' });
    const row = c.rows.find((r) => r.surface === 'ui-view' && r.name === 'feed');
    assert.equal(row.class, 'core', 'without the views declaration the view is NOT filed by its nav section, so this guard proves nothing');
    assert.equal(census.rows.find((r) => r.surface === 'ui-view' && r.name === 'feed').class, 'ring-outward');
  });
});

test('a flag that enforces nothing says WHICH surface it cannot reach, rather than reporting nothing', () => {
  // `flow`, `map`, `sitemap` and the other cli-script groups have no runtime gate at all — a script
  // is invoked directly and no dispatcher sees it. The census is right to report `enforcedBy: []`
  // there; what it must never do is report an empty enforcement list with no reason beside it,
  // which reads identically to a flag whose gates nobody has written yet.
  for (const f of census.experimentalFlags) {
    assert.ok(Array.isArray(f.enforcedBy), `${f.id} has no enforcedBy field`);
    assert.ok(Array.isArray(f.unenforcedSurfaces), `${f.id} has no unenforcedSurfaces field`);
    assert.ok(f.enforcedBy.length || f.unenforcedSurfaces.length,
      `${f.id} enforces nothing and names no unenforced surface — its state is unreported, not clean`);
  }
  const scripts = census.experimentalFlags.filter((f) => f.unenforcedSurfaces.includes('cli-script'));
  assert.ok(scripts.length > 0, 'no flag reports an unenforced surface; the field may have stopped being filled');
});
