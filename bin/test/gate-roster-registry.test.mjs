// The gate population is declared TWICE by necessity, and the two declarations answer different
// questions about the same list: bin/lib/verdict-journal-core.mjs holds GATE_ROSTER — what journalHealth()
// enumerates, so a gate that has never written renders ABSENT instead of not being listed — and
// bin/adjudication-sampler.mjs holds GATE_REGISTRY, what each gate's verdicts MEAN, so no stratum
// can go missing from a denominator. Two declarations of one fact is this repo's named failure
// mode, and this pair had already drifted: `liveness` sat in the registry and not the roster, so
// the gate whose entire job is detecting silence was the one gate journalHealth() could never
// report silent.
//
// These assertions read the EXPORTED CONSTANTS, not the source text. A source-extracting test binds
// a spelling; importing binds the value, so a gate added under a different formatting style, a
// computed key, or a spread still lands inside the comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_ROSTER } from '../lib/verdict-journal-core.mjs';
import { GATE_REGISTRY } from '../adjudication-sampler.mjs';

// A legitimate asymmetry must be DECLARED here, with a reason, and never silently tolerated: an
// undocumented difference between these two lists is indistinguishable from the drift this file
// exists to catch. Both maps are empty today, and the set equality below closes only because they
// are. Key is the gate name; value is why that gate belongs to one declaration and not the other.
const ROSTER_ONLY = {      // health-tracked, but has no verdict vocabulary to classify
  'scan-config': 'records a consent TRANSITION — which lanes the operator enabled and which binaries '
    + 'they approved this box to execute. There is no clean/alarm axis to sample: approving a scanner '
    + 'is not a fault and refusing one is not a finding, so any vocabulary invented for it would put '
    + 'the operator\'s own choices into a stratum that counts faults.',
};
const REGISTRY_ONLY = {};  // verdicts classified, but its silence is deliberately not watched

test('GATE_ROSTER and GATE_REGISTRY name the same set of gates', () => {
  const roster = new Set(GATE_ROSTER.map((g) => g.gate));
  const registry = new Set(Object.keys(GATE_REGISTRY));

  // Non-degenerate guard: an import that resolved to an empty or near-empty list would make every
  // assertion below pass while proving nothing, which is the failure the extraction guard in
  // admin/test/panel-view-paths.test.mjs was added for.
  assert.ok(roster.size >= 6, `GATE_ROSTER extraction degenerated (${roster.size} gates) — the equality below would pass vacuously`);
  assert.ok(registry.size >= 6, `GATE_REGISTRY extraction degenerated (${registry.size} gates) — the equality below would pass vacuously`);
  assert.equal(roster.size, GATE_ROSTER.length, 'GATE_ROSTER lists a gate twice — a duplicate collapses in a Set and can mask a missing gate');

  const rosterOnly = [...roster].filter((g) => !registry.has(g) && !(g in ROSTER_ONLY)).sort();
  const registryOnly = [...registry].filter((g) => !roster.has(g) && !(g in REGISTRY_ONLY)).sort();

  assert.deepEqual(rosterOnly, [],
    `on GATE_ROSTER but not GATE_REGISTRY: ${rosterOnly.join(', ')} — its verdicts land in the 'unclassified' stratum and corrupt the denominators the sampler exists to fix. Add it to GATE_REGISTRY, or declare it in ROSTER_ONLY with a reason.`);
  assert.deepEqual(registryOnly, [],
    `in GATE_REGISTRY but not on GATE_ROSTER: ${registryOnly.join(', ')} — journalHealth() cannot report it silent, so the gate could stop writing and no health row would turn grey. Add it to GATE_ROSTER, or declare it in REGISTRY_ONLY with a reason.`);
});

test('liveness is on the roster — the deadman is not exempt from the deadman', () => {
  // Named separately from the set equality above because this is the specific drift that happened:
  // the roster carried six gates while the registry carried seven, for the whole time liveness was
  // journalling. A future edit that removes liveness from BOTH declarations would
  // satisfy set equality and re-open exactly this hole, so the membership is pinned by name.
  const entry = GATE_ROSTER.find((g) => g.gate === 'liveness');
  assert.ok(entry, 'liveness left GATE_ROSTER — the gate that reports every other gate\'s silence would again be the one gate whose own silence is invisible');
  assert.equal(entry.baseline, null, 'liveness gained a baseline path — it compares nothing to a floor, and a baseline would arm stale-baseline-moved against an artifact that does not exist');
});

test('a declared asymmetry carries a reason — an empty exemption is a silent one', () => {
  for (const [gate, why] of [...Object.entries(ROSTER_ONLY), ...Object.entries(REGISTRY_ONLY)]) {
    assert.equal(typeof why, 'string', `${gate} is exempted from the set equality without a reason`);
    assert.ok(why.length > 20, `${gate}'s exemption reason is too short to be one — say what makes the asymmetry legitimate`);
  }
});

test('every roster entry declares a baseline explicitly, null included', () => {
  // `baseline: null` is a claim ("this gate compares nothing to a floor"), not an omission.
  // A missing key reads as undefined, which journalHealth() treats identically to null — so the
  // absence of the field would silently pass while losing the statement the field is there to make.
  for (const g of GATE_ROSTER) {
    assert.ok(Object.prototype.hasOwnProperty.call(g, 'baseline'), `${g.gate} omits baseline — declare it null rather than leaving it undefined`);
    assert.ok(g.baseline === null || typeof g.baseline === 'string', `${g.gate} baseline is neither a path nor null`);
  }
});
