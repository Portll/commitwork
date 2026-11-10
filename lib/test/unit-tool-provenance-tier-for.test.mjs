// Maps a tool record to its trust tier by channel (lib/tool-provenance.mjs tierFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierFor } from '../tool-provenance.mjs';

test('returns unrecorded tier when record is null', () => {
  const r = tierFor(null);
  assert.deepEqual(r, { rank: null, label: "unrecorded (not installed by setup)" });
});

test('returns unrecorded tier when record is undefined', () => {
  const r = tierFor(undefined);
  assert.deepEqual(r, { rank: null, label: "unrecorded (not installed by setup)" });
});

test('returns primary signed tier for release/cosign channel', () => {
  const r = tierFor({ channel: 'release/cosign' });
  assert.deepEqual(r, { rank: 0, label: "primary, publisher-signed, pinned" });
});

test('returns primary pinned tier for release/sha256 channel', () => {
  const r = tierFor({ channel: 'release/sha256' });
  assert.deepEqual(r, { rank: 1, label: "primary, pinned, unsigned" });
});

test('returns registry tier for go channel', () => {
  const r = tierFor({ channel: 'go' });
  assert.deepEqual(r, { rank: 2, label: "registry, sumdb-checked" });
});

test('returns registry tier for npm channel', () => {
  const r = tierFor({ channel: 'npm' });
  assert.deepEqual(r, { rank: 2, label: "registry, exact version" });
});

test('returns secondary tier for brew channel', () => {
  const r = tierFor({ channel: 'brew' });
  assert.deepEqual(r, { rank: 3, label: "secondary, curated rebuild, unpinned" });
});

test('returns unranked tier for unknown channel', () => {
  const r = tierFor({ channel: 'unknown-channel' });
  assert.deepEqual(r, { rank: null, label: "unranked channel unknown-channel" });
});

test('returns unranked tier when channel is missing', () => {
  const r = tierFor({});
  assert.deepEqual(r, { rank: null, label: "unranked channel undefined" });
});
