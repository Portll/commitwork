// node --test bin/test/ — the derived VEX corpus must not drift from the vendored schemas.
//
// This exists because a prose read of the OASIS CSAF HTML got three of four lists wrong on
// 2026-08-22 (product_status 5 vs 8; an invented `component_present`; an invented `timing`).
// The corpus is DERIVED, and this asserts the derivation still reproduces what is committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { derive, assertShape, EXPECTED } = await import(pathToFileURL(join(REPO, 'bin', 'vex-vocabulary-sync.mjs')).href);

test('the committed corpus is exactly what the vendored schemas yield', () => {
  const fresh = derive();
  const committed = JSON.parse(readFileSync(join(REPO, 'schema', 'vex-vocabulary.json'), 'utf8'));
  assert.deepEqual(fresh.formats, committed.formats,
    'schema/vex-vocabulary.json is stale — re-run `node bin/vex-vocabulary-sync.mjs`');
  assert.equal(fresh.total, committed.total);
});

test('the extractor fails LOUD rather than yielding an empty corpus', () => {
  // An extractor that quietly returns null writes an empty vocabulary, and an empty vocabulary makes
  // every downstream exhaustiveness test pass vacuously — the corpus would certify its own absence.
  const broken = { formats: { csaf: {}, cyclonedx: {}, openvex: {} } };
  const problems = assertShape(broken);
  assert.ok(problems.length >= 9, `expected a refusal per axis, got ${problems.length}`);
  assert.ok(problems.every((p) => /did not extract at all/.test(p)));
});

test('a count that moves is reported as churn, not silently adopted', () => {
  const shrunk = { formats: { csaf: { status: ['a'], justification: [], threat: [], response: [] }, cyclonedx: {}, openvex: {} } };
  assert.ok(assertShape(shrunk).some((p) => /upstream churn or a broken extractor/.test(p)));
});

test('the expected shape is the one measured on 2026-08-22', () => {
  assert.equal(EXPECTED.csaf.status, 8);
  assert.equal(EXPECTED.cyclonedx.justification, 9);
  assert.equal(EXPECTED.openvex.status, 4);
  const total = Object.values(EXPECTED).reduce((a, ax) => a + Object.values(ax).reduce((b, n) => b + n, 0), 0);
  assert.equal(total, 50);
});
