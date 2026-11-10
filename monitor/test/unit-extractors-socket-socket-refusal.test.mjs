// Detects whether a socket.json artifact records a provider refusal rather than a completed scan (monitor/extractors/socket.mjs socketRefusal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socketRefusal } from '../extractors/socket.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the artifact file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    assert.deepEqual(socketRefusal(dir, 'socket.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the artifact is a zero-byte husk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), '');
    assert.deepEqual(socketRefusal(dir, 'socket.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the artifact is unparseable JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), 'not json');
    assert.deepEqual(socketRefusal(dir, 'socket.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the artifact is a completed legacy scan with issues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), JSON.stringify({ issues: [] }));
    assert.deepEqual(socketRefusal(dir, 'socket.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the artifact is a completed modern scan with ok true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), JSON.stringify({ ok: true, data: { alerts: {} } }));
    assert.deepEqual(socketRefusal(dir, 'socket.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a refusal with quota false for a no-token message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), JSON.stringify({ ok: false, message: 'No token provided' }));
    assert.deepEqual(socketRefusal(dir, 'socket.json'), { refused: true, message: "No token provided", quota: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a refusal with quota true for a quota-exhaustion message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), JSON.stringify({ ok: false, message: 'quota exceeded' }));
    assert.deepEqual(socketRefusal(dir, 'socket.json'), { refused: true, message: "quota exceeded", quota: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a refusal with the no-message placeholder when message is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    writeFileSync(join(dir, 'socket.json'), JSON.stringify({ ok: false }));
    assert.deepEqual(socketRefusal(dir, 'socket.json'), { refused: true, message: "(no message field on the refusal)", quota: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('caps the refusal message at 200 characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socketRefusal-'));
  try {
    const longMsg = 'x'.repeat(250);
    writeFileSync(join(dir, 'socket.json'), JSON.stringify({ ok: false, message: longMsg }));
    assert.deepEqual(socketRefusal(dir, 'socket.json'), { refused: true, message: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", quota: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
