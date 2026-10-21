// bin/test/verdict-journal-core-units.test.mjs — case tests for judgementArchivePath, retractionsFrom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { judgementArchivePath, retractionsFrom } from '../lib/verdict-journal-core.mjs';

test('returns path with month from ISO timestamp', () => {
  const result = judgementArchivePath('/data/verdicts/2024-01-15.jsonl', '2024-01-15T10:30:00Z');
  assert.equal(result, join('/data/verdicts', 'judgements', '2024-01.jsonl'));
});

test('returns path with month from different date', () => {
  const result = judgementArchivePath('/srv/verdicts/log.jsonl', '2023-12-25T00:00:00Z');
  assert.equal(result, join('/srv/verdicts', 'judgements', '2023-12.jsonl'));
});

test('returns undated when at is empty string', () => {
  const result = judgementArchivePath('/data/verdicts/file.jsonl', '');
  assert.equal(result, join('/data/verdicts', 'judgements', 'undated.jsonl'));
});

test('returns undated when at is undefined', () => {
  const result = judgementArchivePath('/data/verdicts/file.jsonl', undefined);
  assert.equal(result, join('/data/verdicts', 'judgements', 'undated.jsonl'));
});

test('returns undated when at is null', () => {
  const result = judgementArchivePath('/data/verdicts/file.jsonl', null);
  assert.equal(result, join('/data/verdicts', 'judgements', 'undated.jsonl'));
});

test('handles relative file path', () => {
  const result = judgementArchivePath('verdicts/2024-06-01.jsonl', '2024-06-01T12:00:00Z');
  assert.equal(result, join('verdicts', 'judgements', '2024-06.jsonl'));
});

test('uses only first 7 chars of at for month', () => {
  const result = judgementArchivePath('/a/b/c.jsonl', '2024-03-15T08:00:00Z');
  assert.equal(result, join('/a/b', 'judgements', '2024-03.jsonl'));
});

test('empty array returns zero count and has() false', () => {
  const r = retractionsFrom([]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ gate: 'g', recordAt: 't', method: 'm' }), false);
});

test('non-retraction entries are skipped', () => {
  const r = retractionsFrom([{ kind: 'other', gate: 'g', recordAt: 't', method: 'm' }]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ gate: 'g', recordAt: 't', method: 'm' }), false);
});

test('missing gate or recordAt is skipped', () => {
  const r = retractionsFrom([
    { kind: 'adjudication-retraction', recordAt: 't', method: 'm' },
    { kind: 'adjudication-retraction', gate: 'g', method: 'm' },
  ]);
  assert.equal(r.count, 0);
});

test('null entry is skipped', () => {
  const r = retractionsFrom([null]);
  assert.equal(r.count, 0);
});

test('retraction with method uses exact key', () => {
  const rec = { kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1', method: 'm1' };
  const r = retractionsFrom([rec]);
  assert.equal(r.count, 1);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm1' }), true);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm2' }), false);
});

test('retraction without method uses anyMethod key', () => {
  const rec = { kind: 'adjudication-retraction', gate: 'g2', recordAt: 't2' };
  const r = retractionsFrom([rec]);
  assert.equal(r.count, 1);
  assert.equal(r.has({ gate: 'g2', recordAt: 't2', method: 'anything' }), true);
  assert.equal(r.has({ gate: 'g2', recordAt: 't3', method: 'anything' }), false);
});

test('duplicate same gate+recordAt+method counts once', () => {
  const rec = { kind: 'adjudication-retraction', gate: 'g', recordAt: 't', method: 'm' };
  const r = retractionsFrom([rec, { ...rec }]);
  assert.equal(r.count, 1);
});

test('duplicate same gate+recordAt without method counts once', () => {
  const rec = { kind: 'adjudication-retraction', gate: 'g', recordAt: 't' };
  const r = retractionsFrom([rec, { ...rec }]);
  assert.equal(r.count, 1);
});
