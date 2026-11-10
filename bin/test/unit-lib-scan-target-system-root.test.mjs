// Maps a path to its containing system root or null (bin/lib/scan-target.mjs systemRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemRoot } from '../lib/scan-target.mjs';

test('returns null for a path inside a temp directory', () => {
  const r = systemRoot('/tmp/foo');
  assert.equal(r, null);
});

test('returns the matching system root for a path inside /usr', () => {
  const r = systemRoot('/usr/local/bin');
  assert.equal(r, "/usr");
});

test('returns null for a path outside all system roots and temp dirs', () => {
  const r = systemRoot('/home/user/project');
  assert.equal(r, null);
});

test('returns null for a path inside /var/folders', () => {
  const r = systemRoot('/var/folders/ab/cd');
  assert.equal(r, null);
});

test('returns the matching system root for a path inside /etc', () => {
  const r = systemRoot('/etc/passwd');
  assert.equal(r, "/etc");
});

test('returns null for a path inside /private/tmp', () => {
  const r = systemRoot('/private/tmp/data');
  assert.equal(r, null);
});

test('returns the matching system root for a path inside /opt', () => {
  const r = systemRoot('/opt/homebrew/bin');
  assert.equal(r, "/opt");
});

test('returns null for a path inside /var/tmp', () => {
  const r = systemRoot('/var/tmp/cache');
  assert.equal(r, null);
});
