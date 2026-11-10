// Extracts version declarations from Dockerfiles, Compose, and language version files (bin/eol-scan.mjs declarationsIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declarationsIn } from '../eol-scan.mjs';

test('parses Dockerfile FROM lines with valid image versions', () => {
  const text = 'FROM node:18\nFROM python:3.11';
  const r = declarationsIn('Dockerfile', text);
  assert.deepEqual(r, [{ product: "nodejs", version: "18", line: 1, source: "Dockerfile FROM" }, { product: "python", version: "3.11", line: 2, source: "Dockerfile FROM" }]);
});

test('parses Compose image lines with valid versions', () => {
  const text = 'services:\n  app:\n    image: node:18\n  db:\n    image: postgres:15';
  const r = declarationsIn('docker-compose.yml', text);
  assert.deepEqual(r, [{ product: "nodejs", version: "18", line: 3, source: "Compose image" }, { product: "postgresql", version: "15", line: 5, source: "Compose image" }]);
});

test('parses .nvmrc with version prefix', () => {
  const r = declarationsIn('.nvmrc', 'v18.2.0');
  assert.deepEqual(r, [{ product: "nodejs", version: "v18.2.0", line: 1, source: ".nvmrc" }]);
});

test('parses package.json engines.node major version', () => {
  const text = '{"name":"x","engines":{"node":"^18.0.0"}}';
  const r = declarationsIn('package.json', text);
  assert.deepEqual(r, [{ product: "nodejs", version: "18", line: 1, source: "package.json engines.node" }]);
});

test('parses .python-version file', () => {
  const r = declarationsIn('.python-version', '3.11');
  assert.deepEqual(r, [{ product: "python", version: "3.11", line: 1, source: ".python-version" }]);
});

test('parses runtime.txt with python version', () => {
  const text = 'python-3.11.2';
  const r = declarationsIn('runtime.txt', text);
  assert.deepEqual(r, [{ product: "python", version: "3.11.2", line: 1, source: "runtime.txt" }]);
});

test('parses .ruby-version file', () => {
  const r = declarationsIn('.ruby-version', '3.2.1');
  assert.deepEqual(r, [{ product: "ruby", version: "3.2.1", line: 1, source: ".ruby-version" }]);
});

test('parses .tool-versions with multiple tools', () => {
  const text = 'nodejs 18.2.0\npython 3.11.2';
  const r = declarationsIn('.tool-versions', text);
  assert.deepEqual(r, [{ product: "nodejs", version: "18.2.0", line: 1, source: ".tool-versions" }, { product: "python", version: "3.11.2", line: 2, source: ".tool-versions" }]);
});

test('parses go.mod toolchain directive', () => {
  const text = 'module example.com/x\ngo 1.21\ntoolchain go1.21.3';
  const r = declarationsIn('go.mod', text);
  assert.deepEqual(r, [{ product: "go", version: "1.21.3", line: 3, source: "go.mod toolchain" }]);
});

test('returns empty array for unrecognized file names', () => {
  const r = declarationsIn('README.md', '# Hello');
  assert.deepEqual(r, []);
});
