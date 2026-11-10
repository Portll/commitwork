// Computes the provenance channel key from via and signatureTier (lib/tool-provenance.mjs channelKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelKey } from '../tool-provenance.mjs';

test('returns release/cosign when via is release and signatureTier is cosign', () => {
  const r = channelKey('release', 'cosign');
  assert.equal(r, "release/cosign");
});

test('returns release/sha256 when via is release and signatureTier is sha256', () => {
  const r = channelKey('release', 'sha256');
  assert.equal(r, "release/sha256");
});

test('returns release/sha256 when via is release and signatureTier is undefined', () => {
  const r = channelKey('release', undefined);
  assert.equal(r, "release/sha256");
});

test('returns the via value when via is dev and signatureTier is cosign', () => {
  const r = channelKey('dev', 'cosign');
  assert.equal(r, "dev");
});

test('returns the via value when via is dev and signatureTier is sha256', () => {
  const r = channelKey('dev', 'sha256');
  assert.equal(r, "dev");
});

test('returns the via value when via is nightly and signatureTier is cosign', () => {
  const r = channelKey('nightly', 'cosign');
  assert.equal(r, "nightly");
});

test('returns the via value when via is nightly and signatureTier is sha256', () => {
  const r = channelKey('nightly', 'sha256');
  assert.equal(r, "nightly");
});

test('returns the via value when via is an empty string and signatureTier is cosign', () => {
  const r = channelKey('', 'cosign');
  assert.equal(r, "");
});
