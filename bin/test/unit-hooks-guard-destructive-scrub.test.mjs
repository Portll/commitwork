// Reduces a shell command to its live, unquoted, un-commented form (bin/hooks/guard-destructive.mjs scrub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../hooks/guard-destructive.mjs';

test('strips heredoc bodies before quote and comment handling', () => {
  assert.equal(scrub('git commit -m "$(cat <<\'EOF\'\nforce push\nEOF\n)"'), 'git commit -m $(cat  \n)');
});

test('collapses single-quoted strings to inert markers', () => {
  assert.equal(scrub("echo 'rm -rf /'"), "echo  '' ");
});

test('collapses double-quoted prose but keeps variable expansions', () => {
  assert.equal(scrub('rm -rf "$SCRATCH"/*'), 'rm -rf $SCRATCH/*');
});

test('preserves command substitutions inside double quotes', () => {
  assert.equal(scrub('cat "$(echo ~/.ssh/id_rsa)"'), 'cat $(echo ~/.ssh/id_rsa)');
});

test('preserves a dollar-paren pwd substitution inside double quotes', () => {
  assert.equal(scrub('echo "$(pwd)"'), 'echo $(pwd)');
});

test('keeps unterminated double quotes raw', () => {
  assert.equal(scrub('echo "unterminated'), 'echo "unterminated');
});

test('keeps unterminated single quotes raw', () => {
  assert.equal(scrub("echo 'unterminated"), "echo 'unterminated");
});

test('strips trailing comments after whitespace', () => {
  assert.equal(scrub('rm -rf / # force push'), 'rm -rf / ');
});

test('strips comments at start of line', () => {
  assert.equal(scrub('# rm -rf /'), ' ');
});

test('preserves escaped characters and null input', () => {
  assert.equal(scrub('echo \\'), 'echo \\');
  assert.equal(scrub(null), '');
});
