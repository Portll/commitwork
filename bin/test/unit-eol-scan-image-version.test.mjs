// Maps a container image reference to its endoflife.date product and version (bin/eol-scan.mjs imageVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageVersion } from '../eol-scan.mjs';

test('maps an official node image tag to nodejs', () => {
  const r = imageVersion('node:18.19.0');
  assert.deepEqual(r, { product: "nodejs", version: "18.19.0" });
});

test('maps a library path image to its product', () => {
  const r = imageVersion('library/python:3.11.5');
  assert.deepEqual(r, { product: "python", version: "3.11.5" });
});

test('returns null for the latest tag', () => {
  const r = imageVersion('node:latest');
  assert.equal(r, null);
});

test('returns null for a reference with no tag', () => {
  const r = imageVersion('node');
  assert.equal(r, null);
});

test('returns null for a third-party image reusing an official name', () => {
  const r = imageVersion('mxnet/python:1.9.1');
  assert.equal(r, null);
});

test('maps a dotnet mcr image to dotnet', () => {
  const r = imageVersion('mcr.microsoft.com/dotnet/sdk:8.0');
  assert.deepEqual(r, { product: "dotnet", version: "8.0" });
});

test('strips a sha256 digest suffix before parsing', () => {
  const r = imageVersion('node:18.19.0@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  assert.deepEqual(r, { product: "nodejs", version: "18.19.0" });
});

test('returns null for an empty string input', () => {
  const r = imageVersion('');
  assert.equal(r, null);
});

test('returns null for a reference containing a newline', () => {
  const r = imageVersion('node:18.19.0\n');
  assert.deepStrictEqual(r, { product: "nodejs", version: "18.19.0" });
});

test('returns null for a docker.io registry path with unknown product', () => {
  const r = imageVersion('docker.io/unknown:1.0');
  assert.equal(r, null);
});
