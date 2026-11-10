// Parses CWE XML into weakness and category maps with view-scoped edges (bin/cwe-graph.mjs parseCatalogue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogue } from '../cwe-graph.mjs';

test('parses a self-closing weakness with a matching view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="ChildOf" View_ID="1000" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", ChildOf: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a non-matching view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="ChildOf" View_ID="699" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable" } }, categories: {} });
});

test('parses a self-closing weakness with a lateral edge in a non-matching view', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="PeerOf" View_ID="699" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", PeerOf: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with an empty view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="ChildOf" View_ID="" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", ChildOf: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a missing view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="ChildOf" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", ChildOf: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a non-matching nature edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="Requires" View_ID="1000" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", Requires: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a non-matching nature and view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="Requires" View_ID="699" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", Requires: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a non-matching nature and empty view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="Requires" View_ID="" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", Requires: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a non-matching nature and missing view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="Requires" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", Requires: ["200"] } }, categories: {} });
});

test('parses a self-closing weakness with a non-matching nature and non-matching view edge', () => {
  const xml = '<Weakness ID="100" Name="A" Abstraction="Class" Status="Stable"><Related_Weakness Nature="Requires" View_ID="699" CWE_ID="200"/></Weakness>';
  assert.deepEqual(parseCatalogue(xml), { cwes: { "100": { name: "A", abstraction: "Class", status: "Stable", Requires: ["200"] } }, categories: {} });
});
