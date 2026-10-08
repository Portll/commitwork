// Groups scanner and dependency findings by stable item id (monitor/daily.mjs groupFindings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFindings } from '../daily.mjs';

test('returns an empty map when the rollup has no findings', () => {
  const result = groupFindings({}, 'repo-a');
  assert.equal(result.size, 0);
});

test('groups scanner findings by category, rule, and normalised file path', () => {
  const rollup = {
    scannerFindings: {
      security: [
        { repo: 'repo-a', rule: 'no-eval', file: './src/a.js', line: 10 },
        { repo: 'repo-a', rule: 'no-eval', file: 'src/a.js', line: 20 },
        { repo: 'repo-b', rule: 'no-eval', file: 'src/a.js', line: 30 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 1);
  const [id, group] = [...result.entries()][0];
  assert.equal(group.category, 'security');
  assert.equal(group.rule, 'no-eval');
  assert.equal(group.file, 'src/a.js');
  assert.deepEqual(group.lines, [10, 20]);
  assert.equal(group.rows.length, 2);
  assert.equal(id, group.id);
});

test('deduplicates identical line numbers within a group', () => {
  const rollup = {
    scannerFindings: {
      lint: [
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 5 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 5 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 5 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 1);
  const group = [...result.values()][0];
  assert.deepEqual(group.lines, [5]);
  assert.equal(group.rows.length, 3);
});

test('ignores scanner findings that do not match the target repo', () => {
  const rollup = {
    scannerFindings: {
      security: [
        { repo: 'other-repo', rule: 'no-eval', file: 'src/a.js', line: 10 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 0);
});

test('includes only dependency findings in open states', () => {
  const rollup = {
    findings: [
      { repo: 'repo-a', state: 'born', id: 'dep-1', path: 'lodash' },
      { repo: 'repo-a', state: 'persisting', id: 'dep-2', path: 'express' },
      { repo: 'repo-a', state: 'resolved', id: 'dep-3', path: 'react' },
      { repo: 'repo-a', state: 'closed', id: 'dep-4', path: 'vue' }
    ]
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 2);
  const groups = [...result.values()];
  const dep1 = groups.find((g) => g.rule === 'dep-1');
  const dep2 = groups.find((g) => g.rule === 'dep-2');
  assert.ok(dep1);
  assert.ok(dep2);
  assert.equal(dep1.category, 'dependencies');
  assert.equal(dep1.file, 'lodash');
  assert.equal(dep2.category, 'dependencies');
  assert.equal(dep2.file, 'express');
});

test('excludes dependency findings that do not match the target repo', () => {
  const rollup = {
    findings: [
      { repo: 'other-repo', state: 'born', id: 'dep-1', path: 'lodash' }
    ]
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 0);
});

test('sorts line numbers in ascending order', () => {
  const rollup = {
    scannerFindings: {
      lint: [
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 30 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 10 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 20 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  const group = [...result.values()][0];
  assert.deepEqual(group.lines, [10, 20, 30]);
});

test('ignores non-positive and non-integer line values', () => {
  const rollup = {
    scannerFindings: {
      lint: [
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 0 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: -5 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 3.5 },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: null },
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 10 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  const group = [...result.values()][0];
  assert.deepEqual(group.lines, [10]);
  assert.equal(group.rows.length, 5);
});

test('normalises file paths by stripping leading ./ prefix', () => {
  const rollup = {
    scannerFindings: {
      security: [
        { repo: 'repo-a', rule: 'no-eval', file: './src/a.js', line: 1 },
        { repo: 'repo-a', rule: 'no-eval', file: 'src/a.js', line: 2 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 1);
  const group = [...result.values()][0];
  assert.equal(group.file, 'src/a.js');
  assert.deepEqual(group.lines, [1, 2]);
});

test('creates separate groups for different rules on the same file', () => {
  const rollup = {
    scannerFindings: {
      lint: [
        { repo: 'repo-a', rule: 'r1', file: 'f.js', line: 1 },
        { repo: 'repo-a', rule: 'r2', file: 'f.js', line: 2 }
      ]
    }
  };
  const result = groupFindings(rollup, 'repo-a');
  assert.equal(result.size, 2);
  const groups = [...result.values()];
  const rules = groups.map((g) => g.rule).sort();
  assert.deepEqual(rules, ['r1', 'r2']);
});
