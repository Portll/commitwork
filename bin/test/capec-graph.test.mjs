// Each test here enforces a constraint from evaluations/STPA-capec-attack-2026-08-23.md §6. The
// analysis is only worth writing if the constraints it derived are mechanically held.
//
// Every test that selects a fixture from the graph ASSERTS IT FOUND ONE. A silent `return` when the
// search misses is green over an empty subject, and a negative control cannot catch that — there is
// nothing to break. See cw-taxonomy-gaps-20260823 task 1.45.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseCatalogue, attributionFor, loadGraph, graphPath, serialise } from '../capec-graph.mjs';
import { loadGraph as loadCwe, ancestors } from '../cwe-graph.mjs';

const G = existsSync(graphPath()) ? loadGraph() : null;
const CG = loadCwe();
const built = (name, fn) => test(name, { skip: G ? false : 'graph not built' }, fn);

const XML = `
<Attack_Pattern ID="63" Name="XSS" Abstraction="Standard" Status="Stable">
  <Related_Weaknesses><Related_Weakness CWE_ID="79"/><Related_Weakness CWE_ID="79"/></Related_Weaknesses>
  <Taxonomy_Mappings>
    <Taxonomy_Mapping Taxonomy_Name="ATTACK"><Entry_ID>1059.007</Entry_ID></Taxonomy_Mapping>
    <Taxonomy_Mapping Taxonomy_Name="OWASP"><Entry_ID>A03</Entry_ID></Taxonomy_Mapping>
  </Taxonomy_Mappings>
</Attack_Pattern>
<Attack_Pattern ID="999" Name="Gone" Abstraction="Detailed" Status="Deprecated">
  <Related_Weaknesses><Related_Weakness CWE_ID="79"/></Related_Weaknesses>
</Attack_Pattern>`;

describe('§6.4 deprecated is excluded AND counted', () => {
  test('a deprecated pattern never reaches the graph', () => {
    const g = parseCatalogue(XML);
    assert.equal(g.patterns['999'], undefined);
    assert.equal(g.dropped.deprecated, 1);
    assert.deepEqual(g.byCwe['79'], ['63'], 'a deprecated pattern leaked into the CWE join');
  });
  built('the built graph carries no deprecated or obsolete status', () => {
    const bad = Object.entries(G.patterns).filter(([, p]) => ['Deprecated', 'Obsolete'].includes(p.status));
    assert.deepEqual(bad.map(([k]) => k), []);
  });
});

describe('§6.1/6.2 attributes, never rows — enrichment cannot multiply', () => {
  built('a CWE with heavy fan-out yields ONE attribution object', () => {
    // measured max is 59 CAPECs for a single CWE; the per-technique row shape would be 78k rows
    const worst = Object.entries(G.byCwe).sort((a, b) => b[1].length - a[1].length)[0];
    const a = attributionFor([`CWE-${worst[0]}`], G);
    assert.equal(typeof a.capec, 'string');
    assert.equal(typeof a.attack, 'string');
    assert.ok(!Array.isArray(a), 'attribution returned a list — that is the row-multiplying shape');
  });
  built('enrichment never returns a severity field of any kind', () => {
    const a = attributionFor(['CWE-79'], G);
    for (const k of Object.keys(a)) {
      assert.ok(!/^(sev|severity|score|crit|high|med|low)$/i.test(k), `enrichment emitted ${k}`);
    }
  });
});

describe('§6.3 derivation strength is published, and ancestor is off by default', () => {
  built('a direct hit says direct', () => {
    assert.equal(attributionFor(['CWE-79'], G).capecVia, 'direct');
  });
  built('ancestor derivation requires being asked for', () => {
    // an unmapped CWE stays unmapped without the cwe graph, whatever its parents offer
    const unmapped = Object.keys(CG.cwes).find((c) => !G.byCwe[c] && CG.cwes[c].ChildOf);
    assert.ok(unmapped, 'no fixture CWE found — this test would have passed on an empty subject');
    assert.equal(attributionFor([`CWE-${unmapped}`], G).capecVia, '');
    assert.equal(attributionFor([`CWE-${unmapped}`], G).capecReason, 'cwe-unmapped');
  });
  built('when enabled, an ancestor-derived hit is LABELLED, never passed off as direct', () => {
    const unmapped = Object.keys(CG.cwes)
      .find((c) => !G.byCwe[c] && (ancestors(CG, c) || []).slice(0, 1).some((p) => G.byCwe[p]));
    assert.ok(unmapped, 'no fixture CWE found — this test would have passed on an empty subject');
    const a = attributionFor([`CWE-${unmapped}`], G, { cweGraph: CG, ancestors });
    assert.equal(a.capecVia, 'ancestor');
    assert.ok(a.capec, 'ancestor mode found nothing at a CWE chosen because its parent maps');
  });
  test('ancestor walk is depth-1 — each further step compounds the generalisation', () => {
    const g = parseCatalogue('<Attack_Pattern ID="1" Name="P" Abstraction="Meta" Status="Stable">'
      + '<Related_Weaknesses><Related_Weakness CWE_ID="707"/></Related_Weaknesses></Attack_Pattern>');
    const cwe = { cwes: { 79: { ChildOf: ['74'] }, 74: { ChildOf: ['707'] }, 707: {} } };
    const a = attributionFor(['CWE-79'], g, { cweGraph: cwe, ancestors });
    assert.equal(a.capec, '', 'a grandparent match was accepted — depth-1 was not enforced');
  });
});

