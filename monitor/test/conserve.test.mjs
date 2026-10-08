// node --test monitor/test/ — conserve.mjs: the fleet-aggregate conservation invariant.
//
// The property under test: `published + truncated === declared`, per category, only for categories
// that HAVE a ROW_SCHEMA identity — and skipped (never violated) for those that do not, so a future
// count-first category cannot permanently violate before its schema lands (finding F3,
// evaluations/sauron-execution-20260810-sdc-cot-rl.md). This is the check monitor/scanner-delta.mjs's
// `refuse()` gate consults before trusting an "absence" as a fix.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConservation } from '../conserve.mjs';

describe('conserve', () => {
  test('published rows exactly equal the declared total: checked, no violation', () => {
    const scanners = { sastSemgrep: { total: 2, crit: 0, high: 2, med: 0, low: 0 } };
    const scannerFindings = { sastSemgrep: [
      { repo: 'r1', rule: 'a', file: 'a.ts' },
      { repo: 'r1', rule: 'b', file: 'b.ts' },
    ] };
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, ['sastSemgrep']);
    assert.deepEqual(violations, []);
  });

  test('capped but accounted for: published + truncated reconstructs the declared total, conforms', () => {
    const scanners = { secrets: { total: 2600, detail: { truncated: 100, rows: 2500, noDetail: [] } } };
    const scannerFindings = { secrets: Array.from({ length: 2500 }, (_, i) => ({ repo: 'r1', rule: `r${i}`, file: 'f.env' })) };
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, ['secrets']);
    assert.deepEqual(violations, []);
  });

  test('published + truncated falls short of the declared total: a named violation, not a silent gap', () => {
    // declared 3000, but only 2500 published and 100 named as dropped — 400 are unaccounted for.
    const scanners = { secrets: { total: 3000, detail: { truncated: 100, rows: 2500, noDetail: [] } } };
    const scannerFindings = { secrets: Array.from({ length: 2500 }, (_, i) => ({ repo: 'r1', rule: `r${i}`, file: 'f.env' })) };
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, ['secrets']);
    assert.deepEqual(violations, [{ category: 'secrets', declared: 3000, published: 2500, truncated: 100 }]);
  });

  test('a category with no ROW_SCHEMA is skipped, never violated, however badly its numbers disagree', () => {
    const scanners = { mysteryLane: { total: 500 } };
    const scannerFindings = { mysteryLane: [] }; // 0 + 0 !== 500, and yet — no schema, no claim
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, []);
    assert.deepEqual(violations, []);
  });

  test('a category with no numeric declared total is skipped — never treated as declaring zero', () => {
    const scanners = { sastSemgrep: {} }; // no .total at all
    const scannerFindings = { sastSemgrep: [{ repo: 'r1', rule: 'a', file: 'a.ts' }] };
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, []);
    assert.deepEqual(violations, []);
  });

  test('accepts an extractor-shaped {findings} entry the same as a bare published array', () => {
    const scanners = { sastGo: { total: 3 } };
    const scannerFindings = { sastGo: { findings: [
      { rule: 'a', file: 'a.go' }, { rule: 'b', file: 'b.go' }, { rule: 'c', file: 'c.go' },
    ] } };
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, ['sastGo']);
    assert.deepEqual(violations, []);
  });

  test('checked and violations are sorted by category regardless of input key order; every violation is also checked', () => {
    const scanners = {
      sastGo: { total: 1 },
      accessibility: { total: 5 }, // 0 published + 0 truncated != 5 — violates
      bola: { total: 0 },
    };
    const scannerFindings = { sastGo: [{ rule: 'a', file: 'a.go' }], bola: [] };
    const { checked, violations } = checkConservation({ scanners, scannerFindings });
    assert.deepEqual(checked, ['accessibility', 'bola', 'sastGo']);
    assert.deepEqual(violations, [{ category: 'accessibility', declared: 5, published: 0, truncated: 0 }]);
    assert.ok(violations.every((v) => checked.includes(v.category)));
  });

  test('no input at all: empty checked, empty violations, never throws', () => {
    assert.deepEqual(checkConservation({}), { checked: [], violations: [] });
    assert.deepEqual(checkConservation(undefined), { checked: [], violations: [] });
  });
});
