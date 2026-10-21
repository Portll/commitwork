// history-chain.mjs — the hash-chained write log. What these tests pin, in order of consequence:
// tampering with any recorded state (edit, drop, reorder, slice-byte swap) is NAMED, a torn tail
// is detected and not built on, retro-seals stay marked as seal-time attestations, and an index
// row the chain never saw surfaces as `unrecorded` rather than blending in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GENESIS, appendChainEvent, readChain, sealHistory, verifyChain, verifySliceBytes, chainPath,
} from '../history-chain.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-chain-'));
const ev = (stamp, over = {}) => ({ at: '2026-08-29T12:00:00.000Z', op: 'slice', stamp, sliceId: `sweep-${stamp}`, source: `/tmp/sweep-${stamp}`, sliceSha256: 'a'.repeat(64), ...over });

test('append then verify: every line binds its predecessor from GENESIS', () => {
  const d = dir();
  const a = appendChainEvent(d, ev('20260829120000'));
  const b = appendChainEvent(d, ev('20260829130000', { op: 'replace' }));
  assert.equal(a.prev, GENESIS);
  assert.equal(b.prev, a.chain);
  const v = verifyChain(d, [{ stamp: '20260829120000' }, { stamp: '20260829130000' }]);
  assert.deepEqual([v.verified, v.length, v.unrecorded.length, v.brokenAt], [true, 2, 0, null]);
  rmSync(d, { recursive: true, force: true });
});

test('editing a recorded line breaks verification AT that line, by name', () => {
  const d = dir();
  appendChainEvent(d, ev('20260829120000'));
  appendChainEvent(d, ev('20260829130000'));
  const lines = readFileSync(chainPath(d), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  lines[0].sliceSha256 = 'b'.repeat(64); // the forgery: change what state 1 attested
  writeFileSync(chainPath(d), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const v = verifyChain(d, []);
  assert.equal(v.verified, false);
  assert.deepEqual(v.brokenAt, { line: 1, stamp: '20260829120000' });
  rmSync(d, { recursive: true, force: true });
});

test('dropping a line breaks the chain — the successor no longer binds', () => {
  const d = dir();
  appendChainEvent(d, ev('20260829120000'));
  appendChainEvent(d, ev('20260829130000'));
  appendChainEvent(d, ev('20260829140000'));
  const lines = readFileSync(chainPath(d), 'utf8').trim().split('\n');
  writeFileSync(chainPath(d), [lines[0], lines[2]].join('\n') + '\n'); // excise the middle state
  const v = verifyChain(d, []);
  assert.equal(v.verified, false);
  assert.equal(v.brokenAt.line, 2);
  rmSync(d, { recursive: true, force: true });
});

test('reordering lines breaks the chain even though every line is individually intact', () => {
  const d = dir();
  appendChainEvent(d, ev('20260829120000'));
  appendChainEvent(d, ev('20260829130000'));
  const lines = readFileSync(chainPath(d), 'utf8').trim().split('\n');
  writeFileSync(chainPath(d), [lines[1], lines[0]].join('\n') + '\n');
  assert.equal(verifyChain(d, []).verified, false);
  rmSync(d, { recursive: true, force: true });
});

test('a torn tail is detected, the prefix stands, and nothing appends on top of the tear', () => {
  const d = dir();
  appendChainEvent(d, ev('20260829120000'));
  appendFileSync(chainPath(d), '{"at":"2026-08-29T13:00:00.000Z","op":"sli'); // the crash mid-append
  const v = verifyChain(d, []);
  assert.deepEqual([v.tailTorn, v.verified, v.length], [true, true, 1], 'prefix verifies; the tear is reported beside it, not instead of it');
  assert.throws(() => appendChainEvent(d, ev('20260829140000')), /torn tail/, 'building on a tear would bury it');
  rmSync(d, { recursive: true, force: true });
});

test('retro-seal covers unrecorded index rows once, marks them, and claims nothing pre-seal', () => {
  const d = dir();
  writeFileSync(join(d, '20260801120000.json'), '{"stamp":"20260801120000"}');
  const idx = [
    { stamp: '20260801120000', sliceId: 'sweep-a', file: '20260801120000.json' },          // no recorded hash: sealed from bytes as found
    { stamp: '20260802120000', sliceId: 'sweep-b', file: 'gone.json', sliceSha256: 'c'.repeat(64) }, // hash recorded, file gone — seals the recorded hash
  ];
  const first = sealHistory(d, idx, '2026-08-29T12:00:00.000Z');
  assert.equal(first.sealed, 2);
  assert.equal(sealHistory(d, idx, '2026-08-29T12:01:00.000Z').sealed, 0, 'idempotent — covered rows are never resealed');
  const v = verifyChain(d, idx);
  assert.deepEqual([v.verified, v.retroSealed, v.unrecorded.length], [true, 2, 0]);
  const { events } = readChain(d);
  assert.match(events[0].note, /seal time/, 'a retro-seal says what it attests and when');
  rmSync(d, { recursive: true, force: true });
});

test('an index row the chain never saw surfaces as unrecorded — a write that dodged the log', () => {
  const d = dir();
  appendChainEvent(d, ev('20260829120000'));
  const v = verifyChain(d, [{ stamp: '20260829120000' }, { stamp: '20260830120000' }]);
  assert.deepEqual(v.unrecorded, ['20260830120000']);
  rmSync(d, { recursive: true, force: true });
});

test('verifySliceBytes: match, mismatch (file changed after recording), and no-hash are three states', () => {
  const d = dir();
  const body = '{"stamp":"x"}';
  writeFileSync(join(d, 'x.json'), body);
  const good = createHash('sha256').update(body).digest('hex');
  assert.equal(verifySliceBytes(d, 'x.json', good).match, true);
  const bad = verifySliceBytes(d, 'x.json', 'd'.repeat(64));
  assert.deepEqual([bad.checked, bad.match], [true, false]);
  assert.match(bad.why, /changed after it was recorded/);
  const none = verifySliceBytes(d, 'x.json', null);
  assert.deepEqual([none.checked, none.match], [false, null], 'no attested hash is unchecked, never a pass');
  rmSync(d, { recursive: true, force: true });
});

test('stripping the attribution off a newer line is tamper; its absence on old lines is history', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906120000', { by: 'session-abc' }));
  const p = chainPath(d);
  const line = JSON.parse(readFileSync(p, 'utf8').trim());
  assert.equal(line.by, 'session-abc', 'new lines always carry who');
  assert.equal(verifyChain(d, []).verified, true);
  delete line.by; // the forgery: disown the write
  writeFileSync(p, JSON.stringify(line) + '\n');
  assert.equal(verifyChain(d, []).verified, false, 'attribution is hashed when present — deleting it breaks the line');
  rmSync(d, { recursive: true, force: true });
});

test('the chain deadman: lastEventAt + staleDays are computed on every verdict', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906120000'));
  const v = verifyChain(d, [], { now: Date.parse('2026-09-16T12:00:00.000Z') });
  assert.equal(v.lastEventAt, '2026-08-29T12:00:00.000Z');
  assert.equal(v.staleDays, 18, 'a chain that stopped moving is a detected state, not an inferred one');
  rmSync(d, { recursive: true, force: true });
});
