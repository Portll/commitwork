// Evidence file and receipt JSON written beside it, returning dest and receipt (bin/offbox-fetch.mjs writeEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeEvidence } from '../offbox-fetch.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'writeEvidence-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('attested true with no attestationState yields a verified receipt', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    const res = { text: 'data', repo: 'r', run: { databaseId: 1, createdAt: 'c', headSha: 's' }, attested: true };
    const r = writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-01T00:00:00.000Z') });
    assert.deepEqual(r, {
      dest,
      receipt: { fetchedAt: '2024-01-01T00:00:00.000Z', repo: 'r', runId: 1, runCreatedAt: 'c', headSha: 's', attested: true, attestationState: 'verified' },
    });
  });
});

test('attested false with undefined attestationState yields an unavailable receipt', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    const res = { text: 'x', repo: 'r2', run: { databaseId: 2, createdAt: 'c2', headSha: 's2' }, attested: false, attestationState: undefined };
    const r = writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-02T00:00:00.000Z') });
    assert.deepEqual(r, {
      dest,
      receipt: { fetchedAt: '2024-01-02T00:00:00.000Z', repo: 'r2', runId: 2, runCreatedAt: 'c2', headSha: 's2', attested: false, attestationState: 'unavailable' },
    });
  });
});

test('an explicit attestationState is kept even when attested is true', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    const res = { text: 'y', repo: 'r3', run: { databaseId: 3, createdAt: 'c3', headSha: 's3' }, attested: true, attestationState: 'pending' };
    const r = writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-03T00:00:00.000Z') });
    assert.deepEqual(r, {
      dest,
      receipt: { fetchedAt: '2024-01-03T00:00:00.000Z', repo: 'r3', runId: 3, runCreatedAt: 'c3', headSha: 's3', attested: true, attestationState: 'pending' },
    });
  });
});

test('a null attestationState falls back to verified when attested is true', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    const res = { text: 'z', repo: 'r4', run: { databaseId: 4, createdAt: 'c4', headSha: 's4' }, attested: true, attestationState: null };
    const r = writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-04T00:00:00.000Z') });
    assert.deepEqual(r.receipt, { fetchedAt: '2024-01-04T00:00:00.000Z', repo: 'r4', runId: 4, runCreatedAt: 'c4', headSha: 's4', attested: true, attestationState: 'verified' });
  });
});

test('missing nested parent directories are created and the text is written there', () => {
  withDir((dir) => {
    const dest = join(dir, 'a', 'b', 'out.json');
    const res = { text: 'nested', repo: 'rn', run: { databaseId: 5, createdAt: 'cn', headSha: 'sn' }, attested: true };
    const r = writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-05T00:00:00.000Z') });
    assert.equal(r.dest, dest);
    assert.equal(readFileSync(dest, 'utf8'), 'nested');
  });
});

test('the receipt file holds two-space indented JSON with a trailing newline', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    const res = { text: 'content', repo: 'rx', run: { databaseId: 6, createdAt: 'cx', headSha: 'sx' }, attested: false };
    writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-06T00:00:00.000Z') });
    const expected = [
      '{',
      '  "fetchedAt": "2024-01-06T00:00:00.000Z",',
      '  "repo": "rx",',
      '  "runId": 6,',
      '  "runCreatedAt": "cx",',
      '  "headSha": "sx",',
      '  "attested": false,',
      '  "attestationState": "unavailable"',
      '}',
      '',
    ].join('\n');
    assert.equal(readFileSync(join(dir, 'out.json.receipt.json'), 'utf8'), expected);
  });
});

test('an existing evidence file is replaced and no temp files remain', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    writeFileSync(dest, 'old');
    const text = 'n'.repeat(64);
    const res = { text, repo: 'ry', run: { databaseId: 7, createdAt: 'cy', headSha: 'sy' }, attested: true, attestationState: 'verified' };
    writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-07T00:00:00.000Z') });
    assert.equal(readFileSync(dest, 'utf8'), text);
    assert.equal(existsSync(`${dest}.tmp-${process.pid}`), false);
    assert.equal(existsSync(`${dest}.receipt.json.tmp-${process.pid}`), false);
  });
});

test('a result without run throws a TypeError after writing the evidence text', () => {
  withDir((dir) => {
    const dest = join(dir, 'out.json');
    const res = { text: 'partial', repo: 'rz', attested: false };
    assert.throws(() => writeEvidence(res, { env: { CW_OFFBOX_EVIDENCE: dest }, now: new Date('2024-01-08T00:00:00.000Z') }), {
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'databaseId')",
    });
    assert.equal(readFileSync(dest, 'utf8'), 'partial');
    assert.equal(existsSync(join(dir, 'out.json.receipt.json')), false);
  });
});
