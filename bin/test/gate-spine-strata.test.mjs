// gate-spine's verdicts and the sampler's strata must not drift apart.
//
// They had. The registry keyed on `block` with `clean:[false]`, and all four of assess()'s GREY
// verdicts fail open — so they carry block:false and landed in `clean`. 110 of 993 records, 11% of
// the journal, were scored as passes by the instrument whose denominators exist to prevent that.
// The grey flag was computed and dropped one hop before the only consumer that could act on it.
//
// TWO WITNESSES, because a single one here would share the defect's failure mode. Driving assess()
// tells you what it DOES; reading its source tells you what it DECLARES. A test built only on the
// driver silently stops covering a branch whose inputs it can no longer construct, and reports
// green for the branches it still reaches — which is how a subset came to be read as the whole.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assess } from '../gate-spine-core.mjs';
import { classifyRecord, GATE_REGISTRY } from '../adjudication-sampler.mjs';

const CORE = fileURLToPath(new URL('../gate-spine-core.mjs', import.meta.url));

// WITNESS A — behaviour. One input per branch; each names the branch it is aiming at, so a drifted
// input shows up as a missing verdict rather than as a silently unreached branch.
const DRIVERS = {
  'sensor-absent': { edits: 10, ledgerPresent: false },
  'below-threshold': { edits: 1, minEdits: 5 },
  'spine-ledger-unreadable': { edits: 10, spineLedgerCorrupt: true },
  'spine-ledger-absent': { edits: 10, spineLedgerPresent: false },
  'store-unreadable': { edits: 10, tasks: null, spineRecords: [] },
  'no-spine-record': { edits: 10, tasks: [], spineRecords: [] },
  // NOWHERE TO FILE: same zero records as above, but overwatch-layer is unreachable fleet-wide. The two
  // differ only by that witness, which is the whole point of the branch.
  'overwatch-unreachable': { edits: 10, tasks: [], spineRecords: [], overwatchReachable: false },
  'decoy-suspected': {
    edits: 10,
    spineRecords: [{ task: 't1', at: '2026-01-02T00:00:00Z' }],
    tasks: [{ id: 't1', status: 'pending' }],
    history: [{ block: true, at: '2026-01-01T00:00:00Z' }],
  },
  'satisfied': {
    edits: 10,
    spineRecords: [{ task: 't1', at: '2026-01-02T00:00:00Z' }],
    tasks: [{ id: 't1', status: 'done' }],
  },
};

const driven = new Map();
for (const [aimedAt, input] of Object.entries(DRIVERS)) {
  const v = assess(input);
  driven.set(v.reason, { grey: v.grey === true, block: v.block, aimedAt });
}