describe('§6.5 unmapped is declared, never a bare blank', () => {
  built('no CWE at all', () => {
    assert.equal(attributionFor([], G).capecReason, 'no-cwe');
    assert.equal(attributionFor(null, G).capecReason, 'no-cwe');
  });
  built('a CWE nothing maps', () => {
    assert.equal(attributionFor(['CWE-99999'], G).capecReason, 'cwe-unmapped');
  });
  built('mapped to a pattern that carries no technique — 71% of patterns', () => {
    const a = attributionFor(['CWE-79'], G);
    assert.ok(a.capec, 'CWE-79 should reach a CAPEC');
    if (!a.attack) assert.match(a.capecReason, /capec-has-no-attack/);
  });
  built('every blank capec has a reason and every reason is declared', () => {
    const OK = /^(no-cwe|cwe-unmapped|capec-has-no-attack|capped-\d+)(\+(capec-has-no-attack))?$/;
    for (const c of ['CWE-79', 'CWE-400', 'CWE-99999', 'CWE-22']) {
      const a = attributionFor([c], G);
      if (!a.capec) assert.ok(a.capecReason, `${c} blank with no reason`);
      if (a.capecReason) assert.match(a.capecReason, OK, `${c} → undeclared reason ${a.capecReason}`);
    }
  });
});

describe('§6.4 a cap that is not stated is a silent truncation', () => {
  built('the cap is reported with the true count', () => {
    const worst = Object.entries(G.byCwe).sort((a, b) => b[1].length - a[1].length)[0];
    const a = attributionFor([`CWE-${worst[0]}`], G, { cap: 2 });
    assert.equal(a.capec.split(' ').length, 2);
    assert.match(a.capecReason, new RegExp(`capped-${worst[1].length}`));
  });
});

describe('§6.7/6.8 one direction, separate graphs', () => {
  built('the artifact carries no ATT&CK→CAPEC inverse', () => {
    for (const k of Object.keys(G)) {
      assert.ok(!/byAttack|attackTo|inverse/i.test(k), `${k} looks like an inverse index`);
    }
  });
  built('technique ids are T-prefixed — a bare number resolves nowhere in ATT&CK', () => {
    const techs = [...new Set(Object.values(G.patterns).flatMap((p) => p.attack || []))];
    assert.ok(techs.length > 100, `only ${techs.length} techniques parsed`);
    for (const t of techs) assert.match(t, /^T\d+(\.\d+)?$/, `malformed technique id ${t}`);
  });
  built('only ATTACK taxonomy entries become techniques', () => {
    const g = parseCatalogue(XML);
    assert.deepEqual(g.patterns['63'].attack, ['T1059.007'], 'a non-ATT&CK taxonomy entry leaked in');
  });
  built('CAPEC ids and CWE ids are not interchangeable', () => {
    // the two graphs are separate namespaces; CAPEC-63 and CWE-63 are unrelated things
    assert.ok(G.patterns['63'], 'CAPEC-63 missing');
    assert.notEqual(G.patterns['63'].name, (CG.cwes['63'] || {}).name);
  });
});

built('§6 determinism — same graph serialises byte-identically, ids sorted numerically', () => {
  assert.equal(serialise(G), serialise(G));
  const ids = Object.keys(JSON.parse(serialise(G)).patterns);
  assert.deepEqual(ids, [...ids].sort((a, b) => Number(a) - Number(b)));
});

built('the checked-in graph is self-consistent', () => {
  assert.equal(G.count, Object.keys(G.patterns).length);
  for (const [cwe, list] of Object.entries(G.byCwe)) {
    for (const p of list) assert.ok(G.patterns[p], `byCwe[${cwe}] cites missing pattern ${p}`);
  }
});
