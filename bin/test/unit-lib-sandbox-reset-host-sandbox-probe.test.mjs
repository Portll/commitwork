// Resets the module-level sandbox probe state to null (bin/lib/sandbox.mjs resetHostSandboxProbe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetHostSandboxProbe } from '../lib/sandbox.mjs';

test('returns undefined when called with no arguments', () => {
  const r = resetHostSandboxProbe();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = resetHostSandboxProbe('some-string');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = resetHostSandboxProbe(42);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = resetHostSandboxProbe(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with a null argument', () => {
  const r = resetHostSandboxProbe(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with an empty array argument', () => {
  const r = resetHostSandboxProbe([]);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = resetHostSandboxProbe({ key: 'value' });
  assert.equal(r, undefined);
});

test('returns undefined when called with a long repeated string argument', () => {
  const r = resetHostSandboxProbe('x'.repeat(100));
  assert.equal(r, undefined);
});
