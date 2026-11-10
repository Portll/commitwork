// Order-independent canonical summary of each SARIF run (bin/lib/lane-reuse.mjs sarifResults).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sarifResults } from '../lib/lane-reuse.mjs';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const fs = process.getBuiltinModule('node:fs');
const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
const here = fileURLToPath(import.meta.url);

function scan(...runs) {
  const real = fs.readFileSync;
  fs.readFileSync = (p, opts) => {
    if ((p instanceof URL ? fileURLToPath(p) : String(p)) !== here) return real(p, opts);
    const bytes = Buffer.from(JSON.stringify({ version: '2.1.0', runs }));
    const encoding = typeof opts === 'string' ? opts : opts && opts.encoding;
    return encoding ? bytes.toString(encoding) : bytes;
  };
  syncBuiltinESMExports();
  try {
    return sarifResults(here);
  } finally {
    fs.readFileSync = real;
    syncBuiltinESMExports();
  }
}

const summary = (...runs) => JSON.stringify(runs.map(([artifacts, results, tool]) => ({ artifacts, results: results && results.map((r) => JSON.stringify(r)), tool })));
const codeql = { driver: { name: 'CodeQL', semanticVersion: '2.19.0', version: '2.19.0+build' } };
const art = (uri) => ({ location: { uri } });
const at = (artifactLocation) => ({ physicalLocation: { artifactLocation } });

test('a path that does not exist reports the missing state', () => {
  assert.equal(sarifResults('/nonexistent/commitwork/results.sarif'), "state:absent");
});

test('a file with no content reports the empty state', () => {
  assert.equal(sarifResults('/dev/null'), 'state:empty');
});

test('a result loses its rule indexes and its artifact index becomes the uri it points to', () => {
  const result = { ruleId: 'js/xss', ruleIndex: 4, rule: { id: 'js/xss', index: 4 }, message: { text: 'XSS' }, locations: [{ physicalLocation: { artifactLocation: { index: 1 }, region: { startLine: 7 } } }] };
  assert.equal(scan({ tool: codeql, artifacts: [art('src/b.js'), art('src/a.js')], results: [result] }), summary([
    ['src/a.js', 'src/b.js'],
    [{ locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 7 } } }], message: { text: 'XSS' }, rule: { id: 'js/xss' }, ruleId: 'js/xss' }],
    'CodeQL@2.19.0',
  ]));
});

test('a location keeps its own uri over its index, an index past the artifacts gives null, and version stands in for semanticVersion', () => {
  const results = [
    { ruleId: 'r2', locations: [at({ index: 1 })] },
    { ruleId: 'r1', locations: [at({ uri: 'lib/own.js', uriBaseId: 'SRCROOT', index: 0 })] },
  ];
  assert.equal(scan({ tool: { driver: { name: 'Semgrep', version: '1.90.0' } }, artifacts: [art('src/a.js')], results }), summary([
    ['src/a.js'],
    [{ locations: [at({ uri: 'lib/own.js', uriBaseId: 'SRCROOT' })], ruleId: 'r1' }, { locations: [at({ uri: null })], ruleId: 'r2' }],
    'Semgrep@1.90.0',
  ]));
});

test('artifacts without a uri count as null and a repeated uri is listed once, all sorted', () => {
  const artifacts = [art('src/z.js'), null, { location: {} }, { description: { text: 'generated' } }, art('src/z.js'), art('src/m.js')];
  assert.equal(scan({ tool: { driver: { name: 'CodeQL' } }, artifacts, results: [{ ruleId: 'r', locations: [at({ index: 2 }), at({ index: 5 })] }] }), summary([
    [null, 'src/m.js', 'src/z.js'],
    [{ locations: [at({ uri: null }), at({ uri: 'src/m.js' })], ruleId: 'r' }],
    'CodeQL@',
  ]));
});

test('only an integer index, zero included, is resolved and any other index is copied as written', () => {
  const locations = [at({ index: '1' }), at({ index: 1.5, uriBaseId: 'SRC' }), at({ index: 0 })];
  assert.equal(scan({ tool: codeql, artifacts: [art('src/a.js'), art('src/b.js')], results: [{ ruleId: 'r', locations }] }), summary([
    ['src/a.js', 'src/b.js'],
    [{ locations: [at({ index: '1' }), at({ index: 1.5, uriBaseId: 'SRC' }), at({ uri: 'src/a.js' })], ruleId: 'r' }],
    'CodeQL@2.19.0',
  ]));
});

test('a run with no driver, no artifacts and no results array still gets a summary, in run order', () => {
  assert.equal(scan({ tool: {}, results: null }, { tool: codeql, results: [] }), "[{\"artifacts\":[],\"results\":[],\"tool\":\"@\"},{\"artifacts\":[],\"results\":[],\"tool\":\"CodeQL@2.19.0\"}]");
});

test('the same findings with artifacts and results reordered and different rule indexes give the same summary', () => {
  const finding = (ruleId, ruleIndex, index) => ({ ruleId, ruleIndex, locations: [at({ index })] });
  const expected = summary([
    ['src/a.js', 'src/b.js'],
    [{ locations: [at({ uri: 'src/a.js' })], ruleId: 'r1' }, { locations: [at({ uri: 'src/b.js' })], ruleId: 'r2' }],
    'CodeQL@2.19.0',
  ]);
  assert.equal(scan({ tool: codeql, artifacts: [art('src/a.js'), art('src/b.js')], results: [finding('r2', 1, 1), finding('r1', 0, 0)] }), expected);
  assert.equal(scan({ tool: codeql, artifacts: [art('src/b.js'), art('src/a.js')], results: [finding('r1', 7, 1), finding('r2', 3, 0)] }), expected);
});

test('null, false, zero and empty values pass through, as do a null artifactLocation and a rule that is not an object', () => {
  const results = [
    { ruleId: 'q', rule: null, locations: [] },
    { ruleId: 'r', rule: 'r', baselineState: null, kind: '', rank: 0, properties: { suppressed: false }, locations: [{ physicalLocation: { artifactLocation: null, region: { startColumn: 0 } } }] },
  ];
  assert.equal(scan({ tool: codeql, artifacts: [art('src/a.js')], results }), summary([
    ['src/a.js'],
    [
      { baselineState: null, kind: '', locations: [{ physicalLocation: { artifactLocation: null, region: { startColumn: 0 } } }], properties: { suppressed: false }, rank: 0, rule: 'r', ruleId: 'r' },
      { locations: [], rule: null, ruleId: 'q' },
    ],
    'CodeQL@2.19.0',
  ]));
});
