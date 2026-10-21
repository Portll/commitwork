// Human-readable summary of orphan buckets (flow/orphans.mjs formatReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../orphans.mjs';

test('formats a report with all buckets populated', () => {
  const o = {
    summary: {
      writtenNeverRead: 3,
      readNeverWritten: 5,
      readNeverWrittenWithFallback: 2,
      directionUnknown: 1,
      lowConfidenceComposed: 4,
      testFixtures: 6,
    },
  };
  const expected = [
    'flow/orphans: written-never-read 3  read-never-written 5  (+2 of those behind a fallback, reported separately)',
    '  direction never determined (NOT a finding)  1',
    '  bare-filename nodes, low confidence         4',
    '  test fixtures (not repo artifacts)          6',
  ].join('\n');
  assert.equal(formatReport(o), expected);
});

test('formats a report with zero counts', () => {
  const o = {
    summary: {
      writtenNeverRead: 0,
      readNeverWritten: 0,
      readNeverWrittenWithFallback: 0,
      directionUnknown: 0,
      lowConfidenceComposed: 0,
      testFixtures: 0,
    },
  };
  const expected = [
    'flow/orphans: written-never-read 0  read-never-written 0  (+0 of those behind a fallback, reported separately)',
    '  direction never determined (NOT a finding)  0',
    '  bare-filename nodes, low confidence         0',
    '  test fixtures (not repo artifacts)          0',
  ].join('\n');
  assert.equal(formatReport(o), expected);
});

test('formats a report with single unit counts', () => {
  const o = {
    summary: {
      writtenNeverRead: 1,
      readNeverWritten: 1,
      readNeverWrittenWithFallback: 1,
      directionUnknown: 1,
      lowConfidenceComposed: 1,
      testFixtures: 1,
    },
  };
  const expected = [
    'flow/orphans: written-never-read 1  read-never-written 1  (+1 of those behind a fallback, reported separately)',
    '  direction never determined (NOT a finding)  1',
    '  bare-filename nodes, low confidence         1',
    '  test fixtures (not repo artifacts)          1',
  ].join('\n');
  assert.equal(formatReport(o), expected);
});

test('formats a report with large counts', () => {
  const o = {
    summary: {
      writtenNeverRead: 100,
      readNeverWritten: 200,
      readNeverWrittenWithFallback: 300,
      directionUnknown: 400,
      lowConfidenceComposed: 500,
      testFixtures: 600,
    },
  };
  const expected = [
    'flow/orphans: written-never-read 100  read-never-written 200  (+300 of those behind a fallback, reported separately)',
    '  direction never determined (NOT a finding)  400',
    '  bare-filename nodes, low confidence         500',
    '  test fixtures (not repo artifacts)          600',
  ].join('\n');
  assert.equal(formatReport(o), expected);
});

test('formats a report with asymmetric counts', () => {
  const o = {
    summary: {
      writtenNeverRead: 7,
      readNeverWritten: 12,
      readNeverWrittenWithFallback: 3,
      directionUnknown: 0,
      lowConfidenceComposed: 2,
      testFixtures: 0,
    },
  };
  const expected = [
    'flow/orphans: written-never-read 7  read-never-written 12  (+3 of those behind a fallback, reported separately)',
    '  direction never determined (NOT a finding)  0',
    '  bare-filename nodes, low confidence         2',
    '  test fixtures (not repo artifacts)          0',
  ].join('\n');
  assert.equal(formatReport(o), expected);
});
