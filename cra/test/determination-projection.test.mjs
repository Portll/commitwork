// node --test cra/test/ — the native determination vocabulary and its three projections.
//
// Two test classes carry the weight:
//   1. EXHAUSTIVENESS against schema/vex-vocabulary.json — every value a projection emits must
//      exist upstream, and every native value must have a cell in all three formats. A typo here
//      would otherwise become a silently-invalid document.
//   2. REFUSED NEIGHBOURS — a curated list of tempting-but-wrong substitutions, each asserted NOT
//      to be produced. This is the whole discipline: the nearest-looking enum value usually makes
//      a DIFFERENT FACTUAL CLAIM, and a consumer of a signed document cannot check it.
// Plan: evaluations/PLAN-vex-determination-matrix-2026-08-22.md, phases 2 and 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VOCAB = JSON.parse(readFileSync(join(REPO, 'schema', 'vex-vocabulary.json'), 'utf8'));
const D = await import(pathToFileURL(join(REPO, 'cra', 'determination.mjs')).href);
const P = await import(pathToFileURL(join(REPO, 'cra', 'determination-projection.mjs')).href);

// Every legal value upstream, per format, flattened — the corpus a projection may draw from.
const legal = (fmt) => new Set(Object.values(VOCAB.formats[fmt]).flat());

test('the corpus is the shape bin/vex-vocabulary-sync.mjs promises', () => {
  assert.equal(VOCAB.total, 50, 'the derived corpus changed size — read the upstream diff, do not edit this number');
  assert.equal(VOCAB.formats.cyclonedx.justification.length, 9);
  assert.equal(VOCAB.formats.csaf.status.length, 8);
  assert.equal(VOCAB.formats.openvex.status.length, 4);
});

// ── 1. exhaustiveness ───────────────────────────────────────────────────────────────────────────

test('every native justification value has a cell in ALL three formats', () => {
  const native = [
    ...Object.keys(D.PRESENCE).filter((k) => k !== 'component_present_code_present'),
    ...Object.keys(D.REACHABILITY).filter((k) => k.startsWith('unreachable_')),
    ...Object.keys(D.EXPLOITABILITY).filter((k) => k === 'adversary_cannot_control' || k.startsWith('mitigated_')),
  ];
  assert.ok(native.length >= 10, 'a shrunken axis set would make this vacuous');
  for (const v of native) {
    const row = P.JUSTIFICATION[v];
    assert.ok(row, `no justification projection for native '${v}'`);
    for (const f of P.FORMATS) assert.ok(row[f], `'${v}' has no ${f} cell`);
  }
});

test('every native remediation value has a cell in ALL three formats', () => {
  for (const v of Object.keys(D.REMEDIATION)) {
    const row = P.RESPONSE[v];
    assert.ok(row, `no response projection for native '${v}'`);
    for (const f of P.FORMATS) assert.ok(row[f], `'${v}' has no ${f} cell`);
  }
});

test('every value a projection emits EXISTS in the upstream corpus', () => {
  let checked = 0;
  for (const [name, row] of [...Object.entries(P.JUSTIFICATION), ...Object.entries(P.RESPONSE)]) {
    for (const f of P.FORMATS) {
      const cell = row[f];
      if (!cell || cell.value === null) continue;          // prose_only carries no enum value
      checked++;
      assert.ok(legal(f).has(cell.value),
        `${name} → ${f} emits '${cell.value}', which is NOT in schema/vex-vocabulary.json`);
    }
  }
  assert.ok(checked > 25, `only ${checked} enum cells checked — the matrix shrank`);
});

test('every STATUS a projection emits exists upstream too', () => {
  const shapes = [
    { remediation: 'fixed_verified' },
    { remediation: 'fixed_verified', _tier: 'strong' },
    { remediation: 'under_investigation' },
    { presence: 'component_absent' },
    { remediation: 'will_not_fix_by_choice', presence: 'component_present_code_present', reachability: 'reachable', exploitability: 'exploitable' },
  ];
  for (const s of shapes) {
    const st = P.projectStatus(s, { ledgerTier: s._tier });
    for (const f of P.FORMATS) assert.ok(legal(f).has(st[f].value), `${f} status '${st[f].value}' is not upstream-legal`);
  }
});

// ── 2. refused neighbours — the discipline ──────────────────────────────────────────────────────

