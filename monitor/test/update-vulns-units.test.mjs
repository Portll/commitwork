// monitor/test/update-vulns-units.test.mjs — case tests for brewPrefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brewPrefix } from '../update-vulns.mjs';

test('returns CW_BREW_PREFIX when set', () => {
  const prev = process.env.CW_BREW_PREFIX;
  process.env.CW_BREW_PREFIX = '/custom/prefix';
  try {
    assert.equal(brewPrefix(), '/custom/prefix');
  } finally {
    if (prev === undefined) delete process.env.CW_BREW_PREFIX;
    else process.env.CW_BREW_PREFIX = prev;
  }
});

test('returns trimmed stdout when brew --prefix succeeds', () => {
  const run = (cmd, args) => {
    assert.equal(cmd, 'brew');
    assert.deepEqual(args, ['--prefix']);
    return { status: 0, stdout: '/usr/local\n' };
  };
  assert.equal(brewPrefix({ run }), '/usr/local');
});

test('returns /opt/homebrew when brew --prefix fails', () => {
  const run = () => ({ status: 1, stdout: '' });
  assert.equal(brewPrefix({ run }), '/opt/homebrew');
});

test('returns /opt/homebrew when stdout is empty after trim', () => {
  const run = () => ({ status: 0, stdout: '   \n' });
  assert.equal(brewPrefix({ run }), '/opt/homebrew');
});

test('returns /opt/homebrew when status is 0 but stdout is whitespace', () => {
  const run = () => ({ status: 0, stdout: '\t\n' });
  assert.equal(brewPrefix({ run }), '/opt/homebrew');
});
