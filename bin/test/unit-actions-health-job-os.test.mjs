// Maps a job's labels to an OS name (bin/actions-health.mjs jobOs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobOs } from '../actions-health.mjs';

test('returns self-hosted when labels include self-hosted', () => {
  assert.equal(jobOs({ labels: ['self-hosted'] }), 'self-hosted');
});

test('returns self-hosted when labels include Self-Hosted with mixed case', () => {
  assert.equal(jobOs({ labels: ['Self-Hosted', 'linux'] }), 'self-hosted');
});

test('returns windows when a label contains windows', () => {
  assert.equal(jobOs({ labels: ['windows-latest'] }), 'windows');
});

test('returns windows when a label contains Windows with mixed case', () => {
  assert.equal(jobOs({ labels: ['Windows-2022'] }), 'windows');
});

test('returns macos when a label contains macos', () => {
  assert.equal(jobOs({ labels: ['macos-latest'] }), 'macos');
});

test('returns macos when a label contains macOS with mixed case', () => {
  assert.equal(jobOs({ labels: ['macOS-14'] }), 'macos');
});

test('returns linux when labels are empty', () => {
  assert.equal(jobOs({ labels: [] }), 'linux');
});

test('returns linux when labels are missing', () => {
  assert.equal(jobOs({}), 'linux');
});

test('returns linux when labels contain only linux', () => {
  assert.equal(jobOs({ labels: ['linux-latest'] }), 'linux');
});

test('returns linux when labels contain non-matching strings', () => {
  assert.equal(jobOs({ labels: ['ubuntu', 'debian'] }), 'linux');
});
