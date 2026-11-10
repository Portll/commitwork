// Computes the archive path for a judgement file by month (bin/lib/verdict-journal-core.mjs judgementArchivePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgementArchivePath } from '../lib/verdict-journal-core.mjs';
import { join, dirname } from 'node:path';

test('returns path with month derived from a full ISO timestamp', () => {
  const filePath = '/repo/verdicts/2024-01-15T10:30:00Z.json';
  const at = '2024-01-15T10:30:00.000Z';
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/2024-01.jsonl");
});

test('returns path with undated month when at is undefined', () => {
  const filePath = '/repo/verdicts/abc.json';
  const r = judgementArchivePath(filePath, undefined);
  assert.equal(r, "/repo/verdicts/judgements/undated.jsonl");
});

test('returns path with undated month when at is null', () => {
  const filePath = '/repo/verdicts/abc.json';
  const r = judgementArchivePath(filePath, null);
  assert.equal(r, "/repo/verdicts/judgements/undated.jsonl");
});

test('returns path with undated month when at is empty string', () => {
  const filePath = '/repo/verdicts/abc.json';
  const r = judgementArchivePath(filePath, '');
  assert.equal(r, "/repo/verdicts/judgements/undated.jsonl");
});

test('returns path with month from a short date string', () => {
  const filePath = '/repo/verdicts/abc.json';
  const at = '2023-12-01';
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/2023-12.jsonl");
});

test('returns path with undated month when at is a number', () => {
  const filePath = '/repo/verdicts/abc.json';
  const at = 12345;
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/12345.jsonl");
});

test('returns path with month from a timestamp shorter than 7 chars', () => {
  const filePath = '/repo/verdicts/abc.json';
  const at = '2024-0';
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/2024-0.jsonl");
});

test('returns path with month from a timestamp exactly 7 chars', () => {
  const filePath = '/repo/verdicts/abc.json';
  const at = '2024-01';
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/2024-01.jsonl");
});

test('returns path with month from a timestamp longer than 7 chars', () => {
  const filePath = '/repo/verdicts/abc.json';
  const at = '2024-01-15T10:30:00Z';
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/2024-01.jsonl");
});

test('returns path with month from a timestamp of 8 chars', () => {
  const filePath = '/repo/verdicts/abc.json';
  const at = '2024-011';
  const r = judgementArchivePath(filePath, at);
  assert.equal(r, "/repo/verdicts/judgements/2024-01.jsonl");
});
