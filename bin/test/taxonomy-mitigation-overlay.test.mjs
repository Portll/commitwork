// node --test bin/test/taxonomy-mitigation-overlay.test.mjs
//
// The mitigation axis is split across the publication boundary, and this pins both halves.
//
// The failure taxonomy records classes observed across the maintainer's whole fleet, and a record
// that names which tool produced the failure is the only kind another reader can re-audit. Those
// tool names are configuration about a private fleet rather than part of this product, so the
// tracked registry carries commitwork's own layer and the rest sit in the private store, merged at
// render time by mergeMitigationOverlay().
//
// THE DIRECTION THAT MATTERS: an ABSENT overlay is the PUBLIC shape — a clone with no private store
// renders commitwork's records, which is the sample the page is meant to show. An overlay that
// EXISTS and cannot be used is a refusal. Those two are one line apart in the code and opposite in
// consequence, so they are asserted separately. Before this split the generated page carried 989
// denied-term hits, a third of the whole release gate's count, from two byte-identical copies.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeMitigationOverlay } from '../taxonomy-render.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'tax-overlay-'));
const PRODUCT = { layer: 'remediation', test: 'The record names a mechanism in commitwork.' };
const OTHER = { layer: 'help', test: 'The record names what the other layer does.' };
const entry = (product, what) => ({ product, status: 'open', what, evidence: 'scoreBasis', date: '2026-01-01' });

// A register small enough to read, carrying the one shape the merge cares about.
const register = () => ({
  version: 4,
  mitigationVocabulary: { products: { commitwork: { ...PRODUCT } }, statuses: { open: { test: 'nothing executes' } } },
  classes: [
    { id: 'C1', mitigations: [entry('commitwork', 'the guard exists')] },
    { id: 'C2' },
  ],
});
const write = (dir, doc) => { const p = join(dir, 'overlay.json'); writeFileSync(p, JSON.stringify(doc)); return p; };

describe('an absent overlay is the public shape, not a failure', () => {
  test('the register comes back untouched, with only this product declared', () => {
    const dir = scratch();
    try {
      const doc = mergeMitigationOverlay(register(), { path: join(dir, 'nothing-here.json') });
      assert.deepEqual(Object.keys(doc.mitigationVocabulary.products), ['commitwork']);
      assert.equal(doc.classes[0].mitigations.length, 1);
      assert.equal(doc.classes[1].mitigations, undefined, 'a class with no record must not gain an empty list');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('an overlay that exists and cannot be used REFUSES', () => {
  test('unparseable JSON throws and names the path', () => {
    const dir = scratch();
    try {
      const p = join(dir, 'overlay.json');
      writeFileSync(p, 'not json at all');
      assert.throws(() => mergeMitigationOverlay(register(), { path: p }), /not valid JSON/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a directory in place of the file throws rather than reading as absent', () => {
    const dir = scratch();
    try {
      // EISDIR, not ENOENT: only a missing file is the public shape.
      assert.throws(() => mergeMitigationOverlay(register(), { path: dir }), /could not be read/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('entries for a class the register does not declare throw — a stale overlay loses records', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1, products: {}, entries: { ZZ99: [entry('commitwork', 'x')] } });
      assert.throws(() => mergeMitigationOverlay(register(), { path: p }), /does not declare/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a register with no product vocabulary throws rather than inventing one', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1, products: { other: { ...OTHER } }, entries: {} });
      const bare = { version: 4, classes: [{ id: 'C1' }] };
      assert.throws(() => mergeMitigationOverlay(bare, { path: p }), /nothing to merge into/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the merge adds and never overwrites', () => {
  test('a product and its entries arrive, and land on the right class', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1, products: { other: { ...OTHER } }, entries: { C2: [entry('other', 'the other layer logs it')] } });
      const doc = mergeMitigationOverlay(register(), { path: p });
      assert.deepEqual(Object.keys(doc.mitigationVocabulary.products).sort(), ['commitwork', 'other']);
      assert.equal(doc.classes[1].mitigations.length, 1);
      assert.equal(doc.classes[1].mitigations[0].product, 'other');
      assert.equal(doc.classes[0].mitigations.length, 1, 'an unrelated class is untouched');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a product the register already declares keeps the REGISTER definition', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1, products: { commitwork: { layer: 'help', test: 'the overlay version' } }, entries: {} });
      const doc = mergeMitigationOverlay(register(), { path: p });
      assert.equal(doc.mitigationVocabulary.products.commitwork.layer, 'remediation',
        'the overlay must not restate this product own layer');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an entry already on the class is not duplicated', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1, products: {}, entries: { C1: [entry('commitwork', 'the guard exists')] } });
      const doc = mergeMitigationOverlay(register(), { path: p });
      assert.equal(doc.classes[0].mitigations.length, 1, 'same product and same `what` is the same record');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('the same product with a DIFFERENT record is a second record, not a duplicate', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1, products: {}, entries: { C1: [entry('commitwork', 'a different mechanism')] } });
      const doc = mergeMitigationOverlay(register(), { path: p });
      assert.equal(doc.classes[0].mitigations.length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
