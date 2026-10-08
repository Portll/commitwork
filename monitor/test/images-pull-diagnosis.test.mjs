// A credential-helper failure is not a network failure, and it does not look like one in the log.
//
// MEASURED 2026-08-28: every image pull in the fleet had been failing with
//   error getting credentials - err: exec: "docker-credential-osxkeychain": executable file not found in $PATH
// for four images (osv-scanner, dep-scan, renovate, guarddog), on a box whose ~/.docker/config.json
// declares `credsStore: osxkeychain` and where nothing provides it — Docker Desktop is not
// installed, the context is colima. All four are PUBLIC images needing no credentials at all; the
// helper is consulted before anyone asks whether authentication is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPullFailure } from '../images.mjs';

const MACOS = 'error getting credentials - err: exec: "docker-credential-osxkeychain": executable file not found in $PATH, out: ``';

test('a credential-helper failure gains an instruction, and keeps the original text', () => {
  const out = explainPullFailure(MACOS);
  assert.ok(out.includes('docker-credential-osxkeychain'), 'the raw error must survive — it is the evidence');
  assert.match(out, /PUBLIC and need none/, 'and it must say the images need no credentials, which is the non-obvious half');
  assert.match(out, /Fix:/);
});

// The raw error names whatever helper the CONFIG asked for, so on Linux or Windows it prints a
// different binary and the same nothing about what to do. The fix is chosen from the platform
// actually running, not from the string the error happens to carry.
test('the instruction is chosen from the running platform, not from the error text', () => {
  const out = explainPullFailure(MACOS);
  const expected = { darwin: /brew install docker-credential-helper/, linux: /secretservice|docker-credential-pass/, win32: /wincred/ }[process.platform];
  if (expected) assert.match(out, expected, `the fix must name this platform's helper (${process.platform})`);
  else assert.match(out, /credential helper your platform uses/, 'an unrecognised platform still gets a usable sentence');
});

// The most important direction: this must not editorialise over failures it does not understand.
test('an unrelated pull failure passes through untouched', () => {
  for (const raw of [
    'Error response from daemon: manifest unknown',
    'net/http: TLS handshake timeout',
    'toomanyrequests: You have reached your pull rate limit',
    '',
  ]) {
    assert.equal(explainPullFailure(raw), raw, `must not rewrite: ${JSON.stringify(raw)}`);
  }
});

// A credentials-shaped message with no helper named is not something we can act on, so it is left
// alone rather than given a guess.
test('a credential error naming no helper is left alone', () => {
  const raw = 'error getting credentials - err: something else entirely';
  assert.equal(explainPullFailure(raw), raw);
});
