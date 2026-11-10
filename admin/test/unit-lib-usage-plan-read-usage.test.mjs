// Reads Claude config JSON and reports cached usage utilization state (admin/lib/usage-plan.mjs readUsage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUsage } from '../lib/usage-plan.mjs';

test('returns live with cache when config has cachedUsageUtilization object', () => {
  const cache = { plan: 'pro', used: 42 };
  const raw = JSON.stringify({ cachedUsageUtilization: cache });
  const result = readUsage({ path: '/fake', readFile: () => raw });
  assert.deepEqual(result, { ok: true, state: 'live', path: '/fake', cache });
});

test('returns absent when file does not exist', () => {
  const err = new Error('no such file');
  err.code = 'ENOENT';
  const result = readUsage({ path: '/missing', readFile: () => { throw err; } });
  assert.deepEqual(result, { ok: false, state: 'absent', path: '/missing', why: 'no Claude config on this box' });
});

test('returns unreadable when file read fails with non-ENOENT error', () => {
  const err = new Error('permission denied');
  err.code = 'EACCES';
  const result = readUsage({ path: '/locked', readFile: () => { throw err; } });
  assert.deepEqual(result, { ok: false, state: 'unreadable', path: '/locked', why: 'could not read /locked: EACCES' });
});

test('returns unreadable when file read fails with error lacking code', () => {
  const err = new Error('boom');
  const result = readUsage({ path: '/x', readFile: () => { throw err; } });
  assert.deepEqual(result, { ok: false, state: "unreadable", path: "/x", why: "could not read /x: Error: boom" });
});

test('returns unreadable when raw content is not valid JSON', () => {
  const result = readUsage({ path: '/bad', readFile: () => 'not json {' });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'unreadable');
  assert.equal(result.path, '/bad');
  assert.match(result.why, /^config is not JSON:/);
});

test('returns absent when parsed doc is null', () => {
  const result = readUsage({ path: '/null', readFile: () => 'null' });
  assert.deepEqual(result, { ok: false, state: 'absent', path: '/null', why: 'config carries no cachedUsageUtilization' });
});

test('returns absent when parsed doc is a string', () => {
  const result = readUsage({ path: '/str', readFile: () => '"hello"' });
  assert.deepEqual(result, { ok: false, state: 'absent', path: '/str', why: 'config carries no cachedUsageUtilization' });
});

test('returns absent when cachedUsageUtilization is a number', () => {
  const raw = JSON.stringify({ cachedUsageUtilization: 5 });
  const result = readUsage({ path: '/num', readFile: () => raw });
  assert.deepEqual(result, { ok: false, state: 'absent', path: '/num', why: 'config carries no cachedUsageUtilization' });
});

test('returns absent when cachedUsageUtilization is null', () => {
  const raw = JSON.stringify({ cachedUsageUtilization: null });
  const result = readUsage({ path: '/n', readFile: () => raw });
  assert.deepEqual(result, { ok: false, state: 'absent', path: '/n', why: 'config carries no cachedUsageUtilization' });
});

test('returns absent when cachedUsageUtilization is missing from doc', () => {
  const raw = JSON.stringify({ other: 1 });
  const result = readUsage({ path: '/nokey', readFile: () => raw });
  assert.deepEqual(result, { ok: false, state: 'absent', path: '/nokey', why: 'config carries no cachedUsageUtilization' });
});
