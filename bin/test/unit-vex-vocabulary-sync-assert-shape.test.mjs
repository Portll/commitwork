// Validates that extracted vocabulary axes match expected counts (bin/vex-vocabulary-sync.mjs assertShape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertShape } from '../vex-vocabulary-sync.mjs';

test('returns empty array when all axes match expected counts', () => {
  const vocab = {
    formats: {
      csaf: {
        status: Array.from({ length: 8 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
        threat: Array.from({ length: 3 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      cyclonedx: {
        status: Array.from({ length: 6 }, (_, i) => i),
        justification: Array.from({ length: 9 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  assert.deepEqual(assertShape(vocab), []);
});

test('reports missing axis when value is not an array', () => {
  const vocab = {
    formats: {
      csaf: {
        status: null,
        justification: Array.from({ length: 5 }, (_, i) => i),
        threat: Array.from({ length: 3 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      cyclonedx: {
        status: Array.from({ length: 6 }, (_, i) => i),
        justification: Array.from({ length: 9 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 1);
  assert.equal(problems[0], 'csaf.status did not extract at all (extractor broken, or upstream moved)');
});

test('reports count mismatch when array length differs from expected', () => {
  const vocab = {
    formats: {
      csaf: {
        status: Array.from({ length: 7 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
        threat: Array.from({ length: 3 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      cyclonedx: {
        status: Array.from({ length: 6 }, (_, i) => i),
        justification: Array.from({ length: 9 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 1);
  assert.equal(problems[0], 'csaf.status: 7 values, expected 8 \u2014 upstream churn or a broken extractor; read the diff before changing EXPECTED');
});

test('reports multiple problems when several axes are wrong', () => {
  const vocab = {
    formats: {
      csaf: {
        status: undefined,
        justification: Array.from({ length: 4 }, (_, i) => i),
        threat: Array.from({ length: 3 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      cyclonedx: {
        status: Array.from({ length: 6 }, (_, i) => i),
        justification: Array.from({ length: 8 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 3);
  assert.equal(problems[0], 'csaf.status did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[1], 'csaf.justification: 4 values, expected 5 \u2014 upstream churn or a broken extractor; read the diff before changing EXPECTED');
});

test('reports missing format when formats object lacks the key', () => {
  const vocab = {
    formats: {
      csaf: {
        status: Array.from({ length: 8 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
        threat: Array.from({ length: 3 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 3);
  assert.equal(problems[0], 'cyclonedx.status did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[1], 'cyclonedx.justification did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[2], 'cyclonedx.response did not extract at all (extractor broken, or upstream moved)');
});

test('reports all axes missing when formats is empty object', () => {
  const vocab = { formats: {} };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 9);
  assert.equal(problems[0], 'csaf.status did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[1], 'csaf.justification did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[2], 'csaf.threat did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[3], 'csaf.response did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[4], 'cyclonedx.status did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[5], 'cyclonedx.justification did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[6], 'cyclonedx.response did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[7], 'openvex.status did not extract at all (extractor broken, or upstream moved)');
  assert.equal(problems[8], 'openvex.justification did not extract at all (extractor broken, or upstream moved)');
});

test('reports count mismatch for boundary case of one extra value', () => {
  const vocab = {
    formats: {
      csaf: {
        status: Array.from({ length: 8 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
        threat: Array.from({ length: 4 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      cyclonedx: {
        status: Array.from({ length: 6 }, (_, i) => i),
        justification: Array.from({ length: 9 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 1);
  assert.equal(problems[0], 'csaf.threat: 4 values, expected 3 \u2014 upstream churn or a broken extractor; read the diff before changing EXPECTED');
});

test('reports count mismatch for boundary case of one fewer value', () => {
  const vocab = {
    formats: {
      csaf: {
        status: Array.from({ length: 8 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
        threat: Array.from({ length: 3 }, (_, i) => i),
        response: Array.from({ length: 5 }, (_, i) => i),
      },
      cyclonedx: {
        status: Array.from({ length: 6 }, (_, i) => i),
        justification: Array.from({ length: 9 }, (_, i) => i),
        response: Array.from({ length: 4 }, (_, i) => i),
      },
      openvex: {
        status: Array.from({ length: 4 }, (_, i) => i),
        justification: Array.from({ length: 5 }, (_, i) => i),
      },
    },
  };
  const problems = assertShape(vocab);
  assert.equal(problems.length, 1);
  assert.equal(problems[0], 'cyclonedx.response: 4 values, expected 5 \u2014 upstream churn or a broken extractor; read the diff before changing EXPECTED');
});
