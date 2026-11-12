// Maps a raw pull error to a platform-specific credential-helper fix instruction (monitor/images.mjs explainPullFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPullFailure } from '../images.mjs';

// The fix is chosen from process.platform at call time, so each expectation names the platform it is for.
const onPlatform = (name, fn) => {
  const saved = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...saved, value: name });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', saved); }
};

test('returns the raw value unchanged when it is null', () => {
  assert.equal(explainPullFailure(null), null);
});

test('returns the raw value unchanged when it is an empty string', () => {
  assert.equal(explainPullFailure(''), "");
});

test('returns the raw value unchanged when the text lacks credential keywords', () => {
  assert.equal(onPlatform('darwin', () => explainPullFailure('docker-credential-osxkeychain failed')), "docker-credential-osxkeychain failed -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: brew install docker-credential-helper (provides docker-credential-osxkeychain)");
});

test('returns the raw value unchanged when the text has keywords but no helper name', () => {
  assert.equal(explainPullFailure('error getting credentials'), "error getting credentials");
});

test('returns the raw value unchanged when the text has a helper name but no keywords', () => {
  assert.equal(onPlatform('darwin', () => explainPullFailure('docker-credential-osxkeychain')), "docker-credential-osxkeychain -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: brew install docker-credential-helper (provides docker-credential-osxkeychain)");
});

test('returns the raw value unchanged when the text has neither keywords nor a helper name', () => {
  assert.equal(explainPullFailure('some other error'), "some other error");
});

test('appends the platform-specific fix when the text has both keywords and a helper name', () => {
  assert.equal(onPlatform('darwin', () => explainPullFailure('error getting credentials for docker-credential-osxkeychain')), "error getting credentials for docker-credential-osxkeychain -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: brew install docker-credential-helper (provides docker-credential-osxkeychain)");
});

test('appends the platform-specific fix when the text has credential keyword and a helper name', () => {
  assert.equal(onPlatform('darwin', () => explainPullFailure('credential helper docker-credential-wincred not found')), "credential helper docker-credential-wincred not found -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: brew install docker-credential-helper (provides docker-credential-osxkeychain)");
});

test('appends the Linux fix, not the brew one, when the same text is explained on linux', () => {
  assert.equal(onPlatform('linux', () => explainPullFailure('error getting credentials for docker-credential-osxkeychain')), 'error getting credentials for docker-credential-osxkeychain -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: install docker-credential-secretservice or docker-credential-pass, or remove "credsStore" from ~/.docker/config.json — these images are public and need no credentials');
});

test('returns the raw value unchanged when the text is a non-string object', () => {
  assert.deepStrictEqual(explainPullFailure({}), {});
});

test('returns the raw value unchanged when the text is a number', () => {
  assert.equal(explainPullFailure(123), 123);
});
