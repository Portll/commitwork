// POSTs a Time-Stamp query, verifies the reply, and writes .tsq/.tsr (cra/timestamp.mjs requestStamp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestStamp } from '../timestamp.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('throws TsaError with code no-url when CW_TSA_URL is unset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    await assert.rejects(
      requestStamp(record, { env: {} }),
      (e) => e instanceof Error && e.code === 'no-url' && /CW_TSA_URL is not set/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError with code no-url when CW_TSA_URL is not http or https', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'ftp://example.com' } }),
      (e) => e instanceof Error && e.code === 'no-url' && /must be http/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError with code request-failed when fetch rejects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    const badFetch = async () => { throw new Error('network down'); };
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'https://tsa.example.com' }, fetchImpl: badFetch }),
      (e) => e instanceof Error && e.code === 'request-failed' && /network down/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError with code request-failed when HTTP status is not ok', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    const fakeRes = { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    const fakeFetch = async () => fakeRes;
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'https://tsa.example.com' }, fetchImpl: fakeFetch }),
      (e) => e instanceof Error && e.code === 'request-failed' && /HTTP 503/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError with code request-failed when response exceeds MAX_RESPONSE_BYTES', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    const big = Buffer.alloc((1 << 20) + 1);
    const fakeRes = { ok: true, status: 200, arrayBuffer: async () => big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength) };
    const fakeFetch = async () => fakeRes;
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'https://tsa.example.com' }, fetchImpl: fakeFetch }),
      (e) => e instanceof Error && e.code === 'request-failed' && /over the/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError when response does not parse as TimeStampResp', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    const garbage = Buffer.from([0x30, 0x03, 0x01, 0x02, 0x03]);
    const fakeRes = { ok: true, status: 200, arrayBuffer: async () => garbage.buffer.slice(garbage.byteOffset, garbage.byteOffset + garbage.byteLength) };
    const fakeFetch = async () => fakeRes;
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'https://tsa.example.com' }, fetchImpl: fakeFetch }),
      (e) => e instanceof Error && /does not parse/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError when CW_TSA_CA is set but the file cannot be read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    const fakeRes = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    const fakeFetch = async () => fakeRes;
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'https://tsa.example.com', CW_TSA_CA: join(dir, 'nonexistent.pem') }, fetchImpl: fakeFetch }),
      (e) => e instanceof Error && /could not be read/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TsaError when CW_TSA_CA file holds no PEM certificate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'requestStamp-'));
  try {
    const record = join(dir, 'file.txt');
    writeFileSync(record, 'hello');
    const pemPath = join(dir, 'empty.pem');
    writeFileSync(pemPath, 'no certs here');
    const fakeRes = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    const fakeFetch = async () => fakeRes;
    await assert.rejects(
      requestStamp(record, { env: { CW_TSA_URL: 'https://tsa.example.com', CW_TSA_CA: pemPath }, fetchImpl: fakeFetch }),
      (e) => e instanceof Error && /holds no PEM certificate/.test(e.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
