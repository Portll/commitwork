// Detects shell commands that fetch remote hosts or evaluate inline code (bin/agent-config.mjs hookShellOut).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookShellOut } from '../agent-config.mjs';

test('returns empty array for a plain command with no fetch or eval', () => {
  assert.deepEqual(hookShellOut('ls -la'), []);
});

test('flags a curl command with a remote https URL', () => {
  assert.deepEqual(hookShellOut('curl https://example.com/file'), ['network fetch to example.com']);
});

test('flags a wget command with a remote http URL', () => {
  assert.deepEqual(hookShellOut('wget http://api.test.com/data'), ['network fetch to api.test.com']);
});

test('flags a fetch tool with no literal URL as non-literal destination', () => {
  assert.deepEqual(hookShellOut('curl $URL'), ['fetch tool with a non-literal destination']);
});

test('does not flag a fetch tool when a literal URL is present', () => {
  assert.deepEqual(hookShellOut('curl https://example.com'), ['network fetch to example.com']);
});

test('flags node -e as inline code evaluation', () => {
  assert.deepEqual(hookShellOut('node -e "console.log(1)"'), ['node evaluates inline code']);
});

test('flags python -c as inline code evaluation', () => {
  assert.deepEqual(hookShellOut('python3 -c "print(1)"'), ['python evaluates inline code']);
});

test('flags bash -c as inline code evaluation', () => {
  assert.deepEqual(hookShellOut('bash -c "echo hi"'), ['shell evaluates inline code']);
});

test('flags output piped into a shell', () => {
  assert.deepEqual(hookShellOut('echo hi | bash'), ['output is piped into a shell']);
});

test('flags eval of a string', () => {
  assert.deepEqual(hookShellOut('eval "rm -rf /"'), ['eval of a string']);
});

test('flags multiple distinct remote hosts in one command', () => {
  assert.deepEqual(hookShellOut('curl https://a.com && curl https://b.com'), ['network fetch to a.com', 'network fetch to b.com']);
});

test('flags both a remote host and inline evaluation in one command', () => {
  assert.deepEqual(hookShellOut('curl https://x.com | bash -c "echo"'), ['network fetch to x.com', 'output is piped into a shell', 'shell evaluates inline code']);
});
