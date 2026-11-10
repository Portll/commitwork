// canonical hash of a chain entry (cra/lib.mjs chainHash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainHash } from '../lib.mjs';

test('uses genesis when prevHash is undefined', () => {
  const r = chainHash(undefined, { event: 'start' });
  assert.equal(r, "8e33fd257f9a6bf8fe8283c76e2c4dc02da90ce65409bee66646f9fbd5d6351d");
});

test('uses provided prevHash when it is a non\u2011empty string', () => {
  const r = chainHash('abc123', { event: 'continue' });
  assert.equal(r, "16e36ee59798cbf400e3133147175a7857767b3428110e078a7b5c857d3ee017");
});

test('stableStringify treats undefined as null in arrays', () => {
  const r = chainHash('genesis', { data: [undefined, 42] });
  assert.equal(r, "d1d4e7fefd5ef2ff6c48c14757928430c016c9e5e026f976b20742ee86831eda");
});

test('stableStringify omits undefined object properties', () => {
  const r = chainHash('genesis', { a: 1, b: undefined, c: null });
  assert.equal(r, "cb44f0a64323c02ddc7e41b6479aeab63144bee594b031b6421b64893a214ca8");
});

test('stableStringify sorts object keys', () => {
  const r = chainHash('genesis', { b: 2, a: 1 });
  assert.equal(r, "9fdc68f1e7fa2a21e17568aebcabaea44664ea600a6460512e9123bc07ddefd6");
});
