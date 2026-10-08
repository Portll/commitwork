// The structured-field enforcer, and the proof that it is not a rubber stamp.
//
// This validator sits in the WRITE PATH: cra/vex.mjs refuses to put a CSAF document on disk if it
// breaks its own schema. That makes it the single most dangerous thing in the module to get wrong,
// because a validator that passes everything looks exactly like a codebase with no defects. Every
// test below either plants a violation and demands it be caught, or pins the honesty of the
// `unchecked` channel.
//
// It EARNED its place on the day it landed: run against the emitter, it immediately found two real
// defects in documents an earlier commit had already published — a missing required `$schema` and
// product_tree.relationships, which 2.1 replaced with product_paths. The hand-written rename guard
// beside it had compared two subtrees and was blind to both.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCsaf, assertCsafValid } from '../csaf-validate.mjs';
import { buildCsaf, buildCsaf21 } from '../vex-formats.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S20 = JSON.parse(readFileSync(join(REPO, 'schema', 'upstream', 'csaf_json_schema.json'), 'utf8'));
const S21 = JSON.parse(readFileSync(join(REPO, 'schema', 'upstream', 'csaf-2.1-csd02.schema.json'), 'utf8'));
const CAT = JSON.parse(readFileSync(join(REPO, 'cra', 'cwe-catalogue.json'), 'utf8'));

const PRODUCT = { id: 'demo', name: 'Demo', version: '1.0' };
const MAKER = { name: 'Acme', namespace: 'https://acme.example' };
const KEV = {
  cveID: 'CVE-2026-0001', vendorProject: 'Gitea', product: 'Gitea',
  vulnerabilityName: 'Gitea Code Injection Vulnerability',
  dateAdded: '2026-08-25', dueDate: '2026-08-28',
  shortDescription: 'Gitea contains a code injection vulnerability.',
  requiredAction: 'Apply mitigations in accordance with vendor instructions.',
  knownRansomwareCampaignUse: 'Unknown',
  notes: 'https://example.invalid/a ; https://example.invalid/b',
  cwes: ['CWE-94', 'CWE-79'],
};
const STATEMENTS = [{
  vulnId: 'CVE-2026-0001', state: 'exploitable', detail: 'detail', reason: null,
  affects: [{ ref: 'pkg@1' }], cvss: 7.5, severity: 'high', advisory: 'https://advisory.example',
}];
const AT = '2026-08-26T00:00:00.000Z';
const ENRICH = {
  kev: { 'CVE-2026-0001': KEV }, cweCatalogue: CAT,
  epss: { 'CVE-2026-0001': { probability: '0.003860000', percentile: '0.314200000', date: '2026-08-25' } },
};

