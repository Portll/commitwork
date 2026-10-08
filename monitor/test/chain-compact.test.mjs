// chain-compact.mjs — checkpoint rotation. What is pinned, in order of consequence: a rotated
// chain verifies END-TO-END through its checkpoint (and names an altered archive); an unverified
// chain is REFUSED rotation (rotating it would launder the evidence); an unconfigured sweeper
// sweeps nothing, loudly; and rotation is never truncation — every archived byte survives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactChain } from '../chain-compact.mjs';
import { appendChainEvent, readChain, verifyChain, CHAIN_FILE } from '../history-chain.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-chaincompact-'));
const ev = (stamp) => ({ at: '2026-09-06T02:00:00.000Z', op: 'slice', stamp, sliceId: `sweep-${stamp}`, source: `/tmp/sweep-${stamp}`, sliceSha256: 'a'.repeat(64), by: 'test' });
const NOW = '2026-09-06T03:00:00.000Z';

test('no configured maximum sweeps nothing, loudly', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906010000'));
  const r = compactChain(d, { nowISO: NOW });
  assert.equal(r.rotated, false);
  assert.match(r.reason, /no chainMaxBytes configured/);
  rmSync(d, { recursive: true, force: true });
});

test('under the maximum is a reported skip, never a silent one', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906010000'));
  const r = compactChain(d, { maxBytes: 1e9, nowISO: NOW });
  assert.equal(r.rotated, false);
  assert.match(r.reason, /under the maximum/);
  rmSync(d, { recursive: true, force: true });
});

test('rotation archives whole, opens with a checkpoint, and the chain verifies through it', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906010000'));
  appendChainEvent(d, ev('20260906020000'));
  const preBytes = statSync(join(d, CHAIN_FILE)).size;
  const r = compactChain(d, { maxBytes: 1, nowISO: NOW });
  assert.equal(r.rotated, true);
  assert.equal(r.length, 2, 'both events archived');
  // never truncation: the archive holds every pre-rotation byte
  assert.equal(statSync(join(d, r.archive)).size, preBytes);
  const { events } = readChain(d);
  assert.equal(events.length, 1);
  assert.equal(events[0].op, 'checkpoint');
  const v = verifyChain(d, []);
  assert.equal(v.verified, true, 'a rotated chain verifies end-to-end');
  assert.equal(v.checkpoint.segmentVerified, true, 'the archived tip re-checks against the checkpoint');
  // and the chain keeps growing normally after rotation
  appendChainEvent(d, ev('20260906030000'));
  assert.equal(verifyChain(d, []).verified, true);
  rmSync(d, { recursive: true, force: true });
});

test('altering the archive after rotation is NAMED — the checkpoint remembers its tip', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906010000'));
  const r = compactChain(d, { maxBytes: 1, nowISO: NOW });
  const seg = join(d, r.archive);
  const lines = readFileSync(seg, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  lines[0].sliceSha256 = 'b'.repeat(64);
  writeFileSync(seg, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const v = verifyChain(d, []);
  assert.equal(v.verified, false);
  assert.equal(v.checkpoint.segmentVerified, false);
  assert.match(v.checkpoint.segmentWhy, /altered after rotation/);
  rmSync(d, { recursive: true, force: true });
});

test('an unverified chain is REFUSED rotation — the broken state stays in place, named', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906010000'));
  appendChainEvent(d, ev('20260906020000'));
  const p = join(d, CHAIN_FILE);
  const lines = readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  lines[0].sliceSha256 = 'c'.repeat(64); // the forgery
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = compactChain(d, { maxBytes: 1, nowISO: NOW });
  assert.equal(r.rotated, false);
  assert.match(r.reason, /REFUSED/);
  assert.match(r.reason, /launder/);
  assert.ok(existsSync(p), 'the broken chain was not moved');
  assert.ok(!existsSync(join(d, 'chain.20260906030000.jsonl')), 'no archive was minted');
  rmSync(d, { recursive: true, force: true });
});

test('a second rotation at the same pinned clock refuses to overwrite the prior archive', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906010000'));
  compactChain(d, { maxBytes: 1, nowISO: NOW });
  appendChainEvent(d, ev('20260906020000'));
  appendChainEvent(d, ev('20260906030000'));
  const r = compactChain(d, { maxBytes: 1, nowISO: NOW });
  assert.equal(r.rotated, false);
  assert.match(r.reason, /already exists/);
  rmSync(d, { recursive: true, force: true });
});
