// Validates an oversight record for stance, attribution, basis, subject identity, and forbidden fields (lib/oversight.mjs validateOversight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOversight } from '../oversight.mjs';

test('rejects non-object inputs with a single error', () => {
  assert.deepEqual(validateOversight(null), { errors: ["oversight record is not an object"] });
});

test('rejects arrays as oversight records', () => {
  assert.deepEqual(validateOversight([]), { errors: ["oversight record is not an object"] });
});

test('rejects invalid stance values', () => {
  assert.deepEqual(validateOversight({ stance: 'maybe', who: 'alice', basis: 'read', subject: { repo: 'r' } }), { errors: ["stance must be one of corroborate, dispute - got \"maybe\""] });
});

test('rejects missing who attribution', () => {
  assert.deepEqual(validateOversight({ stance: 'corroborate', who: '', basis: 'read', subject: { repo: 'r' } }), { errors: ["who is required - an unattributed attestation attests nothing, and it comes from the session, never the request body"] });
});

test('rejects missing basis', () => {
  assert.deepEqual(validateOversight({ stance: 'corroborate', who: 'alice', basis: '  ', subject: { repo: 'r' } }), { errors: ["basis is required - name the determination you read and where. An attestation with no basis is a signature on a blank page"] });
});

test('rejects subjects with no identifying parts', () => {
  assert.deepEqual(validateOversight({ stance: 'corroborate', who: 'alice', basis: 'read', subject: { repo: '', file: '', rule: '', package: '' } }), { errors: ["subject must name at least one of repo/file/rule/package"] });
});

test('rejects subjects containing line numbers', () => {
  assert.deepEqual(validateOversight({ stance: 'corroborate', who: 'alice', basis: 'read', subject: { repo: 'r', line: 10 } }), { errors: ["subject.line is not part of an oversight identity - code moves for reasons unrelated to the finding"] });
});

test('rejects suppress fields on oversight records', () => {
  assert.deepEqual(validateOversight({ stance: 'corroborate', who: 'alice', basis: 'read', subject: { repo: 'r' }, suppress: true }), { errors: ["oversight never suppresses - use the scanner-annotation vocabulary for that, and keep the two apart"] });
});

test('accepts valid oversight records with no errors', () => {
  assert.deepEqual(validateOversight({ stance: 'dispute', who: 'bob', basis: 'checked', subject: { file: 'a.js' } }), { errors: [] });
});
