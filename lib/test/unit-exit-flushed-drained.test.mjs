// resolves when stream is finished or empty write completes (lib/exit-flushed.mjs drained)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drained } from '../exit-flushed.mjs';

test('returns resolved promise when stream is null (covers !stream true branch)', async () => {
  const r = await drained(null);
  assert.equal(r, undefined);
});

test('returns resolved promise when stream is undefined (covers !stream true branch)', async () => {
  const r = await drained(undefined);
  assert.equal(r, undefined);
});

test('returns resolved promise when stream.destroyed is true (covers stream.destroyed true branch)', async () => {
  const stream = {
    destroyed: true,
    writableEnded: false,
    write: () => {}
  };
  const r = await drained(stream);
  assert.equal(r, undefined);
});

test('returns resolved promise when stream.writableEnded is true (covers stream.writableEnded true branch)', async () => {
  const stream = {
    destroyed: false,
    writableEnded: true,
    write: () => {}
  };
  const r = await drained(stream);
  assert.equal(r, undefined);
});

test('calls write and resolves via callback when write succeeds (covers normal path)', async () => {
  const stream = {
    destroyed: false,
    writableEnded: false,
    write: (_, cb) => { cb(); }
  };
  const r = await drained(stream);
  assert.equal(r, undefined);
});

test('catches exception from write and resolves (covers catch block)', async () => {
  const stream = {
    destroyed: false,
    writableEnded: false,
    write: () => { throw new Error('boom'); }
  };
  const r = await drained(stream);
  assert.equal(r, undefined);
});

test('original resolves when stream is null but edited version would not (tests first edit)', async () => {
  const r = await drained(null);
  assert.equal(r, undefined);
});

test('original resolves when stream.destroyed true but writableEnded false (tests second edit)', async () => {
  const stream = {
    destroyed: true,
    writableEnded: false,
    write: () => {}
  };
  const r = await drained(stream);
  assert.equal(r, undefined);
});

test('original proceeds to write when stream is truthy and not destroyed/ended (tests third edit)', async () => {
  const stream = {
    destroyed: false,
    writableEnded: false,
    write: (_, cb) => { cb(); }
  };
  const r = await drained(stream);
  assert.equal(r, undefined);
});
