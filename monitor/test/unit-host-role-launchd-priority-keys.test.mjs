// Maps a declared host role to its launchd priority XML fragment (monitor/host-role.mjs launchdPriorityKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchdPriorityKeys } from '../host-role.mjs';

test('returns empty string for server role', () => {
  assert.equal(launchdPriorityKeys('server'), "");
});

test('returns yield keys for auto role', () => {
  assert.equal(launchdPriorityKeys('auto'), "  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});

test('returns background and yield keys for shared role', () => {
  assert.equal(launchdPriorityKeys('shared'), "  <key>ProcessType</key><string>Background</string>\n  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});

test('returns yield keys for unknown role', () => {
  assert.equal(launchdPriorityKeys('unknown'), "  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});

test('returns empty string for empty string role', () => {
  assert.equal(launchdPriorityKeys(''), "  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});

test('returns yield keys for null role', () => {
  assert.equal(launchdPriorityKeys(null), "  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});

test('returns yield keys for undefined role', () => {
  assert.equal(launchdPriorityKeys(undefined), "  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});

test('returns yield keys for number role', () => {
  assert.equal(launchdPriorityKeys(0), "  <key>Nice</key><integer>10</integer>\n  <key>LowPriorityIO</key><true/>");
});
