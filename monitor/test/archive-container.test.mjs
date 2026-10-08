// node --test monitor/test/ — the archive container. This format may become the ONLY copy of 19 GB
// of evidence, so every test here is a way the archive could be silently wrong rather than loudly
// broken: a truncation that still authenticates, a frame reordered, a wrong key that half-works.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  packEntries, unpackEntries, sealArchive, openArchive, sha256,
  MAGIC, VERSION, HEADER_LEN, IV_LEN, TAG_LEN, KEY_LEN,
} from '../archive-container.mjs';

const KEY = Buffer.alloc(KEY_LEN, 7);
const entries = (n = 3) => Array.from({ length: n }, (_, i) => ({
  path: `sweep-2026-a/repo-${i}/gitleaks.json`,
  data: Buffer.from(JSON.stringify({ RuleID: 'generic', Secret: `SYNTHETIC-NOT-A-REAL-SECRET-${i}`, File: 'x.js' })),
}));

describe('the plaintext container', () => {
  test('round-trips entries byte-for-byte, in order', () => {
    const e = entries(4);
    const got = unpackEntries(packEntries(e));
    assert.equal(got.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(got[i].path, e[i].path);
      assert.ok(got[i].data.equals(e[i].data));
    }
  });

  test('packing is DETERMINISTIC — same entries, byte-identical container', () => {
    assert.ok(packEntries(entries(3)).equals(packEntries(entries(3))));
  });

  test('a flipped payload byte is caught by the entry hash, not left to the caller', () => {
    const buf = packEntries(entries(2));
    const i = buf.length - 5;
    buf[i] = buf[i] ^ 0xff;
    assert.throws(() => unpackEntries(buf), /failed its own hash/);
  });

  test('a truncated container names where it ran out rather than returning what it got', () => {
    const buf = packEntries(entries(3));
    assert.throws(() => unpackEntries(buf.subarray(0, buf.length - 20)), /truncated/);
  });

  test('an empty entry set is legal and round-trips', () => {
    assert.deepEqual(unpackEntries(packEntries([])), []);
  });
});

describe('seal / open', () => {
  test('round-trips through compression and encryption', () => {
    const plain = packEntries(entries(5));
    const { buf, frames } = sealArchive(plain, KEY);
    assert.ok(frames >= 1);
    const { plaintext } = openArchive(buf, KEY, { expectFrames: frames });
    assert.ok(plaintext.equals(plain));
  });

  test('the ciphertext is NOT deterministic — a fixed IV under one key would be the bug', () => {
    const plain = packEntries(entries(2));
    assert.equal(sealArchive(plain, KEY).buf.equals(sealArchive(plain, KEY).buf), false);
  });

  test('a wrong key fails cleanly — no partial plaintext escapes', () => {
    const { buf } = sealArchive(packEntries(entries(2)), KEY);
    assert.throws(() => openArchive(buf, Buffer.alloc(KEY_LEN, 9)), /failed authentication/);
  });

  test('compresses hard — the whole point is that SARIF-shaped JSON is redundant', () => {
    const rep = Buffer.from(JSON.stringify({ runs: [{ results: Array.from({ length: 400 }, () => ({ ruleId: 'js/x', message: { text: 'same finding repeated' } })) }] }));
    const plain = packEntries([{ path: 'a.sarif', data: rep }]);
    const { buf } = sealArchive(plain, KEY);
    assert.ok(buf.length < plain.length / 8, `expected >8x, got ${(plain.length / buf.length).toFixed(1)}x`);
  });
});

describe('THE COMPOUND-CRITICAL PATH — a truncated archive must never authenticate', () => {
  // Breakers finding: per-frame tags alone are not enough. Drop the trailing frames and every
  // surviving frame still verifies on its own, so a short archive reads as a complete one, a
  // verify passes it, and a human deletes the source.
  const big = packEntries(Array.from({ length: 40 }, (_, i) => ({
    path: `b/${i}.sarif`,
    data: randomBytes(300_000), // incompressible, to force real multi-frame output
  })));

  test('the fixture actually spans multiple frames — otherwise this suite proves nothing', () => {
    const { frames } = sealArchive(big, KEY, { frameBytes: 1 << 20 });
    assert.ok(frames > 1, `fixture produced ${frames} frame(s); the truncation tests need >1`);
  });

  test('dropping the final frame is DETECTED (the case a per-frame tag cannot catch)', () => {
    const { buf, frames } = sealArchive(big, KEY, { frameBytes: 1 << 20 });
    assert.ok(frames > 1);
    // Cut one whole trailing frame off. Every remaining frame is individually intact and would
    // pass a naive reader that only checks tags.
    let off = HEADER_LEN;
    const bounds = [];
    for (let i = 0; i < frames; i++) {
      const start = off;
      off += IV_LEN;
      const len = buf.readUInt32BE(off); off += 4 + len + TAG_LEN;
      bounds.push([start, off]);
    }
    const short = buf.subarray(0, bounds[frames - 2][1]);
    assert.throws(() => openArchive(short, KEY), /TRUNCATED|no final frame/);
  });

  test('a frame count that disagrees with the manifest is refused', () => {
    const { buf, frames } = sealArchive(big, KEY, { frameBytes: 1 << 20 });
    assert.throws(() => openArchive(buf, KEY, { expectFrames: frames + 1 }), /frame count/);
  });

  test('appending after the final frame is refused', () => {
    const { buf } = sealArchive(packEntries(entries(2)), KEY, { frameBytes: 1 << 20 });
    assert.throws(() => openArchive(Buffer.concat([buf, randomBytes(64)]), KEY), /after the final frame|truncated/);
  });

  test('reordering two frames is refused — the index is authenticated', () => {
    const { buf, frames } = sealArchive(big, KEY, { frameBytes: 1 << 20 });
    assert.ok(frames > 2);
    let off = HEADER_LEN;
    const parts = [];
    for (let i = 0; i < frames; i++) {
      const start = off;
      off += IV_LEN;
      const len = buf.readUInt32BE(off); off += 4 + len + TAG_LEN;
      parts.push(buf.subarray(start, off));
    }
    [parts[0], parts[1]] = [parts[1], parts[0]];
    assert.throws(() => openArchive(Buffer.concat([buf.subarray(0, HEADER_LEN), ...parts]), KEY), /failed authentication/);
  });
});

describe('header and version refusals', () => {
  test('a foreign file is not mistaken for an archive', () => {
    assert.throws(() => openArchive(Buffer.from('this is not an archive at all'), KEY), /bad magic/);
  });

  test('an UNKNOWN version is refused, never guessed at', () => {
    const { buf } = sealArchive(packEntries(entries(1)), KEY);
    const bent = Buffer.from(buf);
    bent.writeUInt8(VERSION + 1, MAGIC.length);
    assert.throws(() => openArchive(bent, KEY), /not readable by this build/);
  });

  test('a key of the wrong length is refused before any work happens', () => {
    assert.throws(() => sealArchive(Buffer.from('x'), Buffer.alloc(16)), /32 raw bytes/);
    assert.throws(() => openArchive(Buffer.alloc(64), Buffer.alloc(16)), /32 raw bytes/);
  });

  test('a tampered archiveId breaks authentication — the id is bound into every frame', () => {
    const { buf } = sealArchive(packEntries(entries(2)), KEY);
    const bent = Buffer.from(buf);
    bent[MAGIC.length + 3] = bent[MAGIC.length + 3] ^ 0xff;
    assert.throws(() => openArchive(bent, KEY), /failed authentication/);
  });
});
