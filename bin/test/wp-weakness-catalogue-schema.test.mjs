// The schema mirrors loadCatalogue in bin/wp-posture.mjs, which never applies it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../../monitor/registry.mjs';
import { SEVERITIES, VERBS } from '../wp-posture.mjs';
import { TYPES } from '../lib/wp-observables.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = join(REPO, 'schema', 'wp-weakness-catalogue.schema.json');
const readCatalogue = () => JSON.parse(readFileSync(join(REPO, 'manifests', 'wp-weakness-catalogue.json'), 'utf8'));
const predicateSchema = () => JSON.parse(readFileSync(SCHEMA, 'utf8')).properties.entries.items.properties.predicate.properties;
const errorsOf = (doc) => validateAgainstSchema(doc, { path: SCHEMA }).errors;

test('the shipped catalogue validates against its schema', () => {
  assert.deepEqual(errorsOf(readCatalogue()), []);
});

test('the catalogue holds more than ten entries, so the validation above read something', () => {
  const doc = readCatalogue();
  assert.ok(Array.isArray(doc.entries), 'entries must be an array');
  assert.ok(doc.entries.length > 10, `only ${doc.entries.length} entries`);
});

test('an entry with a verb the reader does not implement is refused', () => {
  const doc = readCatalogue();
  doc.entries[0].predicate.verb = 'sometimes';
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('entries[0].predicate.verb')), errors.join('\n'));
});

test('an entry missing a required field is refused', () => {
  const doc = readCatalogue();
  delete doc.entries[0].detail;
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('entries[0]') && e.includes("'detail'")), errors.join('\n'));
});

test('an unknown top-level key is refused', () => {
  const doc = readCatalogue();
  doc.__schema_probe__ = true;
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes("'__schema_probe__'")), errors.join('\n'));
});

test('an entry with an unknown key is refused', () => {
  const doc = readCatalogue();
  doc.entries[0].__schema_probe__ = true;
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('entries[0]') && e.includes("'__schema_probe__'")), errors.join('\n'));
});

test('a catalogue whose entries are not an array is refused', () => {
  const doc = readCatalogue();
  doc.entries = { 0: doc.entries[0] };
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('entries: expected array')), errors.join('\n'));
});

test('the schema lists the verbs the reader implements', () => {
  assert.deepEqual(predicateSchema().verb.enum, [...VERBS]);
});

test('the schema lists the severities the reader accepts', () => {
  const entry = JSON.parse(readFileSync(SCHEMA, 'utf8')).properties.entries.items.properties;
  assert.deepEqual(entry.sev.enum, [...SEVERITIES]);
});

test('the schema lists the observable types the reader collects, for a predicate and for its precondition', () => {
  assert.deepEqual(predicateSchema().type.enum, [...TYPES]);
  assert.deepEqual(predicateSchema().given.properties.type.enum, [...TYPES]);
});

test('an entry with an observable type the reader does not collect is refused', () => {
  const doc = readCatalogue();
  doc.entries[0].predicate.type = 'wp-nothing';
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('entries[0].predicate.type')), errors.join('\n'));
});

test('a where condition with an operator the reader does not implement is refused', () => {
  const doc = readCatalogue();
  doc.entries[0].predicate.where = { slug: { like: 'a' } };
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('entries[0].predicate.where.slug')), errors.join('\n'));
});

test('a precondition where with an operator the reader does not implement is refused', () => {
  const doc = readCatalogue();
  const i = doc.entries.findIndex((e) => e.predicate.given);
  assert.notEqual(i, -1, 'no shipped entry carries a precondition');
  doc.entries[i].predicate.given.where = { slug: { like: 'a' } };
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes(`entries[${i}].predicate.given.where.slug`)), errors.join('\n'));
});

test('a catalogue with no entries key is refused', () => {
  const doc = readCatalogue();
  delete doc.entries;
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes("required key 'entries'")), errors.join('\n'));
});
