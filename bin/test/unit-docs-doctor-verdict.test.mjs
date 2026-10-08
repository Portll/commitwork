// Maps a docs-doctor scan result to an exit code: 1 for orange, untracked or index findings, 2 for grey only, else 0 (bin/docs-doctor.mjs verdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from '../docs-doctor.mjs';

test('returns 0 when all docs are green and no index findings', () => {
  const result = {
    docs: [
      { status: 'green' },
      { status: 'green' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 0);
});

test('returns 2 when there are grey docs but no orange or untracked', () => {
  const result = {
    docs: [
      { status: 'green' },
      { status: 'grey' },
      { status: 'grey' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 2);
});

test('returns 1 when there is an orange doc', () => {
  const result = {
    docs: [
      { status: 'green' },
      { status: 'orange' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 1);
});

test('returns 1 when there is an untracked doc', () => {
  const result = {
    docs: [
      { status: 'green' },
      { status: 'untracked' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 1);
});

test('returns 1 when there are index findings', () => {
  const result = {
    docs: [
      { status: 'green' },
    ],
    indexFindings: ['missing reference'],
  };
  assert.equal(verdict(result), 1);
});

test('returns 1 when there are both grey and orange docs', () => {
  const result = {
    docs: [
      { status: 'grey' },
      { status: 'orange' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 1);
});

test('returns 1 when there are both grey and untracked docs', () => {
  const result = {
    docs: [
      { status: 'grey' },
      { status: 'untracked' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 1);
});

test('returns 1 when there are index findings and grey docs', () => {
  const result = {
    docs: [
      { status: 'grey' },
    ],
    indexFindings: ['broken link'],
  };
  assert.equal(verdict(result), 1);
});

test('returns 0 when docs array is empty and no index findings', () => {
  const result = {
    docs: [],
    indexFindings: [],
  };
  assert.equal(verdict(result), 0);
});

test('returns 2 when only grey docs exist and no index findings', () => {
  const result = {
    docs: [
      { status: 'grey' },
    ],
    indexFindings: [],
  };
  assert.equal(verdict(result), 2);
});
