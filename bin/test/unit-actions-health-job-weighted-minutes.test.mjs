// Weighted minutes for a private job based on OS and duration (bin/actions-health.mjs jobWeightedMinutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobWeightedMinutes } from '../actions-health.mjs';

test('returns 0 when isPrivate is false', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, false), 0);
});

test('returns 0 when job never started', () => {
  const job = {
    runner_name: null,
    steps: [],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns 0 when started_at is missing', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns 0 when completed_at is missing', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns 0 when duration is zero', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:00:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns 0 when duration is negative', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:10:00Z',
    completed_at: '2024-01-01T00:00:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns weighted minutes for linux job', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 10);
});

test('returns weighted minutes for windows job', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['windows']
  };
  assert.equal(jobWeightedMinutes(job, true), 20);
});

test('returns weighted minutes for macos job', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['macos']
  };
  assert.equal(jobWeightedMinutes(job, true), 100);
});

test('returns weighted minutes for self-hosted job', () => {
  const job = {
    runner_name: 'r',
    steps: [{ name: 's' }],
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:10:00Z',
    labels: ['self-hosted', 'linux']
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});
