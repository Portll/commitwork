// fn's result run under an exclusive file lock, or a lock-contention report (cra/lib.mjs withCraStoreLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCraStoreLock } from '../lib.mjs';
import { resolve } from 'node:path';

const KEYS = ['CW_CRA_LOCK_STALE_MS', 'CW_CRA_LOCK_ATTEMPTS', 'CW_CRA_LOCK_SPIN_MS'];

function withFastLockEnv(fn) {
  const saved = KEYS.map((k) => process.env[k]);
  process.env.CW_CRA_LOCK_STALE_MS = '600000';
  process.env.CW_CRA_LOCK_ATTEMPTS = '2';
  process.env.CW_CRA_LOCK_SPIN_MS = '1';
  try {
    return fn();
  } finally {
    KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
}

test('returns ok true with the value the function returned when the lock is free', () => {
  const r = withFastLockEnv(() => withCraStoreLock('.cw-wcsl-free', () => 42));
  assert.deepEqual(r, { ok: true, value: 42 });
});

test('returns ok true with an undefined value when the function returns nothing', () => {
  const r = withFastLockEnv(() => withCraStoreLock('.cw-wcsl-undef', () => {}));
  assert.deepEqual(r, { ok: true, value: undefined });
});

test('returns the very object the function returned as the value', () => {
  const obj = { a: 1, b: [2, 3] };
  const r = withFastLockEnv(() => withCraStoreLock('.cw-wcsl-object', () => obj));
  assert.equal(r.ok, true);
  assert.equal(r.value, obj);
  assert.deepEqual(Object.keys(r), ['ok', 'value']);
});

test('reports lock contention without running the function when the same path is already locked', () => {
  const path = '.cw-wcsl-nested';
  let innerRan = false;
  const outer = withFastLockEnv(() => withCraStoreLock(path, () => withCraStoreLock(path, () => {
    innerRan = true;
    return 'inner';
  })));
  assert.equal(outer.ok, true);
  assert.equal(innerRan, false);
  const inner = outer.value;
  assert.deepEqual(Object.keys(inner), ['ok', 'code', 'holder', 'target']);
  assert.deepEqual([inner.ok, inner.code, inner.target], [false, 'lock-contention', resolve(path)]);
  assert.notEqual(inner.holder, undefined);
});

test('reports contention with a custom label and the resolved absolute target', () => {
  const path = '.cw-wcsl-labelled';
  const outer = withFastLockEnv(() => withCraStoreLock(path, () => withCraStoreLock(path, () => 'x', { label: 'case-store' }), { label: 'case-store' }));
  assert.equal(outer.ok, true);
  assert.equal(outer.value.ok, false);
  assert.equal(outer.value.code, 'lock-contention');
  assert.equal(outer.value.target, resolve(path));
  assert.notEqual(outer.value.holder, undefined);
});

test('releases the lock after a contended run so the next call on the same path succeeds', () => {
  const path = '.cw-wcsl-after';
  const r = withFastLockEnv(() => {
    withCraStoreLock(path, () => withCraStoreLock(path, () => 'never'));
    return withCraStoreLock(path, () => 'after');
  });
  assert.deepEqual(r, { ok: true, value: 'after' });
});

test('locks on different paths do not contend with each other', () => {
  const r = withFastLockEnv(() => withCraStoreLock('.cw-wcsl-a', () => withCraStoreLock('.cw-wcsl-b', () => 'b')));
  assert.deepEqual(r, { ok: true, value: { ok: true, value: 'b' } });
});

test('propagates an error thrown by the function and releases the lock', () => {
  const path = '.cw-wcsl-throw';
  withFastLockEnv(() => {
    assert.throws(() => withCraStoreLock(path, () => { throw new RangeError('inner'); }), { name: 'RangeError', message: 'inner' });
  });
  const r = withFastLockEnv(() => withCraStoreLock(path, () => 'again'));
  assert.deepEqual(r, { ok: true, value: 'again' });
});

test('throws a TypeError before locking when the path is not a string', () => {
  assert.throws(() => withCraStoreLock(undefined, () => 1), {
    name: 'TypeError',
    message: 'The "paths[0]" argument must be of type string. Received undefined',
  });
});
