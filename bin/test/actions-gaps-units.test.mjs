// bin/test/actions-gaps-units.test.mjs — shellDropsPipefail and stepPullsTriggeringHead, one case at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shellDropsPipefail, stepPullsTriggeringHead } from '../actions-gaps.mjs';

test('shellDropsPipefail: falsy shell values return true', () => {
  assert.equal(shellDropsPipefail(''), true);
  assert.equal(shellDropsPipefail(null), true);
  assert.equal(shellDropsPipefail(undefined), true);
  assert.equal(shellDropsPipefail(0), true);
  assert.equal(shellDropsPipefail(false), true);
});

test('shellDropsPipefail: "bash" returns false', () => {
  assert.equal(shellDropsPipefail('bash'), false);
});

test('shellDropsPipefail: PowerShell and Python shells return false', () => {
  assert.equal(shellDropsPipefail('pwsh'), false);
  assert.equal(shellDropsPipefail('powershell'), false);
  assert.equal(shellDropsPipefail('cmd'), false);
  assert.equal(shellDropsPipefail('python'), false);
});

test('shellDropsPipefail: "sh" returns true', () => {
  assert.equal(shellDropsPipefail('sh'), true);
});

test('shellDropsPipefail: custom shell with pipefail returns false', () => {
  assert.equal(shellDropsPipefail('bash -eo pipefail'), false);
  assert.equal(shellDropsPipefail('sh -eo pipefail'), false);
  assert.equal(shellDropsPipefail('myshell --pipefail'), false);
});

test('shellDropsPipefail: custom shell without pipefail returns true', () => {
  assert.equal(shellDropsPipefail('bash -e'), true);
  assert.equal(shellDropsPipefail('sh -e'), true);
  assert.equal(shellDropsPipefail('zsh'), true);
  assert.equal(shellDropsPipefail('fish'), true);
});

test('returns empty string for a step with no uses or run', () => {
  const step = { type: 'map', line: 1, entries: new Map() };
  assert.equal(stepPullsTriggeringHead(step), '');
});

test('returns empty string for a run step without triggering head', () => {
  const step = { type: 'map', line: 1, entries: new Map([['run', { type: 'scalar', line: 1, value: 'echo hello' }]]) };
  assert.equal(stepPullsTriggeringHead(step), '');
});

test('returns empty string for a run step with triggering head but no fetch verb', () => {
  const step = { type: 'map', line: 1, entries: new Map([['run', { type: 'scalar', line: 1, value: 'echo ${{ github.event.workflow_run.head_sha }}' }]]) };
  assert.equal(stepPullsTriggeringHead(step), '');
});

test('returns fetch message for a run step with triggering head and git fetch', () => {
  const step = { type: 'map', line: 1, entries: new Map([['run', { type: 'scalar', line: 1, value: 'git fetch ${{ github.event.workflow_run.head_sha }}' }]]) };
  assert.equal(stepPullsTriggeringHead(step), 'fetches the triggering head in a run step');
});

test('returns checkout message for actions/checkout with triggering head ref', () => {
  const step = { type: 'map', line: 1, entries: new Map([
    ['uses', { type: 'scalar', line: 1, value: 'actions/checkout@v4' }],
    ['with', { type: 'map', line: 1, entries: new Map([['ref', { type: 'scalar', line: 1, value: '${{ github.event.workflow_run.head_sha }}' }]]) }]
  ]) };
  assert.equal(stepPullsTriggeringHead(step), 'checks out the triggering head');
});

test('returns empty string for actions/checkout without triggering head ref', () => {
  const step = { type: 'map', line: 1, entries: new Map([
    ['uses', { type: 'scalar', line: 1, value: 'actions/checkout@v4' }],
    ['with', { type: 'map', line: 1, entries: new Map([['ref', { type: 'scalar', line: 1, value: 'main' }]]) }]
  ]) };
  assert.equal(stepPullsTriggeringHead(step), '');
});

test('returns download message for download-artifact with workflow_run in with values', () => {
  const step = { type: 'map', line: 1, entries: new Map([
    ['uses', { type: 'scalar', line: 1, value: 'actions/download-artifact@v4' }],
    ['with', { type: 'map', line: 1, entries: new Map([['path', { type: 'scalar', line: 1, value: '${{ github.event.workflow_run.id }}' }]]) }]
  ]) };
  assert.equal(stepPullsTriggeringHead(step), "downloads the triggering run's artifacts");
});

test('returns empty string for download-artifact without workflow_run in with values', () => {
  const step = { type: 'map', line: 1, entries: new Map([
    ['uses', { type: 'scalar', line: 1, value: 'actions/download-artifact@v4' }],
    ['with', { type: 'map', line: 1, entries: new Map([['path', { type: 'scalar', line: 1, value: 'output' }]]) }]
  ]) };
  assert.equal(stepPullsTriggeringHead(step), '');
});
