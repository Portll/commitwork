// bin/test/actions-health-units.test.mjs — the pure half: slug, runner OS, billed minutes, red streak, and assess over fetched API objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { githubSlug, jobOs, jobWeightedMinutes, redStreak, assess } from '../actions-health.mjs';

test('parses https URL with .git suffix', () => {
  assert.equal(githubSlug('https://github.com/owner/repo.git'), 'owner/repo');
});

test('parses https URL without .git suffix', () => {
  assert.equal(githubSlug('https://github.com/owner/repo'), 'owner/repo');
});

test('parses git@ SSH URL', () => {
  assert.equal(githubSlug('git@github.com:owner/repo.git'), 'owner/repo');
});

test('returns null for non-github URL', () => {
  assert.equal(githubSlug('https://gitlab.com/owner/repo.git'), null);
});

test('returns null for empty string', () => {
  assert.equal(githubSlug(''), null);
});

test('returns null for null input', () => {
  assert.equal(githubSlug(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(githubSlug(undefined), null);
});

test('trims whitespace from input', () => {
  assert.equal(githubSlug('  https://github.com/owner/repo  '), 'owner/repo');
});

test('returns linux for empty labels', () => {
  assert.equal(jobOs({ labels: [] }), 'linux');
});

test('returns self-hosted when label present', () => {
  assert.equal(jobOs({ labels: ['self-hosted', 'linux'] }), 'self-hosted');
});

test('returns windows for windows label', () => {
  assert.equal(jobOs({ labels: ['windows-latest'] }), 'windows');
});

test('returns macos for macos label', () => {
  assert.equal(jobOs({ labels: ['macos-14'] }), 'macos');
});

test('returns linux for linux label', () => {
  assert.equal(jobOs({ labels: ['linux-latest'] }), 'linux');
});

test('handles undefined labels', () => {
  assert.equal(jobOs({}), 'linux');
});

test('case insensitive matching', () => {
  assert.equal(jobOs({ labels: ['WINDOWS'] }), 'windows');
  assert.equal(jobOs({ labels: ['MACOS'] }), 'macos');
  assert.equal(jobOs({ labels: ['Self-Hosted'] }), 'self-hosted');
});

test('returns 0 for public repositories', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    labels: ['linux'],
  };
  assert.equal(jobWeightedMinutes(job, false), 0);
});

test('returns 0 for jobs that never started', () => {
  const job = {
    runner_name: null,
    steps: [],
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    labels: ['linux'],
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns 0 when started_at is missing', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    completed_at: '2026-01-01T00:01:00Z',
    labels: ['linux'],
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('returns 0 when completed_at is missing', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    started_at: '2026-01-01T00:00:00Z',
    labels: ['linux'],
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('calculates weighted minutes for linux job', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:30Z',
    labels: ['linux'],
  };
  assert.equal(jobWeightedMinutes(job, true), 2);
});

test('calculates weighted minutes for windows job', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:30Z',
    labels: ['windows'],
  };
  assert.equal(jobWeightedMinutes(job, true), 4);
});

test('calculates weighted minutes for macos job', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:30Z',
    labels: ['macos'],
  };
  assert.equal(jobWeightedMinutes(job, true), 20);
});

test('returns 0 when duration is zero or negative', () => {
  const job = {
    runner_name: 'runner',
    steps: [{ name: 'step' }],
    started_at: '2026-01-01T00:01:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    labels: ['linux'],
  };
  assert.equal(jobWeightedMinutes(job, true), 0);
});

test('empty array returns zero length and null since', () => {
  const r = redStreak([]);
  assert.equal(r.length, 0);
  assert.equal(r.since, null);
});

