// edition-lineage-complete — every version the registry has ever declared has a lineage entry.
//
// Raised on 2026-09-11 and verified here: the registry declares version 16 and
// monitor/taxonomy-editions.json stops at 15. Measuring it found a second hole nobody had reported —
// version 11 is absent too, and has been for long enough that nothing noticed.
//
// WHY THE EXISTING GUARD DOES NOT CATCH THIS, which is the whole point of adding another one.
// bin/test/taxonomy-web.test.mjs reconciles the lineage thoroughly — seven tests over class
// accounting: a class no edition claims is UNATTRIBUTED, a class claimed twice is an error, a
// declared countAfter that disagrees with the ids beneath it is an error. All of them ask *are the
// CLASSES accounted for*. None asks *are the VERSIONS accounted for*, and the two questions come
// apart precisely here: edition 15's countAfter is 199 and the registry holds 199 classes, so class
// accounting is perfectly satisfied while two version numbers have no entry at all. The renderer
// then prints "v16" against a history that ends at 15.
//
// A version bump with no entry is not cosmetic. The lineage is the only record of WHAT CHANGED
// between two states of the register, and an edition that was never authored cannot be written later
// from anything but memory — the diff it described is already folded into the next one.
//
// THIS IS A RATCHET, NOT A REPAIR. The two existing holes are declared below with the reason they
// cannot be closed here: writing an edition entry means authoring a headline and a body describing a
// delta, which is a curator's act and not a test's. What this refuses is a THIRD hole.
//
// Env, read at CALL time: CW_REPO, CW_TAXONOMY_JSON, CW_EDITIONS_JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = () => process.env.CW_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registryPath = () => process.env.CW_TAXONOMY_JSON || resolve(REPO(), 'monitor', 'failure-taxonomy.json');
const editionsPath = () => process.env.CW_EDITIONS_JSON || resolve(REPO(), 'monitor', 'taxonomy-editions.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * Versions declared by the lineage, ascending. The field is `version`; `edition` is accepted because
 * two entries used it before the schema settled, and reading only one name would silently drop them.
 */
export const declaredVersions = (lineage) =>
  (lineage.editions || []).map((e) => e.version ?? e.edition).filter((v) => Number.isInteger(v)).sort((a, b) => a - b);

/** Versions between the lineage's floor and `upTo` that no entry claims. */
export function unaccountedVersions(lineage, upTo) {
  const vs = declaredVersions(lineage);
  if (!vs.length) return [];
  const out = [];
  for (let v = vs[0]; v <= upTo; v++) if (!vs.includes(v)) out.push(v);
  return out;
}

/**
 * The holes that exist today, each with why it cannot be closed by this test.
 *
 * An entry here is permission for a gap that is already in the record, never for a new one. Writing
 * the missing entries needs someone who can say what changed and is willing to sign the sentence;
 * inventing a headline and body for a delta already absorbed into a later edition would put a
 * fabricated history in the one file whose job is to be the history.
 */
export const DECLARED_GAPS = Object.freeze({
  11: 'Absent since before 2026-09-06 and not reported by anyone until this guard measured it. '
    + 'Its delta is already folded into edition 12, so the entry cannot now be reconstructed from '
    + 'anything but memory. Needs a curator to decide whether to author it from the commit range or '
    + 'to record the hole deliberately.',
});

test('declaredVersions reads both field names and sorts', () => {
  assert.deepEqual(declaredVersions({ editions: [{ version: 3 }, { edition: 1 }, { version: 2 }] }), [1, 2, 3]);
});

test('a lineage with no hole reports none', () => {
  assert.deepEqual(unaccountedVersions({ editions: [{ version: 1 }, { version: 2 }, { version: 3 }] }, 3), []);
});

test('a hole in the middle and a hole at the top are both found', () => {
  assert.deepEqual(unaccountedVersions({ editions: [{ version: 1 }, { version: 3 }] }, 5), [2, 4, 5]);
});

test('NEGATIVE: the allowlist is not a blanket — an undeclared hole is still reported', () => {
  const lineage = { editions: [{ version: 10 }, { version: 12 }] };
  const holes = unaccountedVersions(lineage, 13).filter((v) => !(v in DECLARED_GAPS));
  assert.deepEqual(holes, [13], 'declaring 11 must not excuse 13');
});

test('every declared gap carries a reason a reader could act on', () => {
  const entries = Object.entries(DECLARED_GAPS);
  assert.ok(entries.length > 0, 'no gaps declared — this test would pass over an empty allowlist');
  for (const [v, why] of entries) {
    assert.ok(why.split(/\s+/).length >= 15, `edition ${v}: a one-line exemption is not a reason`);
  }
});

test('THE RATCHET: no version the registry has declared is unaccounted for, beyond the known holes', () => {
  const registry = read(registryPath());
  const lineage = read(editionsPath());
  assert.ok(Number.isInteger(registry.version), 'the registry declares no integer version');
  assert.ok(declaredVersions(lineage).length > 5, 'lineage read produced almost nothing — the guard is blind');

  const holes = unaccountedVersions(lineage, registry.version);
  const undeclared = holes.filter((v) => !(v in DECLARED_GAPS));
  assert.deepEqual(undeclared, [],
    `version(s) ${undeclared.join(', ')} have no lineage entry. The registry says it is at v${registry.version} `
    + `and monitor/taxonomy-editions.json accounts for ${declaredVersions(lineage).join(', ')}. `
    + 'Class accounting cannot see this: bin/test/taxonomy-web.test.mjs checks that every CLASS is '
    + 'claimed by some edition, which stays satisfied while a version number has no entry at all. '
    + 'Author the edition entry, or add it to DECLARED_GAPS with the reason it cannot be written.');
});

test('a gap that has since been filled must be dropped from the allowlist', () => {
  // fact: an exemption outliving its reason is standing permission for the next one (expiry: never)
  const lineage = read(editionsPath());
  const vs = declaredVersions(lineage);
  const stale = Object.keys(DECLARED_GAPS).map(Number).filter((v) => vs.includes(v));
  assert.deepEqual(stale, [],
    `edition(s) ${stale.join(', ')} now exist in the lineage and are still listed as declared gaps — `
    + 'drop them rather than leaving permission lying around.');
});
