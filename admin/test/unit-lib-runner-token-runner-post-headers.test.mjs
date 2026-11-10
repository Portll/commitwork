// Builds operator-socket POST headers or a refusal reason (admin/lib/runner-token.mjs runnerPostHeaders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerPostHeaders } from '../lib/runner-token.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok with bearer header when token file contains a valid token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    writeFileSync(tokenFile, 'abc123\n');
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.deepEqual(res, {
      ok: true,
      headers: {
        'content-type': 'application/json',
        'x-substrate-dispatch': '1',
        authorization: 'Bearer abc123',
      },
    });
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with trimmed token when file has surrounding whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    writeFileSync(tokenFile, '  tok-xyz  \n');
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.equal(res.ok, true);
    assert.equal(res.headers.authorization, 'Bearer tok-xyz');
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refusal when token file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const missing = join(dir, 'no-such-file');
  try {
    process.env.CW_SUBSTRATE_TOKEN_FILE = missing;
    const res = runnerPostHeaders();
    assert.equal(res.ok, false);
    assert.match(res.why, /runner token unreadable at/);
    assert.match(res.why, /ENOENT/);
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refusal when token file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    writeFileSync(tokenFile, '');
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.equal(res.ok, false);
    assert.match(res.why, /empty or malformed/);
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refusal when token contains only whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    writeFileSync(tokenFile, '   \n  ');
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.equal(res.ok, false);
    assert.match(res.why, /empty or malformed/);
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refusal when token contains internal whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    writeFileSync(tokenFile, 'abc def\n');
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.equal(res.ok, false);
    assert.match(res.why, /empty or malformed/);
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok for a single non-whitespace character token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    writeFileSync(tokenFile, 'x');
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.equal(res.ok, true);
    assert.equal(res.headers.authorization, 'Bearer x');
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok for a long token built with repeat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runnerPostHeaders-'));
  const tokenFile = join(dir, 'runner-token');
  try {
    const longToken = 'a'.repeat(200);
    writeFileSync(tokenFile, longToken);
    process.env.CW_SUBSTRATE_TOKEN_FILE = tokenFile;
    const res = runnerPostHeaders();
    assert.equal(res.ok, true);
    assert.equal(res.headers.authorization, `Bearer ${longToken}`);
  } finally {
    delete process.env.CW_SUBSTRATE_TOKEN_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});
