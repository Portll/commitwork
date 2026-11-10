// extracts source and sink file, line, and expression from the first code flow (cra/dataflow-evidence.mjs pathOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathOf } from '../dataflow-evidence.mjs';

test('returns null when result is undefined', () => {
  assert.equal(pathOf(undefined), null);
});

test('returns null when codeFlows is missing', () => {
  assert.equal(pathOf({}), null);
});

test('returns null when threadFlows is missing', () => {
  assert.equal(pathOf({ codeFlows: [{ threadFlows: [] }] }), null);
});

test('returns null when locations is not an array', () => {
  assert.equal(pathOf({ codeFlows: [{ threadFlows: [{ locations: 'not-array' }] }] }), null);
});

test('returns null when locations is an empty array', () => {
  assert.equal(pathOf({ codeFlows: [{ threadFlows: [{ locations: [] }] }] }), null);
});

test('returns null when locations is a non-empty non-array', () => {
  assert.equal(pathOf({ codeFlows: [{ threadFlows: [{ locations: 'x' }] }] }), null);
});

test('returns null when locations is a non-empty array of length zero is impossible but tests the && branch with non-array', () => {
  assert.equal(pathOf({ codeFlows: [{ threadFlows: [{ locations: {} }] }] }), null);
});

test('returns null when locations is an empty array testing the || branch', () => {
  assert.equal(pathOf({ codeFlows: [{ threadFlows: [{ locations: [] }] }] }), null);
});

test('returns full path object with one location', () => {
  const result = {
    codeFlows: [{
      threadFlows: [{
        locations: [{
          location: {
            physicalLocation: {
              artifactLocation: { uri: 'src/app.js' },
              region: { startLine: 42 }
            },
            message: { text: 'tainted value' }
          }
        }]
      }]
    }]
  };
  assert.deepEqual(pathOf(result), { steps: 1, flows: 1, source: { file: "src/app.js", line: 42, expr: "tainted value" }, sink: { file: "src/app.js", line: 42, expr: "tainted value" } });
});

test('returns full path object with multiple locations using first and last', () => {
  const result = {
    codeFlows: [{
      threadFlows: [{
        locations: [
          {
            location: {
              physicalLocation: {
                artifactLocation: { uri: 'src/input.js' },
                region: { startLine: 10 }
              },
              message: { text: 'user input' }
            }
          },
          {
            location: {
              physicalLocation: {
                artifactLocation: { uri: 'src/middle.js' },
                region: { startLine: 20 }
              },
              message: { text: 'propagated' }
            }
          },
          {
            location: {
              physicalLocation: {
                artifactLocation: { uri: 'src/sink.js' },
                region: { startLine: 30 }
              },
              message: { text: 'sql injection' }
            }
          }
        ]
      }]
    }]
  };
  assert.deepEqual(pathOf(result), { steps: 3, flows: 1, source: { file: "src/input.js", line: 10, expr: "user input" }, sink: { file: "src/sink.js", line: 30, expr: "sql injection" } });
});
