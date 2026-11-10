// Verifies tarball bytes against registry integrity anchors (bin/vendor-verify.mjs checkIntegrity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIntegrity } from '../vendor-verify.mjs';
import { createHash } from 'node:crypto';

const buf = Buffer.from('hello world');
const sha512 = createHash('sha512').update(buf).digest('base64');
const sha384 = createHash('sha384').update(buf).digest('base64');
const sha256 = createHash('sha256').update(buf).digest('base64');
const sha1 = createHash('sha1').update(buf).digest('hex');

test('accepts matching sha512 integrity anchor', () => {
  const meta = { integrity: `sha512-${sha512}` };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: true, anchor: 'sha512 integrity' });
});

test('rejects mismatched sha512 integrity anchor', () => {
  const wrong = 'A'.repeat(sha512.length);
  const meta = { integrity: `sha512-${wrong}` };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: false, why: 'tarball sha512 does not match the registry integrity' });
});

test('accepts matching sha384 integrity anchor', () => {
  const meta = { integrity: `sha384-${sha384}` };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: true, anchor: 'sha384 integrity' });
});

test('rejects mismatched sha384 integrity anchor', () => {
  const wrong = 'B'.repeat(sha384.length);
  const meta = { integrity: `sha384-${wrong}` };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: false, why: 'tarball sha384 does not match the registry integrity' });
});

test('accepts matching sha256 integrity anchor', () => {
  const meta = { integrity: `sha256-${sha256}` };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: true, anchor: 'sha256 integrity' });
});

test('rejects mismatched sha256 integrity anchor', () => {
  const wrong = 'C'.repeat(sha256.length);
  const meta = { integrity: `sha256-${wrong}` };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: false, why: 'tarball sha256 does not match the registry integrity' });
});

test('accepts matching legacy sha1 shasum when no integrity exists', () => {
  const meta = { shasum: sha1 };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: true, anchor: 'sha1 shasum (legacy)' });
});

test('rejects mismatched legacy sha1 shasum when no integrity exists', () => {
  const wrong = 'd'.repeat(40);
  const meta = { shasum: wrong };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: false, why: 'tarball sha1 does not match the registry shasum' });
});

test('rejects metadata with no integrity or shasum', () => {
  const meta = {};
  assert.deepEqual(checkIntegrity(meta, buf), { ok: false, why: 'registry metadata carries no integrity or shasum \u2014 nothing anchors this tarball' });
});

test('rejects invalid shasum format when no integrity exists', () => {
  const meta = { shasum: 'not-a-valid-sha1' };
  assert.deepEqual(checkIntegrity(meta, buf), { ok: false, why: 'registry metadata carries no integrity or shasum \u2014 nothing anchors this tarball' });
});
