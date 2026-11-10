// Computes Go advisories from a scanner slice, tracking drops and coverage (monitor/remediation-source.mjs advisoriesFromSlice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoriesFromSlice } from '../remediation-source.mjs';

const seams = {
  osvFixed: (id, pkg) => `1.0.0-${id}`,
  slugFor: (repo) => (repo === 'github.com/org/repo' ? 'org/repo' : null),
};

test('returns empty result for null slice', () => {
  const r = advisoriesFromSlice(null, seams);
  assert.deepEqual(r, { advisories: [], dropped: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] } });
});

test('returns empty result for undefined slice', () => {
  const r = advisoriesFromSlice(undefined, seams);
  assert.deepEqual(r, { advisories: [], dropped: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] } });
});

test('returns empty result for empty object slice', () => {
  const r = advisoriesFromSlice({}, seams);
  assert.deepEqual(r, { advisories: [], dropped: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] } });
});

test('emits advisory for reachable row with valid slug', () => {
  const slice = {
    scanned: ['repo1', 'repo2'],
    scannerFindings: {
      depsGo: [{ repo: 'github.com/org/repo', id: 'CVE-1', package: 'pkg', reachability: 'reachable' }],
    },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [{ id: "CVE-1", package: "pkg", ecosystem: "Go", currentVersion: "", fixed: "1.0.0-CVE-1", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" }], dropped: [], coverage: { scannedRepos: 2, goRows: 1, emitted: 1, droppedByReason: {}, ecosystemsNotCovered: [] } });
});

test('drops duplicate rows and counts them', () => {
  const row = { repo: 'github.com/org/repo', id: 'CVE-1', package: 'pkg', reachability: 'reachable' };
  const slice = {
    scanned: ['repo1'],
    scannerFindings: { depsGo: [row, { ...row }] },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [{ id: "CVE-1", package: "pkg", ecosystem: "Go", currentVersion: "", fixed: "1.0.0-CVE-1", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" }], dropped: [{ key: "github.com/org/repo|CVE-1|pkg", reason: "duplicate" }], coverage: { scannedRepos: 1, goRows: 2, emitted: 1, droppedByReason: { duplicate: 1 }, ecosystemsNotCovered: [] } });
});

test('drops non-reachable rows with reason', () => {
  const slice = {
    scanned: ['repo1'],
    scannerFindings: {
      depsGo: [{ repo: 'github.com/org/repo', id: 'CVE-1', package: 'pkg', reachability: 'unreachable' }],
    },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [], dropped: [{ key: "github.com/org/repo|CVE-1|pkg", reason: "not-reachable:unreachable" }], coverage: { scannedRepos: 1, goRows: 1, emitted: 0, droppedByReason: { "not-reachable:unreachable": 1 }, ecosystemsNotCovered: [] } });
});

test('drops rows with no upstream slug', () => {
  const slice = {
    scanned: ['repo1'],
    scannerFindings: {
      depsGo: [{ repo: 'github.com/other/repo', id: 'CVE-1', package: 'pkg', reachability: 'reachable' }],
    },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [], dropped: [{ key: "github.com/other/repo|CVE-1|pkg", reason: "no-upstream-slug" }], coverage: { scannedRepos: 1, goRows: 1, emitted: 0, droppedByReason: { "no-upstream-slug": 1 }, ecosystemsNotCovered: [] } });
});

test('tracks ecosystems not covered when other lanes have findings', () => {
  const slice = {
    scanned: ['repo1'],
    scannerFindings: {
      depsGo: [{ repo: 'github.com/org/repo', id: 'CVE-1', package: 'pkg', reachability: 'reachable' }],
      depsJvm: [{ id: 'jvm-1' }],
      depsGradleDeclared: [],
      depsRetire: [],
      maliciousPackages: [],
      supplyChainHeuristic: [],
      supplyChainPosture: [],
      vendorAssets: [],
    },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [{ id: "CVE-1", package: "pkg", ecosystem: "Go", currentVersion: "", fixed: "1.0.0-CVE-1", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" }], dropped: [], coverage: { scannedRepos: 1, goRows: 1, emitted: 1, droppedByReason: {}, ecosystemsNotCovered: ["depsJvm"] } });
});

test('handles scanned as number instead of array', () => {
  const slice = {
    scanned: 5,
    scannerFindings: {
      depsGo: [{ repo: 'github.com/org/repo', id: 'CVE-1', package: 'pkg', reachability: 'reachable' }],
    },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [{ id: "CVE-1", package: "pkg", ecosystem: "Go", currentVersion: "", fixed: "1.0.0-CVE-1", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" }], dropped: [], coverage: { scannedRepos: 5, goRows: 1, emitted: 1, droppedByReason: {}, ecosystemsNotCovered: [] } });
});

test('drops malformed row that is not an object', () => {
  const slice = {
    scanned: ['repo1'],
    scannerFindings: { depsGo: [null, { repo: 'github.com/org/repo', id: 'CVE-1', package: 'pkg', reachability: 'reachable' }] },
  };
  const r = advisoriesFromSlice(slice, seams);
  assert.deepEqual(r, { advisories: [{ id: "CVE-1", package: "pkg", ecosystem: "Go", currentVersion: "", fixed: "1.0.0-CVE-1", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" }], dropped: [{ key: "undefined|undefined|undefined", reason: "malformed-row" }], coverage: { scannedRepos: 1, goRows: 2, emitted: 1, droppedByReason: { "malformed-row": 1 }, ecosystemsNotCovered: [] } });
});
