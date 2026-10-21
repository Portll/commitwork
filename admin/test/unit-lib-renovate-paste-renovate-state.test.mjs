// Maps a Dependency Dashboard section heading to a compact state token (admin/lib/renovate-paste.mjs renovateState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renovateState } from '../lib/renovate-paste.mjs';

test('returns empty string for falsy input', () => {
  assert.equal(renovateState(''), '');
  assert.equal(renovateState(null), '');
  assert.equal(renovateState(undefined), '');
});

test('returns rate-limited for rate limit sections', () => {
  assert.equal(renovateState('Rate Limit'), 'rate-limited');
  assert.equal(renovateState('rate limited'), 'rate-limited');
  assert.equal(renovateState('Rate-Limited'), 'rate-limited');
});

test('returns awaiting-schedule for awaiting schedule sections', () => {
  assert.equal(renovateState('Awaiting Schedule'), 'awaiting-schedule');
  assert.equal(renovateState('awaiting schedule'), 'awaiting-schedule');
});

test('returns pending-approval for pending approval sections', () => {
  assert.equal(renovateState('Pending Approval'), 'pending-approval');
  assert.equal(renovateState('pending approval'), 'pending-approval');
});

test('returns pending for pending sections without approval', () => {
  assert.equal(renovateState('Pending'), 'pending');
  assert.equal(renovateState('pending'), 'pending');
});

test('returns open for sections starting with open', () => {
  assert.equal(renovateState('Open'), 'open');
  assert.equal(renovateState('open'), 'open');
  assert.equal(renovateState('Open PRs'), 'open');
});

test('returns edited-blocked for edited or blocked sections', () => {
  assert.equal(renovateState('Edited'), 'edited-blocked');
  assert.equal(renovateState('Blocked'), 'edited-blocked');
  assert.equal(renovateState('edited'), 'edited-blocked');
  assert.equal(renovateState('blocked'), 'edited-blocked');
});

test('returns ignored for ignored or closed sections', () => {
  assert.equal(renovateState('Ignored'), 'ignored');
  assert.equal(renovateState('Closed'), 'ignored');
  assert.equal(renovateState('ignored'), 'ignored');
  assert.equal(renovateState('closed'), 'ignored');
});

test('returns errored for error sections', () => {
  assert.equal(renovateState('Error'), 'errored');
  assert.equal(renovateState('error'), 'errored');
});

test('normalizes other sections to kebab-case and truncates to 40 chars', () => {
  assert.equal(renovateState('Some Random Section'), 'some-random-section');
  assert.equal(renovateState('A'), 'a');
  assert.equal(renovateState('a'.repeat(50)), 'a'.repeat(40));
});
