// node --test cra/test/ — phases 3 and 5: annotations carry determinations, documents declare loss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { annotationsPathFor } from '../../monitor/store-paths.mjs';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(REPO, 'cra', 'test', 'fixtures');
const V = await import(pathToFileURL(join(REPO, 'cra', 'vex.mjs')).href);
const D = await import(pathToFileURL(join(REPO, 'cra', 'determination.mjs')).href);
const NOW = '2026-07-20T00:00:00.000Z';
const load = (n) => JSON.parse(readFileSync(join(FIX, n), 'utf8'));

// ── phase 3: annotations → determinations ───────────────────────────────────────────────────────

test('an explicit determination is used as given, and marked explicit', () => {
  const r = D.determinationFromAnnotation({ action: 'accept', reason: 'r', who: 'w', at: NOW,
    determination: { presence: 'component_present_code_present', remediation: 'no_fix_available_upstream' } });
  assert.equal(r.source, 'explicit');
  assert.equal(r.determination.remediation, 'no_fix_available_upstream');
  assert.deepEqual(r.errors, []);
});

test('a legacy action expands to ONLY what the action establishes', () => {
  const r = D.determinationFromAnnotation({ action: 'accept', reason: 'r', who: 'w', at: NOW });
  assert.equal(r.source, 'legacy-action');
  assert.equal(r.determination.remediation, 'will_not_fix_by_choice');
  assert.equal(r.determination.reachability, undefined, 'an accept says nothing about reachability');
  assert.equal(r.evidence[0].method, 'manual_review');
});

test('false-positive yields NO determination — it disputes the finding, not the exposure', () => {
  const r = D.determinationFromAnnotation({ action: 'false-positive', reason: 'r', who: 'w', at: NOW });
  assert.equal(r.determination, null);
  assert.equal(r.source, 'none');
});

test('an illegal explicit determination is reported, not silently accepted', () => {
  const r = D.determinationFromAnnotation({ action: 'accept', reason: 'r', who: 'w', at: NOW,
    determination: { presence: 'component_absent', reachability: 'unreachable_static' } });
  assert.ok(r.errors.some((e) => /absent component has no call graph/.test(e)));
});

test('validateAnnotation catches an undeclared action, method and confidence', () => {
  assert.ok(D.validateAnnotation({ action: 'vibes', reason: 'r', who: 'w', at: NOW }).some((e) => /not a declared action/.test(e)));
  assert.ok(D.validateAnnotation({ action: 'note', reason: 'r', who: 'w', at: NOW,
    determination: { evidence: [{ method: 'a-hunch' }] } }).some((e) => /not a declared method/.test(e)));
  assert.deepEqual(D.validateAnnotation(load('annotations.json').annotations[0]), [], 'the live fixture must validate');
});

// The live store is private (monitor/store-paths.mjs): the shipped example always runs, the private
// store when present. Its absence (ENOENT, no CW_ANNOTATIONS) is a stated skip.
for (const [label, path] of [['the shipped example', join(REPO, 'monitor', 'annotations.example.json')], ['the private store', annotationsPathFor(REPO)]]) {
  test(`EVERY annotation in ${label} validates`, (t) => {
    let store;
    try { store = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
      if (e.code === 'ENOENT' && label !== 'the shipped example' && !process.env.CW_ANNOTATIONS) return t.skip(`${path} absent (ENOENT): private record`);
      throw e;
    }
    assert.ok((store.annotations || []).length > 0, `${path} carries no annotations to validate`);
    for (const a of store.annotations || []) {
      assert.deepEqual(D.validateAnnotation(a), [], `${a.id || '(wildcard)'} does not validate`);
    }
  });
}

// ── phase 5: the fidelity ledger ────────────────────────────────────────────────────────────────

const build = () => {
  const products = load('products.json');
  return V.buildAll(products.products[0], products.manufacturer, load('rollup.json'),
    load('ledger.json').entries, load('annotations.json'), NOW);
};

test('a lifecycle state is not a determination — an open finding claims only presence', () => {
  const d = V.determinationForStatement({ state: 'exploitable' });
  assert.equal(d.presence, 'component_present_code_present');
  assert.equal(d.reachability, undefined, 'inventing reachability here is the confabulation the gate exists to stop');
  assert.equal(V.determinationForStatement({ state: 'false_positive' }), null);
});

test('a joined reachability proof reaches the determination', () => {
  const d = V.determinationForStatement({ state: 'exploitable' }, { reachability: 'reachable' });
  assert.equal(d.reachability, 'reachable');
});

test('every format carries a fidelity ledger, and it names what was lost', () => {
  const { cdx, csaf, openvex } = build();
  const cdxF = JSON.parse((cdx.metadata.properties || []).find((p) => p.name === 'commitwork:fidelity').value);
  const csafF = JSON.parse((csaf.document.notes || []).find((n) => n.title === 'commitwork:fidelity').text);
  const ovF = openvex['commitwork:fidelity'];
  for (const [name, f] of [['cdx', cdxF], ['csaf', csafF], ['openvex', ovF]]) {
    assert.ok(f, `${name} carries no fidelity ledger`);
    assert.equal(typeof f.exact, 'number');
    assert.equal(typeof f.lossless, 'boolean', 'losslessness is STATED, never inferred from a zero');
    assert.ok(Array.isArray(f.lost));
    for (const l of f.lost) assert.ok(l.vulnId && l.note, 'a declared loss names the statement and the reason');
  }
});

test('OpenVEX declares the loss CycloneDX does not have — the ledger is per format', () => {
  const { cdx, openvex } = build();
  const cdxF = JSON.parse((cdx.metadata.properties || []).find((p) => p.name === 'commitwork:fidelity').value);
  const ovF = openvex['commitwork:fidelity'];
  // OpenVEX has no response vocabulary at all, so a remediation must go to prose.
  assert.ok(ovF.prose_only > 0, 'OpenVEX cannot carry a response and must say so');
  assert.equal(ovF.lossless, false);
  assert.equal(cdxF.lossless, true, 'CycloneDX carries these statements exactly');
});

test('the documents are still deterministic with the ledger attached', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});
