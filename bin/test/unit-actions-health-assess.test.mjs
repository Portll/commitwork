// CI health summary: red streaks, never-started jobs, weighted minutes (bin/actions-health.mjs assess).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../actions-health.mjs';

const repo = { private: false, default_branch: 'main' };

test('returns void summary when there are no runs', () => {
  const out = assess({ repo, runs: [], jobsByRun: {} });
  assert.equal(out.summary.void, true);
  assert.equal(out.summary.voidReason, 'Actions holds no runs for this repository \u2014 nothing to believe or disbelieve, which is not a clean result');
  assert.equal(out.summary.findings, 0);
  assert.equal(out.findings.length, 0);
});

test('flags a red streak of three or more on the default branch', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 1);
  assert.equal(out.findings[0].rule, 'ci-red-streak');
  assert.equal(out.findings[0].sev, 'med');
  assert.equal(out.summary.workflows[0].redStreak, 3);
  assert.equal(out.summary.byRule['ci-red-streak'], 1);
  assert.equal(out.findings[0].detail, 'the last 3 main runs of CI failed, the first of them on 2024-01-01; a workflow that always fails tells nobody anything');
});

test('does not flag a red streak shorter than the minimum', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.workflows[0].redStreak, 2);
});

test('ignores pull request events when computing red streaks', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'pull_request', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'pull_request', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'pull_request', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.workflows[0].redStreak, 0);
});

test('flags never-started jobs when at least half of three or more jobs never started', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
  ];
  const jobs = [
    { runner_name: null, steps: [], conclusion: 'failure' },
    { runner_name: null, steps: [], conclusion: 'failure' },
    { runner_name: null, steps: [], conclusion: 'failure' },
  ];
  const out = assess({ repo, runs, jobsByRun: { 1: jobs } });
  assert.equal(out.summary.findings, 1);
  assert.equal(out.findings[0].rule, 'ci-never-started');
  assert.equal(out.findings[0].sev, 'high');
  assert.equal(out.summary.jobsNeverStarted, 3);
  assert.equal(out.summary.byRule['ci-never-started'], 1);
});

test('does not flag never-started jobs when fewer than half never started', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
  ];
  const jobs = [
    { runner_name: 'runner1', steps: [{ name: 'step' }], conclusion: 'failure' },
    { runner_name: null, steps: [], conclusion: 'failure' },
    { runner_name: 'runner2', steps: [{ name: 'step' }], conclusion: 'success' },
  ];
  const out = assess({ repo, runs, jobsByRun: { 1: jobs } });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.jobsNeverStarted, 1);
});

test('does not flag never-started jobs when there are fewer than three jobs', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
  ];
  const jobs = [
    { runner_name: null, steps: [], conclusion: 'failure' },
    { runner_name: null, steps: [], conclusion: 'failure' },
  ];
  const out = assess({ repo, runs, jobsByRun: { 1: jobs } });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.jobsNeverStarted, 2);
});

test('computes weighted minutes for private repo jobs with valid timestamps', () => {
  const privateRepo = { private: true, default_branch: 'main' };
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
  ];
  const jobs = [
    { runner_name: 'r', steps: [{ name: 's' }], conclusion: 'failure', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z', labels: ['linux'] },
  ];
  const out = assess({ repo: privateRepo, runs, jobsByRun: { 1: jobs } });
  assert.equal(out.summary.weightedMinutesSampled, 1);
  assert.equal(out.summary.weightedMinutesOnFailures, 1);
});

test('returns zero weighted minutes for public repos', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
  ];
  const jobs = [
    { runner_name: 'r', steps: [{ name: 's' }], conclusion: 'failure', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z', labels: ['linux'] },
  ];
  const out = assess({ repo, runs, jobsByRun: { 1: jobs } });
  assert.equal(out.summary.weightedMinutesSampled, 0);
  assert.equal(out.summary.weightedMinutesOnFailures, 0);
});

test('returns zero weighted minutes for jobs that never started', () => {
  const privateRepo = { private: true, default_branch: 'main' };
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
  ];
  const jobs = [
    { runner_name: null, steps: [], conclusion: 'failure', started_at: null, completed_at: null, labels: ['linux'] },
  ];
  const out = assess({ repo: privateRepo, runs, jobsByRun: { 1: jobs } });
  assert.equal(out.summary.weightedMinutesSampled, 0);
});

test('sorts workflows by path and groups runs correctly', () => {
  const runs = [
    { path: 'b.yml', name: 'B', workflow_id: 2, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
    { path: 'a.yml', name: 'A', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
    { path: 'a.yml', name: 'A', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-02T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.filesScanned, 2);
  assert.equal(out.summary.workflows[0].path, 'a.yml');
  assert.equal(out.summary.workflows[1].path, 'b.yml');
  assert.equal(out.summary.workflows[0].runs, 2);
  assert.equal(out.summary.workflows[1].runs, 1);
});

test('uses name as key when path is missing', () => {
  const runs = [
    { path: null, name: 'MyWorkflow', workflow_id: 5, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
    { path: null, name: 'MyWorkflow', workflow_id: 5, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-02T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.filesScanned, 1);
  assert.equal(out.summary.workflows[0].path, 'MyWorkflow');
  assert.equal(out.summary.workflows[0].runs, 2);
});

test('uses workflow id as key when path and name are missing', () => {
  const runs = [
    { path: null, name: null, workflow_id: 42, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
    { path: null, name: null, workflow_id: 42, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-02T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.filesScanned, 1);
  assert.equal(out.summary.workflows[0].path, 'workflow 42');
  assert.equal(out.summary.workflows[0].runs, 2);
});

test('breaks red streak on success conclusion', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-05T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'success', created_at: '2024-01-04T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.workflows[0].redStreak, 1);
});

test('skips non-red non-green conclusions in streak calculation', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'skipped', created_at: '2024-01-05T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-04T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 1);
  assert.equal(out.summary.workflows[0].redStreak, 3);
  assert.equal(out.findings[0].detail, 'the last 3 main runs of CI failed, the first of them on 2024-01-02; a workflow that always fails tells nobody anything');
});

test('ignores runs not on default branch for streak', () => {
  const runs = [
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'feature', event: 'push', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'feature', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'ci.yml', name: 'CI', workflow_id: 1, head_branch: 'feature', event: 'push', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 0);
  assert.equal(out.summary.workflows[0].redStreak, 0);
});

test('counts multiple findings in byRule correctly', () => {
  const runs = [
    { path: 'a.yml', name: 'A', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'a.yml', name: 'A', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'a.yml', name: 'A', workflow_id: 1, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
    { path: 'b.yml', name: 'B', workflow_id: 2, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-03T00:00:00Z' },
    { path: 'b.yml', name: 'B', workflow_id: 2, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-02T00:00:00Z' },
    { path: 'b.yml', name: 'B', workflow_id: 2, head_branch: 'main', event: 'push', conclusion: 'failure', created_at: '2024-01-01T00:00:00Z' },
  ];
  const out = assess({ repo, runs, jobsByRun: {} });
  assert.equal(out.summary.findings, 2);
  assert.equal(out.summary.byRule['ci-red-streak'], 2);
});
