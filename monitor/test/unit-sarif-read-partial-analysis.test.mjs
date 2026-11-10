// Maps SARIF tool execution notifications to per-file partial scan reasons (monitor/sarif-read.mjs partialAnalysis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partialAnalysis } from '../sarif-read.mjs';

test('returns an empty array when no invocations are provided', () => {
  assert.deepEqual(partialAnalysis(undefined), []);
});

test('ignores notifications whose descriptor id is not a known partial reason', () => {
  const inv = [{ toolExecutionNotifications: [{ descriptor: { id: 'Unknown' }, message: { text: 'x' } }] }];
  assert.deepEqual(partialAnalysis(inv), []);
});

test('ignores notifications whose message text matches the snippet pattern', () => {
  const inv = [{ toolExecutionNotifications: [{ descriptor: { id: 'Timeout' }, message: { text: 'When parsing a snippet as Bash' } }] }];
  assert.deepEqual(partialAnalysis(inv), []);
});

test('extracts the file uri from the notification location and records the reason', () => {
  const inv = [{ toolExecutionNotifications: [{ descriptor: { id: 'Timeout' }, message: { text: 'timed out' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' } } }] }] }];
  assert.deepEqual(partialAnalysis(inv), [{ uri: "src/a.js", reasons: ["timeout"], notices: 1 }]);
});

test('extracts the file uri from the message text when no location is present', () => {
  const inv = [{ toolExecutionNotifications: [{ descriptor: { id: 'Timeout' }, message: { text: 'timed out on src/b.js:' } }] }];
  assert.deepEqual(partialAnalysis(inv), [{ uri: "src/b.js", reasons: ["timeout"], notices: 1 }]);
});

test('skips notifications that yield no resolvable uri', () => {
  const inv = [{ toolExecutionNotifications: [{ descriptor: { id: 'Timeout' }, message: { text: 'no location here' } }] }];
  assert.deepEqual(partialAnalysis(inv), []);
});

test('aggregates multiple notices for the same uri into one row with sorted reasons', () => {
  const inv = [{ toolExecutionNotifications: [
    { descriptor: { id: 'Timeout' }, message: { text: 't' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'f.js' } } }] },
    { descriptor: { id: 'Syntax error' }, message: { text: 's' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'f.js' } } }] },
    { descriptor: { id: 'Timeout' }, message: { text: 't2' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'f.js' } } }] },
  ] }];
  assert.deepEqual(partialAnalysis(inv), [{ uri: "f.js", reasons: ["syntax-error", "timeout"], notices: 3 }]);
});

test('sorts output rows by uri then rule', () => {
  const inv = [{ toolExecutionNotifications: [
    { descriptor: { id: 'Timeout' }, message: { text: 't' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'z.js' } } }] },
    { descriptor: { id: 'Timeout' }, message: { text: 't' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
  ] }];
  assert.deepEqual(partialAnalysis(inv), [{ uri: "a.js", reasons: ["timeout"], notices: 1 }, { uri: "z.js", reasons: ["timeout"], notices: 1 }]);
});
