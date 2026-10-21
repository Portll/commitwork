// Counts TensorFlow NodeDef op names in a protobuf buffer (bin/model-artefacts.mjs scanGraphBuffer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanGraphBuffer } from '../model-artefacts.mjs';

test('returns zero ops and empty hits for an empty buffer', () => {
  const buf = Buffer.alloc(0);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 0, hits: {} });
});

test('returns zero ops and empty hits for a buffer shorter than two bytes', () => {
  const buf = Buffer.from([0x12]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 0, hits: {} });
});

test('ignores a 0x12 byte followed by a zero length byte', () => {
  const buf = Buffer.from([0x12, 0x00, 0x41]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 0, hits: {} });
});

test('ignores a 0x12 byte followed by a length of 64', () => {
  const buf = Buffer.from([0x12, 0x40, 0x41]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 0, hits: {} });
});

test('ignores a 0x12 byte followed by a length of 63 when the buffer is too short', () => {
  const buf = Buffer.from([0x12, 0x3f, 0x41]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 0, hits: {} });
});

test('counts a valid ReadFile op name with length 8', () => {
  const buf = Buffer.from([0x12, 0x08, ...Buffer.from('ReadFile', 'latin1')]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 1, hits: { ReadFile: 1 } });
});

test('counts a valid WriteFile op name with length 9', () => {
  const buf = Buffer.from([0x12, 0x09, ...Buffer.from('WriteFile', 'latin1')]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 1, hits: { WriteFile: 1 } });
});

test('counts a valid PyFunc op name with length 6', () => {
  const buf = Buffer.from([0x12, 0x06, ...Buffer.from('PyFunc', 'latin1')]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 1, hits: { PyFunc: 1 } });
});

test('counts a valid EagerPyFunc op name with length 11', () => {
  const buf = Buffer.from([0x12, 0x0b, ...Buffer.from('EagerPyFunc', 'latin1')]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 1, hits: { EagerPyFunc: 1 } });
});

test('ignores a node named ReadFile because the name field is 0x0a not 0x12', () => {
  const buf = Buffer.from([0x0a, 0x08, ...Buffer.from('ReadFile', 'latin1')]);
  assert.deepEqual(scanGraphBuffer(buf), { opsSeen: 0, hits: {} });
});
