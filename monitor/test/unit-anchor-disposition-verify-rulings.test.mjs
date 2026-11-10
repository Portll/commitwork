// Verifies hash chain and content integrity of rulings (monitor/anchor-disposition.mjs verifyRulings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRulings } from '../anchor-disposition.mjs';
import { createHash } from 'node:crypto';

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const stable = (o) => JSON.stringify(o, Object.keys(o).sort());

const mkRuling = (anchor, prevHash, hash) => {
  const content = { anchor, disposition: 'ok', evidenceDigest: 'sha256:abc', by: 'alice', reason: 'fine', at: '2024-01-01' };
  const expect = sha256hex(`${prevHash || ''}|${stable(content)}`);
  return { anchor, prevHash, hash: hash ?? expect, disposition: 'ok', evidenceDigest: 'sha256:abc', by: 'alice', reason: 'fine', at: '2024-01-01' };
};

test('returns empty array when doc has no rulings property', () => {
  assert.deepEqual(verifyRulings({}), []);
});

test('returns empty array when rulings is an empty list', () => {
  assert.deepEqual(verifyRulings({ rulings: [] }), []);
});

test('returns empty array for a single valid ruling with null prevHash', () => {
  const r = mkRuling('a1', null);
  assert.deepEqual(verifyRulings({ rulings: [r] }), []);
});

test('returns empty array for two chained valid rulings', () => {
  const r0 = mkRuling('a1', null);
  const r1 = mkRuling('a2', r0.hash);
  assert.deepEqual(verifyRulings({ rulings: [r0, r1] }), []);
});

test('reports prevHash chain break when second ruling prevHash does not match first hash', () => {
  const r0 = mkRuling('a1', null);
  const r1 = mkRuling('a2', 'wrong-prev');
  assert.deepEqual(verifyRulings({ rulings: [r0, r1] }), ["ruling 1 (a2): prevHash does not chain"]);
});

test('reports hash mismatch when ruling hash does not match its content', () => {
  const r = mkRuling('a1', null, 'bad-hash');
  assert.deepEqual(verifyRulings({ rulings: [r] }), ["ruling 0 (a1): hash does not match its content"]);
});

test('reports both chain break and hash mismatch for a corrupted second ruling', () => {
  const r0 = mkRuling('a1', null);
  const r1 = mkRuling('a2', 'wrong-prev', 'bad-hash');
  assert.deepEqual(verifyRulings({ rulings: [r0, r1] }), ["ruling 1 (a2): prevHash does not chain", "ruling 1 (a2): hash does not match its content"]);
});

test('handles a ruling with empty string prevHash in a two-ruling chain', () => {
  const r0 = mkRuling('a1', null);
  const r1 = mkRuling('a2', '');
  assert.deepEqual(verifyRulings({ rulings: [r0, r1] }), ["ruling 1 (a2): prevHash does not chain"]);
});
