// bin/test/setup-units.test.mjs — case tests for ensureFirstRunSetup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFirstRunSetup } from '../setup.mjs';

test('returns undefined when stdin is not a TTY', async () => {
  const orig = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  try {
    const result = await ensureFirstRunSetup();
    assert.equal(result, undefined);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: orig, configurable: true });
  }
});

test('returns undefined when stdout is not a TTY', async () => {
  const orig = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  try {
    const result = await ensureFirstRunSetup();
    assert.equal(result, undefined);
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: orig, configurable: true });
  }
});

test('returns undefined when CW_SKIP_SETUP is 1', async () => {
  const origIn = process.stdin.isTTY;
  const origOut = process.stdout.isTTY;
  const origEnv = process.env.CW_SKIP_SETUP;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  process.env.CW_SKIP_SETUP = '1';
  try {
    const result = await ensureFirstRunSetup();
    assert.equal(result, undefined);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: origIn, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: origOut, configurable: true });
    if (origEnv === undefined) delete process.env.CW_SKIP_SETUP;
    else process.env.CW_SKIP_SETUP = origEnv;
  }
});