// WITNESS B — declaration. Independent of the driver and unable to share its failure mode: it reads
// the source, so a branch the driver can no longer reach still appears here.
const declared = new Set(
  [...readFileSync(CORE, 'utf8').matchAll(/verdict\(\s*(?:true|false)\s*,\s*'([a-z-]+)'/g)].map((m) => m[1]),
);

describe('gate-spine verdicts vs sampler strata', () => {
  test('the two witnesses agree on which verdicts exist — in both directions', () => {
    const unreached = [...declared].filter((r) => !driven.has(r));
    const undeclared = [...driven.keys()].filter((r) => !declared.has(r));
    assert.deepEqual(unreached, [],
      'assess() declares these verdicts and no driver reaches them — this file is scoring a subset');
    assert.deepEqual(undeclared, [],
      'a driver produced a verdict the source does not declare — the extractor drifted, not the code');
    // Floor: if both witnesses degenerate together the equality above holds vacuously.
    assert.ok(declared.size >= 8, `verdict extraction degenerated (${declared.size} found)`);
  });

  test('every verdict is classified — none falls to `unclassified`', () => {
    const bad = [...driven.keys()]
      .map((v) => ({ v, s: classifyRecord('gate-spine', { verdict: v }).stratum }))
      .filter(({ s }) => s === 'unclassified');
    assert.deepEqual(bad.map(({ v }) => v), [],
      'an unclassified verdict is invisible to every denominator the sampler computes');
  });

  test('every GREY verdict is `neither` — not clean, and not alarm either', () => {
    const grey = [...driven].filter(([, d]) => d.grey).map(([v]) => v);
    assert.ok(grey.length >= 4, `expected assess()'s blind-sensor family, found ${grey.length}`);
    const misfiled = grey
      .map((v) => ({ v, s: classifyRecord('gate-spine', { verdict: v }).stratum }))
      .filter(({ s }) => s !== 'neither');
    assert.deepEqual(misfiled, [],
      'a grey verdict outside `neither` is the house rule breached inside the enforcement subsystem: '
      + 'in `clean` it publishes an unknown as a pass, in `alarm` as a finding');
  });

  test('non-grey verdicts follow `block` — blocking is alarm, non-blocking is clean', () => {
    const wrong = [...driven]
      .filter(([, d]) => !d.grey)
      .map(([v, d]) => ({ v, want: d.block ? 'alarm' : 'clean', got: classifyRecord('gate-spine', { verdict: v }).stratum }))
      .filter(({ want, got }) => want !== got);
    assert.deepEqual(wrong, []);
  });

  test('the registry lists no verdict assess() cannot produce', () => {
    const spec = GATE_REGISTRY['gate-spine'];
    const listed = [...spec.clean, ...spec.alarm, ...spec.neither];
    // A RETIRED id is unproducible on purpose: renamed, no longer written, still classified because
    // stored records carry it. Exempting it keeps this guard pointed at what it was built for — a
    // stratum that is dead by accident — rather than firing on one that is dead by declaration.
    const retired = new Set(spec.retired || []);
    const phantom = listed.filter((v) => !declared.has(v) && !retired.has(v));
    assert.deepEqual(phantom, [],
      'the registry classifies a verdict that no longer exists — dead strata read as coverage');
  });

  // The exemption must not become a way to hide a genuinely dead stratum, so it is bounded in both
  // directions: a retired id must still CLASSIFY (that is its whole purpose), and it must not be
  // producible (or it is not retired at all, and the rename never happened).
  test('a retired verdict still classifies, and is genuinely no longer emitted', () => {
    const spec = GATE_REGISTRY['gate-spine'];
    for (const id of spec.retired || []) {
      assert.equal(classifyRecord('gate-spine', { verdict: id }).stratum, 'neither',
        `${id} is retired but no longer classifies — stored records carrying it would fall into the `
        + 'unclassified remainder, which is exactly the silent reclassification this list prevents');
      assert.equal(declared.has(id), false,
        `${id} is listed as retired but assess() still produces it — retire the writer or drop it `
        + 'from the list; a live verdict hiding behind the exemption defeats the phantom guard');
    }
  });
});

// The reader for the `grey` flag gate-spine journals. Without one the flag is inert: an independent
// witness confirmed that deleting it left every gate-spine and sampler test green.
describe('the grey flag is cross-checked against the stratum', () => {
  test('a record claiming grey that classifies as clean or alarm is flagged as a MISMATCH', () => {
    assert.equal(classifyRecord('gate-spine', { verdict: 'satisfied', grey: true }).greyMismatch, true);
    assert.equal(classifyRecord('gate-spine', { verdict: 'no-spine-record', grey: true }).greyMismatch, true);
    // agreement is silent — the field appears only when the two descriptions disagree
    assert.equal(classifyRecord('gate-spine', { verdict: 'sensor-absent', grey: true }).greyMismatch, undefined);
    assert.equal(classifyRecord('gate-spine', { verdict: 'satisfied' }).greyMismatch, undefined);
  });

  test('every grey verdict assess() can produce agrees with the registry', () => {
    // Drives the real thing rather than a literal list: if a new grey verdict is added to the core
    // and not to `neither`, this fails.
    const bad = [...driven].filter(([, d]) => d.grey)
      .map(([v]) => ({ v, m: classifyRecord('gate-spine', { verdict: v, grey: true }).greyMismatch }))
      .filter(({ m }) => m);
    assert.deepEqual(bad.map(({ v }) => v), []);
  });
});
