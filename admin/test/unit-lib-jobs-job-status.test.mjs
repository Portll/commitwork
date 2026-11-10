// Maps a persisted job record to the status payload the panel renders (admin/lib/jobs.mjs jobStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobStatus, jobs } from '../lib/jobs.mjs';

test('returns null when the kind has no record', () => {
  assert.equal(jobStatus('nope'), null);
});

test('returns null for an empty kind', () => {
  assert.equal(jobStatus(''), null);
});

test('returns null for a non-string kind', () => {
  assert.equal(jobStatus(42), null);
  assert.equal(jobStatus(null), null);
  assert.equal(jobStatus(undefined), null);
});

test('maps a minimal record with defaults for optional fields', () => {
  jobs.scan = { running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: 'scanning', done: 2, total: 10, current: 'repo-a', batchDir: '/b', seq: 7, lines: ['l1', 'l2'] };
  const s = jobStatus('scan');
  assert.equal(s.running, true);
  assert.equal(s.startedAt, 1);
  assert.equal(s.finishedAt, null);
  assert.equal(s.exitCode, null);
  assert.equal(s.phase, 'scanning');
  assert.equal(s.done, 2);
  assert.equal(s.total, 10);
  assert.equal(s.current, 'repo-a');
  assert.equal(s.batchDir, '/b');
  assert.equal(s.seq, 7);
  assert.deepEqual(s.lines, ['l1', 'l2']);
  assert.equal(s.label, null);
  assert.equal(s.project, null);
  assert.equal(s.repo, null);
  assert.equal(s.fleet, false);
  assert.deepEqual(s.lanes, {});
  assert.equal(s.signal, null);
  assert.equal(s.stoppedAt, null);
  assert.equal(s.stoppedBy, null);
  assert.equal(s.interruptedAt, null);
  delete jobs.scan;
});

test('passes through label project repo and lanes when present', () => {
  jobs.health = { running: false, startedAt: 5, finishedAt: 9, exitCode: 0, phase: 'done', done: 3, total: 3, current: null, batchDir: null, seq: 1, lines: [], label: 'Health', project: 'p1', repo: 'r1', lanes: { a: { done: 1, total: 2 } } };
  const s = jobStatus('health');
  assert.equal(s.label, 'Health');
  assert.equal(s.project, 'p1');
  assert.equal(s.repo, 'r1');
  assert.deepEqual(s.lanes, { a: { done: 1, total: 2 } });
  delete jobs.health;
});

test('coerces a truthy fleet flag to true and a falsy one to false', () => {
  jobs.f1 = { running: false, startedAt: 1, finishedAt: 2, exitCode: 0, phase: 'done', done: 1, total: 1, current: null, batchDir: null, seq: 0, lines: [], fleet: 1 };
  assert.equal(jobStatus('f1').fleet, true);
  jobs.f1.fleet = 0;
  assert.equal(jobStatus('f1').fleet, false);
  jobs.f1.fleet = 'yes';
  assert.equal(jobStatus('f1').fleet, true);
  delete jobs.f1;
});

test('surfaces a signal when the job was killed', () => {
  jobs.k = { running: false, startedAt: 1, finishedAt: 2, exitCode: null, phase: 'done', done: 0, total: 5, current: null, batchDir: null, seq: 0, lines: [], signal: 'SIGTERM' };
  const s = jobStatus('k');
  assert.equal(s.signal, 'SIGTERM');
  assert.equal(s.exitCode, null);
  delete jobs.k;
});

test('surfaces stoppedAt and stoppedBy for a halted run', () => {
  jobs.h = { running: false, startedAt: 1, finishedAt: 2, exitCode: null, phase: 'halted', done: 1, total: 9, current: null, batchDir: null, seq: 0, lines: [], stoppedAt: 123, stoppedBy: 'operator' };
  const s = jobStatus('h');
  assert.equal(s.stoppedAt, 123);
  assert.equal(s.stoppedBy, 'operator');
  assert.equal(s.interruptedAt, null);
  delete jobs.h;
});

test('surfaces interruptedAt when set', () => {
  jobs.i = { running: false, startedAt: 1, finishedAt: 2, exitCode: null, phase: 'done', done: 4, total: 4, current: null, batchDir: null, seq: 0, lines: [], interruptedAt: 999 };
  assert.equal(jobStatus('i').interruptedAt, 999);
  delete jobs.i;
});

test('returns the same lines array reference from the record', () => {
  const lines = Array.from({ length: 50 }, (_, i) => 'line' + i);
  jobs.big = { running: false, startedAt: 1, finishedAt: 2, exitCode: 0, phase: 'done', done: 50, total: 50, current: null, batchDir: null, seq: 0, lines };
  assert.equal(jobStatus('big').lines, lines);
  delete jobs.big;
});
