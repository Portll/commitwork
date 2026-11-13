// computes SARIF replacement objects for a unified diff (lib/sarif-remediation.mjs replacementsForFileDiff)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replacementsForFileDiff } from '../sarif-remediation.mjs';

test('returns empty array when there are only context lines', () => {
  const input = {
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [' line1', ' line2', ' line3'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, []);
});

test('produces a deletion replacement when only deletions are present', () => {
  const input = {
    hunks: [
      {
        oldStart: 5,
        oldLines: 2,
        newStart: 5,
        newLines: 0,
        lines: ['-oldA', '-oldB'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 5, startColumn: 1, endLine: 7, endColumn: 1 } }]);
});

test('produces an insertion replacement when only insertions are present', () => {
  const input = {
    hunks: [
      {
        oldStart: 10,
        oldLines: 0,
        newStart: 10,
        newLines: 2,
        lines: ['+newA', '+newB'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 11, startColumn: 1, endLine: 11, endColumn: 1 }, insertedContent: { text: "newA\nnewB\n" } }]);
});

test('handles mixed delete/insert with newNoNewline true and newLast line', () => {
  const input = {
    hunks: [
      {
        oldStart: 20,
        oldLines: 2,
        newStart: 20,
        newLines: 2,
        newNoNewline: true,
        lines: ['-oldX', '+newX'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 20, startColumn: 1, endLine: 21, endColumn: 1 }, insertedContent: { text: "newX\n" } }]);
});

test('triggers oldLines===0 branch with insertion only', () => {
  const input = {
    hunks: [
      {
        oldStart: 30,
        oldLines: 0,
        newStart: 30,
        newLines: 1,
        lines: ['+onlyNew'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 31, startColumn: 1, endLine: 31, endColumn: 1 }, insertedContent: { text: "onlyNew\n" } }]);
});

test('triggers newLines===0 branch with deletion only', () => {
  const input = {
    hunks: [
      {
        oldStart: 40,
        oldLines: 1,
        newStart: 40,
        newLines: 0,
        lines: ['-onlyOld'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 40, startColumn: 1, endLine: 41, endColumn: 1 } }]);
});

test('sets atEndWithoutNewline true when oldNoNewline is true on last deleted line', () => {
  const input = {
    hunks: [
      {
        oldStart: 50,
        oldLines: 1,
        newStart: 50,
        newLines: 0,
        oldNoNewline: true,
        lines: ['-lastOld'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 50, startColumn: 1, endLine: 50, endColumn: 8 } }]);
});

test('processes multiple hunks with various line kinds', () => {
  const input = {
    hunks: [
      {
        oldStart: 60,
        oldLines: 1,
        newStart: 60,
        newLines: 1,
        lines: ['-del1', '+ins1'],
      },
      {
        oldStart: 70,
        oldLines: 2,
        newStart: 70,
        newLines: 2,
        lines: [' lineA', '-del2', '+ins2', ' lineB'],
      },
    ],
  };
  const result = replacementsForFileDiff(input);
  assert.deepEqual(result, [{ deletedRegion: { startLine: 60, startColumn: 1, endLine: 61, endColumn: 1 }, insertedContent: { text: "ins1\n" } }, { deletedRegion: { startLine: 71, startColumn: 1, endLine: 72, endColumn: 1 }, insertedContent: { text: "ins2\n" } }]);
});
