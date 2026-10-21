// Resolves the shell for a step from step, job defaults, or doc defaults (bin/actions-gaps.mjs effectiveShell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveShell } from '../actions-gaps.mjs';

test('returns the step shell when present', () => {
  const doc = { type: 'map', entries: new Map() };
  const job = { type: 'map', entries: new Map() };
  const step = { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'bash' }]]) };
  assert.equal(effectiveShell(doc, job, step), 'bash');
});

test('returns the job defaults run shell when step shell is missing', () => {
  const doc = { type: 'map', entries: new Map() };
  const job = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'sh' }]]) }]]) }]
    ])
  };
  const step = { type: 'map', entries: new Map() };
  assert.equal(effectiveShell(doc, job, step), 'sh');
});

test('returns the doc defaults run shell when step and job shells are missing', () => {
  const doc = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'zsh' }]]) }]]) }]
    ])
  };
  const job = { type: 'map', entries: new Map() };
  const step = { type: 'map', entries: new Map() };
  assert.equal(effectiveShell(doc, job, step), 'zsh');
});

test('returns empty string when no shell is defined anywhere', () => {
  const doc = { type: 'map', entries: new Map() };
  const job = { type: 'map', entries: new Map() };
  const step = { type: 'map', entries: new Map() };
  assert.equal(effectiveShell(doc, job, step), '');
});

test('trims whitespace from scalar shell values', () => {
  const doc = { type: 'map', entries: new Map() };
  const job = { type: 'map', entries: new Map() };
  const step = { type: 'map', entries: new Map([['shell', { type: 'scalar', value: '  bash  ' }]]) };
  assert.equal(effectiveShell(doc, job, step), 'bash');
});

test('prefers step shell over job and doc defaults', () => {
  const doc = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'zsh' }]]) }]]) }]
    ])
  };
  const job = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'sh' }]]) }]]) }]
    ])
  };
  const step = { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'bash' }]]) };
  assert.equal(effectiveShell(doc, job, step), 'bash');
});

test('prefers job defaults over doc defaults when step shell is missing', () => {
  const doc = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'zsh' }]]) }]]) }]
    ])
  };
  const job = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'sh' }]]) }]]) }]
    ])
  };
  const step = { type: 'map', entries: new Map() };
  assert.equal(effectiveShell(doc, job, step), 'sh');
});

test('falls back to the doc defaults shell when the step shell is blank after trimming', () => {
  const doc = {
    type: 'map',
    entries: new Map([
      ['defaults', { type: 'map', entries: new Map([['run', { type: 'map', entries: new Map([['shell', { type: 'scalar', value: 'zsh' }]]) }]]) }]
    ])
  };
  const job = { type: 'map', entries: new Map() };
  const step = { type: 'map', entries: new Map([['shell', { type: 'scalar', value: '   ' }]]) };
  assert.equal(effectiveShell(doc, job, step), 'zsh');
});

test('handles non-map nodes by returning empty string', () => {
  const doc = { type: 'scalar', value: 'doc' };
  const job = { type: 'scalar', value: 'job' };
  const step = { type: 'scalar', value: 'step' };
  assert.equal(effectiveShell(doc, job, step), '');
});

test('handles null inputs by returning empty string', () => {
  assert.equal(effectiveShell(null, null, null), '');
});