test('configuration-scoped unreachability NEVER becomes static unreachability', () => {
  for (const v of ['unreachable_config', 'unreachable_dependency', 'unreachable_environment']) {
    for (const f of ['csaf', 'openvex']) {
      const cell = P.JUSTIFICATION[v][f];
      assert.equal(cell.value, null, `${v} → ${f} must be prose, not an enum value`);
      assert.equal(cell.fidelity, 'prose_only');
    }
    // CycloneDX genuinely has these three; it must NOT degrade them.
    assert.equal(P.JUSTIFICATION[v].cyclonedx.fidelity, 'exact');
  }
});

test('adversary-uncontrollable NEVER becomes "protected by a mitigating control" in CycloneDX', () => {
  // The claims differ: one says nothing needs to protect it, the other says something does.
  const cell = P.JUSTIFICATION.adversary_cannot_control.cyclonedx;
  assert.equal(cell.value, null);
  assert.notEqual(cell.value, 'protected_by_mitigating_control');
  assert.equal(cell.fidelity, 'prose_only');
});

test('a mitigation NEVER becomes a workaround in CycloneDX', () => {
  // workaround_available asserts exposure is AVOIDED; a mitigation reduces risk without avoiding it.
  const cell = P.RESPONSE.mitigation_applied.cyclonedx;
  assert.equal(cell.value, null);
  assert.notEqual(cell.value, 'workaround_available');
});

test('a rollback NEVER becomes a vendor fix in CSAF', () => {
  const cell = P.RESPONSE.rollback_applied.csaf;
  assert.equal(cell.value, null, 'vendor_fix would assert a patch was taken rather than a version reverted');
});

test('"no fix exists" and "we chose not to" never collapse into one value', () => {
  for (const f of ['cyclonedx', 'csaf']) {
    const cant = P.RESPONSE.no_fix_available_upstream[f].value;
    const wont = P.RESPONSE.will_not_fix_by_choice[f].value;
    assert.ok(cant && wont);
    assert.notEqual(cant, wont, `${f} renders "cannot fix" and "will not fix" identically — the distinction the whole axis exists for`);
  }
});

test('compiler/runtime/perimeter protections never borrow the inline-mitigation flag', () => {
  for (const v of ['mitigated_compiler', 'mitigated_runtime', 'mitigated_perimeter']) {
    for (const f of ['csaf', 'openvex']) {
      assert.notEqual(P.JUSTIFICATION[v][f].value, 'inline_mitigations_already_exist',
        `${v} → ${f} borrowed a flag that means a protection INSIDE the product`);
      assert.equal(P.JUSTIFICATION[v][f].value, null);
    }
  }
});

// ── the two values no standard can express ──────────────────────────────────────────────────────

test('an UNKNOWN reachability or exploitability is never a not-affected verdict', () => {
  assert.equal(D.isNotAffected({ presence: 'component_present_code_present', reachability: 'reachability_unknown' }), false);
  assert.equal(D.isNotAffected({ presence: 'component_present_code_present', exploitability: 'exploitability_unknown' }), false);
  assert.equal(D.notAffectedReason({ reachability: 'reachability_unknown' }), null);
  // …and no justification row exists for them at all, so none can be emitted by construction.
  assert.equal(P.JUSTIFICATION.reachability_unknown, undefined);
  assert.equal(P.JUSTIFICATION.exploitability_unknown, undefined);
});

// ── legality ────────────────────────────────────────────────────────────────────────────────────

test('an absent component may not carry a reachability or exploitability claim', () => {
  const errs = D.legality({ presence: 'component_absent', reachability: 'unreachable_static' });
  assert.ok(errs.some((e) => /absent component has no call graph/.test(e)));
  assert.deepEqual(D.legality({ presence: 'component_absent', reachability: 'reachability_unknown' }), []);
});

test('unreachable code cannot simultaneously be exploitable', () => {
  assert.ok(D.legality({ reachability: 'unreachable_static', exploitability: 'exploitable' }).length);
});

test('an undeclared axis value is rejected, not passed through', () => {
  assert.ok(D.legality({ reachability: 'probably_fine' }).some((e) => /not a declared value/.test(e)));
});

// ── the evidence gate (phase 4) ─────────────────────────────────────────────────────────────────

test('static unreachability requires a call-graph tool and nothing else will do', () => {
  const d = { reachability: 'unreachable_static' };
  assert.equal(D.assertable(d, [{ method: 'manual_review' }]).ok, false, 'a human reading code is not a call-graph analysis');
  assert.equal(D.assertable(d, [{ method: 'scanner_default' }]).ok, false, 'a tool default is evidence of nothing');
  assert.equal(D.assertable(d, []).ok, false);
  assert.equal(D.assertable(d, [{ method: 'call_graph' }]).ok, true);
});

