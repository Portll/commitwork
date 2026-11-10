// Maps a SARIF result to a dataflow evidence record with reachability and path (cra/dataflow-evidence.mjs dataflowFromResult).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataflowFromResult } from '../dataflow-evidence.mjs';

test('returns null when ruleId is missing', () => {
  const r = dataflowFromResult({ locations: [] }, 'repo', '2024-01-01T00:00:00Z');
  assert.deepEqual(r, null);
});

test('returns null when ruleId is empty string', () => {
  const r = dataflowFromResult({ ruleId: '', locations: [] }, 'repo', '2024-01-01T00:00:00Z');
  assert.deepEqual(r, null);
});

test('returns reachability_unknown when no codeFlows present', () => {
  const r = dataflowFromResult({ ruleId: 'rule1', locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' } } }] }, 'repo', '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { repo: "repo", rule: "rule1", file: "src/a.js", reachability: "reachability_unknown", path: null, evidence: [], why: "CodeQL rule rule1 is not a dataflow query; it emits no path, so this result says nothing either way about reachability" });
});

test('returns reachable with path when codeFlows present and source expr is set', () => {
  const r = dataflowFromResult({
    ruleId: 'rule1',
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' } } }],
    codeFlows: [{ threadFlows: [{ locations: [
      { location: { physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 10 } }, message: { text: 'user input' } } },
      { location: { physicalLocation: { artifactLocation: { uri: 'src/b.js' }, region: { startLine: 20 } }, message: { text: 'sql exec' } } }
    ] }] }]
  }, 'repo', '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { repo: "repo", rule: "rule1", file: "src/a.js", reachability: "reachable", path: { steps: 2, flows: 1, source: { file: "src/a.js", line: 10, expr: "user input" }, sink: { file: "src/b.js", line: 20, expr: "sql exec" } }, evidence: { source: "codeql", method: "dataflow", confidence: "high", at: "2024-01-01T00:00:00Z", detail: "CodeQL traced 2 steps from user input (src/a.js:10) to sql exec (src/b.js:20)" } });
});

test('returns reachable with path when source expr is null', () => {
  const r = dataflowFromResult({
    ruleId: 'rule1',
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' } } }],
    codeFlows: [{ threadFlows: [{ locations: [
      { location: { physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 10 } } } },
      { location: { physicalLocation: { artifactLocation: { uri: 'src/b.js' }, region: { startLine: 20 } }, message: { text: 'sink' } } }
    ] }] }]
  }, 'repo', '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { repo: "repo", rule: "rule1", file: "src/a.js", reachability: "reachable", path: { steps: 2, flows: 1, source: { file: "src/a.js", line: 10, expr: null }, sink: { file: "src/b.js", line: 20, expr: "sink" } }, evidence: { source: "codeql", method: "dataflow", confidence: "high", at: "2024-01-01T00:00:00Z", detail: "CodeQL traced 2 steps from a source (src/a.js:10) to sink (src/b.js:20)" } });
});

test('returns reachable with single-step path when one location in threadFlow', () => {
  const r = dataflowFromResult({
    ruleId: 'rule1',
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' } } }],
    codeFlows: [{ threadFlows: [{ locations: [
      { location: { physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 5 } }, message: { text: 'both' } } }
    ] }] }]
  }, 'repo', '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { repo: "repo", rule: "rule1", file: "src/a.js", reachability: "reachable", path: { steps: 1, flows: 1, source: { file: "src/a.js", line: 5, expr: "both" }, sink: { file: "src/a.js", line: 5, expr: "both" } }, evidence: { source: "codeql", method: "dataflow", confidence: "high", at: "2024-01-01T00:00:00Z", detail: "CodeQL traced 1 steps from both (src/a.js:5) to both (src/a.js:5)" } });
});
