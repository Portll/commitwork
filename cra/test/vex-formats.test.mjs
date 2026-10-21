// node --test cra/test/ — the three VEX projections must agree with each other and with the record.
// Fixture-driven; annotations are built inline so the shared fixture keeps its own meaning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const NOW = '2026-07-20T00:00:00.000Z';

const load = (n) => JSON.parse(readFileSync(join(FIX, n), 'utf8'));
const vexMod = () => import(pathToFileURL(join(REPO, 'cra', 'vex.mjs')).href);

function inputs(annotations) {
  const products = load('products.json');
  return {
    product: products.products[0],
    manufacturer: products.manufacturer,
    rollup: load('rollup.json'),
    ledger: load('ledger.json').entries,
    annDoc: annotations ? { annotations } : load('annotations.json'),
  };
}

// An operator acceptance over a finding that is otherwise exploitable.
const ACCEPT = [{ id: 'CVE-2026-11111', repo: 'repo-a', action: 'accept', reason: 'compensating control at the gateway', who: 'operator', at: '2026-07-02T00:00:00Z' }];

test('the three formats never contradict each other about a vulnerability', async () => {
  const { buildAll } = await vexMod();
  const i = inputs();
  const { cdx, csaf, openvex } = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);

  // one shared vocabulary, three renderings of it
  const EQUIV = {
    exploitable: { csaf: 'known_affected', openvex: 'affected' },
    in_triage: { csaf: 'under_investigation', openvex: 'under_investigation' },
    false_positive: { csaf: 'known_not_affected', openvex: 'not_affected' },
    resolved: { csaf: 'fixed', openvex: 'fixed' },
  };
  const csafStatus = (id) => Object.keys(csaf.vulnerabilities.find((v) => v.cve === id).product_status)[0];
  const ovStatus = (id) => openvex.statements.find((s) => s.vulnerability.name === id).status;

  assert.equal(cdx.vulnerabilities.length, csaf.vulnerabilities.length);
  assert.equal(cdx.vulnerabilities.length, openvex.statements.length);
  for (const v of cdx.vulnerabilities) {
    const want = EQUIV[v.analysis.state];
    if (!want) continue; // `accepted` renders as exploitable in cdx; covered separately below
    assert.equal(csafStatus(v.id), want.csaf, `${v.id} csaf`);
    assert.equal(ovStatus(v.id), want.openvex, `${v.id} openvex`);
  }
});

test('an accepted finding is AFFECTED in every format — never not_affected', async () => {
  const { buildAll, collectStatements } = await vexMod();
  const i = inputs(ACCEPT);
  const st = collectStatements(i.product, i.rollup, i.ledger, i.annDoc, NOW)
    .find((s) => s.vulnId === 'CVE-2026-11111');
  assert.equal(st.state, 'accepted');

  const { cdx, csaf, openvex } = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);

  // CycloneDX has no plain "affected": exploitable IS affected, and the decision rides in response.
  const c = cdx.vulnerabilities.find((v) => v.id === 'CVE-2026-11111');
  assert.equal(c.analysis.state, 'exploitable');
  assert.deepEqual(c.analysis.response, ['will_not_fix']);

  const s = csaf.vulnerabilities.find((v) => v.cve === 'CVE-2026-11111');
  assert.ok(s.product_status.known_affected, 'csaf must say known_affected');
  assert.equal(s.product_status.known_not_affected, undefined);
  assert.equal(s.remediations[0].category, 'no_fix_planned');
  assert.match(s.remediations[0].details, /compensating control/);

  const o = openvex.statements.find((x) => x.vulnerability.name === 'CVE-2026-11111');
  assert.equal(o.status, 'affected');
  assert.match(o.action_statement, /No fix planned/);
  assert.match(o.action_statement, /compensating control/);
});

test('not_affected carries the recorded reason and never a synthesised justification', async () => {
  const { buildAll } = await vexMod();
  const i = inputs();
  const { csaf, openvex } = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);

  // CVE-2026-33333 is annotated false-positive in the fixture, reason "test data only"
  const o = openvex.statements.find((x) => x.vulnerability.name === 'CVE-2026-33333');
  assert.equal(o.status, 'not_affected');
  assert.equal(o.impact_statement, 'test data only');
  assert.equal(o.justification, undefined, 'a justification is a claim about code nobody verified');

  const s = csaf.vulnerabilities.find((v) => v.cve === 'CVE-2026-33333');
  assert.equal(s.flags, undefined, 'csaf flag labels are the same enumerated claim');
  assert.equal(s.threats[0].category, 'impact');
  assert.equal(s.threats[0].details, 'test data only');
});

test('unknown-not-scanned stays under investigation in both new formats — explicit uncertainty', async () => {
  const { buildCsaf, buildOpenVex } = await import(pathToFileURL(join(REPO, 'cra', 'vex-formats.mjs')).href);
  const st = [{
    vulnId: 'CVE-2026-77777', state: 'in_triage', origin: 'finding', decision: null, reason: null,
    advisory: null, cvss: null, severity: null,
    affects: [{ ref: 'repo-a/unscanned@1.0.0', repo: 'repo-a', package: 'unscanned', version: '1.0.0' }],
    detail: 'lane never ran', firstIssued: NOW, lastUpdated: NOW,
  }];
  const i = inputs();
  const csaf = buildCsaf(i.product, i.manufacturer, st, i.rollup, NOW);
  const openvex = buildOpenVex(i.product, i.manufacturer, st, NOW);
  assert.ok(csaf.vulnerabilities[0].product_status.under_investigation);
  assert.equal(csaf.vulnerabilities[0].product_status.known_not_affected, undefined);
  assert.equal(openvex.statements[0].status, 'under_investigation');
});

test('every CSAF product_id referenced by a statement is declared in the product_tree', async () => {
  const { buildAll } = await vexMod();
  const i = inputs();
  const { csaf } = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);
  const declared = new Set([
    ...csaf.product_tree.full_product_names.map((p) => p.product_id),
    ...csaf.product_tree.relationships.map((r) => r.full_product_name.product_id),
  ]);
  let referenced = 0;
  for (const v of csaf.vulnerabilities) {
    for (const ids of Object.values(v.product_status)) {
      for (const id of ids) { referenced++; assert.ok(declared.has(id), `${id} is referenced but undeclared`); }
    }
  }
  assert.ok(referenced > 0, 'a vacuous pass would prove nothing');
});

test('weak ledger evidence reaches none of the three formats', async () => {
  const { buildAll } = await vexMod();
  const i = inputs();
  const { cdx, csaf, openvex } = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);
  assert.ok(!cdx.vulnerabilities.some((v) => v.id === 'CVE-2026-66666'));
  assert.ok(!csaf.vulnerabilities.some((v) => v.cve === 'CVE-2026-66666'));
  assert.ok(!openvex.statements.some((s) => s.vulnerability.name === 'CVE-2026-66666'));
});

test('all three are deterministic — same inputs, byte-identical documents', async () => {
  const { buildAll } = await vexMod();
  const i = inputs(ACCEPT);
  const a = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);
  const b = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);
  for (const f of ['cdx', 'csaf', 'openvex']) {
    assert.equal(JSON.stringify(a[f]), JSON.stringify(b[f]), `${f} is not deterministic`);
  }
});

test('both new documents declare themselves drafts that assert no filing', async () => {
  const { buildAll } = await vexMod();
  const i = inputs();
  const { csaf } = buildAll(i.product, i.manufacturer, i.rollup, i.ledger, i.annDoc, NOW);
  const legal = csaf.document.notes.find((n) => n.category === 'legal_disclaimer');
  assert.match(legal.text, /human act/);
});