test('a refusal names the degradation rather than only complaining', () => {
  const { refusals } = D.assertable({ reachability: 'unreachable_static' }, [{ method: 'manual_review' }]);
  assert.match(refusals[0], /reachability_unknown/);
  assert.match(refusals[0], /an unchecked claim is not a determination/);
});

test('degrade() strips only the claim the evidence cannot carry', () => {
  const d = { presence: 'component_present_code_present', reachability: 'unreachable_static', exploitability: 'mitigated_perimeter', remediation: 'will_not_fix_by_choice' };
  const { determination, degraded } = D.degrade(d, [{ method: 'config_read' }]);
  assert.equal(determination.reachability, 'reachability_unknown', 'config_read cannot support a call-graph claim');
  assert.equal(determination.exploitability, 'mitigated_perimeter', 'config_read DOES support a perimeter-control claim');
  assert.equal(determination.remediation, 'will_not_fix_by_choice', 'remediation is a decision, not an analysis — never degraded');
  assert.equal(degraded.length, 1);
  assert.deepEqual(degraded[0], { axis: 'reachability', from: 'unreachable_static', to: 'reachability_unknown' });
});

test('a degraded determination is no longer a not-affected verdict', () => {
  const d = { presence: 'component_present_code_present', reachability: 'unreachable_static' };
  assert.equal(D.isNotAffected(d), true);
  assert.equal(D.isNotAffected(D.degrade(d, [{ method: 'scanner_default' }]).determination), false,
    'an unevidenced not-affected must not survive the gate — this is the confidently-wrong document the gate exists to stop');
});

// ── rulings 2026-08-22 ──────────────────────────────────────────────────────────────────────────

test('RULING: ledger-strong evidence earns resolved_with_pedigree', () => {
  assert.equal(P.projectStatus({ remediation: 'fixed_verified' }, { ledgerTier: 'strong' }).cyclonedx.value, 'resolved_with_pedigree');
  assert.equal(P.projectStatus({ remediation: 'fixed_verified' }, { ledgerTier: 'medium' }).cyclonedx.value, 'resolved');
  // …and it is a real CycloneDX value, not an invention.
  assert.ok(legal('cyclonedx').has('resolved_with_pedigree'));
});

test('RULING: asymmetric enrichment — KEV becomes a CSAF exploit_status threat', () => {
  const kev = P.enrichments({}, { kev: true });
  assert.equal(kev.length, 1);
  assert.equal(kev[0].format, 'csaf');
  assert.equal(kev[0].category, 'exploit_status');
  assert.match(kev[0].details, /observed, not predicted/);
  assert.ok(VOCAB.formats.csaf.threat.includes('exploit_status'), 'exploit_status must exist upstream');

  // EPSS above the trigger is PREDICTED exploitation and must not be worded as observed.
  const epss = P.enrichments({}, { epss: 0.91 });
  assert.match(epss[0].details, /PREDICTED, not observed/);
  assert.equal(P.enrichments({}, { epss: 0.01 }).length, 0);
});

test('RULING: generate-and-declare — a lossy projection still produces a document, and says what it lost', () => {
  const d = { presence: 'component_present_code_present', reachability: 'unreachable_config', remediation: 'mitigation_applied' };
  const { per } = P.project(d);
  // CycloneDX keeps the reachability reason exactly but loses the mitigation response.
  assert.equal(per.cyclonedx.justification.value, 'requires_configuration');
  assert.ok(per.cyclonedx.lost.some((l) => l.carrier === 'detail'));
  // OpenVEX loses the reason and has no response vocabulary at all — but still emits.
  assert.equal(per.openvex.justification.value, null);
  assert.ok(per.openvex.lost.length >= 2);
  for (const f of P.FORMATS) assert.ok(per[f].status.value, `${f} produced no status — generate-and-declare means it still generates`);
});

test('the fidelity summary counts every cell and names every loss', () => {
  const projections = [
    { vulnId: 'CVE-1', projection: P.project({ presence: 'component_absent', remediation: 'under_investigation' }) },
    { vulnId: 'CVE-2', projection: P.project({ presence: 'component_present_code_present', exploitability: 'mitigated_runtime', remediation: 'rollback_applied' }) },
  ];
  const cdx = P.fidelitySummary(projections, 'cyclonedx');
  const ovx = P.fidelitySummary(projections, 'openvex');
  assert.ok(cdx.exact > 0);
  assert.ok(ovx.prose_only > 0, 'OpenVEX cannot express a runtime protection and must say so');
  for (const l of ovx.lost) assert.ok(l.vulnId && l.note, 'a declared loss must name the vuln and the reason');
});
