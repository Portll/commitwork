// node --test monitor/test/ — CWE extraction from SARIF rules.
//
// WHY THIS FILE EXISTS. The live rollup carried 64,748 findings with 37 CWEs — 0.06% — and that
// was diagnosed as "nothing populates the field", i.e. new classification work. Wrong: one semgrep
// SARIF in the reports tree carries 137 distinct CWEs across 1,074 rules, and sarif-read.mjs had
// no reference to cwe, tags or properties. The scanners were asserting it and the reader dropped
// it. These tests pin the join so it cannot silently regress to a blank field again.
//
// THE ASSERTION THAT MATTERS MOST is the last one: a rule asserting no CWE must yield an empty
// array and a `rule-asserts-none` reason, never a guess. A CWE inferred from what a rule
// "probably" means is a fabricated citation carrying a MITRE identifier, and it corrupts every
// Top-25 and ASVS rollup built on top of it. Blank is honestly unknown; wrong is not.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cweOf, cweForResult } from '../sarif-read.mjs';

describe('cweOf — the two conventions scanners actually use', () => {
  test('CodeQL tag form, with zero padding stripped', () => {
    // external/cwe/cwe-079 is the CodeQL convention and the padding is theirs, not ours.
    assert.deepEqual(cweOf({ properties: { tags: ['security', 'external/cwe/cwe-079'] } }), ['CWE-79']);
  });

  test('semgrep string form', () => {
    assert.deepEqual(cweOf({ properties: { cwe: "CWE-89: Improper Neutralization of Special Elements used in an SQL Command" } }), ['CWE-89']);
  });

  test('semgrep array form — a rule may assert several', () => {
    assert.deepEqual(
      cweOf({ properties: { cwe: ['CWE-79: XSS', 'CWE-116: Improper Encoding'] } }),
      ['CWE-79', 'CWE-116'],
    );
  });

  test('both conventions on one rule are merged and deduped', () => {
    const r = { properties: { tags: ['external/cwe/cwe-079'], cwe: 'CWE-79: XSS' } };
    assert.deepEqual(cweOf(r), ['CWE-79'], 'the same CWE from two sources must appear once');
  });

  test('SORTED NUMERICALLY, not lexically', () => {
    // The regression this pins: string sort puts CWE-119 before CWE-79, so a report ordered by
    // "first CWE" would silently reorder and two runs would disagree about the same finding.
    const r = { properties: { tags: ['external/cwe/cwe-119', 'external/cwe/cwe-079', 'external/cwe/cwe-787'] } };
    assert.deepEqual(cweOf(r), ['CWE-79', 'CWE-119', 'CWE-787']);
  });

  test('a rule asserting no CWE yields [] — never an inference', () => {
    assert.deepEqual(cweOf({ id: 'some.rule', properties: { tags: ['security', 'correctness'] } }), []);
    assert.deepEqual(cweOf({ id: 'bare' }), []);
    assert.deepEqual(cweOf(null), []);
  });

  test('a tag that merely CONTAINS "cwe" does not match', () => {
    // 'cwe-coverage' and 'not-a-cwe' must not mint an identifier. The anchor is the digits.
    assert.deepEqual(cweOf({ properties: { tags: ['cwe-coverage', 'reviewed-for-cwe'] } }), []);
  });
});

describe('cweForResult — the join, and its failure told apart from absence', () => {
  const rules = { 'js.xss': { id: 'js.xss', properties: { tags: ['external/cwe/cwe-079'] } },
                  'js.style': { id: 'js.style', properties: { tags: ['maintainability'] } } };

  test('a joined result carries its rule CWE', () => {
    assert.deepEqual(cweForResult({ ruleId: 'js.xss' }, rules), { cwe: ['CWE-79'], via: 'rule-tags' });
  });

  test('RULE ASSERTS NONE and RULE NOT FOUND are different facts', () => {
    // Both yield no CWE, and collapsing them would hide a broken join behind a clean-looking
    // absence — the explicit uncertainty error applied to a foreign key.
    assert.equal(cweForResult({ ruleId: 'js.style' }, rules).via, 'rule-asserts-none');
    assert.equal(cweForResult({ ruleId: 'gone.rule' }, rules).via, 'rule-not-found');
    assert.equal(cweForResult({}, rules).via, 'no-rule-id');
  });

  test('the SARIF alternative rule reference is honoured', () => {
    assert.deepEqual(cweForResult({ rule: { id: 'js.xss' } }, rules).cwe, ['CWE-79']);
  });
});
