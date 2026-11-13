// jobStatusFor returns a redacted job status for the given kind and scope, or null if invisible or missing (admin/lib/jobs.mjs jobStatusFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobStatusFor, jobs } from '../lib/jobs.mjs';

test('returns null when jobVisible is false for a fleet job with fleet scope false', () => {
  const kind = 'sweep';
  jobs[kind] = { fleet: true, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set(['proj']), operator: false };
  const result = jobStatusFor(kind, scope);
  assert.equal(result, null);
  delete jobs[kind];
});

test('returns null when jobVisible is false for a non-fleet job with project not in scope', () => {
  const kind = 'sweep';
  jobs[kind] = { fleet: false, project: 'proj', repo: 'repo' };
  const scope = { fleet: false, names: new Set(['other']), operator: false };
  const result = jobStatusFor(kind, scope);
  assert.equal(result, null);
  delete jobs[kind];
});

test('returns null when jobVisible is true but jobStatus returns null (job not in jobs)', () => {
  const kind = 'unknown';
  const scope = { fleet: true, names: new Set(), operator: false };
  const result = jobStatusFor(kind, scope);
  assert.equal(result, null);
});

test('returns redacted status when jobVisible true and jobStatus returns object with no secrets or tokens', () => {
  const kind = 'scan-path';
  jobs[kind] = {
    running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: 'running',
    done: 0, total: 10, current: 'file', batchDir: '/tmp/batch', seq: 1,
    lines: ['line1', 'line2'], label: 'scan', project: 'proj', repo: 'repo', fleet: false,
    lanes: {}, signal: null, stoppedAt: null, stoppedBy: null, interruptedAt: null
  };
  const scope = { fleet: true, names: new Set(['proj']), operator: false };
  const result = jobStatusFor(kind, scope);
  assert.deepEqual(result, { running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: "running", done: 0, total: 10, current: "file", batchDir: "/tmp/batch", seq: 1, lines: ["line1", "line2"], label: "scan", project: "proj", repo: "repo", fleet: false, lanes: {}, signal: null, stoppedAt: null, stoppedBy: null, interruptedAt: null });
  delete jobs[kind];
});

test('redacts secrets and tokens in label, current, batchDir, and lines when operator is false', () => {
  const kind = 'sweep';
  jobs[kind] = {
    running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: 'running',
    done: 0, total: 10, current: 'secret-value', batchDir: '/tmp/secret', seq: 1,
    lines: ['token-abc', 'normal'], label: 'secret-label', project: 'proj', repo: 'repo', fleet: false,
    lanes: {}, signal: null, stoppedAt: null, stoppedBy: null, interruptedAt: null,
    secrets: ['secret'], tokens: ['token']
  };
  const scope = { fleet: true, names: new Set(['proj']), operator: false };
  const result = jobStatusFor(kind, scope);
  assert.deepEqual(result, { running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: "running", done: 0, total: 10, current: "[redacted: shown on the operator port]-value", batchDir: "/tmp/[redacted: shown on the operator port]", seq: 1, lines: ["[redacted: credential]-abc", "normal"], label: "[redacted: shown on the operator port]-label", project: "proj", repo: "repo", fleet: false, lanes: {}, signal: null, stoppedAt: null, stoppedBy: null, interruptedAt: null });
  delete jobs[kind];
});

test('does not redact secrets when operator is true', () => {
  const kind = 'sweep';
  jobs[kind] = {
    running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: 'running',
    done: 0, total: 10, current: 'secret-value', batchDir: '/tmp/secret', seq: 1,
    lines: ['token-abc', 'normal'], label: 'secret-label', project: 'proj', repo: 'repo', fleet: false,
    lanes: {}, signal: null, stoppedAt: null, stoppedBy: null, interruptedAt: null,
    secrets: ['secret'], tokens: ['token']
  };
  const scope = { fleet: true, names: new Set(['proj']), operator: true };
  const result = jobStatusFor(kind, scope);
  assert.deepEqual(result, { running: true, startedAt: 1, finishedAt: null, exitCode: null, phase: "running", done: 0, total: 10, current: "secret-value", batchDir: "/tmp/secret", seq: 1, lines: ["[redacted: credential]-abc", "normal"], label: "secret-label", project: "proj", repo: "repo", fleet: false, lanes: {}, signal: null, stoppedAt: null, stoppedBy: null, interruptedAt: null });
  delete jobs[kind];
});
