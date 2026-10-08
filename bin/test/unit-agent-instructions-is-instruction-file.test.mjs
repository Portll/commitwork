// Determines if a relative path is an agent instruction or documentation file (bin/agent-instructions.mjs isInstructionFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInstructionFile } from '../agent-instructions.mjs';

test('returns true for AGENTS.md at root', () => {
  assert.equal(isInstructionFile('AGENTS.md'), true);
});

test('returns true for CLAUDE.md in subdirectory', () => {
  assert.equal(isInstructionFile('src/CLAUDE.md'), true);
});

test('returns true for .cursorrules at root', () => {
  assert.equal(isInstructionFile('.cursorrules'), true);
});

test('returns true for .github/copilot-instructions.md', () => {
  assert.equal(isInstructionFile('.github/copilot-instructions.md'), true);
});

test('returns true for README.md at root', () => {
  assert.equal(isInstructionFile('README.md'), true);
});

test('returns true for docs/guide.md', () => {
  assert.equal(isInstructionFile('docs/guide.md'), true);
});

test('returns true for .claude/settings.md', () => {
  assert.equal(isInstructionFile('.claude/settings.md'), true);
});

test('returns false for regular source file', () => {
  assert.equal(isInstructionFile('src/index.js'), false);
});

test('returns false for README.txt', () => {
  assert.equal(isInstructionFile('README.txt'), false);
});

test('returns true for docs/readme.md', () => {
  assert.equal(isInstructionFile('docs/readme.md'), true);
});
