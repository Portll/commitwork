// Serialises a value to indented JSON and writes it durably, or returns a refusal receipt (lib/durable-write.mjs durableWriteJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durableWriteJson } from '../durable-write.mjs';

const ENV = { CW_NOW: '2026-01-02T03:04:05Z' };
const AT = '2026-01-02T03:04:05.000Z';
const PATH = '/nonexistent-commitwork-unit-dir/out.json';
const OPTS = { env: ENV, mkdir: false, max: 1 };

function refused(over) {
  return {
    ok: false,
    state: 'refused',
    path: PATH,
    bytes: null,
    sha256: null,
    reason: null,
    class: null,
    errno: null,
    at: AT,
    preflight: { state: 'unknown', freeBytes: null, requiredBytes: null, headroomBytes: null, why: 'not run' },
    durability: {
      tmpWrite: 'not-attempted',
      fileFsync: 'not-attempted',
      rename: 'not-attempted',
      dirFsync: 'not-attempted',
      readback: 'not-attempted',
    },
    partial: { started: false, bytesWritten: 0, targetReplaced: false },
    tmp: { path: null, cleaned: 'not-created', cleanupReason: null },
    notes: [],
    platform: process.platform,
    guarantees: { atomicRename: false, fileDurable: false, dirDurable: false },
    ...over,
  };
}

const UNDEF_REASON = 'JSON.stringify produced undefined \u2014 the value is not serialisable';

test('An undefined value is refused because stringify produced no text', () => {
  const r = durableWriteJson(PATH, undefined, OPTS);
  assert.deepEqual(r, refused({ class: 'unknown', reason: UNDEF_REASON }));
});

test('A function value is refused because stringify produced no text', () => {
  const r = durableWriteJson(PATH, () => 1, OPTS);
  assert.deepEqual(r, refused({ class: 'unknown', reason: UNDEF_REASON }));
});

test('A value whose toJSON throws an ENOENT error is refused and classified as absent', () => {
  const value = { toJSON() { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); } };
  const r = durableWriteJson(PATH, value, OPTS);
  assert.deepEqual(r, refused({
    class: 'absent',
    errno: 'ENOENT',
    reason: 'could not serialise the value: path does not exist',
  }));
});

test('A BigInt inside the value is refused with the runtime message as an unknown class', () => {
  const r = durableWriteJson(PATH, { n: 1n }, OPTS);
  assert.deepEqual(r, refused({
    class: 'unknown',
    errno: null,
    reason: 'could not serialise the value: Do not know how to serialize a BigInt',
  }));
});

test('A RangeError about string length during serialisation is refused as an oom class', () => {
  const value = { toJSON() { throw new RangeError('Invalid string length'); } };
  const r = durableWriteJson(PATH, value, OPTS);
  assert.deepEqual(r, refused({
    class: 'oom',
    errno: null,
    reason: 'could not serialise the value: allocation refused by the runtime: Invalid string length',
  }));
});

test('An ERR_STRING_TOO_LONG error during serialisation is refused as an oom class with that errno', () => {
  const value = { toJSON() { throw Object.assign(new Error('too long'), { code: 'ERR_STRING_TOO_LONG' }); } };
  const r = durableWriteJson(PATH, value, OPTS);
  assert.deepEqual(r, refused({
    class: 'oom',
    errno: 'ERR_STRING_TOO_LONG',
    reason: 'could not serialise the value: string exceeded V8 max string length',
  }));
});

test('An explicit indent option is handed to stringify so a throwing Number indent refuses the write', () => {
  const indent = new Number(4);
  indent.valueOf = () => { throw new Error('bad indent'); };
  const r = durableWriteJson(PATH, undefined, { ...OPTS, indent });
  assert.deepEqual(r, refused({
    class: 'unknown',
    errno: null,
    reason: 'could not serialise the value: bad indent',
  }));
});

test('The env option supplies the clock, so an unparseable CW_NOW throws while building the refusal', () => {
  assert.throws(
    () => durableWriteJson(PATH, undefined, { env: { CW_NOW: 'not-a-date' }, mkdir: false, max: 1 }),
    { name: 'Error', message: 'CW_NOW is not a parseable date: not-a-date' },
  );
});
