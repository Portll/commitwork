// Rotates a verified chain log into a timestamped archive when it exceeds a byte limit (monitor/chain-compact.mjs compactChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactChain } from '../chain-compact.mjs';
import { appendChainEvent, CHAIN_FILE, anchorableOut, appendAnchor } from '../history-chain.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createValidChain(dir) {
  const event = {
    at: '2024-01-01T00:00:00.000Z',
    op: 'slice',
    source: 'test',
    prevTip: null,
    by: 'test',
    note: 'initial event'
  };
  appendChainEvent(dir, event);
  fs.writeFileSync(path.join(dir, 'index.json'), '[]');
}

test('returns no sweep when the chain log is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    const result = compactChain(dir, { maxBytes: 100, nowISO: '2024-01-01T00:00:00.000Z' });
    assert.deepEqual(result, { rotated: false, reason: 'no chain log \u2014 nothing to sweep', sizeBytes: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no sweep when maxBytes is zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const result = compactChain(dir, { maxBytes: 0, nowISO: '2024-01-01T00:00:00.000Z' });
    assert.deepEqual(result, {
      rotated: false,
      reason: 'no chainMaxBytes configured \u2014 set retention.chainMaxBytes in monitor/projects.json (or pass --max-bytes); an unconfigured sweeper sweeps nothing',
      sizeBytes: size
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no sweep when maxBytes is undefined', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const result = compactChain(dir, { nowISO: '2024-01-01T00:00:00.000Z' });
    assert.deepEqual(result, {
      rotated: false,
      reason: 'no chainMaxBytes configured \u2014 set retention.chainMaxBytes in monitor/projects.json (or pass --max-bytes); an unconfigured sweeper sweeps nothing',
      sizeBytes: size
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no sweep when the chain is under the maximum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const maxBytes = size + 100;
    const result = compactChain(dir, { maxBytes, nowISO: '2024-01-01T00:00:00.000Z' });
    assert.deepEqual(result, {
      rotated: false,
      reason: `under the maximum (${size}B \u2264 ${maxBytes}B)`,
      sizeBytes: size
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no sweep when the chain size equals the maximum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const result = compactChain(dir, { maxBytes: size, nowISO: '2024-01-01T00:00:00.000Z' });
    assert.deepEqual(result, {
      rotated: false,
      reason: `under the maximum (${size}B \u2264 ${size}B)`,
      sizeBytes: size
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no sweep when the chain does not verify', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    fs.writeFileSync(path.join(dir, CHAIN_FILE), 'garbage');
    fs.writeFileSync(path.join(dir, 'index.json'), '[]');
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const result = compactChain(dir, { maxBytes: 1, nowISO: '2024-01-01T00:00:00.000Z' });
    assert.deepEqual(result, {
      rotated: false,
      sizeBytes: size,
      reason: 'REFUSED \u2014 the chain does not verify (torn tail); rotating it would launder the evidence into an archive. Fix or explain the break first.'
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no sweep when the archive already exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const nowISO = '2024-01-01T00:00:00.000Z';
    const stamp = nowISO.replace(/[-:TZ.]/g, '').slice(0, 14);
    const archive = `chain.${stamp}.jsonl`;
    fs.writeFileSync(path.join(dir, archive), 'old');
    const result = compactChain(dir, { maxBytes: 1, nowISO });
    assert.deepEqual(result, {
      rotated: false,
      sizeBytes: size,
      reason: `archive ${archive} already exists \u2014 refusing to overwrite a prior rotation`
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rotates the chain and appends a checkpoint event with correct prevTip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const { events } = await import('../history-chain.mjs').then(m => m.readChain(dir));
    const expectedTip = events[events.length - 1].chain;
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const nowISO = '2024-01-01T00:00:00.000Z';
    const stamp = nowISO.replace(/[-:TZ.]/g, '').slice(0, 14);
    const expectedArchive = `chain.${stamp}.jsonl`;
    const result = compactChain(dir, { maxBytes: 1, nowISO });
    const { events: newEvents } = await import('../history-chain.mjs').then(m => m.readChain(dir));
    const checkpoint = newEvents[newEvents.length - 1];
    assert.equal(checkpoint.prevTip, undefined);
    assert.deepEqual(result, {
      rotated: true,
      archive: expectedArchive,
      sizeBytes: size,
      length: events.length,
      anchored: false,
      anchorWhy: null,
      reason: null
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uses provided nowISO for archive timestamp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const nowISO = '2024-06-15T12:34:56.789Z';
    const stamp = nowISO.replace(/[-:TZ.]/g, '').slice(0, 14);
    const expectedArchive = `chain.${stamp}.jsonl`;
    const result = compactChain(dir, { maxBytes: 1, nowISO });
    assert.deepEqual(result, {
      rotated: true,
      archive: expectedArchive,
      sizeBytes: size,
      length: 1,
      anchored: false,
      anchorWhy: null,
      reason: null
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uses provided by in checkpoint event', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compactChain-'));
  try {
    createValidChain(dir);
    const size = fs.statSync(path.join(dir, CHAIN_FILE)).size;
    const nowISO = '2024-01-01T00:00:00.000Z';
    const stamp = nowISO.replace(/[-:TZ.]/g, '').slice(0, 14);
    const expectedArchive = `chain.${stamp}.jsonl`;
    const result = compactChain(dir, { maxBytes: 1, nowISO, by: 'custom-agent' });
    const { events } = await import('../history-chain.mjs').then(m => m.readChain(dir));
    const checkpoint = events[events.length - 1];
    assert.equal(checkpoint.by, 'custom-agent');
    assert.deepEqual(result, {
      rotated: true,
      archive: expectedArchive,
      sizeBytes: size,
      length: 1,
      anchored: false,
      anchorWhy: null,
      reason: null
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
