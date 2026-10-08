// Does the CodeQL coverage guard actually SEPARATE a degraded extraction from a clean repository?
//
// The failure this suite is written against is a test that asserts a marker is set without asserting
// anything obeys it. So every case here is built as a PAIR wherever a pair is meaningful: the shape
// that must pass and the shape that must fail, differing in one fact. A suite that only fed it good
// SARIF would pass while proving nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { codeqlCoverage, coverageLicensesAZero, COVERAGE_FLOOR } from '../codeql-coverage.mjs';

/** Minimal SARIF carrying only what the guard reads: extraction notifications. */
function sarif({ succeeded = [], expected = [] }) {
  const note = (id, uri) => ({
    descriptor: { id },
    locations: [{ physicalLocation: { artifactLocation: { uri } } }],
  });
  return {
    runs: [{
      invocations: [{
        toolExecutionNotifications: [
          ...succeeded.map((u) => note('py/diagnostics/successfully-extracted-files', u)),
          ...expected.map((u) => note('py/baseline/expected-extracted-files', u)),
        ],
      }],
    }],
  };
}

const PY = ['.py', '.pyi'];

describe('codeqlCoverage — the four states are four different claims', () => {
  test('a fully extracted tree is `covered` and licenses its own zero', () => {
    const v = codeqlCoverage(sarif({ succeeded: ['a.py', 'b.py'], expected: ['a.py', 'b.py'] }), PY);
    assert.equal(v.state, 'covered');
    assert.equal(v.ratio, 1);
    assert.equal(coverageLicensesAZero(v), true);
  });

  test('the SAME tree with most files unread is `partial` and does NOT license a zero', () => {
    const expected = Array.from({ length: 10 }, (_, i) => `f${i}.py`);
    const v = codeqlCoverage(sarif({ succeeded: ['f0.py'], expected }), PY);
    assert.equal(v.state, 'partial');
    assert.equal(v.ratio, 0.1);
    assert.equal(coverageLicensesAZero(v), false,
      'a 10%-read tree must never be publishable as clean — this is the whole point of the file');
    assert.match(v.reason, /absence of findings/i);
  });

  test('a SARIF with no expected baseline is `unmeasurable`, which is neither pass nor fail', () => {
    const v = codeqlCoverage(sarif({ succeeded: ['a.py'], expected: [] }), PY);
    assert.equal(v.state, 'unmeasurable');
    assert.equal(v.ratio, null);
    assert.equal(coverageLicensesAZero(v), false, 'explicit uncertainty');
    // ...and equally it is not reported as a degraded scan, which would be unsupported finding.
    assert.notEqual(v.state, 'partial');
  });

  test('a repo with none of the language is `no-language` — an honest empty, not a void', () => {
    const v = codeqlCoverage(sarif({ succeeded: [], expected: ['main.go', 'x.rs'] }), PY);
    assert.equal(v.state, 'no-language');
    assert.equal(coverageLicensesAZero(v), true,
      'nothing to read is not the same as failing to read, and must not be reported as a coverage void');
  });

  test('successes with NO baseline for this language are unmeasurable — never a licensed no-language zero', () => {
    // Measured 2026-08-26 on memory-layer: the Rust extractor emitted 1,104 success notifications and no
    // rust expected-extracted-files, while js/py/rb baselines were present in the same polyglot
    // archive. The old code read that as no-language, which LICENSES a zero — a degraded run
    // publishable as clean, the exact false-clean this module exists to prevent.
    const v = codeqlCoverage(sarif({ succeeded: ['a.py', 'b.py'], expected: ['main.go', 'x.rs'] }), PY);
    assert.equal(v.state, 'unmeasurable');
    assert.equal(v.extracted, 2, 'the successes are real and are carried');
    assert.equal(coverageLicensesAZero(v), false, 'a denominator-less success list licenses nothing');
    assert.match(v.reason, /baseline enumerates none/);
  });

  test('a lane declaring no extensions is `unmeasurable`, never silently `covered`', () => {
    const v = codeqlCoverage(sarif({ succeeded: ['a.py'], expected: ['a.py'] }), []);
    assert.equal(v.state, 'unmeasurable');
    assert.equal(coverageLicensesAZero(v), false);
  });
});

