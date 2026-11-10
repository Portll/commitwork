export function machineryHealth({ runs, parsers, tests, rules, thresholds }) {
  validateInput({ runs, parsers, tests, rules, thresholds });

  const defects = [];
  const unmeasured = [];

  checkRuns(runs, defects, unmeasured);
  checkParsers(parsers, defects, unmeasured);
  checkTests(tests, defects, unmeasured);
  checkRules(rules, thresholds, defects);

  defects.sort((a, b) => {
    const kindCmp = a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    if (kindCmp !== 0) return kindCmp;
    const subjA = JSON.stringify(a.subject);
    const subjB = JSON.stringify(b.subject);
    return subjA < subjB ? -1 : subjA > subjB ? 1 : 0;
  });

  unmeasured.sort((a, b) => {
    const srcCmp = a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
    if (srcCmp !== 0) return srcCmp;
    const subjA = JSON.stringify(a.subject);
    const subjB = JSON.stringify(b.subject);
    return subjA < subjB ? -1 : subjA > subjB ? 1 : 0;
  });

  return {
    defects,
    unmeasured,
    populations: {
      runs: runs.length,
      parsers: parsers.length,
      tests: tests.length,
      rules: rules.length
    }
  };
}

function validateInput({ runs, parsers, tests, rules, thresholds }) {
  if (!Array.isArray(runs)) throw new TypeError('runs must be an array');
  if (!Array.isArray(parsers)) throw new TypeError('parsers must be an array');
  if (!Array.isArray(tests)) throw new TypeError('tests must be an array');
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array');
  if (thresholds === null || typeof thresholds !== 'object') throw new TypeError('thresholds must be an object');

  const runKeys = new Set();
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r === null || typeof r !== 'object') throw new TypeError(`runs[${i}] must be an object`);
    validateString(r.lane, `runs[${i}].lane`);
    validateString(r.repo, `runs[${i}].repo`);
    if (typeof r.declared !== 'boolean') throw new TypeError(`runs[${i}].declared must be boolean`);
    if (typeof r.started !== 'boolean') throw new TypeError(`runs[${i}].started must be boolean`);
    if (r.parsed !== true && r.parsed !== false && r.parsed !== null) throw new TypeError(`runs[${i}].parsed must be true, false, or null`);
    if (r.findings !== null && (!Number.isInteger(r.findings) || r.findings < 0)) throw new TypeError(`runs[${i}].findings must be non-negative integer or null`);
    const key = JSON.stringify([r.lane, r.repo]);
    if (runKeys.has(key)) throw new Error(`duplicate run identity: ${key}`);
    runKeys.add(key);
  }

  const parserKeys = new Set();
  for (let i = 0; i < parsers.length; i++) {
    const p = parsers[i];
    if (p === null || typeof p !== 'object') throw new TypeError(`parsers[${i}] must be an object`);
    validateString(p.parser, `parsers[${i}].parser`);
    validateString(p.fixture, `parsers[${i}].fixture`);
    if (typeof p.positive !== 'boolean') throw new TypeError(`parsers[${i}].positive must be boolean`);
    if (typeof p.nonempty !== 'boolean') throw new TypeError(`parsers[${i}].nonempty must be boolean`);
    if (p.parsedFindings !== null && (!Number.isInteger(p.parsedFindings) || p.parsedFindings < 0)) throw new TypeError(`parsers[${i}].parsedFindings must be non-negative integer or null`);
    const key = JSON.stringify([p.parser, p.fixture]);
    if (parserKeys.has(key)) throw new Error(`duplicate parser identity: ${key}`);
    parserKeys.add(key);
  }

  const testKeys = new Set();
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (t === null || typeof t !== 'object') throw new TypeError(`tests[${i}] must be an object`);
    validateString(t.file, `tests[${i}].file`);
    validateString(t.name, `tests[${i}].name`);
    if (t.assertions !== null && (!Number.isInteger(t.assertions) || t.assertions < 0)) throw new TypeError(`tests[${i}].assertions must be non-negative integer or null`);
    if (t.emptyLoopAssertions !== true && t.emptyLoopAssertions !== false && t.emptyLoopAssertions !== null) throw new TypeError(`tests[${i}].emptyLoopAssertions must be true, false, or null`);
    const key = JSON.stringify([t.file, t.name]);
    if (testKeys.has(key)) throw new Error(`duplicate test identity: ${key}`);
    testKeys.add(key);
  }

  const ruleKeys = new Set();
  const validSeverities = new Set(['crit', 'high', 'med', 'low']);
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r === null || typeof r !== 'object') throw new TypeError(`rules[${i}] must be an object`);
    validateString(r.scanner, `rules[${i}].scanner`);
    validateString(r.rule, `rules[${i}].rule`);
    if (!validSeverities.has(r.severity)) throw new TypeError(`rules[${i}].severity must be one of crit, high, med, low`);
    if (!Number.isInteger(r.count) || r.count < 0) throw new TypeError(`rules[${i}].count must be non-negative integer`);
    const key = JSON.stringify([r.scanner, r.rule, r.severity]);
    if (ruleKeys.has(key)) throw new Error(`duplicate rule identity: ${key}`);
    ruleKeys.add(key);
  }

  if (typeof thresholds.dominanceShare !== 'number' || !(thresholds.dominanceShare > 0 && thresholds.dominanceShare <= 1)) {
    throw new TypeError('thresholds.dominanceShare must be a number with 0 < dominanceShare <= 1');
  }
  if (!Number.isInteger(thresholds.minBucket) || thresholds.minBucket <= 0) {
    throw new TypeError('thresholds.minBucket must be a positive integer');
  }
}

