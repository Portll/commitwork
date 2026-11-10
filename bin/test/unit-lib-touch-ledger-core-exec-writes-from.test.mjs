// Maps shell command redirections and output flags to repo-relative file paths (bin/lib/touch-ledger-core.mjs execWritesFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execWritesFrom } from '../lib/touch-ledger-core.mjs';

test('returns empty array for empty string command', () => {
  assert.deepEqual(execWritesFrom('', () => 'x'), []);
});

test('returns empty array for null command', () => {
  assert.deepEqual(execWritesFrom(null, () => 'x'), []);
});

test('returns empty array for undefined command', () => {
  assert.deepEqual(execWritesFrom(undefined, () => 'x'), []);
});

test('returns empty array for command with no write syntax', () => {
  assert.deepEqual(execWritesFrom('ls -la', () => 'x'), []);
});

test('returns empty array when toRepoPath is not a function', () => {
  assert.deepEqual(execWritesFrom('echo hi > out.txt', 'not-a-fn'), []);
});

test('returns empty array when toRepoPath returns null', () => {
  assert.deepEqual(execWritesFrom('echo hi > out.txt', () => null), []);
});

test('returns empty array when toRepoPath returns non-string', () => {
  assert.deepEqual(execWritesFrom('echo hi > out.txt', () => 42), []);
});

test('returns empty array when target is /dev/null', () => {
  assert.deepEqual(execWritesFrom('echo hi > /dev/null', () => '/dev/null'), []);
});

test('returns empty array when target is a file descriptor', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', () => '&2'), []);
});

test('returns empty array when target is dash', () => {
  assert.deepEqual(execWritesFrom('cat - > out.txt', () => '-'), ["-"]);
});

test('returns mapped path for simple redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi > out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for double-quoted redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi > "my file.txt"', (p) => p), ["my file.txt"]);
});

test('returns mapped path for single-quoted redirection', () => {
  assert.deepEqual(execWritesFrom("echo hi > 'my file.txt'", (p) => p), ["my file.txt"]);
});

test('returns mapped path for tee command', () => {
  assert.deepEqual(execWritesFrom('echo hi | tee out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for tee -a command', () => {
  assert.deepEqual(execWritesFrom('echo hi | tee -a out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for -o flag', () => {
  assert.deepEqual(execWritesFrom('cp in.txt -o out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for --output flag', () => {
  assert.deepEqual(execWritesFrom('cp in.txt --output out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for --output with equals', () => {
  assert.deepEqual(execWritesFrom('cp in.txt --output=out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for --output with space', () => {
  assert.deepEqual(execWritesFrom('cp in.txt --output out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 1> redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi 1> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2> redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi 2> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 2>> redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for >> redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi >> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for >& redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi >& out.txt', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});

test('returns mapped path for 2>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>> err.txt', (p) => p), ["err.txt"]);
});

test('returns mapped path for 1>&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>&2', (p) => p), []);
});

test('returns mapped path for 2>&1 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 2>&1', (p) => p), []);
});

test('returns mapped path for >&2 redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi >&2', (p) => p), []);
});

test('returns mapped path for 1>> redirection to file', () => {
  assert.deepEqual(execWritesFrom('echo hi 1>> out.txt', (p) => p), ["out.txt"]);
});