test('single red run returns length 1 and its created_at', () => {
  const r = redStreak([{ conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' }]);
  assert.equal(r.length, 1);
  assert.equal(r.since, '2026-01-01T00:00:00Z');
});

test('consecutive red runs accumulate length and since is oldest red', () => {
  const r = redStreak([
    { conclusion: 'failure', created_at: '2026-01-03T00:00:00Z' },
    { conclusion: 'timed_out', created_at: '2026-01-02T00:00:00Z' },
    { conclusion: 'startup_failure', created_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(r.length, 3);
  assert.equal(r.since, '2026-01-01T00:00:00Z');
});

test('green run stops the streak', () => {
  const r = redStreak([
    { conclusion: 'failure', created_at: '2026-01-03T00:00:00Z' },
    { conclusion: 'success', created_at: '2026-01-02T00:00:00Z' },
    { conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r.since, '2026-01-03T00:00:00Z');
});

test('cancelled and skipped runs are ignored, not breaking the streak', () => {
  const r = redStreak([
    { conclusion: 'failure', created_at: '2026-01-04T00:00:00Z' },
    { conclusion: 'cancelled', created_at: '2026-01-03T00:00:00Z' },
    { conclusion: 'skipped', created_at: '2026-01-02T00:00:00Z' },
    { conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r.since, '2026-01-01T00:00:00Z');
});

test('in-progress run is ignored, not breaking the streak', () => {
  const r = redStreak([
    { conclusion: 'failure', created_at: '2026-01-03T00:00:00Z' },
    { conclusion: 'in_progress', created_at: '2026-01-02T00:00:00Z' },
    { conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r.since, '2026-01-01T00:00:00Z');
});

test('all green returns zero length and null since', () => {
  const r = redStreak([
    { conclusion: 'success', created_at: '2026-01-03T00:00:00Z' },
    { conclusion: 'success', created_at: '2026-01-02T00:00:00Z' },
  ]);
  assert.equal(r.length, 0);
  assert.equal(r.since, null);
});

test('assess returns void summary when runs is empty', () => {
  const repo = { private: true, default_branch: 'main' };
  const out = assess({ repo, runs: [], jobsByRun: {} });
  assert.equal(out.summary.void, true);
  assert.equal(out.summary.findings, 0);
  assert.match(out.summary.voidReason, /nothing to believe/);
});

test('assess reports red streak finding when streak meets minimum', () => {
  const repo = { private: true, default_branch: 'main' };
  const runs = [
    { id: 1, path: 'ci.yml', name: 'CI', conclusion: 'failure', created_at: '2026-09-20T00:00:00Z', head_branch: 'main', event: 'push' },
    { id: 2, path: 'ci.yml', name: 'CI', conclusion: 'failure', created_at: '2026-09-19T00:00:00Z', head_branch: 'main', event: 'push' },
    { id: 3, path: 'ci.yml', name: 'CI', conclusion: 'failure', created_at: '2026-09-18T00:00:00Z', head_branch: 'main', event: 'push' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} }, { streakMin: 3 });
  assert.equal(out.summary.findings, 1);
  assert.equal(out.summary.byRule['ci-red-streak'], 1);
  assert.equal(out.findings[0].rule, 'ci-red-streak');
  assert.equal(out.findings[0].sev, 'med');
  assert.match(out.findings[0].detail, /the last 3 main runs of CI failed/);
});

test('assess does not report red streak when streak is below minimum', () => {
  const repo = { private: true, default_branch: 'main' };
  const runs = [
    { id: 1, path: 'ci.yml', name: 'CI', conclusion: 'failure', created_at: '2026-09-20T00:00:00Z', head_branch: 'main', event: 'push' },
    { id: 2, path: 'ci.yml', name: 'CI', conclusion: 'failure', created_at: '2026-09-19T00:00:00Z', head_branch: 'main', event: 'push' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} }, { streakMin: 3 });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.byRule['ci-red-streak'], undefined);
});

test('assess reports never-started finding when 50% or more jobs never started', () => {
  const repo = { private: true, default_branch: 'main' };
  const runs = [
    { id: 1, path: 'ci.yml', name: 'CI', conclusion: 'failure', created_at: '2026-09-20T00:00:00Z', head_branch: 'main', event: 'push' },
  ];
  const jobsByRun = {
    1: [
      { runner_name: null, steps: [], conclusion: 'failure', started_at: null, completed_at: null, labels: ['linux'] },
      { runner_name: null, steps: [], conclusion: 'failure', started_at: null, completed_at: null, labels: ['linux'] },
      { runner_name: 'runner1', steps: [{ name: 'step1' }], conclusion: 'success', started_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-20T00:01:00Z', labels: ['linux'] },
    ],
  };
  const out = assess({ repo, runs, jobsByRun }, { streakMin: 3 });
  assert.equal(out.summary.jobsNeverStarted, 2);
  assert.equal(out.summary.findings, 1);
  assert.equal(out.summary.byRule['ci-never-started'], 1);
  assert.equal(out.findings[0].rule, 'ci-never-started');
  assert.equal(out.findings[0].sev, 'high');
  assert.match(out.findings[0].detail, /2 of 3 jobs/);
});

test('assess does not report never-started when fewer than 3 jobs or ratio below 50%', () => {
  const repo = { private: true, default_branch: 'main' };
  const runs = [
    { id: 1, path: 'ci.yml', name: 'CI', conclusion: 'success', created_at: '2026-09-20T00:00:00Z', head_branch: 'main', event: 'push' },
  ];
  const jobsByRun = {
    1: [
      { runner_name: null, steps: [], conclusion: 'failure', started_at: null, completed_at: null, labels: ['linux'] },
      { runner_name: 'runner1', steps: [{ name: 'step1' }], conclusion: 'success', started_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-20T00:01:00Z', labels: ['linux'] },
    ],
  };
  const out = assess({ repo, runs, jobsByRun }, { streakMin: 3 });
  assert.equal(out.summary.jobsNeverStarted, 1);
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.byRule['ci-never-started'], undefined);
});

test('assess computes weighted minutes for private repo jobs', () => {
  const repo = { private: true, default_branch: 'main' };
  const runs = [
    { id: 1, path: 'ci.yml', name: 'CI', conclusion: 'success', created_at: '2026-09-20T00:00:00Z', head_branch: 'main', event: 'push' },
  ];
  const jobsByRun = {
    1: [
      { runner_name: 'runner1', steps: [{ name: 'step1' }], conclusion: 'success', started_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-20T00:02:30Z', labels: ['linux'] },
      { runner_name: 'runner2', steps: [{ name: 'step1' }], conclusion: 'failure', started_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-20T00:01:00Z', labels: ['windows'] },
    ],
  };
  const out = assess({ repo, runs, jobsByRun }, { streakMin: 3 });
  // Job 1: 2.5 min -> ceil to 3 min * 1 (linux) = 3
  // Job 2: 1 min -> ceil to 1 min * 2 (windows) = 2
  assert.equal(out.summary.weightedMinutesSampled, 5);
  assert.equal(out.summary.weightedMinutesOnFailures, 2);
});

test('assess returns zero weighted minutes for public repo', () => {
  const repo = { private: false, default_branch: 'main' };
  const runs = [
    { id: 1, path: 'ci.yml', name: 'CI', conclusion: 'success', created_at: '2026-09-20T00:00:00Z', head_branch: 'main', event: 'push' },
  ];
  const jobsByRun = {
    1: [
      { runner_name: 'runner1', steps: [{ name: 'step1' }], conclusion: 'success', started_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-20T00:02:30Z', labels: ['linux'] },
    ],
  };
  const out = assess({ repo, runs, jobsByRun }, { streakMin: 3 });
  assert.equal(out.summary.weightedMinutesSampled, 0);
  assert.equal(out.summary.weightedMinutesOnFailures, 0);
});
