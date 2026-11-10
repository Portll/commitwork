// Appends a hash-chained event line to the history chain file (monitor/history-chain.mjs appendChainEvent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendChainEvent } from '../history-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects an op that is not in the allowed list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    assert.throws(() => appendChainEvent(dir, { op: 'bogus' }), { name: 'Error', message: 'chain op must be one of slice/replace/retro-seal/checkpoint, got "bogus"' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appends a slice event to an empty chain with unattributed by', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    const r = appendChainEvent(dir, { op: 'slice', at: '2024-01-01T00:00:00Z', stamp: 's1', sliceId: 'id1', source: 'src', sliceSha256: 'abc' });
    assert.deepEqual(r, { at: "2024-01-01T00:00:00Z", op: "slice", stamp: "s1", sliceId: "id1", source: "src", sliceSha256: "abc", by: "unattributed", note: undefined, chainVersion: 2, prev: "0000000000000000000000000000000000000000000000000000000000000000", chain: "dda5cd824c27f79d6c754862f47b44dbc292bb32141ca83ccfdb6fcca5636ed6" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appends a replace event to a non-empty chain using the last chain hash as prev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    appendChainEvent(dir, { op: 'slice', at: '2024-01-01T00:00:00Z', stamp: 's1', sliceId: 'id1', source: 'src', sliceSha256: 'abc' });
    const r = appendChainEvent(dir, { op: 'replace', at: '2024-01-02T00:00:00Z', stamp: 's2', sliceId: 'id2', source: 'src2', sliceSha256: 'def' });
    assert.deepEqual(r, { at: "2024-01-02T00:00:00Z", op: "replace", stamp: "s2", sliceId: "id2", source: "src2", sliceSha256: "def", by: "unattributed", note: undefined, chainVersion: 2, prev: "dda5cd824c27f79d6c754862f47b44dbc292bb32141ca83ccfdb6fcca5636ed6", chain: "f74602d303f52ca46f2d89817409b272888b9e2ea984ef9e949dca2b034948a1" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appends a retro-seal event with an explicit by field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    const r = appendChainEvent(dir, { op: 'retro-seal', at: '2024-01-03T00:00:00Z', stamp: 's3', sliceId: 'id3', source: 'src3', sliceSha256: 'ghi', by: 'alice' });
    assert.deepEqual(r, { at: "2024-01-03T00:00:00Z", op: "retro-seal", stamp: "s3", sliceId: "id3", source: "src3", sliceSha256: "ghi", by: "alice", note: undefined, chainVersion: 2, prev: "0000000000000000000000000000000000000000000000000000000000000000", chain: "7fa51d8b3af18dce416b99eee4c50fececfec73bf2034ac1fe2eb77a0ff2775d" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appends a checkpoint to an empty chain with a valid prevTip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    const prevTip = 'a'.repeat(64);
    const r = appendChainEvent(dir, { op: 'checkpoint', at: '2024-01-04T00:00:00Z', stamp: 'cp1', sliceId: 'id4', source: 'src4', sliceSha256: 'jkl', prevTip });
    assert.deepEqual(r, { at: "2024-01-04T00:00:00Z", op: "checkpoint", stamp: "cp1", sliceId: "id4", source: "src4", sliceSha256: "jkl", by: "unattributed", note: undefined, chainVersion: 2, prev: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chain: "525a5a2dd50a2caf35942439011f9cbf1a6e3b5567e156806f5d83709f6b81d9" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects a checkpoint on a non-empty chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    appendChainEvent(dir, { op: 'slice', at: '2024-01-01T00:00:00Z', stamp: 's1', sliceId: 'id1', source: 'src', sliceSha256: 'abc' });
    assert.throws(() => appendChainEvent(dir, { op: 'checkpoint', at: '2024-01-05T00:00:00Z', stamp: 'cp2', sliceId: 'id5', source: 'src5', sliceSha256: 'mno', prevTip: 'b'.repeat(64) }), { name: 'Error', message: 'a checkpoint may only open an empty chain \u2014 archive first, then open' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects a checkpoint with a missing prevTip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    assert.throws(() => appendChainEvent(dir, { op: 'checkpoint', at: '2024-01-06T00:00:00Z', stamp: 'cp3', sliceId: 'id6', source: 'src6', sliceSha256: 'pqr' }), { name: 'Error', message: "a checkpoint needs prevTip: the archived segment's tip hash" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects a checkpoint with a prevTip containing a zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    const prevTip = '0'.repeat(64);
    assert.deepStrictEqual(appendChainEvent(dir, { op: 'checkpoint', at: '2024-01-07T00:00:00Z', stamp: 'cp4', sliceId: 'id7', source: 'src7', sliceSha256: 'stu', prevTip }), { at: "2024-01-07T00:00:00Z", op: "checkpoint", stamp: "cp4", sliceId: "id7", source: "src7", sliceSha256: "stu", by: "unattributed", note: undefined, chainVersion: 2, prev: "0000000000000000000000000000000000000000000000000000000000000000", chain: "344a2d15f97808722c6db6150d8ad546b612286296f4a0d395c52bb254ca36a0" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appends a slice event with a note field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    const r = appendChainEvent(dir, { op: 'slice', at: '2024-01-08T00:00:00Z', stamp: 's8', sliceId: 'id8', source: 'src8', sliceSha256: 'vwx', note: 'hello' });
    assert.deepEqual(r, { at: "2024-01-08T00:00:00Z", op: "slice", stamp: "s8", sliceId: "id8", source: "src8", sliceSha256: "vwx", by: "unattributed", note: "hello", chainVersion: 2, prev: "0000000000000000000000000000000000000000000000000000000000000000", chain: "a2aa7d6cbe075ba9a463bf2010d31d7ebd31d47374e0e1f99b18b3a06b593a88" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appends a slice event without a note field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appendChainEvent-'));
  try {
    const r = appendChainEvent(dir, { op: 'slice', at: '2024-01-09T00:00:00Z', stamp: 's9', sliceId: 'id9', source: 'src9', sliceSha256: 'yz0' });
    assert.deepEqual(r, { at: "2024-01-09T00:00:00Z", op: "slice", stamp: "s9", sliceId: "id9", source: "src9", sliceSha256: "yz0", by: "unattributed", note: undefined, chainVersion: 2, prev: "0000000000000000000000000000000000000000000000000000000000000000", chain: "bbf0dce13d40f93e9ce81de202e1f99d16fad962ff81a085b4b0dcc521bb409a" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
