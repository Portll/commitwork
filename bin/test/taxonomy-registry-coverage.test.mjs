// taxonomy-registry-coverage.test.mjs — every class documented in a taxonomy markdown table exists
// in monitor/failure-taxonomy.json.
//
// THE DRIFT THIS EXISTS FOR: on 2026-08-23 the registry carried C1-C12 while
// FALSE-CLEAN-TAXONOMY.md's table carried C1-C17. Five classes were documented, cited and reasoned
// about while absent from the machine-readable copy every consumer reads — bin/taxonomy-db.mjs,
// bin/taxonomy-web.mjs, bin/pattern-scan.mjs. Nothing compared the two, so the gap was invisible
// until someone counted by hand.
//
// THE DIRECTION IS DELIBERATE AND ASYMMETRIC. Documented-but-unregistered FAILS: the markdown tables
// are where classes are authored, so a class in a table and not in the registry is the registry
// lagging its source. Registered-but-undocumented only REPORTS: families land in the registry first
// while their prose is still being written, and failing on that would block the expansion this guard
// is meant to protect. At the time of writing D7 and K9 are in that state, legitimately.
//
// Env (read at call time, house rule): CW_TAXONOMY_JSON, CW_TAXONOMY_DOCS_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const docsDir = () => process.env.CW_TAXONOMY_DOCS_DIR || join(REPO, 'monitor');
const jsonPath = () => process.env.CW_TAXONOMY_JSON || join(REPO, 'monitor', 'failure-taxonomy.json');

const DOCS = [
  'FALSE-CLEAN-TAXONOMY.md',
  'FAILURE-TAXONOMY.md',
  'FAILURE-TAXONOMY-v2.md',
  'FAILURE-TAXONOMY-v3.md',
];

// A class id in the leading cell of a table row, bold or bare. Anchored to `^|` so an id mentioned
// in prose does not count — prose lags the tables routinely and is not the authoring surface.
const ROW_ID = /^\|\s*\*{0,2}([A-Z]{1,2}\d+)\*{0,2}\s*\|/gm;

/** Class ids from one markdown doc's tables. */
function idsIn(name) {
  const raw = readFileSync(join(docsDir(), name), 'utf8');
  return new Set([...raw.matchAll(ROW_ID)].map((m) => m[1]));
}

function registryIds() {
  const parsed = JSON.parse(readFileSync(jsonPath(), 'utf8'));
  assert.ok(Array.isArray(parsed.classes), 'registry has no classes[] — shape moved, fix this test');
  return new Set(parsed.classes.map((c) => c.id));
}

// Vacuity guard, per doc rather than a pinned total. A count pins to a number that goes stale within
// the week; "this document still yields ids" catches the failure that actually matters — a table
// reformatted past the regex, which would turn the whole assertion below into a silent pass over an
// empty set. Derived from the artifact, never restated.
test('every taxonomy doc still yields class ids — no doc silently drops out of coverage', () => {
  for (const name of DOCS) {
    const ids = idsIn(name);
    assert.ok(ids.size > 0,
      `${name} yielded 0 class ids. Either its tables were reformatted past ROW_ID, or the file `
      + 'moved. Both make the coverage assertion vacuous, which is the state this guard refuses.');
  }
});

test('every DOCUMENTED class id is present in the registry', () => {
  const reg = registryIds();
  const documented = new Map();               // id -> the doc that authored it
  for (const name of DOCS) for (const id of idsIn(name)) if (!documented.has(id)) documented.set(id, name);

  assert.ok(documented.size > 0, 'no documented ids found at all — see the vacuity guard above');

  const missing = [...documented].filter(([id]) => !reg.has(id));
  assert.deepEqual(missing.map(([id]) => id), [],
    'documented in a markdown table but ABSENT from monitor/failure-taxonomy.json:\n'
    + missing.map(([id, doc]) => `  ${id}  (${doc})`).join('\n')
    + '\n\nEvery consumer of the registry — taxonomy-db, taxonomy-web, pattern-scan — cannot see '
    + 'these. Add them to the registry rather than deleting them from the doc.');
});

// A STORED COUNT GOES STALE SILENTLY, AND THIS ONE DID. monitor/taxonomy-substrates.json carries a
// mapVerifiedAgainst block asserting how much of the registry the substrate map covers. On
// 2026-08-29 it still read registryClasses:159, mapped:159, unmapped:0 while the registry had grown
// to 173 and the map held 159 — a completeness claim that was false, in the file whose whole subject
// is which evidence decides a class. Its own note said "re-derived, never restated"; nothing re-derived it.
test('the substrate map\'s coverage claim matches what the map and registry actually hold', () => {
  const mapPath = process.env.CW_TAXONOMY_SUBSTRATES || join(docsDir(), 'taxonomy-substrates.json');
  let subs;
  try { subs = JSON.parse(readFileSync(mapPath, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }   // only genuine absence is a skip

  const claim = subs.mapVerifiedAgainst;
  assert.ok(claim && typeof claim === 'object', 'taxonomy-substrates.json carries no mapVerifiedAgainst block');

  const reg = registryIds();
  const mapped = new Set(Object.keys(subs.map || {}));
  const derived = {
    registryClasses: reg.size,
    mapped: [...mapped].filter((id) => reg.has(id)).length,
    unmapped: [...reg].filter((id) => !mapped.has(id)).length,
  };
  for (const [k, v] of Object.entries(derived)) {
    assert.equal(claim[k], v,
      `mapVerifiedAgainst.${k} says ${claim[k]}; the files say ${v}. Re-derive the block rather than `
      + 'editing the number — a stored count that nobody recomputes is the defect this file catalogues.');
  }
});

// Not an assertion. The reverse direction is a legitimate in-flight state, but an unreported one is
// how a family stays undocumented for months, so it is named on every run rather than left to a
// hand count.
test('registered-but-undocumented classes are disclosed, not failed', () => {
  const reg = registryIds();
  const documented = new Set(DOCS.flatMap((name) => [...idsIn(name)]));
  const undocumented = [...reg].filter((id) => !documented.has(id));
  if (undocumented.length) {
    console.log(`  note: ${undocumented.length} class(es) in the registry with no markdown table `
      + `row yet — ${undocumented.join(', ')}`);
  }
  assert.ok(reg.size >= documented.size,
    'the registry holds FEWER ids than the docs, which the previous test should already have caught '
    + '— if this fires alone, ROW_ID is matching something that is not a class id');
});
