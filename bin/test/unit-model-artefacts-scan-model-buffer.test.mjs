// scanModelBuffer aggregates pickle analysis results, handling plain, gzip, zlib and zip containers (bin/model-artefacts.mjs scanModelBuffer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanModelBuffer } from '../model-artefacts.mjs';

test('plain pickle buffer with STOP opcode returns kind pickle and one walked entry', () => {
  const buf = Buffer.from([0x2e]);
  const res = scanModelBuffer(buf);
  assert.equal(res.kind, 'pickle');
  assert.equal(res.walked, 1);
  assert.equal(res.opcodes, 1);
  assert.equal(res.reduce, 0);
  assert.deepEqual(res.dangerous, []);
  assert.deepEqual(res.errors, []);
  assert.equal(res.members, 0);
});

test('plain buffer without STOP opcode yields error about missing STOP', () => {
  const buf = Buffer.from([0x30]);
  const res = scanModelBuffer(buf);
  assert.equal(res.kind, 'pickle');
  assert.equal(res.walked, 1);
  assert.equal(res.opcodes, 1);
  assert.equal(res.reduce, 0);
  assert.deepEqual(res.dangerous, []);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /stack underflow/);
  assert.equal(res.members, 0);
});

test('buffer starting with gzip signature but not a valid gzip is treated as gzip+pickle and records inflate error', () => {
  const buf = Buffer.from([0x1f, 0x8b, 0x00]);
  const res = scanModelBuffer(buf);
  assert.equal(res.kind, 'gzip+pickle');
  assert.equal(res.walked, 0);
  assert.equal(res.opcodes, 0);
  assert.equal(res.reduce, 0);
  assert.deepEqual(res.dangerous, []);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /unexpected end of file|invalid/);
  assert.equal(res.members, 0);
});

test('buffer starting with zlib signature but not a valid zlib is treated as zlib+pickle and records inflate error', () => {
  const buf = Buffer.from([0x78, 0x9c]);
  const res = scanModelBuffer(buf);
  assert.equal(res.kind, 'zlib+pickle');
  assert.equal(res.walked, 0);
  assert.equal(res.opcodes, 0);
  assert.equal(res.reduce, 0);
  assert.deepEqual(res.dangerous, []);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /unexpected end of file|invalid/);
  assert.equal(res.members, 0);
});

test('buffer with zip signature but missing EOCD record is treated as zip and reports EOCD error', () => {
  const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const res = scanModelBuffer(buf);
  assert.equal(res.kind, 'zip');
  assert.equal(res.walked, 0);
  assert.equal(res.opcodes, 0);
  assert.equal(res.reduce, 0);
  assert.deepEqual(res.dangerous, []);
  assert.equal(res.members, 0);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /no end-of-central-directory record/);
});
