// Parses phase markers from build output into a list of phase results and a completion flag (bin/lib/build-health-parse.mjs parsePhases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhases } from '../lib/build-health-parse.mjs';

test('returns empty phases and false complete for null input', () => {
  assert.deepEqual(parsePhases(null), { complete: false, phases: [] });
});

test('returns empty phases and false complete for empty string', () => {
  assert.deepEqual(parsePhases(''), { complete: false, phases: [] });
});

test('ignores lines that do not start with the phase marker', () => {
  assert.deepEqual(parsePhases('some output\n__CW_PHASE name=a attempted=1 exit=0'), { complete: false, phases: [{ name: "a", attempted: true, exit: 0, green: true }] });
});

test('sets complete to true when end marker is present', () => {
  assert.deepEqual(parsePhases('__CW_PHASE end=1'), { complete: true, phases: [] });
});

test('parses a single phase with attempted and exit zero as green', () => {
  assert.deepEqual(parsePhases('__CW_PHASE name=build attempted=1 exit=0'), { complete: false, phases: [{ name: "build", attempted: true, exit: 0, green: true }] });
});

test('parses a phase with attempted but non-zero exit as not green', () => {
  assert.deepEqual(parsePhases('__CW_PHASE name=build attempted=1 exit=1'), { complete: false, phases: [{ name: "build", attempted: true, exit: 1, green: false }] });
});

test('parses a phase with attempted but invalid exit as null exit and not green', () => {
  assert.deepEqual(parsePhases('__CW_PHASE name=build attempted=1 exit=abc'), { complete: false, phases: [{ name: "build", attempted: true, exit: null, green: false }] });
});

test('parses a phase without attempted as not attempted with null exit', () => {
  assert.deepEqual(parsePhases('__CW_PHASE name=build'), { complete: false, phases: [{ name: "build", attempted: false, exit: null, green: false }] });
});

test('skips phase lines without a name field', () => {
  assert.deepEqual(parsePhases('__CW_PHASE attempted=1 exit=0'), { complete: false, phases: [] });
});

test('parses multiple phases and completion flag together', () => {
  assert.deepEqual(parsePhases('__CW_PHASE name=a attempted=1 exit=0\n__CW_PHASE name=b attempted=1 exit=2\n__CW_PHASE end=1'), { complete: true, phases: [{ name: "a", attempted: true, exit: 0, green: true }, { name: "b", attempted: true, exit: 2, green: false }] });
});
