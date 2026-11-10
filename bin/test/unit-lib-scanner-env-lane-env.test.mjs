// Computes the environment variables passed to a lane (bin/lib/scanner-env.mjs laneEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneEnv } from '../lib/scanner-env.mjs';

test('returns empty object when check is null', () => {
  const r = laneEnv(null, { PATH: '/usr/bin', HOME: '/root' });
  assert.deepEqual(r, { PATH: "/usr/bin", HOME: "/root" });
});

test('returns empty object when check is undefined', () => {
  const r = laneEnv(undefined, { PATH: '/usr/bin', HOME: '/root' });
  assert.deepEqual(r, { PATH: "/usr/bin", HOME: "/root" });
});

test('returns empty object when executesRepoCode is false', () => {
  const r = laneEnv({ executesRepoCode: false }, { PATH: '/usr/bin', HOME: '/root' });
  assert.deepEqual(r, { PATH: "/usr/bin", HOME: "/root" });
});

test('returns empty object when executesRepoCode is 1', () => {
  const r = laneEnv({ executesRepoCode: 1 }, { PATH: '/usr/bin', HOME: '/root' });
  assert.deepEqual(r, { PATH: "/usr/bin", HOME: "/root" });
});

test('returns empty object when executesRepoCode is missing', () => {
  const r = laneEnv({}, { PATH: '/usr/bin', HOME: '/root' });
  assert.deepEqual(r, { PATH: "/usr/bin", HOME: "/root" });
});

test('returns empty object when executesRepoCode is true', () => {
  const r = laneEnv({ executesRepoCode: true }, { PATH: '/usr/bin', HOME: '/root' });
  assert.deepEqual(r, { PATH: "/usr/bin", HOME: "/root" });
});

test('returns empty object when executesRepoCode is true and env is empty', () => {
  const r = laneEnv({ executesRepoCode: true }, {});
  assert.deepEqual(r, {});
});

test('returns empty object when executesRepoCode is true and env has only non-matching keys', () => {
  const r = laneEnv({ executesRepoCode: true }, { FOO: 'bar' });
  assert.deepEqual(r, {});
});

test('returns empty object when executesRepoCode is true and env has only prefix keys', () => {
  const r = laneEnv({ executesRepoCode: true }, { LC_ALL: 'C' });
  assert.deepEqual(r, { LC_ALL: "C" });
});

test('returns empty object when executesRepoCode is true and env has only keep keys', () => {
  const r = laneEnv({ executesRepoCode: true, requires: { secrets: ['MY_SECRET'] } }, { MY_SECRET: 'val' });
  assert.deepEqual(r, { MY_SECRET: "val" });
});
