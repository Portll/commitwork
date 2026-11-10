// extracts cwes, dropped and review entries from ids (cra/vex-formats.mjs cwesFromIds)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cwesFromIds } from '../vex-formats.mjs';

test('malformed id is dropped with schema reason', () => {
  const result = cwesFromIds(['CWE-0'], {});
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-0", why: "malformed id", test: "schema" }], review: [] });
});

test('id that matches a category is dropped with 6.1.11 reason', () => {
  const catalogue = { categories: { 'CWE-1': 'CategoryName' } };
  const result = cwesFromIds(['CWE-1'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-1", why: "CWE Category \"CategoryName\". CSAF 2.1 mandatory test 6.1.11: any id referring to a Category or View MUST fail. A category is a grouping, not a weakness, and MITRE does not permit mapping one to a vulnerability", test: "6.1.11" }], review: [] });
});

test('id that matches a view is dropped with 6.1.11 reason', () => {
  const catalogue = { views: { 'CWE-2': 'ViewName' } };
  const result = cwesFromIds(['CWE-2'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-2", why: "CWE View \"ViewName\". CSAF 2.1 mandatory test 6.1.11 fails a View for the same reason as a Category", test: "6.1.11" }], review: [] });
});

test('id not in weaknesses and rejected by name pattern is dropped with schema+6.1.11 reason', () => {
  const catalogue = { rejectedByCsafNamePattern: { 'CWE-3': 'BadName' } };
  const result = cwesFromIds(['CWE-3'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-3", why: "MITRE publishes the name \"BadName\", which the CSAF 2.1 cwes[].name pattern forbids. The schema cannot carry a name the CWE specification itself grades Allowed for mapping, and 6.1.11 fails an entry whose name does not match the catalogue \u2014 so there is no conformant way to cite this weakness at all", test: "schema+6.1.11" }], review: [] });
});

test('id not in weaknesses without forbidden name is dropped with 6.1.11 reason', () => {
  const catalogue = {};
  const result = cwesFromIds(['CWE-4'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-4", why: "not present in the vendored CWE catalogue \u2014 retired, or newer than the vendored version", test: "6.1.11" }], review: [] });
});

test('id with catalogue lacking version is dropped with 6.1.11 reason', () => {
  const catalogue = { weaknesses: { 'CWE-5': 'ValidName' } };
  const result = cwesFromIds(['CWE-5'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-5", why: "the catalogue declares no version, and 2.1 requires one", test: "6.1.11" }], review: [] });
});

test('id whose catalogue name fails NAME_RE is dropped with schema reason', () => {
  const catalogue = {
    version: '4.20',
    weaknesses: { 'CWE-6': ' invalid' },
  };
  const result = cwesFromIds(['CWE-6'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-6", why: "catalogue name breaks the CSAF 2.1 name pattern", test: "schema" }], review: [] });
});

test('deprecated weakness is dropped with 6.2.23 reason', () => {
  const catalogue = {
    version: '4.20',
    weaknesses: { 'CWE-7': 'GoodName' },
    status: { 'CWE-7': 'Deprecated' },
  };
  const result = cwesFromIds(['CWE-7'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-7", why: "\"GoodName\" is DEPRECATED in CWE 4.20", test: "6.2.23" }], review: [] });
});

test('usage Prohibited causes drop with 6.2.25 reason', () => {
  const catalogue = {
    version: '4.20',
    weaknesses: { 'CWE-8': 'GoodName' },
    mappingUsage: { 'CWE-8': 'Prohibited' },
  };
  const result = cwesFromIds(['CWE-8'], catalogue);
  assert.deepEqual(result, { cwes: [], dropped: [{ id: "CWE-8", why: "MITRE grades \"GoodName\" as Prohibited for vulnerability mapping; CSAF 2.1 test 6.2.25 allows only Allowed and Allowed-with-Review", test: "6.2.25" }], review: [] });
});

test('usage Allowed-with-Review adds entry to review array', () => {
  const catalogue = {
    version: '4.20',
    weaknesses: { 'CWE-9': 'GoodName' },
    mappingUsage: { 'CWE-9': 'Allowed-with-Review' },
  };
  const result = cwesFromIds(['CWE-9'], catalogue);
  assert.deepEqual(result, { cwes: [{ id: "CWE-9", name: "GoodName", version: "4.20" }], dropped: [], review: [{ id: "CWE-9", name: "GoodName", usage: "Allowed-with-Review" }] });
});

test('valid allowed entry appears in cwes array', () => {
  const catalogue = {
    version: '4.20',
    weaknesses: { 'CWE-10': 'GoodName' },
    mappingUsage: { 'CWE-10': 'Allowed' },
  };
  const result = cwesFromIds(['CWE-10'], catalogue);
  assert.deepEqual(result, { cwes: [{ id: "CWE-10", name: "GoodName", version: "4.20" }], dropped: [], review: [] });
});
