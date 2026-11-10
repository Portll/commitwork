// Resolves unpinned third-party action refs to full SHAs and rewrites the workflow text. (monitor/workflow-harden.mjs pinUses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinUses } from '../workflow-harden.mjs';

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const SHA3 = 'c'.repeat(40);
const SHA4 = 'd'.repeat(40);
const SHA5 = 'e'.repeat(40);

test('pins a single unpinned action to its resolved sha', () => {
  const r = pinUses('uses: actions/checkout@v4', () => SHA);
  assert.deepEqual(r, { text: "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4", pinned: [{ action: "actions/checkout", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], skipped: [] });
});

test('skips local actions and docker images as unpinnable', () => {
  const r = pinUses('uses: ./local-action@v1\nuses: docker://alpine:latest', () => SHA);
  assert.deepEqual(r, { text: "uses: ./local-action@v1\nuses: docker://alpine:latest", pinned: [], skipped: [{ action: "./local-action", ref: "v1", reason: "local-action" }] });
});

test('does not skip already-pinned actions in the skipped list', () => {
  const r = pinUses(`uses: actions/checkout@${SHA}`, () => SHA);
  assert.deepEqual(r, { text: "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", pinned: [], skipped: [] });
});

test('skips actions whose ref does not resolve to a valid sha', () => {
  const r = pinUses('uses: actions/checkout@v4', () => null);
  assert.deepEqual(r, { text: "uses: actions/checkout@v4", pinned: [], skipped: [{ action: "actions/checkout", ref: "v4", reason: "unresolved" }] });
});

test('skips actions whose resolved value is not a full sha', () => {
  const r = pinUses('uses: actions/checkout@v4', () => 'not-a-sha');
  assert.deepEqual(r, { text: "uses: actions/checkout@v4", pinned: [], skipped: [{ action: "actions/checkout", ref: "v4", reason: "unresolved" }] });
});

test('keeps a trailing comment that is not just the ref', () => {
  const r = pinUses('uses: actions/checkout@v4 # my comment', () => SHA);
  assert.deepEqual(r, { text: "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4 # my comment", pinned: [{ action: "actions/checkout", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], skipped: [] });
});

test('drops a trailing comment that only repeats the ref', () => {
  const r = pinUses('uses: actions/checkout@v4 # v4', () => SHA);
  assert.deepEqual(r, { text: "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4", pinned: [{ action: "actions/checkout", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], skipped: [] });
});

test('preserves CRLF line endings in the output text', () => {
  const r = pinUses('uses: actions/checkout@v4\r\nuses: actions/setup-node@v4', () => SHA);
  assert.deepEqual(r, { text: "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4\r\nuses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4", pinned: [{ action: "actions/checkout", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { action: "actions/setup-node", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], skipped: [] });
});

test('handles multiple actions with mixed pinning outcomes', () => {
  const r = pinUses('uses: actions/checkout@v4\nuses: actions/setup-node@v4\nuses: ./local@v1', () => SHA);
  assert.deepEqual(r, { text: "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4\nuses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4\nuses: ./local@v1", pinned: [{ action: "actions/checkout", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { action: "actions/setup-node", ref: "v4", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], skipped: [{ action: "./local", ref: "v1", reason: "local-action" }] });
});
