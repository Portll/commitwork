// Converts a Socket scan JSON into an array of alert rows (monitor/extractors/socket.mjs _socketAlertRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _socketAlertRows } from '../extractors/socket.mjs';

test('returns an empty array when the input is null', () => {
  assert.deepEqual(_socketAlertRows(null), []);
});

test('returns an empty array when the input is a string', () => {
  assert.deepEqual(_socketAlertRows('not-an-object'), []);
});

test('maps legacy issue rows with type, key, and pkg fields', () => {
  const j = { issues: [
    { type: 'malware', pkg: 'left-pad', version: '1.0.0', description: 'bad' },
    { key: 'troll', package: 'evil-pkg', version: '2.0.0', title: 'protest' },
    { type: 'gitHubDependency', pkg: 'git-pkg', version: '3.0.0' }
  ]};
  assert.deepEqual(_socketAlertRows(j), [{ rule: "malware", package: "left-pad", version: "1.0.0", sev: "crit", claimKind: "integrity", sevReason: "", message: "bad" }, { rule: "troll", package: "evil-pkg", version: "2.0.0", sev: "high", claimKind: "integrity", sevReason: "", message: "protest" }, { rule: "gitHubDependency", package: "git-pkg", version: "3.0.0", sev: "low", claimKind: "integrity", sevReason: "", message: "" }]);
});

test('maps legacy issue rows with null entries and missing fields', () => {
  const j = { issues: [null, { type: 'gptMalware' }, { key: 'obfuscatedFile', pkg: 'min', version: '0.1.0' }]};
  assert.deepEqual(_socketAlertRows(j), [{ rule: "", package: "", version: "", sev: "", claimKind: "", sevReason: "type-not-in-vocabulary", message: "" }, { rule: "gptMalware", package: "", version: "", sev: "", claimKind: "integrity", sevReason: "single-source-llm-unverified", message: "" }, { rule: "obfuscatedFile", package: "min", version: "0.1.0", sev: "", claimKind: "integrity", sevReason: "corroborates-minifiedCode-no-file-named", message: "" }]);
});

test('maps nested data alerts with ecosystem, package, and version keys', () => {
  const j = { data: { alerts: {
    npm: {
      'lodash': { '4.17.21': { type: 'criticalCVE', severity: 'critical', description: 'RCE' } },
      'express': { '4.18.0': { type: 'gitDependency', severity: 'high' } }
    },
    pypi: {
      'requests': { '2.31.0': { type: 'malware', severity: 'middle', title: 'steals keys' } }
    }
  }}};
  assert.deepEqual(_socketAlertRows(j), [{ rule: "criticalCVE", package: "lodash", version: "4.17.21", ecosystem: "npm", sev: "crit", claimKind: "vulnerability", sevReason: "pending-dedup-against-cve-lanes", message: "RCE" }, { rule: "gitDependency", package: "express", version: "4.18.0", ecosystem: "npm", sev: "high", claimKind: "integrity", sevReason: "", message: "" }, { rule: "malware", package: "requests", version: "2.31.0", ecosystem: "pypi", sev: "med", claimKind: "integrity", sevReason: "", message: "steals keys" }]);
});

test('maps nested data alerts with unknown types and missing severity', () => {
  const j = { data: { alerts: {
    npm: {
      'unknown-pkg': { '1.0.0': { type: 'futureType', severity: 'low' } },
      'no-sev': { '2.0.0': { type: 'troll' } }
    }
  }}};
  assert.deepEqual(_socketAlertRows(j), [{ rule: "futureType", package: "unknown-pkg", version: "1.0.0", ecosystem: "npm", sev: "low", claimKind: "", sevReason: "type-not-in-vocabulary", message: "" }, { rule: "troll", package: "no-sev", version: "2.0.0", ecosystem: "npm", sev: "high", claimKind: "integrity", sevReason: "", message: "" }]);
});

test('returns an empty array when data is present but alerts is missing', () => {
  assert.deepEqual(_socketAlertRows({ data: {} }), []);
});

test('returns an empty array when data is present but alerts is not an object', () => {
  assert.deepEqual(_socketAlertRows({ data: { alerts: 'string' } }), []);
});

test('returns an empty array when the input has no recognized alert paths', () => {
  assert.deepEqual(_socketAlertRows({ foo: 'bar' }), []);
});

test('handles nested alerts with non-object values at each level', () => {
  const j = { data: { alerts: {
    npm: { 'pkg1': 'not-an-object', 'pkg2': { '1.0.0': null, '2.0.0': { type: 'malware', severity: 'medium' } } },
    'not-obj': 'string'
  }}};
  assert.deepEqual(_socketAlertRows(j), [{ rule: "", package: "pkg2", version: "1.0.0", ecosystem: "npm", sev: "", claimKind: "", sevReason: "type-not-in-vocabulary", message: "" }, { rule: "malware", package: "pkg2", version: "2.0.0", ecosystem: "npm", sev: "med", claimKind: "integrity", sevReason: "", message: "" }]);
});
