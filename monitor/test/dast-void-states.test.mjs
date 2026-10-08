// monitor/test/dast-void-states.test.mjs — the DAST lanes' three artifact shapes, and the one that
// used to read as clean.
//
// A lane that probes a RUNNING target has a void a source scanner does not: nothing to probe, or a
// tool that produced output without producing a result. Schemathesis and BOLA each had a state for
// it; nuclei did not, and published `ran:true` with zeroes — a clean scan — for an artifact of
// error lines. The check's own formatNotes declare the opposite ("An empty file is clean; content
// with only non-findings is a void"), and bin/commitwork.mjs's parseReport has returned `noscan`
// for it since 2026-08-07. Two layers, one file, opposite verdicts.
//
// These are the first tests to exercise _nucleiCounts at all, which is how the gap survived.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _nucleiCounts, _schemathesisCounts, _bolaCounts, stampUnknown } from '../extractors.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-dast-'));
const withArtifact = (name, body, fn) => {
  const d = scratch();
  try { writeFileSync(join(d, name), body); return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};
const FINDING = JSON.stringify({
  'template-id': 'exposed-env', info: { severity: 'high', name: 'Exposed .env' },
  'matched-at': 'http://localhost:8080/.env', type: 'http', port: '8080',
});
const INFO_RECORD = JSON.stringify({
  'template-id': 'tech-detect', info: { severity: 'info', name: 'Technology' },
  'matched-at': 'http://localhost:8080/', type: 'http',
});

describe('nuclei: an artifact with content but no record is a void, not a clean run', () => {
  test('an EMPTY artifact stays clean — a run that found nothing writes no lines', () => {
    const r = withArtifact('nuclei.jsonl', '', (d) => _nucleiCounts(d, 'nuclei.jsonl'));
    assert.equal(r.ran, true);
    assert.equal(r.total, 0);
    assert.ok(!r.toolfailed, 'an empty file is the clean case the formatNotes describe');
    assert.equal(stampUnknown(r).unknown, undefined, 'a clean zero must not be stamped unknown');
  });

  test('only non-findings — error objects, another tool’s output — is toolfailed, NOT a clean zero', () => {
    const body = [JSON.stringify({ error: 'connection refused' }), '{}', 'not json at all'].join('\n');
    const r = withArtifact('nuclei.jsonl', body, (d) => _nucleiCounts(d, 'nuclei.jsonl'));
    assert.equal(r.toolfailed, true, 'this is the defect: it used to return ran:true with zeroes');
    assert.equal(r.total, 0);
    assert.match(r.reason, /no nuclei records — 3 non-finding line\(s\)/);
    // The whole point of the state: it must not read as evidence that the target is clean.
    assert.equal(stampUnknown(r).unknownReason, 'tool-failed');
  });

  test('a real finding counts, and rows carry no host', () => {
    const r = withArtifact('nuclei.jsonl', `${FINDING}\n`, (d) => _nucleiCounts(d, 'nuclei.jsonl'));
    assert.ok(!r.toolfailed);
    assert.equal(r.high, 1);
    assert.equal(r.total, 1);
    assert.equal(r.findings[0].path, '/.env', 'the host is dropped at the extractor');
    assert.equal(r.findings[0].rule, 'exposed-env');
  });

  test('an INFO record is a record: the discriminator is the template, not the severity', () => {
    // Info results are deliberately not counted. Counting them as non-findings would make a scan
    // that only detected technologies report a tool failure — the opposite error.
    const r = withArtifact('nuclei.jsonl', `${INFO_RECORD}\n`, (d) => _nucleiCounts(d, 'nuclei.jsonl'));
    assert.ok(!r.toolfailed, 'an info-severity record proves the tool ran and produced a result');
    assert.equal(r.total, 0, 'still not counted as a finding');
  });

  test('one real record alongside noise is a real scan', () => {
    const body = [JSON.stringify({ error: 'x' }), FINDING, 'garbage'].join('\n');
    const r = withArtifact('nuclei.jsonl', body, (d) => _nucleiCounts(d, 'nuclei.jsonl'));
    assert.ok(!r.toolfailed);
    assert.equal(r.total, 1);
  });

  test('an ABSENT artifact is still null — absence is the checks-status provenance’s to report', () => {
    const d = scratch();
    try { assert.equal(_nucleiCounts(d, 'nuclei.jsonl'), null); } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the sibling DAST lanes already refused a clean zero — nuclei now matches them', () => {
  test('schemathesis reports nosrc when the run loaded no spec', () => {
    const r = withArtifact('schemathesis.jsonl', '', (d) => _schemathesisCounts(d, 'schemathesis.jsonl'));
    assert.equal(r.nosrc, true);
    assert.equal(stampUnknown(r).unknown, true);
  });

  test('bola reports nosrc when it probed nothing (ran:false)', () => {
    const body = JSON.stringify({ ran: false, reason: 'no object-level endpoints found' });
    const r = withArtifact('bola.json', body, (d) => _bolaCounts(d, 'bola.json'));
    assert.equal(r.nosrc, true);
    assert.equal(stampUnknown(r).unknown, true);
  });
});