describe('the denominator is language-scoped — the defect that made a naive ratio useless', () => {
  test('other languages in the archive do NOT count against this lane', () => {
    // Ruby's real shape, from dependabot-core: the archive expects .cs/.swift/.go files that a
    // Ruby extractor is correct to skip. A whole-archive ratio would call this 33% and degraded.
    const expected = ['a.py', 'b.py', 'x.cs', 'y.cs', 'z.swift', 'w.go'];
    const v = codeqlCoverage(sarif({ succeeded: ['a.py', 'b.py'], expected }), PY);
    assert.equal(v.state, 'covered');
    assert.equal(v.expected, 2, 'only the .py files form the denominator');
    assert.equal(v.ratio, 1);
  });

  test('and a lane that misses its OWN language is still caught with the same input shape', () => {
    const expected = ['a.py', 'b.py', 'x.cs', 'y.cs', 'z.swift', 'w.go'];
    const v = codeqlCoverage(sarif({ succeeded: ['a.py'], expected }), PY);
    assert.equal(v.state, 'partial');
    assert.equal(v.ratio, 0.5);
  });
});

describe('boundary behaviour is pinned, not incidental', () => {
  test('exactly at the floor is covered; one file below it is partial', () => {
    const expected = Array.from({ length: 10 }, (_, i) => `f${i}.py`);
    const at = codeqlCoverage(sarif({ succeeded: expected.slice(0, 9), expected }), PY);
    assert.equal(at.ratio, COVERAGE_FLOOR);
    assert.equal(at.state, 'covered', 'the floor is inclusive');

    const below = codeqlCoverage(sarif({ succeeded: expected.slice(0, 8), expected }), PY);
    assert.equal(below.state, 'partial');
  });

  test('a ratio above 1 is covered, not an anomaly', () => {
    // Measured on real artifacts: the success list can name files the archive baseline does not.
    const v = codeqlCoverage(sarif({ succeeded: ['a.py', 'b.py', 'c.py'], expected: ['a.py'] }), PY);
    assert.equal(v.state, 'covered');
    assert.ok(v.ratio > 1);
  });

  test('a malformed or empty document is unmeasurable rather than throwing or passing', () => {
    for (const bad of [null, undefined, {}, { runs: [] }, { runs: [{}] }]) {
      const v = codeqlCoverage(bad, PY);
      assert.equal(v.state, 'unmeasurable', `${JSON.stringify(bad)} must not read as covered`);
      assert.equal(coverageLicensesAZero(v), false);
    }
  });
});

describe('determinism', () => {
  test('same inputs produce byte-identical verdicts', () => {
    const doc = sarif({ succeeded: ['a.py'], expected: ['a.py', 'b.py', 'c.py'] });
    const a = JSON.stringify(codeqlCoverage(doc, PY));
    const b = JSON.stringify(codeqlCoverage(doc, PY));
    assert.equal(a, b);
  });
});

// The guard is only worth having if it fires on the fleet's REAL degraded artifact and stays quiet
// on a real healthy one. Skipped rather than failed when the artifacts are absent — a developer
// checkout has no reports/ tree, and a missing fixture is not a failing guard.
describe('against stored fleet artifacts', () => {
  const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const DEGRADED = 'reports/sweep-20260824110533-100randomrepos/InternLM_lmdeploy/codeql-cpp.sarif';
  const HEALTHY = 'reports/sweep-20260823125546-100randomrepos/dependabot_dependabot-core/codeql-ruby.sarif';
  const CPP = ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx'];
  const RB = ['.rb', '.rake', '.gemspec'];

  // These two are the only assertions binding this guard to REAL CodeQL output rather than to the
  // synthetic builder above. reports/ is gitignored, so on every machine but the one that ran the
  // sweep the artifacts are absent — and a `skip:` there reports green while verifying nothing.
  // That is the unsupported finding shape this repo bans everywhere else, so the absence is
  // PRINTED instead: still not a failure (the artifact is legitimately not distributed), but no
  // longer silent. If these ever stop printing, the binding is live again.
  const stored = (label, path, exts, expectState, expectLicense) => {
    test(label, () => {
      const doc = load(path);
      if (!doc) {
        console.log(`  [codeql-coverage] UNVERIFIED against real SARIF — ${path} is absent on this `
          + 'machine, so only the synthetic builder above witnessed the guard in this run.');
        return;
      }
      const v = codeqlCoverage(doc, exts);
      assert.equal(v.state, expectState);
      assert.equal(coverageLicensesAZero(v), expectLicense);
    });
  };

  stored('the cpp run that read 235 of 370 files is partial', DEGRADED, CPP, 'partial', false);
  stored('the ruby run that read its whole language is covered', HEALTHY, RB, 'covered', true);
});