describe('CSAF structured-field enforcer', () => {
  test('the documents this repo actually emits are valid — fully enriched, both versions', () => {
    for (const [label, doc, sch] of [
      ['2.0', buildCsaf(PRODUCT, MAKER, STATEMENTS, { sliceId: 's' }, AT, null, ENRICH), S20],
      ['2.1', buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's' }, AT, null, ENRICH), S21],
    ]) {
      const { errors, checked } = validateCsaf(doc, sch);
      assert.deepEqual(errors, [], `${label}: ${errors.join('\n  ')}`);
      assert.ok(checked > 50, `${label}: only ${checked} values examined — too few to mean anything`);
    }
  });

  test('NON-VACUITY — every constraint class it claims to check, it catches', () => {
    const good = buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's' }, AT, null, ENRICH);
    const clone = () => JSON.parse(JSON.stringify(good));
    const cases = [
      ['required', (d) => { delete d.document.publisher; }, /missing required property "publisher"/],
      ['enum', (d) => { d.document.csaf_version = '2.0'; }, /is not one of/],
      ['pattern', (d) => { d.vulnerabilities[0].cwes[0].id = 'CWE-x'; }, /does not match/],
      ['type', (d) => { d.document.title = 42; }, /expected string, got number/],
      ['minLength', (d) => { d.document.title = ''; }, /minLength/],
      ['additionalProperties', (d) => { d.vulnerabilities[0].bogus = 1; }, /not permitted/],
      ['minItems', (d) => { d.vulnerabilities[0].cwes = []; }, /minItems/],
      ['nested pattern', (d) => { d.vulnerabilities[0].metrics.find((m) => m.content.epss).content.epss.probability = '3.86e-3'; }, /does not match/],
      ['top-level required', (d) => { delete d.$schema; }, /missing required property "\$schema"/],
    ];
    for (const [label, mutate, expect] of cases) {
      const d = clone(); mutate(d);
      const { errors } = validateCsaf(d, S21);
      assert.ok(errors.some((e) => expect.test(e)),
        `${label}: a planted violation was NOT caught. errors were: ${JSON.stringify(errors)}`);
    }
  });

  test('the two defects it found on the day it landed stay caught', () => {
    const d = buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's' }, AT, null, ENRICH);
    // Exactly the shape that was published.
    delete d.$schema;
    d.product_tree.relationships = d.product_tree.product_paths.map((p) => ({
      category: p.subpaths[0].category,
      product_reference: p.beginning_product_reference,
      relates_to_product_reference: p.subpaths[0].next_product_reference,
      full_product_name: p.full_product_name,
    }));
    delete d.product_tree.product_paths;
    const { errors } = validateCsaf(d, S21);
    assert.ok(errors.some((e) => /missing required property "\$schema"/.test(e)));
    assert.ok(errors.some((e) => /product_tree\.relationships: not permitted/.test(e)));
  });

  test('UNCHECKED is reported, never counted as valid', () => {
    // The CVSS payload is a remote $ref to first.org. The validator cannot follow it, and the one
    // thing it must not do is call that a pass.
    const d = buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's' }, AT, null, ENRICH);
    const { unchecked } = validateCsaf(d, S21);
    assert.ok(unchecked.length, 'a document containing CVSS reported nothing unchecked — the channel is dead');
    // 2.1 states cvss_v3 as oneOf[$ref v3.0, $ref v3.1], so it is unevaluated for TWO reasons.
    // The assertion is that the CVSS path is named, not which excuse it carries.
    assert.ok(unchecked.some((u) => /cvss/i.test(u)),
      `the CVSS payload must be named as unevaluated; unchecked was ${JSON.stringify(unchecked.slice(0, 5))}`);
    // and a garbage CVSS payload passes, which is the honest consequence and must be visible
    const bad = JSON.parse(JSON.stringify(d));
    bad.vulnerabilities[0].metrics.find((m) => m.content.cvss_v3).content.cvss_v3 = { nonsense: true };
    assert.deepEqual(validateCsaf(bad, S21).errors, [],
      'this validator does NOT check CVSS — if that ever changes, this assertion should be the thing that fails');
  });

  test('the enforcer throws on a violation and refuses a vacuous pass', () => {
    const d = buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's' }, AT, null, ENRICH);
    assert.doesNotThrow(() => assertCsafValid(d, S21, 'good'));

    const broken = JSON.parse(JSON.stringify(d)); delete broken.document.publisher;
    assert.throws(() => assertCsafValid(broken, S21, 'broken'), /refusing to write/);

    // A schema that matches nothing examines nothing. Reporting THAT as valid is the failure mode
    // every gate in this repository is written against.
    assert.throws(() => assertCsafValid(undefined, S21, 'empty'), /examined NOTHING/);
  });

  test('it does not invent violations — a valid minimal document is clean', () => {
    const minimal = { $schema: S21.properties.$schema.enum[0], document: {
      category: 'csaf_vex', csaf_version: '2.1', title: 't',
      distribution: { tlp: { label: 'AMBER' } },
      publisher: { category: 'vendor', name: 'n', namespace: 'https://n.example' },
      tracking: {
        id: 'X', status: 'final', version: '1',
        initial_release_date: AT, current_release_date: AT,
        revision_history: [{ number: '1', date: AT, summary: 's' }],
      },
    } };
    const { errors } = validateCsaf(minimal, S21);
    assert.deepEqual(errors, [], `a conformant minimal document was rejected: ${errors.join('; ')}`);
  });
});
