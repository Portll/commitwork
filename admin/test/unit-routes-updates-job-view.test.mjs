// Computes a job view object with id, state, timestamps, exit, pid, and a tail of the log file (admin/routes/updates.mjs jobView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobView } from '../routes/updates.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns tail as full log content when log is shorter than tailBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobView-'));
  try {
    const logPath = join(dir, 'short.log');
    writeFileSync(logPath, 'hello world');
    const result = jobView({ id: 'j1', state: 'done', startedAt: 's', endedAt: 'e', exit: 0, pid: 1, log: logPath }, { tailBytes: 4000 });
    assert.deepEqual(result, { id: "j1", state: "done", startedAt: "s", endedAt: "e", exit: 0, pid: 1, tail: "hello world" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns tail as last tailBytes characters when log is longer than tailBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobView-'));
  try {
    const logPath = join(dir, 'long.log');
    const content = 'x'.repeat(100);
    writeFileSync(logPath, content);
    const result = jobView({ id: 'j2', state: 'done', startedAt: 's', endedAt: 'e', exit: 0, pid: 1, log: logPath }, { tailBytes: 10 });
    assert.deepEqual(result, { id: "j2", state: "done", startedAt: "s", endedAt: "e", exit: 0, pid: 1, tail: "xxxxxxxxxx" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null tail when log file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobView-'));
  try {
    const logPath = join(dir, 'missing.log');
    const result = jobView({ id: 'j3', state: 'running', startedAt: 's', endedAt: null, exit: null, pid: null, log: logPath }, { tailBytes: 4000 });
    assert.deepEqual(result, { id: "j3", state: "running", startedAt: "s", endedAt: null, exit: null, pid: null, tail: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns error message in tail when log path is a directory causing read failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobView-'));
  try {
    const logPath = join(dir, 'adir');
    mkdirSync(logPath);
    const result = jobView({ id: 'j4', state: 'done', startedAt: 's', endedAt: 'e', exit: 1, pid: 2, log: logPath }, { tailBytes: 4000 });
    assert.deepEqual(result, { id: "j4", state: "done", startedAt: "s", endedAt: "e", exit: 1, pid: 2, tail: "(log unreadable: EISDIR) \u2014 the scan's output is UNKNOWN, not empty" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns tail as empty string when log file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobView-'));
  try {
    const logPath = join(dir, 'empty.log');
    writeFileSync(logPath, '');
    const result = jobView({ id: 'j5', state: 'done', startedAt: 's', endedAt: 'e', exit: 0, pid: 1, log: logPath }, { tailBytes: 4000 });
    assert.deepEqual(result, { id: "j5", state: "done", startedAt: "s", endedAt: "e", exit: 0, pid: 1, tail: "" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for endedAt and exit when they are undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobView-'));
  try {
    const logPath = join(dir, 'log.log');
    writeFileSync(logPath, 'data');
    const result = jobView({ id: 'j6', state: 'running', startedAt: 's', log: logPath }, { tailBytes: 4000 });
    assert.deepEqual(result, { id: "j6", state: "running", startedAt: "s", endedAt: null, exit: null, pid: null, tail: "data" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
