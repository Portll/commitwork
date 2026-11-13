// Maps a raw pull error to a platform-specific credential-helper fix instruction (monitor/images.mjs explainPullFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPullFailure } from '../images.mjs';

const FIXED = ' -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: ';
const BREW = 'brew install docker-credential-helper (provides docker-credential-osxkeychain)';

// HELPER_FIX is not exported. The module picks the suffix from process.platform: on darwin it is the
// brew text; elsewhere it is whatever HELPER_FIX names for that platform. Assert the fixed prefix
// exactly, the suffix's presence on every platform, and the brew text on darwin.
function expectFix(raw) {
  const actual = explainPullFailure(raw);
  assert.ok(actual.startsWith(`${raw}${FIXED}`), `expected the fixed prefix; got ${JSON.stringify(actual)}`);
  const fix = actual.slice(`${raw}${FIXED}`.length);
  assert.ok(fix.length > 0, 'the platform fix is empty');
  if (process.platform === 'darwin') assert.equal(fix, BREW);
}

test('returns the raw value unchanged when it is null', () => {
  assert.equal(explainPullFailure(null), null);
});

test('returns the raw value unchanged when it is an empty string', () => {
  assert.equal(explainPullFailure(''), "");
});

test('appends the fix when the text is a helper name and a failure', () => {
  expectFix('docker-credential-osxkeychain failed');
});

test('returns the raw value unchanged when the text has keywords but no helper name', () => {
  assert.equal(explainPullFailure('error getting credentials'), "error getting credentials");
});

test('appends the fix when the text is only a helper name', () => {
  expectFix('docker-credential-osxkeychain');
});

test('returns the raw value unchanged when the text has neither keywords nor a helper name', () => {
  assert.equal(explainPullFailure('some other error'), "some other error");
});

test('appends the platform-specific fix when the text has both keywords and a helper name', () => {
  expectFix('error getting credentials for docker-credential-osxkeychain');
});

test('appends the platform-specific fix when the text has credential keyword and a helper name', () => {
  expectFix('credential helper docker-credential-wincred not found');
});

test('returns the raw value unchanged when the text is a non-string object', () => {
  assert.deepStrictEqual(explainPullFailure({}), {});
});

test('returns the raw value unchanged when the text is a number', () => {
  assert.equal(explainPullFailure(123), 123);
});
