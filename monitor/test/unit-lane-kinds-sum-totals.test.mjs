// sumTotals merges CVE feed totals with additive scanner lanes, excluding duplicate lanes, and partitions by claim kind (monitor/lane-kinds.mjs sumTotals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumTotals } from '../lane-kinds.mjs';

test('null scanners falls back to empty object and does not throw', () => {
  const cveTotals = { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 };
  const result = sumTotals(cveTotals, null);
  assert.deepEqual(result, { crit: 1, high: 2, med: 3, low: 4, undetermined: 5, cveTotals: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 1, high: 2, med: 3, low: 4, undetermined: 5 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('excluded lane with severity values does not add to totals', () => {
  const cveTotals = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 };
  const scanners = { depsReachability: { crit: 5, high: 3, med: 2, low: 1, undetermined: 4 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0, cveTotals: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('included lane with zero severity values adds nothing', () => {
  const cveTotals = { crit: 10, high: 10, med: 10, low: 10, undetermined: 10 };
  const scanners = { sastSemgrep: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 10, high: 10, med: 10, low: 10, undetermined: 10, cveTotals: { crit: 10, high: 10, med: 10, low: 10, undetermined: 10 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 10, high: 10, med: 10, low: 10, undetermined: 10 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('cveTotals undetermined zero adds only scanner undetermined', () => {
  const cveTotals = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 };
  const scanners = { secrets: { crit: 0, high: 0, med: 0, low: 0, undetermined: 7 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, undetermined: 7, cveTotals: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 7 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('cveTotals undetermined non-zero adds to scanner undetermined', () => {
  const cveTotals = { crit: 0, high: 0, med: 0, low: 0, undetermined: 3 };
  const scanners = { secrets: { crit: 0, high: 0, med: 0, low: 0, undetermined: 2 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, undetermined: 5, cveTotals: { crit: 0, high: 0, med: 0, low: 0, undetermined: 3 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 5 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('scanner with NaN severity values treats them as zero', () => {
  const cveTotals = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 };
  const scanners = { sastSemgrep: { crit: 'not-a-number', high: NaN, med: 0, low: 0, undetermined: 0 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, undetermined: 0, cveTotals: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('custom exclude parameter overrides default exclusion list', () => {
  const cveTotals = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 };
  const scanners = { depsReachability: { crit: 5, high: 0, med: 0, low: 0, undetermined: 0 } };
  const result = sumTotals(cveTotals, scanners, []);
  assert.deepEqual(result, { crit: 5, high: 0, med: 0, low: 0, undetermined: 0, cveTotals: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, excludedFromTotals: [], byKind: { vulnerability: { crit: 5, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('byKind partitions CVE feed into vulnerability and scanners by lane kind', () => {
  const cveTotals = { crit: 2, high: 1, med: 0, low: 0, undetermined: 0 };
  const scanners = { sastSemgrep: { crit: 0, high: 3, med: 0, low: 0, undetermined: 0 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 2, high: 4, med: 0, low: 0, undetermined: 0, cveTotals: { crit: 2, high: 1, med: 0, low: 0, undetermined: 0 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 2, high: 4, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('excludedFromTotals lists all skipped lane names', () => {
  const cveTotals = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 };
  const scanners = { depsReachability: { crit: 1 }, sastSemgrep: { crit: 1 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 1, high: 0, med: 0, low: 0, undetermined: 0, cveTotals: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 1, high: 0, med: 0, low: 0, undetermined: 0 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('cveTotals object is preserved unchanged in result.cveTotals', () => {
  const cveTotals = { crit: 4, high: 3, med: 2, low: 1, undetermined: 0 };
  const scanners = { secrets: { crit: 1, high: 1, med: 1, low: 1, undetermined: 1 } };
  const result = sumTotals(cveTotals, scanners);
  assert.deepEqual(result, { crit: 5, high: 4, med: 3, low: 2, undetermined: 1, cveTotals: { crit: 4, high: 3, med: 2, low: 1, undetermined: 0 }, excludedFromTotals: ["actionsHealth", "cobolCoverage", "denoLint", "denoTypes", "depsBundlerAudit", "depsReachability", "depsRustAudit", "formatRust", "lintGo", "lintHaskell", "lintJava", "lintPython", "lintRust", "maliciousPackages", "sastAuto", "secretsBetterleaks", "stubs", "testHermetic", "tlsTestssl", "yaraWitness"], byKind: { vulnerability: { crit: 5, high: 4, med: 3, low: 2, undetermined: 1 }, posture: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, integrity: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, hygiene: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 }, unclassified: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } });
});
