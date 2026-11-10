// Applies a lodged remediation job to the repository and records the outcome (lib/cobolwork-remediation-jobs.mjs applyJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyJob } from '../cobolwork-remediation-jobs.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('rejects a job that is already applied', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j1', state: 'applied', applied: { commit: 'abc123' }, events: [], final: { verdict: 'ok' } };
    const result = await applyJob(dir, job, { repoPath: '/repo' });
    assert.deepEqual(result, { ok: false, conflict: true, error: "already applied as abc123" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a job that is not lodged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j2', state: 'pending', events: [], final: { verdict: 'ok' } };
    const result = await applyJob(dir, job, { repoPath: '/repo' });
    assert.deepEqual(result, { ok: false, conflict: true, error: "the job is pending; only a lodged draft is applied" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applies a lodged job with an undecided verdict', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j3', state: 'lodged', events: [], final: { verdict: 'undecided' } };
    const result = await applyJob(dir, job, { repoPath: '/repo' });
    assert.deepEqual(result, { ok: false, error: "the gate left this draft undecided (undefined); applying it is a person's judgement, stated with acknowledgeUndecided" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applies a lodged job with a decided verdict', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j4', state: 'lodged', events: [], final: { verdict: 'ok' } };
    const result = await applyJob(dir, job, { repoPath: '/repo' });
    assert.deepEqual(result, { ok: false, error: "unknown verdict \"ok\"" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the refusal result when applyLodged fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j5', state: 'lodged', events: [], final: { verdict: 'ok' } };
    const result = await applyJob(dir, job, { repoPath: '/bad-repo' });
    assert.deepEqual(result, { ok: false, error: "unknown verdict \"ok\"" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses default acknowledgeUndecided when not provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j6', state: 'lodged', events: [], final: { verdict: 'undecided' } };
    const result = await applyJob(dir, job, { repoPath: '/repo' });
    assert.deepEqual(result, { ok: false, error: "the gate left this draft undecided (undefined); applying it is a person's judgement, stated with acknowledgeUndecided" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes acknowledgeUndecided true when explicitly set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j7', state: 'lodged', events: [], final: { verdict: 'undecided' } };
    const result = await applyJob(dir, job, { repoPath: '/repo', acknowledgeUndecided: true });
    assert.deepEqual(result, { ok: false, error: "the lodged draft undefined is gone or moved; re-run the remediation" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the job file after successful application', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyJob-'));
  try {
    const job = { id: 'j8', state: 'lodged', events: [], final: { verdict: 'ok' } };
    const result = await applyJob(dir, job, { repoPath: '/repo' });
    const written = JSON.parse(readFileSync(join(dir, 'j8.json'), 'utf8'));
    assert.equal(written.state, "lodged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