function validateString(val, field) {
  if (typeof val !== 'string' || val.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function checkRuns(runs, defects, unmeasured) {
  for (const r of runs) {
    const subject = { lane: r.lane, repo: r.repo };

    if (r.declared && !r.started) {
      defects.push({
        kind: 'never-started',
        subject,
        claim: 'declared',
        cause: 'run declared but never started',
        evidence: { declared: r.declared, started: r.started }
      });
    }

    if (r.started && r.parsed === false) {
      defects.push({
        kind: 'not-measured',
        subject,
        claim: 'started',
        cause: 'run started but parser reported failure',
        evidence: { started: r.started, parsed: r.parsed }
      });
    }

    if (r.started && r.parsed === false && r.findings === 0) {
      defects.push({
        kind: 'parser-zero',
        subject,
        claim: '0 findings',
        cause: 'parse failure reported as zero findings',
        evidence: { parsed: r.parsed, findings: r.findings }
      });
    }

    if (r.started && r.parsed === null) {
      unmeasured.push({
        source: 'runs',
        subject,
        field: 'parsed'
      });
    }
    if (r.parsed === false && r.findings === null) {
      unmeasured.push({
        source: 'runs',
        subject,
        field: 'findings'
      });
    }
  }
}

function checkParsers(parsers, defects, unmeasured) {
  for (const p of parsers) {
    const subject = { parser: p.parser, fixture: p.fixture };

    if (p.positive && p.nonempty && p.parsedFindings === 0) {
      defects.push({
        kind: 'golden-parsed-as-zero',
        subject,
        claim: '0 findings',
        cause: 'golden fixture parsed as zero findings',
        evidence: { positive: p.positive, nonempty: p.nonempty, parsedFindings: p.parsedFindings }
      });
    }

    if (p.positive && p.nonempty && p.parsedFindings === null) {
      unmeasured.push({
        source: 'parsers',
        subject,
        field: 'parsedFindings'
      });
    }
  }
}

function checkTests(tests, defects, unmeasured) {
  for (const t of tests) {
    const subject = { file: t.file, name: t.name };

    if (t.assertions === 0) {
      defects.push({
        kind: 'no-assertions',
        subject,
        claim: '0 assertions',
        cause: 'test has zero assertions',
        evidence: { assertions: t.assertions }
      });
    }

    if (t.emptyLoopAssertions === true) {
      defects.push({
        kind: 'empty-assertion-loop',
        subject,
        claim: 'empty loop',
        cause: 'test has empty assertion loop',
        evidence: { emptyLoopAssertions: t.emptyLoopAssertions }
      });
    }

    if (t.assertions === null) {
      unmeasured.push({
        source: 'tests',
        subject,
        field: 'assertions'
      });
    }
    if (t.emptyLoopAssertions === null) {
      unmeasured.push({
        source: 'tests',
        subject,
        field: 'emptyLoopAssertions'
      });
    }
  }
}

function checkRules(rules, thresholds, defects) {
  const severityBuckets = {
    crit: [],
    high: [],
    med: [],
    low: []
  };

  for (const r of rules) {
    severityBuckets[r.severity].push(r);
  }

  for (const severity of ['crit', 'high', 'med', 'low']) {
    const bucket = severityBuckets[severity];
    if (bucket.length === 0) continue;

    const bucketTotal = bucket.reduce((sum, r) => sum + r.count, 0);
    if (bucketTotal < thresholds.minBucket) continue;

    for (const r of bucket) {
      const share = r.count / bucketTotal;
      if (share >= thresholds.dominanceShare) {
        defects.push({
          kind: 'severity-dominance',
          subject: { scanner: r.scanner, rule: r.rule, severity: r.severity },
          claim: `${r.count} findings`,
          cause: 'instrument-defect candidate: one scanner rule holds a dominant share of a severity bucket; not proof that its findings are false',
          evidence: { count: r.count, bucketTotal, share }
        });
      }
    }
  }
}
