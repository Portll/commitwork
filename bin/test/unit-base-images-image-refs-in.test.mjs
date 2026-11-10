// Extracts external image references from Dockerfile and compose files (bin/base-images.mjs imageRefsIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageRefsIn } from '../base-images.mjs';

test('returns empty array for a non-image filename', () => {
  assert.deepEqual(imageRefsIn('README.md', 'FROM node:20'), []);
});

test('extracts a single external image reference from a Dockerfile', () => {
  assert.deepEqual(imageRefsIn('Dockerfile', 'FROM node:20'), [{ ref: 'node:20', line: 1 }]);
});

test('extracts a reference with a platform flag from a Dockerfile', () => {
  assert.deepEqual(imageRefsIn('Dockerfile', 'FROM --platform=linux/amd64 node:20'), [{ ref: 'node:20', line: 1 }]);
});

test('extracts a reference with a stage alias from a Dockerfile', () => {
  assert.deepEqual(imageRefsIn('Dockerfile', 'FROM node:20 AS builder'), [{ ref: 'node:20', line: 1 }]);
});

test('skips a reference that is a previously defined stage', () => {
  assert.deepEqual(imageRefsIn('Dockerfile', 'FROM node:20 AS builder\nFROM builder'), [{ ref: 'node:20', line: 1 }]);
});

test('skips a reference that is the scratch stage', () => {
  assert.deepEqual(imageRefsIn('Dockerfile', 'FROM node:20 AS builder\nFROM scratch'), [{ ref: 'node:20', line: 1 }]);
});

test('extracts an image reference from a compose file', () => {
  assert.deepEqual(imageRefsIn('docker-compose.yml', 'image: node:20'), [{ ref: 'node:20', line: 1 }]);
});

test('skips a compose image reference containing a newline', () => {
  assert.deepEqual(imageRefsIn('docker-compose.yml', 'image: node:20\nimage: node:21'), [{ ref: "node:20", line: 1 }, { ref: "node:21", line: 2 }]);
});

test('extracts multiple external references from a multi-stage Dockerfile', () => {
  const text = 'FROM node:20 AS builder\nFROM alpine:3.18';
  assert.deepEqual(imageRefsIn('Dockerfile', text), [
    { ref: 'node:20', line: 1 },
    { ref: 'alpine:3.18', line: 2 }
  ]);
});
