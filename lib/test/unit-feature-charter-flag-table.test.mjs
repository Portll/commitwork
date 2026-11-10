// Maps a feature charter to a table of experimental flags with their groups and keys (lib/feature-charter.mjs flagTable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagTable } from '../feature-charter.mjs';

test('returns an empty map when the charter has no experimentalFlags', () => {
  assert.deepEqual(flagTable({}), new Map([]));
});

test('throws when experimentalFlags is an array', () => {
  assert.throws(() => flagTable({ experimentalFlags: [] }), { name: 'Error', message: 'feature-charter: experimentalFlags must be an object of {id: {label, why}}' });
});

test('throws when a flag id is not kebab-case', () => {
  assert.throws(() => flagTable({ experimentalFlags: { 'Bad-Id': { label: 'L', why: 'W' } } }), { name: 'Error', message: 'feature-charter: flag id "Bad-Id" is not kebab-case (2-40 chars)' });
});

test('throws when a flag is missing a label', () => {
  assert.throws(() => flagTable({ experimentalFlags: { 'my-flag': { why: 'W' } } }), { name: 'Error', message: 'feature-charter: flag my-flag needs a label and a why' });
});

test('throws when a flag has non-string views', () => {
  assert.throws(() => flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W', views: [1] } } }), { name: 'Error', message: 'feature-charter: flag my-flag views must be an array of panel view ids' });
});

test('returns a flag with empty keys when it has no views', () => {
  assert.deepEqual(flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W' } } }), new Map([["my-flag", { id: "my-flag", label: "L", why: "W", groups: [], keys: {} }]]));
});

test('returns a flag with view keys when views are provided', () => {
  assert.deepEqual(flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W', views: ['v1'] } } }), new Map([["my-flag", { id: "my-flag", label: "L", why: "W", groups: [], keys: { view: ["v1"] } }]]));
});

test('throws when a group is experimental but missing a flag', () => {
  assert.throws(() => flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W' } }, groups: [{ id: 'g1', experimental: true }] }), { name: 'Error', message: 'feature-charter: group g1 must carry both "experimental": true and a "flag", or neither' });
});

test('throws when a flagged group is not ring-outward', () => {
  assert.throws(() => flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W' } }, groups: [{ id: 'g1', experimental: true, flag: 'my-flag', class: 'ring-inward' }] }), { name: 'Error', message: 'feature-charter: group g1 is ring-inward; only ring-outward groups are flagged' });
});

test('throws when a group names a flag not declared in experimentalFlags', () => {
  assert.throws(() => flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W' } }, groups: [{ id: 'g1', experimental: true, flag: 'other-flag', class: 'ring-outward' }] }), { name: 'Error', message: 'feature-charter: group g1 names flag "other-flag", which experimentalFlags does not declare' });
});

test('returns a flag with group data when a valid ring-outward group references it', () => {
  assert.deepEqual(flagTable({ experimentalFlags: { 'my-flag': { label: 'L', why: 'W' } }, groups: [{ id: 'g1', experimental: true, flag: 'my-flag', class: 'ring-outward', surface: 's1', keys: ['k1'] }] }), new Map([["my-flag", { id: "my-flag", label: "L", why: "W", groups: [{ id: "g1", surface: "s1", keys: ["k1"], views: [] }], keys: { s1: ["k1"] } }]]));
});
