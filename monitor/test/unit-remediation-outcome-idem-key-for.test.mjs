// sha256 of the (claimRef, findingKey, sliceId) triple (monitor/remediation-outcome.mjs idemKeyFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idemKeyFor } from '../remediation-outcome.mjs';

test('computes the hash for a typical triple', () => {
  const r = idemKeyFor({ claimRef: 'cr-1', findingKey: 'fk-1', sliceId: 'sl-1' });
  assert.equal(r, "f7a4e07648c41f72e779bd4d4002bda274e289a63e82faa33fb03838c4d476ba");
});

test('computes the hash when all fields are empty strings', () => {
  const r = idemKeyFor({ claimRef: '', findingKey: '', sliceId: '' });
  assert.equal(r, "2f4026022f34480dbee37782940fd6a404c910347c3b2d010039836cacea5cb8");
});

test('computes the hash when all fields are null', () => {
  const r = idemKeyFor({ claimRef: null, findingKey: null, sliceId: null });
  assert.equal(r, "576adde68ddced4a32189403e25780a72b4ed100f3fc2c1ea8ab004711cc957a");
});

test('computes the hash when all fields are undefined', () => {
  const r = idemKeyFor({ claimRef: undefined, findingKey: undefined, sliceId: undefined });
  assert.equal(r, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
});

test('computes the hash for a long repeated claimRef', () => {
  const r = idemKeyFor({ claimRef: 'x'.repeat(100), findingKey: 'fk', sliceId: 'sl' });
  assert.equal(r, "1525fadce16b3b1e6ee24bfb52f71e215b79353c299f5724ac1330b45dad1efa");
});

test('computes the hash for a long repeated findingKey', () => {
  const r = idemKeyFor({ claimRef: 'cr', findingKey: 'y'.repeat(100), sliceId: 'sl' });
  assert.equal(r, "ac2def4e3ece3e9289779b984cdb492297173fcec64390f5c230bc7cb8e462db");
});

test('computes the hash for a long repeated sliceId', () => {
  const r = idemKeyFor({ claimRef: 'cr', findingKey: 'fk', sliceId: 'z'.repeat(100) });
  assert.equal(r, "236987d0e9f0c3fa468ad455c04fbc581401a6835caf072aa76e926998b1f397");
});

test('computes the hash for numeric field values', () => {
  const r = idemKeyFor({ claimRef: 1, findingKey: 2, sliceId: 3 });
  assert.equal(r, "7ad60831db0785a02999c12cc3e80784339593bc6ad7d3b54bc40f82e45f7419");
});

test('computes the hash for boolean field values', () => {
  const r = idemKeyFor({ claimRef: true, findingKey: false, sliceId: true });
  assert.equal(r, "b24740e67d21513ad6c5b0ac522d4c13627aa4019757a985fffc21d147d2c153");
});

test('computes the hash for object field values', () => {
  const r = idemKeyFor({ claimRef: { a: 1 }, findingKey: { b: 2 }, sliceId: { c: 3 } });
  assert.equal(r, "b14671b037030ba19ecf74b42e7c420ca9e8d61f8d01f12568cf0f8b489117c5");
});
