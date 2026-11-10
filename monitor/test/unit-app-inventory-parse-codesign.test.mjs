// Extracts code signing metadata from codesign output (monitor/app-inventory.mjs parseCodesign).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodesign } from '../app-inventory.mjs';

test('returns unsigned when status is non-zero and stderr says not signed at all', () => {
  const r = parseCodesign(1, 'not signed at all');
  assert.deepEqual(r, { signMode: "unsigned", signer: null, teamId: null });
});

test('returns unknown when status is non-zero and stderr does not say not signed at all', () => {
  const r = parseCodesign(1, 'some other error');
  assert.deepEqual(r, { signMode: "unknown", signer: null, teamId: null });
});

test('returns signed with authority and teamId when status is zero and no adhoc markers', () => {
  const stderr = 'Authority=Developer ID Application: Example Corp (ABC123DEF4)\nTeamIdentifier=ABC123DEF4\nSignature=signed';
  const r = parseCodesign(0, stderr);
  assert.deepEqual(r, { signMode: "signed", signer: "Developer ID Application: Example Corp (ABC123DEF4)", teamId: "ABC123DEF4" });
});

test('returns adhoc when status is zero and Signature is adhoc', () => {
  const stderr = 'Authority=adhoc\nSignature=adhoc';
  const r = parseCodesign(0, stderr);
  assert.deepEqual(r, { signMode: "adhoc", signer: "adhoc", teamId: null });
});

test('returns adhoc when status is zero and flags contain adhoc but Signature is not adhoc', () => {
  const stderr = 'Authority=Some Authority\nflags=0x2(adhoc)\nTeamIdentifier=TEAM123';
  const r = parseCodesign(0, stderr);
  assert.deepEqual(r, { signMode: "adhoc", signer: "Some Authority", teamId: "TEAM123" });
});

test('returns signed when status is zero and flags contain adhoc but Signature is signed', () => {
  const stderr = 'Authority=Some Authority\nSignature=signed\nflags=0x2(adhoc)';
  const r = parseCodesign(0, stderr);
  assert.deepEqual(r, { signMode: "adhoc", signer: "Some Authority", teamId: null });
});

test('returns null teamId when TeamIdentifier is not set', () => {
  const stderr = 'Authority=Developer ID Application: Example Corp (ABC123DEF4)\nTeamIdentifier=not set\nSignature=signed';
  const r = parseCodesign(0, stderr);
  assert.deepEqual(r, { signMode: "signed", signer: "Developer ID Application: Example Corp (ABC123DEF4)", teamId: null });
});

test('returns null teamId when TeamIdentifier is absent', () => {
  const stderr = 'Authority=Developer ID Application: Example Corp (ABC123DEF4)\nSignature=signed';
  const r = parseCodesign(0, stderr);
  assert.deepEqual(r, { signMode: "signed", signer: "Developer ID Application: Example Corp (ABC123DEF4)", teamId: null });
});
