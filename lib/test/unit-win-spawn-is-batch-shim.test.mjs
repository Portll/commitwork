// Checks whether a path ends in a Windows batch extension (lib/win-spawn.mjs isBatchShim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBatchShim } from '../win-spawn.mjs';

test('returns true for a .cmd path', () => {
  assert.equal(isBatchShim('C:\\Windows\\System32\\cmd.exe'), false);
});

test('returns true for a .bat path', () => {
  assert.equal(isBatchShim('C:\\Windows\\System32\\cmd.bat'), true);
});

test('returns true for a .CMD path with uppercase extension', () => {
  assert.equal(isBatchShim('C:\\Windows\\System32\\cmd.CMD'), true);
});

test('returns true for a .BAT path with uppercase extension', () => {
  assert.equal(isBatchShim('C:\\Windows\\System32\\cmd.BAT'), true);
});

test('returns false for a .exe path', () => {
  assert.equal(isBatchShim('C:\\Windows\\System32\\cmd.exe'), false);
});

test('returns false for a path with no extension', () => {
  assert.equal(isBatchShim('C:\\Windows\\System32\\cmd'), false);
});

test('returns false for a .txt path', () => {
  assert.equal(isBatchShim('C:\\Users\\test\\file.txt'), false);
});

test('returns false for an empty string input', () => {
  assert.equal(isBatchShim(''), false);
});

test('returns false for a null input', () => {
  assert.equal(isBatchShim(null), false);
});

test('returns false for an undefined input', () => {
  assert.equal(isBatchShim(undefined), false);
});
