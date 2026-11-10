// Aggregates peer bindings from transcript envelopes (bin/lib/peer-headers.mjs scanPeerHeaders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPeerHeaders } from '../lib/peer-headers.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty bindings and zero counts when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const r = scanPeerHeaders({ cwd: dir, dir: join(dir, 'missing') });
    assert.deepEqual(r, { bindings: [], files: 0, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero files and zero unreadable when the directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [], files: 0, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips files that do not contain the cross-session-message marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    writeFileSync(join(dir, 'a.jsonl'), 'no marker here\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extracts a single peer binding with one hit and its timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const line = 'cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"2024-01-01T00:00:00Z"';
    writeFileSync(join(dir, 't.jsonl'), line + '\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "ab", pid: "123", sock: "/tmp/uds/123.sock", hits: 1, at: "2024-01-01T00:00:00Z", seenIn: ["t"] }], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregates hits from multiple files into one binding with newest timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const l1 = 'cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"2024-01-01T00:00:00Z"';
    const l2 = 'cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"2024-01-02T00:00:00Z"';
    writeFileSync(join(dir, 'a.jsonl'), l1 + '\n');
    writeFileSync(join(dir, 'b.jsonl'), l2 + '\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "ab", pid: "123", sock: "/tmp/uds/123.sock", hits: 2, at: "2024-01-02T00:00:00Z", seenIn: ["a", "b"] }], files: 2, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps the earlier timestamp when a later line has an older timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const l1 = 'cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"2024-01-02T00:00:00Z"';
    const l2 = 'cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"2024-01-01T00:00:00Z"';
    writeFileSync(join(dir, 'a.jsonl'), l1 + '\n' + l2 + '\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "ab", pid: "123", sock: "/tmp/uds/123.sock", hits: 2, at: "2024-01-02T00:00:00Z", seenIn: ["a"] }], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps the earlier timestamp when a later line has an equal timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const ts = '2024-01-01T00:00:00Z';
    const l1 = `cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"${ts}"`;
    const l2 = `cross-session-message from="uds:/tmp/uds/123.sock" from-name="commitwork-ab" "timestamp":"${ts}"`;
    writeFileSync(join(dir, 'a.jsonl'), l1 + '\n' + l2 + '\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "ab", pid: "123", sock: "/tmp/uds/123.sock", hits: 2, at: "2024-01-01T00:00:00Z", seenIn: ["a"] }], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts bindings by name then pid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const l1 = 'cross-session-message from="uds:/tmp/uds/1.sock" from-name="commitwork-bb" "timestamp":"2024-01-01T00:00:00Z"';
    const l2 = 'cross-session-message from="uds:/tmp/uds/2.sock" from-name="commitwork-aa" "timestamp":"2024-01-01T00:00:00Z"';
    writeFileSync(join(dir, 'a.jsonl'), l1 + '\n' + l2 + '\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "aa", pid: "2", sock: "/tmp/uds/2.sock", hits: 1, at: "2024-01-01T00:00:00Z", seenIn: ["a"] }, { name: "bb", pid: "1", sock: "/tmp/uds/1.sock", hits: 1, at: "2024-01-01T00:00:00Z", seenIn: ["a"] }], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts unreadable files that cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(dir, 'a.jsonl'), 'cross-session-message from="uds:/tmp/uds/1.sock" from-name="commitwork-ab" "timestamp":"2024-01-01T00:00:00Z"\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "ab", pid: "1", sock: "/tmp/uds/1.sock", hits: 1, at: "2024-01-01T00:00:00Z", seenIn: ["a"] }], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles escaped quotes in nested JSON envelope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanPeerHeaders-'));
  try {
    const line = 'cross-session-message from=\\"uds:/tmp/uds/456.sock\\" from-name=\\"commitwork-cd\\" "timestamp":"2024-01-01T00:00:00Z"';
    writeFileSync(join(dir, 't.jsonl'), line + '\n');
    const r = scanPeerHeaders({ cwd: dir, dir });
    assert.deepEqual(r, { bindings: [{ name: "cd", pid: "456", sock: "/tmp/uds/456.sock", hits: 1, at: "2024-01-01T00:00:00Z", seenIn: ["t"] }], files: 1, unreadable: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
