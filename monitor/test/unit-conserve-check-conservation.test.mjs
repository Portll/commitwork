// Declared scanner totals that do not equal published plus truncated rows (monitor/conserve.mjs checkConservation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConservation } from '../conserve.mjs';

const CANDIDATES = [
  'secrets secret secretScan credentials leaks gitleaks trufflehog todos todo fixme markers debt tech-debt techDebt',
  'deps dependencies dependency outdated vulns vulnerabilities vulnerability audit npm-audit osv advisories',
  'licenses license security sast semgrep lint eslint linting style format types typecheck tests test coverage',
  'complexity duplication duplicates dupes jscpd dead-code deadCode dead_code unused knip cycles circular madge',
  'large-files largeFiles large_files binaries size config env docs imports exports churn hotspots smells',
  'performance perf a11y accessibility i18n pii privacy supply-chain ci workflows docker iac infra shellcheck',
  'hadolint trivy bandit deprecations deprecated errors warnings issues findings files commits hooks',
].join(' ').split(' ');
const UNKNOWN = 'zz-not-a-scanner-category';
const probe = checkConservation({
  scanners: Object.fromEntries(CANDIDATES.map((c) => [c, { total: 0 }])),
  scannerFindings: {},
});
const K = probe.checked[0];
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
const EMPTY = { checked: [], violations: [] };

test('missing or null scanners check nothing and report no violations', () => {
  assert.deepEqual(checkConservation(), EMPTY);
  assert.deepEqual(checkConservation({ scanners: undefined, scannerFindings: { [K]: rows(1) } }), EMPTY);
  assert.deepEqual(checkConservation({ scanners: null, scannerFindings: { [K]: rows(1) } }), EMPTY);
});

test('a schema category whose published rows equal its declared total is checked without violation', () => {
  assert.deepEqual(probe.violations, []);
  const r = checkConservation({ scanners: { [K]: { total: 2 } }, scannerFindings: { [K]: rows(2) } });
  assert.deepEqual(r, { checked: [K], violations: [] });
});

test('a category without a row schema is skipped even when its counts disagree', () => {
  assert.deepEqual(checkConservation({ scanners: { [UNKNOWN]: { total: 5 } }, scannerFindings: { [UNKNOWN]: rows(1) } }), EMPTY);
  const r = checkConservation({
    scanners: { [K]: { total: 1 }, [UNKNOWN]: { total: 5 } },
    scannerFindings: { [K]: rows(1), [UNKNOWN]: rows(1) },
  });
  assert.deepEqual(r, { checked: [K], violations: [] });
});

test('missing scannerFindings counts zero published rows for every checked category', () => {
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 0 } }, scannerFindings: undefined }), { checked: [K], violations: [] });
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 1 } } }), {
    checked: [K],
    violations: [{ category: K, declared: 1, published: 0, truncated: 0 }],
  });
});

test('a declared total one above or one below the published count is a violation', () => {
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 3 } }, scannerFindings: { [K]: rows(2) } }), {
    checked: [K],
    violations: [{ category: K, declared: 3, published: 2, truncated: 0 }],
  });
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 1 } }, scannerFindings: { [K]: rows(2) } }), {
    checked: [K],
    violations: [{ category: K, declared: 1, published: 2, truncated: 0 }],
  });
});

test('an entry without a finite numeric total is skipped rather than violated', () => {
  const findings = { [K]: rows(2) };
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: '2' } }, scannerFindings: findings }), EMPTY);
  assert.deepEqual(checkConservation({ scanners: { [K]: null }, scannerFindings: findings }), EMPTY);
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: NaN } }, scannerFindings: findings }), EMPTY);
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: Infinity } }, scannerFindings: findings }), EMPTY);
  assert.deepEqual(checkConservation({ scanners: { [K]: {} }, scannerFindings: findings }), EMPTY);
});

test('nested detail truncated plus an extractor findings array balances the declared total', () => {
  const r = checkConservation({
    scanners: { [K]: { total: 5, detail: { truncated: 2 } } },
    scannerFindings: { [K]: { findings: rows(3), truncated: 9 } },
  });
  assert.deepEqual(r, { checked: [K], violations: [] });
  const s = checkConservation({ scanners: { [K]: { total: 5, detail: { truncated: '2' }, truncated: 7 } }, scannerFindings: { [K]: rows(3) } });
  assert.deepEqual(s, { checked: [K], violations: [] });
});

test('a nested truncated of zero wins over a flat truncated value', () => {
  const r = checkConservation({ scanners: { [K]: { total: 3, detail: { truncated: 0 }, truncated: 1 } }, scannerFindings: { [K]: rows(2) } });
  assert.deepEqual(r, { checked: [K], violations: [{ category: K, declared: 3, published: 2, truncated: 0 }] });
});

test('flat truncated is used when detail has no truncated count', () => {
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 4, truncated: 1 } }, scannerFindings: { [K]: rows(2) } }), {
    checked: [K],
    violations: [{ category: K, declared: 4, published: 2, truncated: 1 }],
  });
  const r = checkConservation({ scanners: { [K]: { total: 3, detail: {}, truncated: 1 } }, scannerFindings: { [K]: rows(2) } });
  assert.deepEqual(r, { checked: [K], violations: [] });
  const s = checkConservation({ scanners: { [K]: { total: 2, truncated: 'abc' } }, scannerFindings: { [K]: rows(2) } });
  assert.deepEqual(s, { checked: [K], violations: [] });
});

test('published entries that are neither arrays nor findings arrays count as zero rows', () => {
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 2 } }, scannerFindings: { [K]: { findings: 'ab' } } }), {
    checked: [K],
    violations: [{ category: K, declared: 2, published: 0, truncated: 0 }],
  });
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 0 } }, scannerFindings: { [K]: 'xy' } }), { checked: [K], violations: [] });
  assert.deepEqual(checkConservation({ scanners: { [K]: { total: 0 } }, scannerFindings: { [K]: null } }), { checked: [K], violations: [] });
});
