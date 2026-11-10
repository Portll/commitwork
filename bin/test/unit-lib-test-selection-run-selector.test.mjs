// Measured result of the configured selector command or the default test-select script (bin/lib/test-selection.mjs runSelector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runSelector } from '../lib/test-selection.mjs';

const stable = ({ measured: { at, ms, ...measured }, ...rest }) => ({ ...rest, measured });

const execResult = (source) => ({
  out: '\n',
  code: 1,
  measured: {
    source,
    ok: false,
    exit: 1,
    digest: `sha256:${createHash('sha256').update('\n').digest('hex').slice(0, 16)}`,
    detail: 'spawnSync /bin/sh ENOENT',
  },
});

const runResult = () => ({
  out: null,
  code: 1,
  measured: {
    source: 'test-select --json',
    ok: false,
    exit: 1,
    digest: null,
    detail: `spawnSync ${process.execPath} ENOENT`,
  },
});

test('A set selector command runs through the shell and is labelled with the command itself', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: 'pytest' } });
  assert.deepEqual(stable(r), execResult('pytest'));
});

test('A selector command with spaces is labelled with the whole command string', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: 'npm test' } });
  assert.deepEqual(stable(r), execResult('npm test'));
});

test('A set selector command with a custom timeout still runs through the shell', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: 'pytest' }, timeout: 5 });
  assert.deepEqual(stable(r), execResult('pytest'));
});

test('An env without the selector variable runs the default test-select script with node', () => {
  const r = runSelector('/repo', { env: {} });
  assert.deepEqual(stable(r), runResult());
});

test('An empty selector command falls back to the default test-select script', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: '' } });
  assert.deepEqual(stable(r), runResult());
});

test('A zero selector value falls back to the default test-select script', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: 0 } });
  assert.deepEqual(stable(r), runResult());
});

test('A null selector value falls back to the default test-select script', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: null } });
  assert.deepEqual(stable(r), runResult());
});

test('An undefined selector value falls back to the default test-select script', () => {
  const r = runSelector('/repo', { env: { CW_GATE_TESTS_SELECT_CMD: undefined } });
  assert.deepEqual(stable(r), runResult());
});
