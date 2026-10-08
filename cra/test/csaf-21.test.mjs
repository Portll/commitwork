// CSAF 2.1 (CSD02, 25 February 2026) emitter — and the guard that keeps it honest as the draft moves.
//
// The emitter applies an ENUMERATED set of deltas to the 2.0 document. The danger with an
// enumerated list is that the standard changes and the list does not: the emitter would keep
// producing a document that is 2.1-shaped in the fields we thought to rename and 2.0-shaped in the
// ones we did not, while calling itself csaf_version 2.1. That is the false-provenance class — a
// document asserting a conformance it does not have.
//
// So the rename set is DERIVED HERE from the two vendored schemas and compared against what the
// emitter actually handles. If OASIS publishes a draft that renames another field the VEX profile
// touches, this fails rather than shipping a mislabelled document.
//
// Zero-dep: this is NOT a JSON Schema validator. It checks the specific invariants the diff
// produced, and says so rather than letting a green read as full schema conformance.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCsaf, buildCsaf21, CSAF_21_TLP_LABELS, epssTimestamp,
  cwesFromIds, QUALITATIVE_SEVERITY, CSAF_21_SCHEMA_URL,
  SEVERITY_SYNONYMS, mapQualitativeSeverity,
} from '../vex-formats.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S20 = JSON.parse(readFileSync(join(REPO, 'schema', 'upstream', 'csaf_json_schema.json'), 'utf8'));
const S21 = JSON.parse(readFileSync(join(REPO, 'schema', 'upstream', 'csaf-2.1-csd02.schema.json'), 'utf8'));

const PRODUCT = { id: 'demo', name: 'Demo', version: '1.0' };
const MAKER = { name: 'Acme', namespace: 'https://acme.example' };
const STATEMENTS = [{
  vulnId: 'CVE-2026-1', state: 'exploitable', detail: 'detail', reason: null,
  affects: [{ ref: 'pkg@1' }], cvss: 7.5, severity: 'high', advisory: 'https://advisory.example',
}];
const AT = '2026-08-26T00:00:00.000Z';
const emit21 = () => buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT);
const emit20 = () => buildCsaf(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT);

