// Computes a capped, hash-verified timeline slice summary with three-state verification (admin/lib/served-projection.mjs projectTimelineVerify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTimelineVerify } from '../lib/served-projection.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('returns no-history when index.json is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const r = projectTimelineVerify(dir);
    assert.deepEqual(r, { state: 'no-history' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with parse detail when index.json is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    writeFileSync(join(dir, 'index.json'), 'not-json');
    const r = projectTimelineVerify(dir);
    assert.deepEqual(r, { state: 'unreadable', detail: 'parse' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with not-an-array when index.json is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    writeFileSync(join(dir, 'index.json'), '{"a":1}');
    const r = projectTimelineVerify(dir);
    assert.deepEqual(r, { state: 'unreadable', detail: 'not-an-array' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no-history when index.json is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    writeFileSync(join(dir, 'index.json'), '[]');
    const r = projectTimelineVerify(dir);
    assert.deepEqual(r, { state: 'no-history' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks slice as unverified-legacy when sliceSha256 is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const entry = { sliceId: 's1', stamp: 't1', generated: 'g1', file: 'f1.json' };
    writeFileSync(join(dir, 'index.json'), JSON.stringify([entry]));
    writeFileSync(join(dir, 'f1.json'), 'data');
    const r = projectTimelineVerify(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.window, 1);
    assert.equal(r.total, 1);
    assert.deepEqual(r.counts, { verified: 0, 'unverified-legacy': 1, unreadable: 0 });
    assert.equal(r.slices[0].verify, 'unverified-legacy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks slice as verified when sha256 matches file content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const content = Buffer.from('hello');
    const h = sha(content);
    const entry = { sliceId: 's1', stamp: 't1', generated: 'g1', file: 'f1.json', sliceSha256: h };
    writeFileSync(join(dir, 'index.json'), JSON.stringify([entry]));
    writeFileSync(join(dir, 'f1.json'), content);
    const r = projectTimelineVerify(dir);
    assert.equal(r.state, 'ok');
    assert.equal(r.slices[0].verify, 'verified');
    assert.equal(r.counts.verified, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks slice as unreadable with sha256-mismatch when hash differs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const content = Buffer.from('hello');
    const wrongHash = 'a'.repeat(64);
    const entry = { sliceId: 's1', stamp: 't1', generated: 'g1', file: 'f1.json', sliceSha256: wrongHash };
    writeFileSync(join(dir, 'index.json'), JSON.stringify([entry]));
    writeFileSync(join(dir, 'f1.json'), content);
    const r = projectTimelineVerify(dir);
    assert.equal(r.slices[0].verify, 'unreadable');
    assert.equal(r.slices[0].detail, 'sha256-mismatch');
    assert.equal(r.counts.unreadable, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks slice as unreadable with ENOENT when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const content = Buffer.from('hello');
    const h = sha(content);
    const entry = { sliceId: 's1', stamp: 't1', generated: 'g1', file: 'missing.json', sliceSha256: h };
    writeFileSync(join(dir, 'index.json'), JSON.stringify([entry]));
    const r = projectTimelineVerify(dir);
    assert.equal(r.slices[0].verify, 'unreadable');
    assert.equal(r.slices[0].detail, 'ENOENT');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('caps window to 20 entries when index has more', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      sliceId: `s${i}`, stamp: `t${i}`, generated: `g${i}`, file: `f${i}.json`
    }));
    writeFileSync(join(dir, 'index.json'), JSON.stringify(entries));
    for (let i = 0; i < 25; i++) writeFileSync(join(dir, `f${i}.json`), Buffer.alloc(1, 0));
    const r = projectTimelineVerify(dir);
    assert.equal(r.window, 20);
    assert.equal(r.total, 25);
    assert.equal(r.slices.length, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses stamp as filename when file field is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectTimelineVerify-'));
  try {
    const content = Buffer.from('x');
    const h = sha(content);
    const entry = { sliceId: 's1', stamp: 'mystamp', generated: 'g1', sliceSha256: h };
    writeFileSync(join(dir, 'index.json'), JSON.stringify([entry]));
    writeFileSync(join(dir, 'mystamp.json'), content);
    const r = projectTimelineVerify(dir);
    assert.equal(r.slices[0].verify, 'verified');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
