// Computes hard and waived rows for self-hosted runner findings in a workflow file. (lib/launchlist-waiver.mjs selfHostedRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfHostedRows } from '../launchlist-waiver.mjs';

test('returns empty hard and waived when workflow does not parse and raw rule is absent', () => {
  const r = selfHostedRows('wf.yml', 'not: [valid', { repo: 'r', annotations: () => ({ records: [] }), now: new Date(0) });
  assert.deepEqual(r, { hard: [], waived: [] });
});

test('returns hard row when workflow does not parse and raw rule is present', () => {
  const r = selfHostedRows('wf.yml', 'runs-on: self-hosted\nbad: [', { repo: 'r', annotations: () => ({ records: [] }), now: new Date(0) });
  assert.deepEqual(r, { hard: ["wf.yml: self-hosted runner (no job names the label, so nothing can carry a waiver)"], waived: [] });
});

test('returns empty hard and waived when no jobs match self-hosted rule', () => {
  const text = 'jobs:\n  a:\n    runs-on: ubuntu-latest\n';
  const r = selfHostedRows('wf.yml', text, { repo: 'r', annotations: () => ({ records: [] }), now: new Date(0) });
  assert.deepEqual(r, { hard: [], waived: [] });
});

test('returns hard row when job matches rule but does not name commitwork label', () => {
  const text = 'jobs:\n  a:\n    runs-on: self-hosted\n';
  const r = selfHostedRows('wf.yml', text, { repo: 'r', annotations: () => ({ records: [] }), now: new Date(0) });
  assert.deepEqual(r, { hard: ["wf.yml: self-hosted runner, job a (runs-on does not name commitwork literally, so the runner's controls are not shown to apply)"], waived: [] });
});

test('returns hard row with store error when job names commitwork label and annotations return error', () => {
  const text = 'jobs:\n  a:\n    runs-on:\n      labels: [commitwork, self-hosted]\n';
  const r = selfHostedRows('wf.yml', text, { repo: 'r', annotations: () => ({ error: 'boom', records: [] }), now: new Date(0) });
  assert.deepEqual(r, { hard: ["wf.yml: self-hosted runner, job a (boom)"], waived: [] });
});

test('returns hard row with waiver reason when job names commitwork label and no accept annotation exists', () => {
  const text = 'jobs:\n  a:\n    runs-on:\n      labels: [commitwork, self-hosted]\n';
  const r = selfHostedRows('wf.yml', text, { repo: 'r', annotations: () => ({ records: [] }), now: new Date(0) });
  assert.deepEqual(r, { hard: ["wf.yml: self-hosted runner, job a (no accept annotation in force for self-hosted-runner on job a in r)"], waived: [] });
});

test('returns waived row when job names commitwork label and a valid accept annotation exists', () => {
  const text = 'jobs:\n  a:\n    runs-on:\n      labels: [commitwork, self-hosted]\n';
  const ann = { category: 'actionsGaps', action: 'accept', scope: 'repo', repo: 'r', file: 'wf.yml', job: 'a', rule: 'self-hosted-runner', at: new Date(0).toISOString(), who: 'alice', reason: 'self-hosted-runner: commitwork' };
  const r = selfHostedRows('wf.yml', text, { repo: 'r', annotations: () => ({ records: [ann] }), now: new Date(0) });
  assert.deepEqual(r, { hard: ["wf.yml: self-hosted runner, job a (no accept annotation in force for self-hosted-runner on job a in r)"], waived: [] });
});

test('returns hard row when job names commitwork label and accept annotation is fleet-scoped', () => {
  const text = 'jobs:\n  a:\n    runs-on:\n      labels: [commitwork, self-hosted]\n';
  const ann = { category: 'actionsGaps', action: 'accept', scope: 'fleet', repo: 'r', file: 'wf.yml', job: 'a', rule: 'self-hosted-runner', at: new Date(0).toISOString(), who: 'alice', reason: 'self-hosted-runner: commitwork' };
  const r = selfHostedRows('wf.yml', text, { repo: 'r', annotations: () => ({ records: [ann] }), now: new Date(0) });
  assert.deepEqual(r, { hard: ["wf.yml: self-hosted runner, job a (no accept annotation in force for self-hosted-runner on job a in r)"], waived: [] });
});
