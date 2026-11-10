// Detects CLA, DCO, and contributing file requirements from repository metadata (monitor/draft-pr-gates.mjs contributionRequirements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionRequirements } from '../draft-pr-gates.mjs';

test('returns nulls when no files or workflows are provided', () => {
  const r = contributionRequirements({ files: {}, workflows: [] });
  assert.deepEqual(r, { cla: false, claWhy: null, dco: false, dcoWhy: null, contributing: null });
});

test('detects CLA from .clabot file and contributing from CONTRIBUTING.md', () => {
  const r = contributionRequirements({
    files: {
      '.clabot': 'cla config',
      'CONTRIBUTING.md': 'Please read this'
    },
    workflows: []
  });
  assert.deepEqual(r, { cla: true, claWhy: ".clabot", dco: false, dcoWhy: null, contributing: "CONTRIBUTING.md" });
});

test('detects DCO from .github/dco.yml file', () => {
  const r = contributionRequirements({
    files: {
      '.github/dco.yml': 'dco config'
    },
    workflows: []
  });
  assert.deepEqual(r, { cla: false, claWhy: null, dco: true, dcoWhy: ".github/dco.yml", contributing: null });
});

test('detects CLA from CONTRIBUTING.md prose mentioning CLA', () => {
  const r = contributionRequirements({
    files: {
      'CONTRIBUTING.md': 'You must sign the Contributor License Agreement.'
    },
    workflows: []
  });
  assert.deepEqual(r, { cla: true, claWhy: "CONTRIBUTING.md", dco: false, dcoWhy: null, contributing: "CONTRIBUTING.md" });
});

test('detects DCO from CONTRIBUTING.md prose mentioning DCO', () => {
  const r = contributionRequirements({
    files: {
      'CONTRIBUTING.md': 'All commits must include a Signed-off-by line for DCO.'
    },
    workflows: []
  });
  assert.deepEqual(r, { cla: false, claWhy: null, dco: true, dcoWhy: "CONTRIBUTING.md", contributing: "CONTRIBUTING.md" });
});

test('detects CLA from workflow text matching cla-assistant', () => {
  const r = contributionRequirements({
    files: {},
    workflows: [
      { path: '.github/workflows/cla.yml', text: 'uses: cla-assistant/cla.yml' }
    ]
  });
  assert.deepEqual(r, { cla: true, claWhy: ".github/workflows/cla.yml", dco: false, dcoWhy: null, contributing: null });
});

test('detects DCO from workflow text matching dco', () => {
  const r = contributionRequirements({
    files: {},
    workflows: [
      { path: '.github/workflows/dco.yml', text: 'checks for dco sign-off' }
    ]
  });
  assert.deepEqual(r, { cla: false, claWhy: null, dco: true, dcoWhy: ".github/workflows/dco.yml", contributing: null });
});

test('prefers CLA file over prose and workflow', () => {
  const r = contributionRequirements({
    files: {
      '.clabot': 'cla',
      'CONTRIBUTING.md': 'Sign the CLA please.'
    },
    workflows: [
      { path: 'wf/cla.yml', text: 'cla-bot' }
    ]
  });
  assert.deepEqual(r, { cla: true, claWhy: ".clabot", dco: false, dcoWhy: null, contributing: "CONTRIBUTING.md" });
});

test('prefers DCO file over prose and workflow', () => {
  const r = contributionRequirements({
    files: {
      '.github/dco.yml': 'dco',
      'CONTRIBUTING.md': 'DCO sign-off required.'
    },
    workflows: [
      { path: 'wf/dco.yml', text: 'dco check' }
    ]
  });
  assert.deepEqual(r, { cla: false, claWhy: null, dco: true, dcoWhy: ".github/dco.yml", contributing: "CONTRIBUTING.md" });
});

test('returns null contributing when no CONTRIBUTING file exists', () => {
  const r = contributionRequirements({
    files: {
      '.clabot': 'cla'
    },
    workflows: []
  });
  assert.deepEqual(r, { cla: true, claWhy: ".clabot", dco: false, dcoWhy: null, contributing: null });
});
