// Determines whether the current session is attended and allowed to ask for approval (lib/security-posture.mjs commitApprover).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitApprover } from '../security-posture.mjs';

test('returns canAsk false when CW_GUARD_UNATTENDED is 1', () => {
  const r = commitApprover({ env: { CW_GUARD_UNATTENDED: '1' } });
  assert.deepEqual(r, { canAsk: false, why: "CW_GUARD_UNATTENDED=1" });
});

test('returns canAsk false when CW_GUARD_UNATTENDED is 2', () => {
  const r = commitApprover({ env: { CW_GUARD_UNATTENDED: '2' } });
  assert.deepEqual(r, { canAsk: false, why: "CLAUDE_CODE_SESSION_ATTENDED is not 1, so the harness does not mark this session attended" });
});

test('returns canAsk false when permission mode is dontAsk', () => {
  const r = commitApprover({ env: {}, permissionMode: 'dontAsk' });
  assert.deepEqual(r, { canAsk: false, why: "permission_mode dontAsk asks nobody" });
});

test('returns canAsk false when permission mode is bypassPermissions', () => {
  const r = commitApprover({ env: {}, permissionMode: 'bypassPermissions' });
  assert.deepEqual(r, { canAsk: false, why: "permission_mode bypassPermissions asks nobody" });
});

test('returns canAsk false when CLAUDE_CODE_SESSION_ATTENDED is not 1', () => {
  const r = commitApprover({ env: { CLAUDE_CODE_SESSION_ATTENDED: '0' } });
  assert.deepEqual(r, { canAsk: false, why: "CLAUDE_CODE_SESSION_ATTENDED is not 1, so the harness does not mark this session attended" });
});

test('returns canAsk false when CLAUDE_CODE_SESSION_ATTENDED is 2', () => {
  const r = commitApprover({ env: { CLAUDE_CODE_SESSION_ATTENDED: '2' } });
  assert.deepEqual(r, { canAsk: false, why: "CLAUDE_CODE_SESSION_ATTENDED is not 1, so the harness does not mark this session attended" });
});

test('returns canAsk true when attended with no permission mode', () => {
  const r = commitApprover({ env: { CLAUDE_CODE_SESSION_ATTENDED: '1' } });
  assert.deepEqual(r, { canAsk: true, why: "attended" });
});

test('returns canAsk true when attended with a permission mode', () => {
  const r = commitApprover({ env: { CLAUDE_CODE_SESSION_ATTENDED: '1' }, permissionMode: 'ask' });
  assert.deepEqual(r, { canAsk: true, why: "attended, permission_mode ask" });
});
