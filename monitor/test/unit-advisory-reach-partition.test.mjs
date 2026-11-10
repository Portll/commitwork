// Splits advisory rows into kept and undetermined with a reachability report (monitor/advisory-reach.mjs partition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partition } from '../advisory-reach.mjs';

test('counts one malicious row as undetermined with security-holder code', () => {
  const rows = [{ id: 'MAL-2024-1', ecosystem: 'npm', version: '0.0.1-security' }];
  assert.deepEqual(partition(rows), { kept: [], undetermined: [{ id: "MAL-2024-1", ecosystem: "npm", version: "0.0.1-security", undetermined: true, unknown: true, unknownReason: "subject-mismatch", undeterminedCode: "security-holder", undeterminedReason: "version 0.0.1-security is npm's security-holder placeholder, published in place of a removed package \u2014 this is the takedown, not the malware" }], report: { enabled: true, total: 1, malicious: 1, undetermined: 1, unclassified: 0, byCode: { "security-holder": 1 }, note: "An undetermined row matched a malicious-package advisory by NAME, but the advisory could not have reached the installed version \u2014 a non-semver version was never resolved from the npm registry, and 0.0.1-security is npm's own takedown placeholder. Each row keeps its original claim and remains in the artifact; none is counted as crit/high/med/low. This decides reachability of the ADVISORY only, never whether the installed source is safe. Set CW_ADVISORY_REACH=off to count them as published." } });
});

test('counts one malicious row as undetermined with non-semver code', () => {
  const rows = [{ id: 'MAL-2024-2', ecosystem: 'npm', version: 'not-a-version' }];
  assert.deepEqual(partition(rows), { kept: [], undetermined: [{ id: "MAL-2024-2", ecosystem: "npm", version: "not-a-version", undetermined: true, unknown: true, unknownReason: "subject-mismatch", undeterminedCode: "non-semver", undeterminedReason: "version 'not-a-version' is not a semver, so it was not resolved from the npm registry and the advisory's SEMVER range cannot have matched it; this says nothing about whether the installed source is safe" }], report: { enabled: true, total: 1, malicious: 1, undetermined: 1, unclassified: 0, byCode: { "non-semver": 1 }, note: "An undetermined row matched a malicious-package advisory by NAME, but the advisory could not have reached the installed version \u2014 a non-semver version was never resolved from the npm registry, and 0.0.1-security is npm's own takedown placeholder. Each row keeps its original claim and remains in the artifact; none is counted as crit/high/med/low. This decides reachability of the ADVISORY only, never whether the installed source is safe. Set CW_ADVISORY_REACH=off to count them as published." } });
});

test('keeps a malicious row with a valid semver version', () => {
  const rows = [{ id: 'MAL-2024-3', ecosystem: 'npm', version: '1.2.3' }];
  assert.deepEqual(partition(rows), { kept: [{ id: "MAL-2024-3", ecosystem: "npm", version: "1.2.3" }], undetermined: [], report: { enabled: true, total: 1, malicious: 1, undetermined: 0, unclassified: 1, byCode: {}, note: "" } });
});

test('keeps a non-malicious row and reports zero malicious', () => {
  const rows = [{ id: 'CVE-2024-1234', ecosystem: 'npm', version: '1.0.0' }];
  assert.deepEqual(partition(rows), { kept: [{ id: "CVE-2024-1234", ecosystem: "npm", version: "1.0.0" }], undetermined: [], report: { enabled: true, total: 1, malicious: 0, undetermined: 0, unclassified: 0, byCode: {}, note: "" } });
});

test('returns empty arrays and zero counts for empty input', () => {
  assert.deepEqual(partition([]), { kept: [], undetermined: [], report: { enabled: true, total: 0, malicious: 0, undetermined: 0, unclassified: 0, byCode: {}, note: "" } });
});

test('returns empty arrays and zero counts for null input', () => {
  assert.deepEqual(partition(null), { kept: [], undetermined: [], report: { enabled: true, total: 0, malicious: 0, undetermined: 0, unclassified: 0, byCode: {}, note: "" } });
});

test('counts two undetermined rows with the same code in byCode', () => {
  const rows = [
    { id: 'MAL-2024-1', ecosystem: 'npm', version: '0.0.1-security' },
    { id: 'MAL-2024-2', ecosystem: 'npm', version: '0.0.1-security' },
  ];
  assert.deepEqual(partition(rows), { kept: [], undetermined: [{ id: "MAL-2024-1", ecosystem: "npm", version: "0.0.1-security", undetermined: true, unknown: true, unknownReason: "subject-mismatch", undeterminedCode: "security-holder", undeterminedReason: "version 0.0.1-security is npm's security-holder placeholder, published in place of a removed package \u2014 this is the takedown, not the malware" }, { id: "MAL-2024-2", ecosystem: "npm", version: "0.0.1-security", undetermined: true, unknown: true, unknownReason: "subject-mismatch", undeterminedCode: "security-holder", undeterminedReason: "version 0.0.1-security is npm's security-holder placeholder, published in place of a removed package \u2014 this is the takedown, not the malware" }], report: { enabled: true, total: 2, malicious: 2, undetermined: 2, unclassified: 0, byCode: { "security-holder": 2 }, note: "An undetermined row matched a malicious-package advisory by NAME, but the advisory could not have reached the installed version \u2014 a non-semver version was never resolved from the npm registry, and 0.0.1-security is npm's own takedown placeholder. Each row keeps its original claim and remains in the artifact; none is counted as crit/high/med/low. This decides reachability of the ADVISORY only, never whether the installed source is safe. Set CW_ADVISORY_REACH=off to count them as published." } });
});

test('keeps a malicious row with empty version string', () => {
  const rows = [{ id: 'MAL-2024-4', ecosystem: 'npm', version: '' }];
  assert.deepEqual(partition(rows), { kept: [{ id: "MAL-2024-4", ecosystem: "npm", version: "" }], undetermined: [], report: { enabled: true, total: 1, malicious: 1, undetermined: 0, unclassified: 1, byCode: {}, note: "" } });
});

test('keeps a malicious row with non-npm ecosystem', () => {
  const rows = [{ id: 'MAL-2024-5', ecosystem: 'pypi', version: '0.0.1-security' }];
  assert.deepEqual(partition(rows), { kept: [{ id: "MAL-2024-5", ecosystem: "pypi", version: "0.0.1-security" }], undetermined: [], report: { enabled: true, total: 1, malicious: 1, undetermined: 0, unclassified: 1, byCode: {}, note: "" } });
});

test('keeps a malicious row with undefined version', () => {
  const rows = [{ id: 'MAL-2024-6', ecosystem: 'npm' }];
  assert.deepEqual(partition(rows), { kept: [{ id: "MAL-2024-6", ecosystem: "npm" }], undetermined: [], report: { enabled: true, total: 1, malicious: 1, undetermined: 0, unclassified: 1, byCode: {}, note: "" } });
});
