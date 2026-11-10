// The tests gate verdict for a release candidate (bin/release-candidate.mjs testsGate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testsGate } from '../release-candidate.mjs';

test('returns not-run when skip is true', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { skip: true });
  assert.deepEqual(r, { gate: 'tests', status: 'not-run', detail: { reason: '--skip-tests' } });
});

test('returns not-run when skip is truthy non-boolean', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { skip: 1 });
  assert.deepEqual(r, { gate: 'tests', status: 'not-run', detail: { reason: '--skip-tests' } });
});

test('skip takes precedence over a project other than commitwork', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { skip: true, project: 'other', publicTest: null });
  assert.deepEqual(r, { gate: 'tests', status: 'not-run', detail: { reason: '--skip-tests' } });
});

test('a project other than commitwork without publicTest cannot be checked', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { skip: false, project: 'other', publicTest: null });
  assert.deepEqual(r, { gate: 'tests', status: 'cannot-check', detail: { error: 'no publicTest declared for other in the launchlist config' } });
});

test('an empty project name is not commitwork and cannot be checked', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { project: '', publicTest: null });
  assert.deepEqual(r, { gate: 'tests', status: 'cannot-check', detail: { error: 'no publicTest declared for  in the launchlist config' } });
});

test('a null project is not commitwork and cannot be checked', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { project: null, publicTest: null });
  assert.deepEqual(r, { gate: 'tests', status: 'cannot-check', detail: { error: 'no publicTest declared for null in the launchlist config' } });
});

test('a numeric project is not commitwork and cannot be checked', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { project: 42, publicTest: null });
  assert.deepEqual(r, { gate: 'tests', status: 'cannot-check', detail: { error: 'no publicTest declared for 42 in the launchlist config' } });
});

test('a publicTest without a cmd cannot be checked', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { project: 'other', publicTest: { args: ['x'] } });
  assert.deepEqual(r, { gate: 'tests', status: 'cannot-check', detail: { error: 'no publicTest declared for other in the launchlist config' } });
});

test('a publicTest with an empty cmd cannot be checked', () => {
  const r = testsGate('/dest', '/scratch', '/logs', { project: 'commitwork-x', publicTest: { cmd: '' } });
  assert.deepEqual(r, { gate: 'tests', status: 'cannot-check', detail: { error: 'no publicTest declared for commitwork-x in the launchlist config' } });
});
