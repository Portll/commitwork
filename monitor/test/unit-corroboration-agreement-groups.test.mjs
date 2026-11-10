// Computes agreement groups and summary statistics for a rollup (monitor/corroboration.mjs agreementGroups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreementGroups } from '../corroboration.mjs';

test('skip entry when repo is missing but id present (original returns early)', () => {
  const rollup = {
    repos: {
      r1: { name: null, findings: [{ id: 'CVE-1234', package: 'pkg:a', tool: 'osv', severity: 'high' }] },
    },
  };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [], summary: { groups: 0, single: 0, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: null } });
});

test('severity handling when sev is undefined (original treats as no opinion)', () => {
  const rollup = {
    repos: {
      r1: { name: 'repo1', findings: [{ id: 'CVE-5678', package: 'pkg:b', tool: 'osv', severity: undefined }] },
    },
  };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [{ key: "repo1|CVE-5678|pkg:b", repo: "repo1", id: "CVE-5678", package: "pkg:b", analysts: ["osv"], severities: {}, bases: { osv: "advisory-lookup" }, independentBases: 1, agreement: "single" }], summary: { groups: 1, single: 1, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: 1 } });
});

test('rollup.repos null uses fallback {} (original works, edited would throw)', () => {
  const rollup = { repos: null };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [], summary: { groups: 0, single: 0, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: null } });
});

test('scannerFindings null uses fallback {} (original works, edited would throw)', () => {
  const rollup = { scannerFindings: null };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [], summary: { groups: 0, single: 0, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: null } });
});

test('maliciousPackages undefined loops safely (original uses || [], edited would error)', () => {
  const rollup = { scannerFindings: {} };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [], summary: { groups: 0, single: 0, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: null } });
});

test('reachability proven flag differs for exploitable reachability', () => {
  const rollup = {
    scannerFindings: {
      depsReachability: [
        { repo: 'repo2', id: 'CVE-9999', package: 'pkg:c', sev: 'med', reachability: 'exploitable' },
      ],
    },
  };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [{ key: "repo2|CVE-9999|pkg:c", repo: "repo2", id: "CVE-9999", package: "pkg:c", analysts: ["depsReachability"], severities: { depsReachability: "med" }, bases: { depsReachability: "reachability-analysis" }, independentBases: 1, agreement: "single", reachabilityProvenBy: ["depsReachability"] }], summary: { groups: 1, single: 1, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 1, singleAnalystShare: 1 } });
});

test('complemented agreement threshold change (original <2, edited <3)', () => {
  const rollup = {
    repos: {
      r1: {
        name: 'repo3',
        findings: [
          { id: 'CVE-1111', package: 'pkg:d', tool: 'osv', severity: 'low' },
          { id: 'CVE-1111', package: 'pkg:d', tool: 'depsJvm', severity: 'low' },
        ],
      },
    },
  };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [{ key: "repo3|CVE-1111|pkg:d", repo: "repo3", id: "CVE-1111", package: "pkg:d", analysts: ["depsJvm", "osv"], severities: { depsJvm: "low", osv: "low" }, bases: { depsJvm: "advisory-lookup", osv: "advisory-lookup" }, independentBases: 1, agreement: "same-basis" }], summary: { groups: 1, single: 0, corroborated: 0, sameBasis: 1, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: 0 } });
});

test('summary.complemented count reflects original filter (edited would count non\u2011complemented)', () => {
  const rollup = {
    repos: {
      r1: {
        name: 'repo4',
        findings: [{ id: 'CVE-2222', package: 'pkg:e', tool: 'osv', severity: 'high' }],
      },
    },
  };
  const result = agreementGroups(rollup);
  assert.deepEqual(result, { groups: [{ key: "repo4|CVE-2222|pkg:e", repo: "repo4", id: "CVE-2222", package: "pkg:e", analysts: ["osv"], severities: { osv: "high" }, bases: { osv: "advisory-lookup" }, independentBases: 1, agreement: "single" }], summary: { groups: 1, single: 1, corroborated: 0, sameBasis: 0, complemented: 0, disputed: 0, withProvenReachability: 0, singleAnalystShare: 1 } });
});
