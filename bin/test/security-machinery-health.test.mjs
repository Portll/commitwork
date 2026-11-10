import { test, describe } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { machineryHealth } from '../../lib/security-machinery-health.mjs';

describe('machineryHealth', () => {
  const baseThresholds = { dominanceShare: 0.5, minBucket: 10 };

  function baseInput(overrides = {}) {
    return {
      runs: [],
      parsers: [],
      tests: [],
      rules: [],
      thresholds: baseThresholds,
      ...overrides
    };
  }

  describe('input validation', () => {
    test('throws if runs is not an array', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: 'not-array' }), /runs must be an array/);
    });

    test('throws if parsers is not an array', () => {
      throws(() => machineryHealth({ ...baseInput(), parsers: 'not-array' }), /parsers must be an array/);
    });

    test('throws if tests is not an array', () => {
      throws(() => machineryHealth({ ...baseInput(), tests: 'not-array' }), /tests must be an array/);
    });

    test('throws if rules is not an array', () => {
      throws(() => machineryHealth({ ...baseInput(), rules: 'not-array' }), /rules must be an array/);
    });

    test('throws if thresholds is not an object', () => {
      throws(() => machineryHealth({ ...baseInput(), thresholds: null }), /thresholds must be an object/);
    });

    test('throws if run lane is missing', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ repo: 'r', declared: true, started: true, parsed: true, findings: 0 }] }), /runs\[0\]\.lane must be a non-empty string/);
    });

    test('throws if run repo is empty string', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ lane: 'l', repo: '', declared: true, started: true, parsed: true, findings: 0 }] }), /runs\[0\]\.repo must be a non-empty string/);
    });

    test('throws if run declared is not boolean', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ lane: 'l', repo: 'r', declared: 'yes', started: true, parsed: true, findings: 0 }] }), /runs\[0\]\.declared must be boolean/);
    });

    test('throws if run started is not boolean', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ lane: 'l', repo: 'r', declared: true, started: 'yes', parsed: true, findings: 0 }] }), /runs\[0\]\.started must be boolean/);
    });

    test('throws if run parsed is invalid', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: 'yes', findings: 0 }] }), /runs\[0\]\.parsed must be true, false, or null/);
    });

    test('throws if run findings is negative', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: -1 }] }), /runs\[0\]\.findings must be non-negative integer or null/);
    });

    test('throws if run findings is not integer', () => {
      throws(() => machineryHealth({ ...baseInput(), runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: 1.5 }] }), /runs\[0\]\.findings must be non-negative integer or null/);
    });

    test('throws on duplicate run identity', () => {
      throws(() => machineryHealth({
        ...baseInput(),
        runs: [
          { lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: 0 },
          { lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: 0 }
        ]
      }), /duplicate run identity/);
    });

    test('throws if parser parser is missing', () => {
      throws(() => machineryHealth({ ...baseInput(), parsers: [{ fixture: 'f', positive: true, nonempty: true, parsedFindings: 0 }] }), /parsers\[0\]\.parser must be a non-empty string/);
    });

    test('throws if parser fixture is empty', () => {
      throws(() => machineryHealth({ ...baseInput(), parsers: [{ parser: 'p', fixture: '', positive: true, nonempty: true, parsedFindings: 0 }] }), /parsers\[0\]\.fixture must be a non-empty string/);
    });

    test('throws if parser positive is not boolean', () => {
      throws(() => machineryHealth({ ...baseInput(), parsers: [{ parser: 'p', fixture: 'f', positive: 'yes', nonempty: true, parsedFindings: 0 }] }), /parsers\[0\]\.positive must be boolean/);
    });

    test('throws if parser nonempty is not boolean', () => {
      throws(() => machineryHealth({ ...baseInput(), parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: 'yes', parsedFindings: 0 }] }), /parsers\[0\]\.nonempty must be boolean/);
    });

    test('throws if parser parsedFindings is negative', () => {
      throws(() => machineryHealth({ ...baseInput(), parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: true, parsedFindings: -1 }] }), /parsers\[0\]\.parsedFindings must be non-negative integer or null/);
    });

    test('throws on duplicate parser identity', () => {
      throws(() => machineryHealth({
        ...baseInput(),
        parsers: [
          { parser: 'p', fixture: 'f', positive: true, nonempty: true, parsedFindings: 0 },
          { parser: 'p', fixture: 'f', positive: true, nonempty: true, parsedFindings: 0 }
        ]
      }), /duplicate parser identity/);
    });

    test('throws if test file is missing', () => {
      throws(() => machineryHealth({ ...baseInput(), tests: [{ name: 'n', assertions: 0, emptyLoopAssertions: false }] }), /tests\[0\]\.file must be a non-empty string/);
    });

    test('throws if test name is empty', () => {
      throws(() => machineryHealth({ ...baseInput(), tests: [{ file: 'f', name: '', assertions: 0, emptyLoopAssertions: false }] }), /tests\[0\]\.name must be a non-empty string/);
    });

    test('throws if test assertions is negative', () => {
      throws(() => machineryHealth({ ...baseInput(), tests: [{ file: 'f', name: 'n', assertions: -1, emptyLoopAssertions: false }] }), /tests\[0\]\.assertions must be non-negative integer or null/);
    });

    test('throws if test emptyLoopAssertions is invalid', () => {
      throws(() => machineryHealth({ ...baseInput(), tests: [{ file: 'f', name: 'n', assertions: 0, emptyLoopAssertions: 'yes' }] }), /tests\[0\]\.emptyLoopAssertions must be true, false, or null/);
    });

    test('throws on duplicate test identity', () => {
      throws(() => machineryHealth({
        ...baseInput(),
        tests: [
          { file: 'f', name: 'n', assertions: 0, emptyLoopAssertions: false },
          { file: 'f', name: 'n', assertions: 0, emptyLoopAssertions: false }
        ]
      }), /duplicate test identity/);
    });

    test('throws if rule scanner is missing', () => {
      throws(() => machineryHealth({ ...baseInput(), rules: [{ rule: 'r', severity: 'crit', count: 0 }] }), /rules\[0\]\.scanner must be a non-empty string/);
    });

    test('throws if rule rule is empty', () => {
      throws(() => machineryHealth({ ...baseInput(), rules: [{ scanner: 's', rule: '', severity: 'crit', count: 0 }] }), /rules\[0\]\.rule must be a non-empty string/);
    });

    test('throws if rule severity is invalid', () => {
      throws(() => machineryHealth({ ...baseInput(), rules: [{ scanner: 's', rule: 'r', severity: 'invalid', count: 0 }] }), /rules\[0\]\.severity must be one of crit, high, med, low/);
    });

    test('throws if rule count is negative', () => {
      throws(() => machineryHealth({ ...baseInput(), rules: [{ scanner: 's', rule: 'r', severity: 'crit', count: -1 }] }), /rules\[0\]\.count must be non-negative integer/);
    });

    test('throws on duplicate rule identity', () => {
      throws(() => machineryHealth({
        ...baseInput(),
        rules: [
          { scanner: 's', rule: 'r', severity: 'crit', count: 0 },
          { scanner: 's', rule: 'r', severity: 'crit', count: 0 }
        ]
      }), /duplicate rule identity/);
    });

    test('throws if dominanceShare is zero', () => {
      throws(() => machineryHealth({ ...baseInput(), thresholds: { dominanceShare: 0, minBucket: 10 } }), /thresholds\.dominanceShare must be a number with 0 < dominanceShare <= 1/);
    });

    test('throws if dominanceShare is negative', () => {
      throws(() => machineryHealth({ ...baseInput(), thresholds: { dominanceShare: -0.1, minBucket: 10 } }), /thresholds\.dominanceShare must be a number with 0 < dominanceShare <= 1/);
    });

    test('throws if dominanceShare > 1', () => {
      throws(() => machineryHealth({ ...baseInput(), thresholds: { dominanceShare: 1.1, minBucket: 10 } }), /thresholds\.dominanceShare must be a number with 0 < dominanceShare <= 1/);
    });

    test('throws if minBucket is zero', () => {
      throws(() => machineryHealth({ ...baseInput(), thresholds: { dominanceShare: 0.5, minBucket: 0 } }), /thresholds\.minBucket must be a positive integer/);
    });

    test('throws if minBucket is not integer', () => {
      throws(() => machineryHealth({ ...baseInput(), thresholds: { dominanceShare: 0.5, minBucket: 1.5 } }), /thresholds\.minBucket must be a positive integer/);
    });
  });

  describe('never-started defect', () => {
    test('detects declared but not started', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: false, parsed: true, findings: 5 }]
      }));
      deepStrictEqual(result.defects, [{
        kind: 'never-started',
        subject: { lane: 'l', repo: 'r' },
        claim: 'declared',
        cause: 'run declared but never started',
        evidence: { declared: true, started: false }
      }]);
    });

    test('does not flag if not declared', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: false, started: false, parsed: true, findings: 5 }]
      }));
      deepStrictEqual(result.defects, []);
    });

    test('does not flag if started', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: 5 }]
      }));
      deepStrictEqual(result.defects, []);
    });
  });

  describe('not-measured defect', () => {
    test('detects started but parsed false', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: false, findings: 5 }]
      }));
      const notMeasured = result.defects.find(d => d.kind === 'not-measured');
      deepStrictEqual(notMeasured, {
        kind: 'not-measured',
        subject: { lane: 'l', repo: 'r' },
        claim: 'started',
        cause: 'run started but parser reported failure',
        evidence: { started: true, parsed: false }
      });
    });

    test('does not flag if parsed true', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: 0 }]
      }));
      const notMeasured = result.defects.find(d => d.kind === 'not-measured');
      strictEqual(notMeasured, undefined);
    });

    test('does not flag if not started', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: false, parsed: false, findings: 0 }]
      }));
      const neverStarted = result.defects.find(d => d.kind === 'never-started');
      deepStrictEqual(neverStarted, {
        kind: 'never-started',
        subject: { lane: 'l', repo: 'r' },
        claim: 'declared',
        cause: 'run declared but never started',
        evidence: { declared: true, started: false }
      });
      const notMeasured = result.defects.find(d => d.kind === 'not-measured');
      strictEqual(notMeasured, undefined);
    });
  });

  describe('parser-zero defect', () => {
    test('detects parsed false and findings 0', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: false, findings: 0 }]
      }));
      const parserZero = result.defects.find(d => d.kind === 'parser-zero');
      deepStrictEqual(parserZero, {
        kind: 'parser-zero',
        subject: { lane: 'l', repo: 'r' },
        claim: '0 findings',
        cause: 'parse failure reported as zero findings',
        evidence: { parsed: false, findings: 0 }
      });
    });

    test('does not flag if findings > 0', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: false, findings: 5 }]
      }));
      const parserZero = result.defects.find(d => d.kind === 'parser-zero');
      strictEqual(parserZero, undefined);
    });

    test('does not flag if parsed true', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: true, findings: 0 }]
      }));
      const parserZero = result.defects.find(d => d.kind === 'parser-zero');
      strictEqual(parserZero, undefined);
    });

    test('does not flag if not started', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: false, parsed: false, findings: 0 }]
      }));
      const parserZero = result.defects.find(d => d.kind === 'parser-zero');
      strictEqual(parserZero, undefined);
    });
  });

  describe('golden-parsed-as-zero defect', () => {
    test('detects positive nonempty fixture parsed as zero', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: true, parsedFindings: 0 }]
      }));
      deepStrictEqual(result.defects, [{
        kind: 'golden-parsed-as-zero',
        subject: { parser: 'p', fixture: 'f' },
        claim: '0 findings',
        cause: 'golden fixture parsed as zero findings',
        evidence: { positive: true, nonempty: true, parsedFindings: 0 }
      }]);
    });

    test('does not flag if not positive', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: false, nonempty: true, parsedFindings: 0 }]
      }));
      deepStrictEqual(result.defects, []);
    });

    test('does not flag if not nonempty', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: false, parsedFindings: 0 }]
      }));
      deepStrictEqual(result.defects, []);
    });

    test('does not flag if parsedFindings > 0', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: true, parsedFindings: 5 }]
      }));
      deepStrictEqual(result.defects, []);
    });
  });

  describe('no-assertions defect', () => {
    test('detects zero assertions', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: 0, emptyLoopAssertions: false }]
      }));
      deepStrictEqual(result.defects, [{
        kind: 'no-assertions',
        subject: { file: 'f', name: 'n' },
        claim: '0 assertions',
        cause: 'test has zero assertions',
        evidence: { assertions: 0 }
      }]);
    });

    test('does not flag if assertions > 0', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: 3, emptyLoopAssertions: false }]
      }));
      deepStrictEqual(result.defects, []);
    });
  });

  describe('empty-assertion-loop defect', () => {
    test('detects emptyLoopAssertions true', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: 5, emptyLoopAssertions: true }]
      }));
      deepStrictEqual(result.defects, [{
        kind: 'empty-assertion-loop',
        subject: { file: 'f', name: 'n' },
        claim: 'empty loop',
        cause: 'test has empty assertion loop',
        evidence: { emptyLoopAssertions: true }
      }]);
    });

    test('does not flag if emptyLoopAssertions false', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: 5, emptyLoopAssertions: false }]
      }));
      deepStrictEqual(result.defects, []);
    });
  });

  describe('severity-dominance defect', () => {
    test('detects rule dominating severity bucket', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 60 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 40 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.find(d => d.kind === 'severity-dominance');
      deepStrictEqual(dom, {
        kind: 'severity-dominance',
        subject: { scanner: 's1', rule: 'r1', severity: 'crit' },
        claim: '60 findings',
        cause: 'instrument-defect candidate: one scanner rule holds a dominant share of a severity bucket; not proof that its findings are false',
        evidence: { count: 60, bucketTotal: 100, share: 0.6 }
      });
    });

    test('does not flag if share below threshold', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 30 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 30 },
          { scanner: 's3', rule: 'r3', severity: 'crit', count: 40 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.find(d => d.kind === 'severity-dominance');
      strictEqual(dom, undefined);
    });

    test('does not flag if bucket total below minBucket', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 6 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 3 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.find(d => d.kind === 'severity-dominance');
      strictEqual(dom, undefined);
    });

    test('flags at exact dominanceShare boundary', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 50 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 50 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.filter(d => d.kind === 'severity-dominance');
      strictEqual(dom.length, 2);
    });

    test('flags at exact minBucket boundary', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 10 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 0 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.find(d => d.kind === 'severity-dominance');
      deepStrictEqual(dom, {
        kind: 'severity-dominance',
        subject: { scanner: 's1', rule: 'r1', severity: 'crit' },
        claim: '10 findings',
        cause: 'instrument-defect candidate: one scanner rule holds a dominant share of a severity bucket; not proof that its findings are false',
        evidence: { count: 10, bucketTotal: 10, share: 1 }
      });
    });

    test('handles multiple severities independently', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 60 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 40 },
          { scanner: 's3', rule: 'r3', severity: 'high', count: 30 },
          { scanner: 's4', rule: 'r4', severity: 'high', count: 70 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.filter(d => d.kind === 'severity-dominance');
      strictEqual(dom.length, 2);
      const subjects = dom.map(d => JSON.stringify(d.subject)).sort();
      deepStrictEqual(subjects, [
        JSON.stringify({ scanner: 's1', rule: 'r1', severity: 'crit' }),
        JSON.stringify({ scanner: 's4', rule: 'r4', severity: 'high' })
      ]);
    });
  });

  describe('unmeasured rows', () => {
    test('reports unmeasured runs parsed null', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: null, findings: 5 }]
      }));
      deepStrictEqual(result.unmeasured, [{
        source: 'runs',
        subject: { lane: 'l', repo: 'r' },
        field: 'parsed'
      }]);
    });

    test('reports unmeasured runs findings null when parsed false', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: false, findings: null }]
      }));
      deepStrictEqual(result.unmeasured, [{
        source: 'runs',
        subject: { lane: 'l', repo: 'r' },
        field: 'findings'
      }]);
    });

    test('reports unmeasured parsers parsedFindings null for golden fixture', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: true, parsedFindings: null }]
      }));
      deepStrictEqual(result.unmeasured, [{
        source: 'parsers',
        subject: { parser: 'p', fixture: 'f' },
        field: 'parsedFindings'
      }]);
    });

    test('does not report unmeasured parsers if not golden', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: false, nonempty: true, parsedFindings: null }]
      }));
      deepStrictEqual(result.unmeasured, []);
    });

    test('reports unmeasured tests assertions null', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: null, emptyLoopAssertions: false }]
      }));
      deepStrictEqual(result.unmeasured, [{
        source: 'tests',
        subject: { file: 'f', name: 'n' },
        field: 'assertions'
      }]);
    });

    test('reports unmeasured tests emptyLoopAssertions null', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: 5, emptyLoopAssertions: null }]
      }));
      deepStrictEqual(result.unmeasured, [{
        source: 'tests',
        subject: { file: 'f', name: 'n' },
        field: 'emptyLoopAssertions'
      }]);
    });

    test('unmeasured never appears as defect', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: true, started: true, parsed: null, findings: 5 }]
      }));
      const hasDefect = result.defects.some(d => d.subject.lane === 'l' && d.subject.repo === 'r');
      strictEqual(hasDefect, false);
      strictEqual(result.unmeasured.length, 1);
    });
  });

  describe('populations', () => {
    test('reports correct counts', () => {
      const result = machineryHealth(baseInput({
        runs: [
          { lane: 'l1', repo: 'r1', declared: true, started: true, parsed: true, findings: 0 },
          { lane: 'l2', repo: 'r2', declared: true, started: true, parsed: true, findings: 0 }
        ],
        parsers: [
          { parser: 'p1', fixture: 'f1', positive: true, nonempty: true, parsedFindings: 0 }
        ],
        tests: [
          { file: 'f1', name: 'n1', assertions: 0, emptyLoopAssertions: false },
          { file: 'f2', name: 'n2', assertions: 0, emptyLoopAssertions: false }
        ],
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 0 }
        ]
      }));
      deepStrictEqual(result.populations, { runs: 2, parsers: 1, tests: 2, rules: 1 });
    });

    test('reports zero for empty populations', () => {
      const result = machineryHealth(baseInput());
      deepStrictEqual(result.populations, { runs: 0, parsers: 0, tests: 0, rules: 0 });
    });
  });

  describe('sorting', () => {
    test('defects sorted by kind then subject', () => {
      const result = machineryHealth(baseInput({
        runs: [
          { lane: 'b', repo: 'b', declared: true, started: false, parsed: true, findings: 0 },
          { lane: 'a', repo: 'a', declared: true, started: false, parsed: true, findings: 0 }
        ],
        parsers: [
          { parser: 'b', fixture: 'b', positive: true, nonempty: true, parsedFindings: 0 },
          { parser: 'a', fixture: 'a', positive: true, nonempty: true, parsedFindings: 0 }
        ]
      }));
      const kinds = result.defects.map(d => d.kind);
      deepStrictEqual(kinds, ['golden-parsed-as-zero', 'golden-parsed-as-zero', 'never-started', 'never-started']);
      const subjects = result.defects.map(d => JSON.stringify(d.subject));
      deepStrictEqual(subjects, [
        JSON.stringify({ parser: 'a', fixture: 'a' }),
        JSON.stringify({ parser: 'b', fixture: 'b' }),
        JSON.stringify({ lane: 'a', repo: 'a' }),
        JSON.stringify({ lane: 'b', repo: 'b' })
      ]);
    });

    test('unmeasured sorted by source then subject', () => {
      const result = machineryHealth(baseInput({
        runs: [
          { lane: 'b', repo: 'b', declared: true, started: true, parsed: null, findings: 0 },
          { lane: 'a', repo: 'a', declared: true, started: true, parsed: null, findings: 0 }
        ],
        parsers: [
          { parser: 'b', fixture: 'b', positive: true, nonempty: true, parsedFindings: null },
          { parser: 'a', fixture: 'a', positive: true, nonempty: true, parsedFindings: null }
        ]
      }));
      const sources = result.unmeasured.map(u => u.source);
      deepStrictEqual(sources, ['parsers', 'parsers', 'runs', 'runs']);
      const subjects = result.unmeasured.map(u => JSON.stringify(u.subject));
      deepStrictEqual(subjects, [
        JSON.stringify({ parser: 'a', fixture: 'a' }),
        JSON.stringify({ parser: 'b', fixture: 'b' }),
        JSON.stringify({ lane: 'a', repo: 'a' }),
        JSON.stringify({ lane: 'b', repo: 'b' })
      ]);
    });
  });

  describe('deterministic output', () => {
    test('same input different order produces identical output', () => {
      const input1 = baseInput({
        runs: [
          { lane: 'b', repo: 'b', declared: true, started: false, parsed: true, findings: 0 },
          { lane: 'a', repo: 'a', declared: true, started: false, parsed: true, findings: 0 }
        ]
      });
      const input2 = baseInput({
        runs: [
          { lane: 'a', repo: 'a', declared: true, started: false, parsed: true, findings: 0 },
          { lane: 'b', repo: 'b', declared: true, started: false, parsed: true, findings: 0 }
        ]
      });
      const result1 = machineryHealth(input1);
      const result2 = machineryHealth(input2);
      deepStrictEqual(result1, result2);
    });
  });

  describe('edge cases', () => {
    test('run with declared false and started true', () => {
      const result = machineryHealth(baseInput({
        runs: [{ lane: 'l', repo: 'r', declared: false, started: true, parsed: true, findings: 0 }]
      }));
      deepStrictEqual(result.defects, []);
    });

    test('parser with positive true nonempty false parsedFindings 0', () => {
      const result = machineryHealth(baseInput({
        parsers: [{ parser: 'p', fixture: 'f', positive: true, nonempty: false, parsedFindings: 0 }]
      }));
      deepStrictEqual(result.defects, []);
    });

    test('test with assertions null and emptyLoopAssertions true', () => {
      const result = machineryHealth(baseInput({
        tests: [{ file: 'f', name: 'n', assertions: null, emptyLoopAssertions: true }]
      }));
      const defects = result.defects.filter(d => d.kind === 'empty-assertion-loop');
      strictEqual(defects.length, 1);
      const unmeasured = result.unmeasured.filter(u => u.field === 'assertions');
      strictEqual(unmeasured.length, 1);
    });

    test('severity-dominance with zero count rules in bucket', () => {
      const result = machineryHealth(baseInput({
        rules: [
          { scanner: 's1', rule: 'r1', severity: 'crit', count: 10 },
          { scanner: 's2', rule: 'r2', severity: 'crit', count: 0 }
        ],
        thresholds: { dominanceShare: 0.5, minBucket: 10 }
      }));
      const dom = result.defects.find(d => d.kind === 'severity-dominance');
      deepStrictEqual(dom, {
        kind: 'severity-dominance',
        subject: { scanner: 's1', rule: 'r1', severity: 'crit' },
        claim: '10 findings',
        cause: 'instrument-defect candidate: one scanner rule holds a dominant share of a severity bucket; not proof that its findings are false',
        evidence: { count: 10, bucketTotal: 10, share: 1 }
      });
    });

    test('no overall healthy or clean field in output', () => {
      const result = machineryHealth(baseInput());
      strictEqual('healthy' in result, false);
      strictEqual('clean' in result, false);
    });
  });
});
