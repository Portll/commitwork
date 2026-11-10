// Detects self-adjudication in verdict journals (bin/lib/pattern-core.mjs detectSelfAdjudication).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSelfAdjudication } from '../lib/pattern-core.mjs';

test('filters out non-adjudication records and nulls', () => {
  const records = [
    { kind: 'note', adjudicatedBy: 'bot' },
    null,
    { kind: 'adjudication', adjudicatedBy: 'bot' }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [{ identity: "<verdict-journal>::party:bot::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "party:bot", line: null, lineIsAdvisory: true }, evidence: { predicate: "1 adjudication(s) were recorded by an instrument with no independent party on the record \u2014 no human hand and no separate attribution check, so the verdict rests on one witness re-run rather than on two", snippet: "bot \u2014 1 record(s)", redacted: 0, redactor: null }, confidence: "structural", extra: { party: "bot", count: 1, gates: [] } }], undetermined: [], denominator: { unit: "adjudication-record", scanned: 1, skipped: [] } });
});

test('filters out records without adjudicatedBy', () => {
  const records = [
    { kind: 'adjudication' },
    { kind: 'adjudication', adjudicatedBy: '' }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "<verdict-journal>::<none>::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "<none>", line: null, lineIsAdvisory: true }, evidence: { predicate: "the journal carries no adjudication records, so independence could not be assessed \u2014 undetermined, not clean", snippet: "adjudications=0", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "adjudication-record", scanned: 0, skipped: [] } });
});

test('handles null records input', () => {
  const r = detectSelfAdjudication({ records: null });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "<verdict-journal>::<none>::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "<none>", line: null, lineIsAdvisory: true }, evidence: { predicate: "the journal carries no adjudication records, so independence could not be assessed \u2014 undetermined, not clean", snippet: "adjudications=0", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "adjudication-record", scanned: 0, skipped: [] } });
});

test('excludes records with independent who', () => {
  const records = [
    { kind: 'adjudication', adjudicatedBy: 'bot', who: 'human' }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "adjudication-record", scanned: 1, skipped: [] } });
});

test('excludes records with attributionCorrect defined', () => {
  const records = [
    { kind: 'adjudication', adjudicatedBy: 'bot', attributionCorrect: false }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "adjudication-record", scanned: 1, skipped: [] } });
});

test('excludes records where adjudicatedBy is in humanParties', () => {
  const records = [
    { kind: 'adjudication', adjudicatedBy: 'alice' }
  ];
  const r = detectSelfAdjudication({ records, humanParties: ['alice'] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "adjudication-record", scanned: 1, skipped: [] } });
});

test('excludes canary records from self-adjudication count', () => {
  const records = [
    { kind: 'adjudication', adjudicatedBy: 'bot', canary: true },
    { kind: 'adjudication', adjudicatedBy: 'bot' }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [{ identity: "<verdict-journal>::party:bot::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "party:bot", line: null, lineIsAdvisory: true }, evidence: { predicate: "1 adjudication(s) were recorded by an instrument with no independent party on the record \u2014 no human hand and no separate attribution check, so the verdict rests on one witness re-run rather than on two", snippet: "bot \u2014 1 record(s)", redacted: 0, redactor: null }, confidence: "structural", extra: { party: "bot", count: 1, gates: [] } }], undetermined: [], denominator: { unit: "adjudication-record", scanned: 1, skipped: [{ path: "<verdict-journal>", reason: "1 canary records excluded \u2014 a planted expectation is the independent party" }] } });
});

test('creates observation for self-adjudicating party', () => {
  const records = [
    { kind: 'adjudication', adjudicatedBy: 'scanner', gate: 'G1' },
    { kind: 'adjudication', adjudicatedBy: 'scanner', gate: 'G2' }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [{ identity: "<verdict-journal>::party:scanner::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "party:scanner", line: null, lineIsAdvisory: true }, evidence: { predicate: "2 adjudication(s) were recorded by an instrument with no independent party on the record \u2014 no human hand and no separate attribution check, so the verdict rests on one witness re-run rather than on two", snippet: "scanner \u2014 2 record(s), gates: G1, G2", redacted: 0, redactor: null }, confidence: "structural", extra: { party: "scanner", count: 2, gates: ["G1", "G2"] } }], undetermined: [], denominator: { unit: "adjudication-record", scanned: 2, skipped: [] } });
});

test('creates undetermined observation when no adjudications exist', () => {
  const records = [
    { kind: 'note', adjudicatedBy: 'bot' }
  ];
  const r = detectSelfAdjudication({ records });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "<verdict-journal>::<none>::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "<none>", line: null, lineIsAdvisory: true }, evidence: { predicate: "the journal carries no adjudication records, so independence could not be assessed \u2014 undetermined, not clean", snippet: "adjudications=0", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "adjudication-record", scanned: 0, skipped: [] } });
});

test('handles empty records array', () => {
  const r = detectSelfAdjudication({ records: [] });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "<verdict-journal>::<none>::G12", detector: "self-adjudication@1", classId: "G12", place: { path: "<verdict-journal>", scope: "<none>", line: null, lineIsAdvisory: true }, evidence: { predicate: "the journal carries no adjudication records, so independence could not be assessed \u2014 undetermined, not clean", snippet: "adjudications=0", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "adjudication-record", scanned: 0, skipped: [] } });
});