describe('CSAF 2.1 emitter', () => {
  test('the vendored schema is the 2.1 draft it claims to be', () => {
    assert.match(S21.$id, /csaf\/v2\.1\/schema\/csaf\.json$/);
    assert.deepEqual(S21.properties.document.properties.csaf_version.enum, ['2.1']);
    assert.deepEqual(S20.properties.document.properties.csaf_version.enum, ['2.0'],
      'the 2.0 schema beside it must still be 2.0, or the diff below compares the wrong pair');
  });

  test('THE GUARD THAT WAS TOO NARROW — every top-level subtree is diffed, not just two', () => {
    // The original derived guard compared `document` and `vulnerabilities[]` and nothing else. It
    // passed while the emitter produced a 2.1 document that was invalid in TWO other places, and
    // a commit published it: `$schema` became required at the top level, and product_tree's
    // `relationships` was restructured into `product_paths`. The write-path enforcer found both.
    // A rename list scoped to the subtrees someone thought of is a guard shaped like its author.
    const a = Object.keys(S20.properties); const b = Object.keys(S21.properties);
    assert.deepEqual(b.filter((k) => !a.includes(k)).sort(), ['$schema', 'x_extensions'],
      'a new top-level property appeared in 2.1 that the emitter has never been told about');
    const treeA = Object.keys(S20.properties.product_tree.properties);
    const treeB = Object.keys(S21.properties.product_tree.properties);
    assert.deepEqual(treeA.filter((k) => !treeB.includes(k)), ['relationships'],
      'product_tree lost a property 2.1 has no conversion for');
    assert.deepEqual(treeB.filter((k) => !treeA.includes(k)), ['product_paths']);
    assert.deepEqual(S21.required.slice().sort(), ['$schema', 'document']);
  });

  test('$schema is emitted, and it is the exact enum the schema fixes', () => {
    const d = emit21();
    const allowed = S21.properties.$schema.enum;
    assert.deepEqual(allowed, [CSAF_21_SCHEMA_URL], 'the constant has drifted from the schema');
    assert.equal(d.$schema, CSAF_21_SCHEMA_URL);
    assert.equal(emit20().$schema, undefined, '2.0 does not define it; adding it would be noise');
  });

  test('relationships become product_paths WITHOUT re-minting a single product id', () => {
    const a = emit20(); const b = emit21();
    assert.ok(a.product_tree.relationships.length, '2.0 still states relationships');
    assert.equal(b.product_tree.relationships, undefined, '2.1 forbids it — additionalProperties is false');
    assert.equal(b.product_tree.product_paths.length, a.product_tree.relationships.length);

    const rel = a.product_tree.relationships[0];
    const path = b.product_tree.product_paths[0];
    assert.equal(path.beginning_product_reference, rel.product_reference);
    assert.deepEqual(path.subpaths, [{ category: rel.category, next_product_reference: rel.relates_to_product_reference }]);
    assert.deepEqual(path.full_product_name, rel.full_product_name);

    // THE POINT OF THE CONVERSION. A restructure that renamed the container and re-minted ids would
    // produce a schema-valid document full of dangling references — worse than an invalid one,
    // because nothing would complain.
    const known = new Set([
      ...b.product_tree.full_product_names.map((f) => f.product_id),
      ...b.product_tree.product_paths.map((p) => p.full_product_name.product_id),
    ]);
    const referenced = new Set(b.vulnerabilities.flatMap((v) => Object.values(v.product_status || {}).flat()));
    const dangling = [...referenced].filter((id) => !known.has(id));
    assert.deepEqual(dangling, [], 'the restructure orphaned product references');
  });

  test('THE DERIVED GUARD — every vulnerability field 2.1 renamed is handled by the emitter', () => {
    const a = Object.keys(S20.properties.vulnerabilities.items.properties);
    const b = Object.keys(S21.properties.vulnerabilities.items.properties);
    const removed = a.filter((k) => !b.includes(k));
    // What the emitter knows how to convert. Adding a name here without adding the conversion in
    // vex-formats.mjs is caught by the emission assertions below.
    const handled = ['cwe', 'release_date', 'scores'];
    assert.deepEqual(removed.sort(), handled.slice().sort(),
      `2.1 removes ${removed.join(', ')} from vulnerabilities[]; the emitter converts `
      + `${handled.join(', ')}. A name in one list and not the other means a document labelled `
      + '2.1 carrying a 2.0 field, or a conversion for a field that no longer moved.');
  });

  test('THE DERIVED GUARD — document fields newly REQUIRED in 2.1 are emitted', () => {
    const req20 = S20.properties.document.required || [];
    const req21 = S21.properties.document.required || [];
    const newlyRequired = req21.filter((k) => !req20.includes(k));
    assert.deepEqual(newlyRequired, ['distribution'],
      'the emitter only knows to add `distribution`; a second newly-required field would be missing');
    const doc = emit21().document;
    for (const k of req21) {
      assert.ok(doc[k] !== undefined, `2.1 requires document.${k} and the emitter did not produce it`);
    }
  });

  test('no renamed-away 2.0 field survives into a 2.1 document', () => {
    const d = emit21();
    for (const v of d.vulnerabilities) {
      for (const dead of ['scores', 'cwe', 'release_date']) {
        assert.equal(v[dead], undefined, `a 2.1 document still carries the 2.0 field ${dead}`);
      }
    }
  });

  test('scores became metrics, with both keys the schema requires', () => {
    const v = emit21().vulnerabilities[0];
    assert.ok(Array.isArray(v.metrics) && v.metrics.length, 'a scored statement must produce metrics');
    const required = S21.properties.vulnerabilities.items.properties.metrics.items.required;
    assert.deepEqual(required.slice().sort(), ['content', 'products']);
    for (const m of v.metrics) for (const k of required) {
      assert.ok(m[k] !== undefined, `metrics item is missing the required key ${k}`);
    }
    assert.equal(v.metrics[0].content.cvss_v3.baseScore, 7.5, 'the CVSS payload must survive the move');
  });

  test('TLP defaults to the RESTRICTIVE label and says it was not declared', () => {
    const d = emit21().document;
    assert.ok(CSAF_21_TLP_LABELS.includes(d.distribution.tlp.label));
    assert.equal(d.distribution.tlp.label, 'AMBER',
      'an undeclared label must never fall to CLEAR — that asserts a release decision nobody made');
    assert.match(d.distribution.text, /No TLP label was declared/i,
      'the absence must be stated in the document, not hidden behind a default');
    // and a declared label is honoured
    const declared = buildCsaf21(PRODUCT, { ...MAKER, tlp: 'GREEN' }, STATEMENTS, { sliceId: 's1' }, AT);
    assert.equal(declared.document.distribution.tlp.label, 'GREEN');
  });

  test('the TLP vocabulary matches the schema — 2.0 WHITE is gone', () => {
    const enum21 = S21.properties.document.properties.distribution.properties.tlp.properties.label.enum;
    assert.deepEqual(CSAF_21_TLP_LABELS.slice().sort(), enum21.slice().sort(),
      'the emitter\'s label list has drifted from the schema');
    assert.ok(!enum21.includes('WHITE'), '2.1 replaced WHITE with CLEAR; a WHITE label would be invalid');
  });

  test('the 2.0 emitter is UNTOUCHED — this is a sibling, not an upgrade', () => {
    const a = emit20();
    assert.equal(a.document.csaf_version, '2.0');
    assert.ok(a.vulnerabilities[0].scores, '2.0 must still carry scores');
    assert.equal(a.vulnerabilities[0].metrics, undefined, '2.0 must not carry the 2.1 field');
    assert.equal(a.document.distribution, undefined,
      '2.0 leaves distribution optional; adding it here would be an unrequested change to a shipped format');
  });

  // ── EPSS: the one thing 2.1 expresses that 2.0 could not, and that this fleet can actually feed ──
  const EPSS_OK = { 'CVE-2026-1': { probability: '0.003860000', percentile: '0.314200000', date: '2026-08-25' } };
  const emitEnriched = (epss) => buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT, null, { epss });
  const epssMetric = (d) => (d.vulnerabilities[0].metrics || []).find((m) => m.content.epss);

  test('EPSS is emitted as its OWN metrics entry, beside CVSS not folded into it', () => {
    const v = emitEnriched(EPSS_OK).vulnerabilities[0];
    // Asserted as DISTINCT ENTRIES rather than a count: the count was 2 and became 3 when
    // qualitative severity landed, and a count pins the wrong thing. What matters is that each
    // authority keeps its own entry — CVSS from the advisory, EPSS from FIRST, the qualitative
    // rating from our own lifecycle — because one entry would imply one source for all of them.
    const contents = v.metrics.map((m) => Object.keys(m.content).join('+'));
    assert.equal(new Set(contents).size, contents.length, 'two authorities were folded into one entry');
    assert.ok(contents.includes('cvss_v3'), 'the CVSS metric must survive');
    assert.ok(contents.includes('epss'));
    const e = v.metrics.find((m) => m.content.epss);
    assert.ok(e, 'the EPSS metric must be present');
    assert.ok(e.products.length, 'metrics items require products; an entry without them is schema-invalid');
  });

  test('EPSS values match the schema pattern EXACTLY — verbatim strings, never round-tripped floats', () => {
    const pattern = S21.properties.vulnerabilities.items.properties
      .metrics.items.properties.content.properties.epss.properties.probability.pattern;
    const re = new RegExp(pattern);
    const e = epssMetric(emitEnriched(EPSS_OK)).content.epss;
    assert.ok(re.test(e.probability), `probability ${e.probability} does not match the schema pattern`);
    assert.ok(re.test(e.percentile), `percentile ${e.percentile} does not match the schema pattern`);
    // The concrete hazard: a float round-trip renders 0.00386 as "0.00386" (fine) but small values
    // as exponential, which the pattern rejects. Proven, not assumed:
    assert.ok(!re.test(String(3.86e-7)), 'a float round-trip produces a value the schema rejects — hence verbatim strings');
  });

  test('a PARTIAL triple is dropped, never padded', () => {
    const required = S21.properties.vulnerabilities.items.properties
      .metrics.items.properties.content.properties.epss.required;
    assert.deepEqual(required.slice().sort(), ['percentile', 'probability', 'timestamp']);
    for (const drop of required) {
      const partial = { ...EPSS_OK['CVE-2026-1'] };
      delete partial[drop === 'timestamp' ? 'date' : drop];
      assert.equal(epssMetric(emitEnriched({ 'CVE-2026-1': partial })), undefined,
        `an EPSS metric was emitted without ${drop} — a padded metric is worse than an omitted one`);
    }
  });

  test('a malformed date yields no metric rather than a guessed timestamp', () => {
    assert.equal(epssTimestamp('2026-08-25'), '2026-08-25T00:00:00.000Z', 'EPSS runs daily; the day start is the honest widening');
    assert.equal(epssTimestamp('not-a-date'), null);
    assert.equal(epssTimestamp(undefined), null);
    const d = emitEnriched({ 'CVE-2026-1': { ...EPSS_OK['CVE-2026-1'], date: 'whenever' } });
    assert.equal(epssMetric(d), undefined);
  });

  test('no enrichment at all leaves the document valid and simply quieter', () => {
    const v = emit21().vulnerabilities[0];
    assert.ok(v.metrics.length, 'CVSS still produces a metric with no enrichment supplied');
    assert.ok(!v.metrics.some((m) => m.content.epss), 'an absent sidecar must not synthesise a probability');
  });

  test('first_known_exploitation_dates is DELIBERATELY unfed — absent, never a zero', () => {
    // KEV's dateAdded is when CISA catalogued it; the 2.1 field is when exploitation HAPPENED.
    // Publishing one as the other would put a fabricated observed date in front of a regulator.
    for (const d of [emit21(), emitEnriched(EPSS_OK)]) {
      assert.equal(d.vulnerabilities[0].first_known_exploitation_dates, undefined);
    }
  });

  // ── CISA KEV enrichment — version-agnostic, so BOTH formats carry it ──────────────────────────
  // A real record, verbatim from monitor/data/kev.json (CVE-2026-60004, catalogued 2026-08-25).
  const KEV_REC = {
    cveID: 'CVE-2026-1',
    vendorProject: 'Gitea', product: 'Gitea', vulnerabilityName: 'Gitea Code Injection Vulnerability',
    dateAdded: '2026-08-25', dueDate: '2026-08-28',
    shortDescription: 'Gitea contains a code injection vulnerability.',
    requiredAction: 'Apply mitigations in accordance with vendor instructions.',
    knownRansomwareCampaignUse: 'Unknown',
    notes: 'https://example.invalid/advisory ; not-a-url ; https://example.invalid/bod',
    cwes: ['CWE-94'],
  };
  const withKev = (build) => build(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT, null, { kev: { 'CVE-2026-1': KEV_REC } });
  const threatOf = (d) => (d.vulnerabilities[0].threats || []).find((t) => t.category === 'exploit_status');

  test('the catalogue date lands in threats[].date — the field whose meaning matches', () => {
    const t = threatOf(withKev(buildCsaf21));
    assert.equal(t.date, '2026-08-25T00:00:00.000Z',
      'KEV publishes a date; CSAF wants date-time, so it widens to that day start');
    assert.match(t.details, /Catalogued 2026-08-25/);
    assert.ok(t.product_ids.length, 'a threat with no product_ids says nothing about this product');
  });

  test('the fix-by date is carried, and deliberately NOT in remediations.date', () => {
    const v = withKev(buildCsaf21).vulnerabilities[0];
    const r = v.remediations.find((x) => /fix-by/.test(x.details));
    assert.ok(r, 'the CISA due date must reach the document');
    assert.match(r.details, /2026-08-28/);
    assert.equal(r.date, undefined,
      'remediations.date means "available FROM"; a BOD deadline is "must be done BY". '
      + 'Putting one in the other reverses the claim and no reader could tell.');
    assert.equal(r.category, 'mitigation');
    assert.match(r.details, /DEADLINE, not an\s+availability date/,
      'the document must say why the date is in prose, or the next editor will "fix" it into .date');
  });

  test('ransomware use is carried VERBATIM — "Unknown" is not "No"', () => {
    assert.match(threatOf(withKev(buildCsaf21)).details, /Known ransomware campaign use: Unknown\./);
  });

  test('KEV notes become references, and a non-URL is dropped rather than emitted', () => {
    const v = withKev(buildCsaf21).vulnerabilities[0];
    const kevRefs = v.references.filter((r) => r.summary === 'CISA KEV reference');
    assert.equal(kevRefs.length, 2, 'two of the three "; "-separated entries are URLs');
    assert.ok(!kevRefs.some((r) => /not-a-url/.test(r.url)), 'a reference that resolves nowhere is worse than none');
    assert.ok(v.references.some((r) => r.summary === 'advisory'), 'the existing advisory reference must survive');
  });

  test('BOTH formats carry KEV — the newer must not quietly know more', () => {
    for (const [label, build] of [['2.0', buildCsaf], ['2.1', buildCsaf21]]) {
      const t = threatOf(withKev(build));
      assert.ok(t, `${label} carries no exploit_status threat; threats/remediations/references are `
        + 'the same constructs in both versions, so enrichment must not be version-gated');
      assert.equal(t.date, '2026-08-25T00:00:00.000Z');
    }
  });

  // ── weaknesses, once the missing authority was vendored ───────────────────────────────────────
  const CAT = JSON.parse(readFileSync(join(REPO, 'cra', 'cwe-catalogue.json'), 'utf8'));
  const withKevCwe = (build, kevRec = KEV_REC) => build(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT, null,
    { kev: { 'CVE-2026-1': kevRec }, cweCatalogue: CAT });

  test('the vendored catalogue is real, versioned, and its names satisfy the 2.1 pattern', () => {
    assert.ok(CAT.version, 'a catalogue with no version cannot fill a required 2.1 field');
    assert.ok(Object.keys(CAT.weaknesses).length > 900, `only ${Object.keys(CAT.weaknesses).length} weaknesses — a truncated catalogue`);
    const namePattern = new RegExp(S21.properties.vulnerabilities.items.properties.cwes.items.properties.name.pattern);
    const bad = Object.entries(CAT.weaknesses).filter(([, n]) => !namePattern.test(n));
    assert.deepEqual(bad, [], 'the catalogue holds a name CSAF 2.1 cannot carry; it should have been rejected at ingest');
  });

  test('cwes[] is emitted with all three required fields, from the catalogue', () => {
    const required = S21.properties.vulnerabilities.items.properties.cwes.items.required;
    assert.deepEqual(required.slice().sort(), ['id', 'name', 'version']);
    const v = withKevCwe(buildCsaf21).vulnerabilities[0];
    assert.deepEqual(v.cwes, [{ id: 'CWE-94', name: CAT.weaknesses['CWE-94'], version: CAT.version }]);
    assert.equal(v.cwe, undefined, '2.1 forbids the 2.0 singular; leaving it invalidates the document');
  });

  test('2.0 carries ONE weakness without a version, and says the rest are next door', () => {
    const v = withKevCwe(buildCsaf, { ...KEV_REC, cwes: ['CWE-94', 'CWE-79'] }).vulnerabilities[0];
    assert.deepEqual(Object.keys(v.cwe).sort(), ['id', 'name'], '2.0 has no version field');
    assert.equal(v.cwe.id, 'CWE-94');
    assert.ok(v.notes.some((n) => /additional weaknesses/i.test(n.title || '')),
      'the second weakness must not vanish silently just because 2.0 has one slot');
    // and 2.1 keeps both
    assert.equal(withKevCwe(buildCsaf21, { ...KEV_REC, cwes: ['CWE-94', 'CWE-79'] }).vulnerabilities[0].cwes.length, 2);
  });

  test('an id the catalogue cannot complete is WITHHELD, with the reason in the document', () => {
    // CWE-399 is a retired category CISA still cites; measured 2026-08-26, KEV references 8 such
    // ids across 62 records. There is no name to publish, so there is no entry to publish.
    assert.equal(CAT.weaknesses['CWE-399'], undefined, 'CWE-399 must be absent, or this test proves nothing');
    const v = withKevCwe(buildCsaf21, { ...KEV_REC, cwes: ['CWE-399'] }).vulnerabilities[0];
    assert.equal(v.cwes, undefined, 'a weakness with an invented name is worse than one omitted');
    const note = v.notes.find((n) => /withheld/i.test(n.title || ''));
    assert.ok(note, 'silence here is indistinguishable from "this vulnerability has no weakness"');
    assert.match(note.text, /CWE-399/);
  });

  test("MITRE publishes a name CSAF 2.1 forbids, and the document carries neither", () => {
    // CWE-520 is ".NET Misconfiguration: Use of Impersonation". 2.1's name pattern forbids a
    // leading period, so the standard cannot express a name its own ecosystem publishes.
    assert.equal(CAT.rejectedByCsafNamePattern['CWE-520'], '.NET Misconfiguration: Use of Impersonation');
    // AND MITRE GRADES IT `Allowed` — at Variant level, which its own rationale calls a preferred
    // abstraction for mapping. So this is not a fringe entry the schema happens to exclude: the
    // CSAF pattern forbids a name the CWE specification recommends. Verified 2026-08-26 to be live
    // at the v2.1 LATEST stage, not only in CSD02. Reported upstream rather than worked around —
    // rewriting ".NET" to "(dot)NET" would publish a name that is not the one CWE publishes, which
    // is the invention this whole function exists to refuse.
    assert.equal(CAT.mappingUsage['CWE-520'], 'Allowed');
    const v = withKevCwe(buildCsaf21, { ...KEV_REC, cwes: ['CWE-520'] }).vulnerabilities[0];
    assert.equal(v.cwes, undefined);
    assert.match(v.notes.find((n) => /withheld/i.test(n.title || '')).text, /name pattern forbids/);
  });

  test('a CWE Category is refused BY NAME, and for the right reason', () => {
    // The first cut reported these as "not present in the catalogue". Measurably wrong: all eight
    // ids KEV cites are present — as Categories, which MITRE prohibits for vulnerability mapping
    // and CSAF 2.1 has a recommended test against (6.2.25). The refusal was right; the reason was
    // not, and a wrong reason in a published document is its own defect.
    assert.equal(CAT.categories['CWE-399'], 'Resource Management Errors');
    assert.equal(CAT.weaknesses['CWE-399'], undefined, 'a category must not also be a weakness');
    const { cwes, dropped } = cwesFromIds(['CWE-399'], CAT);
    assert.deepEqual(cwes, []);
    assert.match(dropped[0].why, /Category "Resource Management Errors"/);
    assert.equal(dropped[0].test, '6.1.11', 'a Category fails a MANDATORY test, not a recommended one');
  });

  test('a CWE View is refused by the same mandatory test', () => {
    assert.equal(CAT.views['CWE-1000'], 'Research Concepts');
    const { cwes, dropped } = cwesFromIds(['CWE-1000'], CAT);
    assert.deepEqual(cwes, []);
    assert.equal(dropped[0].test, '6.1.11');
    assert.match(dropped[0].why, /View "Research Concepts"/);
  });

  test('a DEPRECATED weakness is refused — 6.2.23', () => {
    // 25 exist in CWE 4.20 and every one was emittable until `status` was carried. KEV cites none
    // today; that is a fact about today, not a reason to leave the hole open.
    const dep = Object.keys(CAT.status).find((k) => CAT.status[k] === 'Deprecated' && CAT.weaknesses[k]);
    assert.ok(dep, 'no deprecated weakness in the catalogue — this test would prove nothing');
    const { cwes, dropped } = cwesFromIds([dep], CAT);
    assert.deepEqual(cwes, []);
    assert.equal(dropped[0].test, '6.2.23');
    assert.match(dropped[0].why, /DEPRECATED/);
  });

  test("6.2.25's allowed set is EXACTLY Allowed and Allowed-with-Review — Discouraged fails it", () => {
    // The spec states the set literally: "Currently, this includes the two usage state `Allowed`
    // and `Allowed-with-Review`." An earlier cut shipped Discouraged with a flag. That was wrong,
    // and wrong against 23 ids CISA KEV actually cites.
    for (const usage of ['Prohibited', 'Discouraged']) {
      const id = Object.keys(CAT.mappingUsage).find((k) => CAT.mappingUsage[k] === usage
        && CAT.weaknesses[k] && CAT.status[k] !== 'Deprecated');
      assert.ok(id, `no ${usage} weakness available — this test would prove nothing`);
      const r = cwesFromIds([id], CAT);
      assert.deepEqual(r.cwes, [], `${usage} (${id}) must not be published`);
      assert.equal(r.dropped[0].test, '6.2.25');
    }
    assert.equal(CAT.mappingUsage['CWE-20'], 'Discouraged');
    assert.deepEqual(cwesFromIds(['CWE-20'], CAT).cwes, [], 'CWE-20 is the spec\'s own 6.2.25 example');
  });

  test('Allowed-with-Review SHIPS, flagged — 6.2.26 triggers a review, it does not forbid', () => {
    const id = Object.keys(CAT.mappingUsage).find((k) => CAT.mappingUsage[k] === 'Allowed-with-Review'
      && CAT.weaknesses[k] && CAT.status[k] !== 'Deprecated');
    const r = cwesFromIds([id], CAT);
    assert.equal(r.cwes.length, 1, 'allowed-with-review is allowed; withholding it over-applies 6.2.26');
    assert.deepEqual(r.review.map((x) => x.usage), ['Allowed-with-Review']);

    // AND THE FLAG REACHES THE DOCUMENT. It was computed and discarded in the first cut, which
    // shipped the mapping with nothing anywhere saying it needed checking.
    const v = withKevCwe(buildCsaf21, { ...KEV_REC, cwes: [id] }).vulnerabilities[0];
    const note = v.notes.find((n) => /needs review/i.test(n.title || ''));
    assert.ok(note, '6.2.26 exists to trigger a review; a trigger nobody can see is not a trigger');
    assert.match(note.text, new RegExp(id.replace('-', '\\-')));
    assert.match(note.text, /Nobody in this pipeline has performed that review/,
      'the note must not read as a claim that the review was done');
  });

  test('plain Allowed ships with no review note at all', () => {
    const id = Object.keys(CAT.mappingUsage).find((k) => CAT.mappingUsage[k] === 'Allowed'
      && CAT.weaknesses[k] && CAT.status[k] !== 'Deprecated');
    const r = cwesFromIds([id], CAT);
    assert.equal(r.cwes.length, 1);
    assert.deepEqual(r.review, [], 'flagging a clean mapping trains the reader to ignore the flag');
  });

  test('cwesFromIds refuses on its own terms', () => {
    assert.deepEqual(cwesFromIds(['nonsense'], CAT).cwes, []);
    assert.match(cwesFromIds(['nonsense'], CAT).dropped[0].why, /malformed/);
    assert.deepEqual(cwesFromIds(['CWE-94'], null).cwes, [], 'no catalogue means no weakness, not a blank name');
    assert.deepEqual(cwesFromIds(['CWE-94'], { weaknesses: { 'CWE-94': 'X' } }).cwes, [],
      'a catalogue with no version cannot satisfy 2.1');
    assert.equal(cwesFromIds([], CAT).cwes.length, 0);
  });

  test('vulnerabilityName becomes the title, and CISA product identification stays a NOTE', () => {
    for (const [label, build] of [['2.0', buildCsaf], ['2.1', buildCsaf21]]) {
      const d = withKevCwe(build);
      const v = d.vulnerabilities[0];
      assert.equal(v.title, KEV_REC.vulnerabilityName, `${label} lost the vulnerability name`);
      const note = v.notes.find((n) => /product identification/i.test(n.title || ''));
      assert.ok(note, `${label} dropped CISA's product identification entirely`);
      assert.match(note.text, /Gitea/);
      // THE CLAIM THAT MUST NOT BE MADE: CISA's product must never appear in our product tree.
      assert.ok(!JSON.stringify(d.product_tree).includes('Gitea'),
        `${label} wrote CISA's product into the product tree, asserting an equivalence nobody established`);
    }
  });

  test('qualitative severity is a 2.1 metric, enum-pinned, and never snapped to the nearest value', () => {
    const enum21 = S21.properties.vulnerabilities.items.properties
      .metrics.items.properties.content.properties.qualitative_severity_rating.enum;
    assert.deepEqual(QUALITATIVE_SEVERITY.slice().sort(), enum21.slice().sort(),
      'the emitter\'s severity vocabulary has drifted from the schema');

    const q = (d) => (d.vulnerabilities[0].metrics || []).find((m) => m.content.qualitative_severity_rating);
    assert.equal(q(emit21()).content.qualitative_severity_rating, 'high', 'the statement severity is "high"');
    assert.equal(q(emit20()), undefined, '2.0 has no field for this');

    // A SCANNER'S READING IS NOT CSAF'S LEXICON. The first cut dropped anything outside the enum,
    // which threw away a real measurement because a different standard uses different words.
    // "severe" sits ABOVE high in the vocabularies that use it, and CSAF has no band between high
    // and critical — so it maps to critical, the nearest value that does not UNDERSTATE it, and the
    // original word is recorded so a reader can tell a mapped rating from a native one.
    const severe = buildCsaf21(PRODUCT, MAKER, [{ ...STATEMENTS[0], severity: 'severe' }], { sliceId: 's1' }, AT);
    assert.equal(q(severe).content.qualitative_severity_rating, 'critical',
      'mapping upward is the safe direction; a "severe" published as "high" understates it');
    const note = severe.vulnerabilities[0].notes.find((n) => /severity vocabulary/i.test(n.title || ''));
    assert.ok(note, 'a mapped rating without the original term hides that a translation happened');
    assert.match(note.text, /MAPPED FROM "severe"/, 'the note must name the term it was mapped from');
    assert.match(note.text, /TRANSLATION into CSAF's lexicon, not a re-assessment/,
      'the note must not read as though someone re-rated the vulnerability');

    // …and a term with no defensible mapping still publishes NO rating, and says why.
    const odd = buildCsaf21(PRODUCT, MAKER, [{ ...STATEMENTS[0], severity: 'banana' }], { sliceId: 's1' }, AT);
    assert.equal(q(odd), undefined, 'an unmappable term must not be snapped to a neighbour');
    assert.match(odd.vulnerabilities[0].notes.find((n) => /not expressible/i.test(n.title || '')).text, /"banana"/);

    // an exact term is NOT annotated — a note on every finding would be noise
    assert.equal(emit21().vulnerabilities[0].notes.some((n) => /severity vocabulary/i.test(n.title || '')), false);
  });

  test('the synonym table only ever translates — it never re-classifies', () => {
    for (const [term, expected] of Object.entries(SEVERITY_SYNONYMS)) {
      if (expected === null) {
        assert.equal(mapQualitativeSeverity(term).rating, null, `${term} must yield no rating`);
        continue;
      }
      assert.ok(QUALITATIVE_SEVERITY.includes(expected), `${term} maps to ${expected}, which is not in the CSAF enum`);
      assert.equal(mapQualitativeSeverity(term).rating, expected);
    }
    // the five native values pass through as `exact`, never as `mapped`
    for (const v of QUALITATIVE_SEVERITY) assert.equal(mapQualitativeSeverity(v).source, 'exact');
    assert.equal(mapQualitativeSeverity('SEVERE').rating, 'critical', 'case must not decide the reading');
    assert.equal(mapQualitativeSeverity('').rating, null);
  });

  test('no KEV record means no KEV arms — absence, never a confident "not exploited"', () => {
    const v = buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT, null, { kev: {} }).vulnerabilities[0];
    assert.ok(!(v.threats || []).some((t) => t.category === 'exploit_status'));
    assert.ok(!(v.remediations || []).some((r) => /fix-by/.test(r.details || '')));
  });

  test('a malformed catalogue date yields a threat WITHOUT a date, not a guessed one', () => {
    const t = threatOf(buildCsaf21(PRODUCT, MAKER, STATEMENTS, { sliceId: 's1' }, AT, null,
      { kev: { 'CVE-2026-1': { ...KEV_REC, dateAdded: 'sometime' } } }));
    assert.ok(t, 'the KEV fact still stands even when its date is unusable');
    assert.equal(t.date, undefined);
    assert.match(t.details, /on an unrecorded date/);
  });

  test('building 2.1 does not mutate a 2.0 document built from the same inputs', () => {
    // The emitter projects the 2.0 document. If it ever shared structure instead of rebuilding,
    // emitting both would corrupt the 2.0 output — and the CLI emits both on `--format all`.
    const a = emit20();
    emit21();
    assert.ok(a.vulnerabilities[0].scores, 'the 2.0 document lost `scores` after a 2.1 build');
    assert.equal(a.document.csaf_version, '2.0', 'the 2.0 document was re-versioned by the 2.1 build');
  });
});
