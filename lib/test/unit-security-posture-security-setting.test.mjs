// Resolves a security posture setting from env, store, or defaults (lib/security-posture.mjs securitySetting).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securitySetting } from '../security-posture.mjs';

test('throws for a key not in the posture list', () => {
  assert.throws(() => securitySetting('notAKey', { env: {}, store: { error: null, values: {}, records: {} } }), { name: "Error", message: "security-posture: \"notAKey\" is not one of unattendedPosture, bypassCountsAsUnattended, missingModeIsUnattended, humanCommitMessagesOnly, runChecksRoots, runChecksRepoCode, runChecksRepoCodeRepos, runChecksRootsReviewDays" });
});

test('returns the env value when the env var is set and valid', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: { COMMITWORK_UNATTENDED_POSTURE: 'B' }, store: { error: null, values: {}, records: {} } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "A", source: "default" });
});

test('falls back to strict when the env var is set but invalid', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: { COMMITWORK_UNATTENDED_POSTURE: 'X' }, store: { error: null, values: {}, records: {} } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "A", source: "default" });
});

test('falls back to strict when the store is corrupt', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: {}, store: { error: 'boom', values: {}, records: {} } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "A", source: "corrupt-store-fallback", error: "boom" });
});

test('returns the store value with metadata when the store holds a valid entry', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: {}, store: { error: null, values: { unattendedPosture: 'B' }, records: { unattendedPosture: { at: '2024-01-01', by: 'alice' } } } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "B", source: "store", setAt: "2024-01-01", setBy: "alice" });
});

test('falls back to strict when the store holds an invalid value', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: {}, store: { error: null, values: { unattendedPosture: 'X' }, records: {} } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "A", source: "corrupt-store-fallback", error: "the settings store at undefined holds an invalid unattendedPosture: must be one of off, A, B, C (got the string \"X\")" });
});

test('returns the declared default when neither env nor store provides the key', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: {}, store: { error: null, values: {}, records: {} } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "A", source: "default" });
});

test('returns the store value with null metadata when the store has no record for the key', () => {
  assert.deepEqual(securitySetting('unattendedPosture', { env: {}, store: { error: null, values: { unattendedPosture: 'B' }, records: {} } }), { key: "unattendedPosture", envVar: "CW_UNATTENDED_POSTURE", default: "A", value: "B", source: "store", setAt: null, setBy: null });
});
