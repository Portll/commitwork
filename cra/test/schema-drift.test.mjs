// node --test cra/test/ — the hand-written validator and the schema it MIRRORS must not drift.
//
// cra/lib.mjs says of itself: "Zero-dep validator mirroring schema/product.schema.json". Two
// authorities for one document, kept in step by hand. This does not merge them — it makes the
// divergence a test failure instead of a silent acceptance.
// Source: evaluations/REMEDIATION-schema-derivation-2026-08-22.md R1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = JSON.parse(readFileSync(join(REPO, 'schema', 'product.schema.json'), 'utf8'));
const libSrc = readFileSync(join(REPO, 'cra', 'lib.mjs'), 'utf8');

test('every product property in the schema is mentioned by the validator that mirrors it', () => {
  const props = Object.keys(schema.properties.products.items.properties);
  assert.ok(props.length >= 8, 'a shrunken schema would make this vacuous');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a property name read from the schema under test
  const missing = props.filter((p) => !new RegExp(`\\b${p}\\b`).test(libSrc));
  assert.deepEqual(missing, [],
    'schema properties the validator never mentions — the schema permits a field nothing checks');
});

test('the schema admits the reporting locale the watch actually reads', async () => {
  // The concrete failure this catches: `reporting` was added to products.json handling and to
  // reportingFor without ever being added to the schema, while the schema declares
  // additionalProperties:false — so a product using the feature was schema-invalid.
  const item = schema.properties.products.items;
  assert.equal(item.additionalProperties, false, 'if this ever becomes true the guard below is moot');
  assert.ok(item.properties.reporting, 'watch.mjs reads product.reporting.locale; the schema must admit it');
  assert.ok(item.properties.reporting.properties.locale);
});

test('the EU member-state set is DERIVED from the directory, not a second literal', async () => {
  const { euMemberStateNames } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const dir = JSON.parse(readFileSync(join(REPO, 'cra', 'csirt-directory.json'), 'utf8'));
  const set = euMemberStateNames();
  assert.equal(dir.memberStates.length, 27, 'the EU has 27 member states; a short directory is a truncated one');
  for (const m of dir.memberStates) {
    assert.ok(set.has(m.name.toLowerCase()), `${m.name} is in the directory but not in the validator's set`);
    assert.ok(set.has(m.code.toLowerCase()), `${m.code} must validate as readily as the full name`);
  }
  // The literal that used to live in lib.mjs is gone. If someone re-adds one, this catches it.
  assert.ok(!/'austria',\s*'belgium'/.test(libSrc),
    'a second hardcoded member-state list has reappeared in cra/lib.mjs — derive it from the directory');
});

test('a member state not in the directory is rejected, and the set never silently empties', async () => {
  const { euMemberStateNames } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const set = euMemberStateNames();
  assert.ok(!set.has('narnia'));
  assert.ok(!set.has('united kingdom'), 'the UK is a benchmark regime, not a member state');
  assert.ok(set.size >= 54, 'names + codes for 27 states, at minimum — an empty set would accept everything');
});
