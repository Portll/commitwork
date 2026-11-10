// Verifies a refutation hash chain and writes it only when intact (monitor/refutation.mjs saveRefutations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveRefutations } from '../refutation.mjs';

const target = '/tmp/ref.json';

const guarded = (fields) => ({
  ...fields,
  get stop() {
    throw new RangeError('reached the writer');
  },
});

test('an empty events array passes verification and reaches the writer', () => {
  assert.throws(() => saveRefutations(target, guarded({ events: [] })), {
    name: 'RangeError',
    message: 'reached the writer',
  });
});

test('a document with no events key passes verification and reaches the writer', () => {
  assert.throws(() => saveRefutations(target, guarded({})), {
    name: 'RangeError',
    message: 'reached the writer',
  });
});

test('a first event whose prevHash is not null is refused before the writer', () => {
  const doc = guarded({ events: [{ prevHash: 'wrong', hash: 'h1' }] });
  assert.throws(() => saveRefutations(target, doc), {
    name: 'Error',
    message: 'refusing to save a broken refutation chain: #0 prevHash does not match the preceding event',
  });
});

test('a first event with an undefined prevHash is refused because null is compared strictly', () => {
  const doc = guarded({ events: [{ hash: 'h1' }] });
  assert.throws(() => saveRefutations(target, doc), {
    name: 'Error',
    message: 'refusing to save a broken refutation chain: #0 prevHash does not match the preceding event',
  });
});

test('a first event with a null prevHash and a wrong hash is refused for its hash', () => {
  const doc = guarded({ events: [{ prevHash: null, hash: 'bad' }] });
  assert.throws(() => saveRefutations(target, doc), {
    name: 'Error',
    message: 'refusing to save a broken refutation chain: #0 hash does not match the event body',
  });
});

test('two linked events with wrong hashes are both reported', () => {
  const doc = guarded({ events: [{ prevHash: null, hash: 'h1' }, { prevHash: 'h1', hash: 'h2' }] });
  assert.throws(() => saveRefutations(target, doc), {
    name: 'Error',
    message: 'refusing to save a broken refutation chain: #0 hash does not match the event body; #1 hash does not match the event body',
  });
});

test('a second event that does not link to the first is reported after the first hash failure', () => {
  const doc = guarded({ events: [{ prevHash: null, hash: 'h1' }, { prevHash: 'wrong', hash: 'h2' }] });
  assert.throws(() => saveRefutations(target, doc), {
    name: 'Error',
    message: 'refusing to save a broken refutation chain: #0 hash does not match the event body; #1 prevHash does not match the preceding event',
  });
});

test('two events with broken links are joined with a semicolon', () => {
  const doc = guarded({ events: [{ prevHash: 'wrong', hash: 'bad' }, { prevHash: 'wrong2', hash: 'bad2' }] });
  assert.throws(() => saveRefutations(target, doc), {
    name: 'Error',
    message: 'refusing to save a broken refutation chain: #0 prevHash does not match the preceding event; #1 prevHash does not match the preceding event',
  });
});
