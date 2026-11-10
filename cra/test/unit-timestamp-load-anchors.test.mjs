// loads a list of X509Certificate objects from a PEM bundle file (cra/timestamp.mjs loadAnchors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAnchors, TsaError } from '../timestamp.mjs';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns null when CW_TSA_CA is not set', () => {
  const env = {};
  const result = loadAnchors(env);
  assert.strictEqual(result, null);
});

test('throws TsaError when CW_TSA_CA points to a non\u2011existent file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAnchors-'));
  try {
    const env = { CW_TSA_CA: join(dir, 'missing.pem') };
    assert.throws(() => loadAnchors(env), err => {
      assert(err instanceof TsaError);
      assert.match(err.message, /could not be read/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError when CW_TSA_CA points to an unreadable file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAnchors-'));
  try {
    const path = join(dir, 'unreadable.pem');
    writeFileSync(path, 'dummy');
    chmodSync(path, 0o000);
    const env = { CW_TSA_CA: path };
    assert.throws(() => loadAnchors(env), err => {
      assert(err instanceof TsaError);
      assert.match(err.message, /could not be read/);
      return true;
    });
  } finally {
    try { chmodSync(join(dir, 'unreadable.pem'), 0o600); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError when the file does not contain a parsable PEM certificate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAnchors-'));
  try {
    const path = join(dir, 'bad.pem');
    writeFileSync(path, '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----\n');
    const env = { CW_TSA_CA: path };
    assert.throws(() => loadAnchors(env), err => {
      assert(err instanceof TsaError);
      assert.match(err.message, /does not parse/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError when the PEM bundle contains no certificates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAnchors-'));
  try {
    const path = join(dir, 'empty.pem');
    writeFileSync(path, '');
    const env = { CW_TSA_CA: path };
    assert.throws(() => loadAnchors(env), err => {
      assert(err instanceof TsaError);
      assert.match(err.message, /holds no PEM certificate/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
