// monitor/test/sarif-read-degraded.test.mjs — an 'ok' record must say when its run failed beside
// its results. The state stays 'ok' (findings win over errors), but executionFailed, toolErrors
// and degraded make the partial failure visible instead of letting it read like a healthy scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSarif } from '../sarif-read.mjs';

const D = () => mkdtempSync(join(tmpdir(), 'cw-sarif-degraded-'));
const put = (dir, name, content) => {
  const p = join(dir, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};

const result = (id) => ({ ruleId: id, level: 'error', message: { text: id } });

const doc = (invocations, results = [result('sqli')]) => ({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'tool' } }, invocations, results }],
});

const read = (docOrText, name = 'x.sarif') => readSarif(put(D(), name, docOrText));

test('executionSuccessful=false beside one result: ok, executionFailed true, no toolErrors, degraded', () => {
  const r = read(doc([{ executionSuccessful: false }], [result('sqli')]));
  assert.equal(r.state, 'ok');
  assert.equal(r.resultCount, 1);
  assert.equal(r.executionFailed, true);
  assert.deepEqual(r.toolErrors, []);
  assert.equal(r.degraded, true);
});

test('one error notification beside two results: toolErrors carries its text, degraded', () => {
  const r = read(doc([{ executionSuccessful: true, toolExecutionNotifications: [
    { level: 'error', message: { text: 'rule pack failed to load' } }] }],
  [result('a'), result('b')]));
  assert.equal(r.state, 'ok');
  assert.equal(r.resultCount, 2);
  assert.equal(r.executionFailed, false);
  assert.deepEqual(r.toolErrors, ['rule pack failed to load']);
  assert.equal(r.degraded, true);
});

test('a failed run and a fatal notification together: both fields set, degraded', () => {
  const r = read(doc([{ executionSuccessful: false, toolExecutionNotifications: [
    { level: 'fatal', message: { text: 'out of memory' } }] }]));
  assert.equal(r.state, 'ok');
  assert.equal(r.executionFailed, true);
  assert.deepEqual(r.toolErrors, ['out of memory']);
  assert.equal(r.degraded, true);
});

test('a healthy run with results is not degraded', () => {
  const r = read(doc([{ executionSuccessful: true }]));
  assert.equal(r.state, 'ok');
  assert.equal(r.executionFailed, false);
  assert.deepEqual(r.toolErrors, []);
  assert.equal(r.degraded, false);
});

test("a 'Missing plugin' note beside results is a tool error", () => {
  const r = read(doc([{ executionSuccessful: true, toolExecutionNotifications: [
    { level: 'note', descriptor: { id: 'Missing plugin' }, message: { text: 'Missing Semgrep extension needed for parsing Elixir target.' } }] }]));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.toolErrors, ['Missing Semgrep extension needed for parsing Elixir target.']);
  assert.equal(r.degraded, true);
});

test("a 'note' notification with another descriptor id never enters toolErrors", () => {
  const r = read(doc([{ executionSuccessful: true, toolExecutionNotifications: [
    { level: 'note', descriptor: { id: 'some-other-note' }, message: { text: 'unrelated' } }] }]));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.toolErrors, []);
  assert.equal(r.degraded, false);
});

test('a warning-level notification never enters toolErrors and does not degrade the run', () => {
  const r = read(doc([{ executionSuccessful: true, toolExecutionNotifications: [
    { level: 'warning', message: { text: 'skipped a large file' } }] }]));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.toolErrors, []);
  assert.equal(r.degraded, false);
});

test('a CodeQL per-file extraction failure is in extractionErrors, not toolErrors, and does not degrade', () => {
  const r = read(doc([{ executionSuccessful: true, toolExecutionNotifications: [{
    level: 'error',
    descriptor: { id: 'codeql/diagnostics/extraction-errors' },
    message: { text: 'Extraction failed in src/a.js with error boom' },
  }] }]));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.extractionErrors.map((e) => e.uri), ['src/a.js']);
  assert.deepEqual(r.toolErrors, []);
  assert.equal(r.degraded, false);
});

test('two error notifications keep document order in toolErrors', () => {
  const r = read(doc([{ executionSuccessful: true, toolExecutionNotifications: [
    { level: 'error', message: { text: 'first failure' } },
    { level: 'fatal', message: { text: 'second failure' } }] }]));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.toolErrors, ['first failure', 'second failure']);
});

test('zero results with executionSuccessful=false is still tool-failed, with no ok fields', () => {
  const r = read(doc([{ executionSuccessful: false }], []));
  assert.equal(r.state, 'tool-failed');
  assert.equal(r.results, null);
  assert.equal(r.executionFailed, undefined);
  assert.equal(r.toolErrors, undefined);
  assert.equal(r.degraded, undefined);
});

test('the same file read twice gives deep-equal records', () => {
  const p = put(D(), 'twice.sarif', doc([{ executionSuccessful: false, toolExecutionNotifications: [
    { level: 'error', message: { text: 'rule pack failed to load' } }] }]));
  assert.deepEqual(readSarif(p), readSarif(p));
});
