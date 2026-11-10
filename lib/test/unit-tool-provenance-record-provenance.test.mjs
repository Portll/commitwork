// The provenance entry recorded for one tool and saved to the JSON store (lib/tool-provenance.mjs recordProvenance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordProvenance } from '../tool-provenance.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'recordProvenance-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function emptyStore(dir) {
  const path = join(dir, 'store.json');
  writeFileSync(path, JSON.stringify({ tools: {} }));
  return path;
}

test('A release with a cosign signature tier is recorded on the release/cosign channel', () => {
  withDir((dir) => {
    const path = emptyStore(dir);
    const r = recordProvenance('tool-a', { via: 'release', signatureTier: 'cosign', now: '2024-01-01T00:00:00.000Z' }, path);
    assert.deepEqual(r, { channel: 'release/cosign', via: 'release', signatureTier: 'cosign', at: '2024-01-01T00:00:00.000Z' });
  });
});

test('A release with a sha256 signature tier is recorded on the release/sha256 channel', () => {
  withDir((dir) => {
    const path = emptyStore(dir);
    const r = recordProvenance('tool-b', { via: 'release', signatureTier: 'sha256', now: '2024-01-02T00:00:00.000Z' }, path);
    assert.deepEqual(r, { channel: 'release/sha256', via: 'release', signatureTier: 'sha256', at: '2024-01-02T00:00:00.000Z' });
  });
});

test('A release without a signature tier falls back to release/sha256 and leaves signatureTier out', () => {
  withDir((dir) => {
    const path = emptyStore(dir);
    const r = recordProvenance('tool-c', { via: 'release', now: '2024-01-03T00:00:00.000Z' }, path);
    assert.deepEqual(r, { channel: 'release/sha256', via: 'release', at: '2024-01-03T00:00:00.000Z' });
  });
});

test('A non-release channel uses via as the channel and keeps a detail string', () => {
  withDir((dir) => {
    const path = emptyStore(dir);
    const r = recordProvenance('tool-d', { via: 'brew', detail: 'v1.2.3', now: '2024-01-04T00:00:00.000Z' }, path);
    assert.deepEqual(r, { channel: 'brew', via: 'brew', detail: 'v1.2.3', at: '2024-01-04T00:00:00.000Z' });
  });
});

test('An empty detail string and an empty signature tier are left out of the entry', () => {
  withDir((dir) => {
    const path = emptyStore(dir);
    const r = recordProvenance('tool-e', { via: 'git', signatureTier: '', detail: '', now: '2024-01-05T00:00:00.000Z' }, path);
    assert.deepEqual(r, { channel: 'git', via: 'git', at: '2024-01-05T00:00:00.000Z' });
  });
});

test('The store is written as two-space JSON with a trailing newline and no temp file is left', () => {
  withDir((dir) => {
    const path = emptyStore(dir);
    recordProvenance('tool-f', { via: 'git', now: '2024-01-06T00:00:00.000Z' }, path);
    const expected = { tools: { 'tool-f': { channel: 'git', via: 'git', at: '2024-01-06T00:00:00.000Z' } } };
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify(expected, null, 2)}\n`);
    assert.deepEqual(readdirSync(dir), ['store.json']);
  });
});

test('A missing store under missing directories is created with its parent directories', () => {
  withDir((dir) => {
    const path = join(dir, 'nested', 'deep', 'store.json');
    const r = recordProvenance('tool-g', { via: 'release', signatureTier: 'cosign', now: '2024-01-07T00:00:00.000Z' }, path);
    const entry = { channel: 'release/cosign', via: 'release', signatureTier: 'cosign', at: '2024-01-07T00:00:00.000Z' };
    assert.deepEqual(r, entry);
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify({ tools: { 'tool-g': entry } }, null, 2)}\n`);
  });
});

test('Existing tools are kept and a tool with the same name is overwritten in place', () => {
  withDir((dir) => {
    const path = join(dir, 'store.json');
    const keep = { channel: 'git', via: 'git', at: '2023-01-01T00:00:00.000Z' };
    writeFileSync(path, JSON.stringify({ tools: { keep, 'tool-h': { channel: 'git', via: 'git', at: '2023-06-01T00:00:00.000Z' } } }));
    const r = recordProvenance('tool-h', { via: 'release', signatureTier: 'cosign', now: '2024-01-08T00:00:00.000Z' }, path);
    const entry = { channel: 'release/cosign', via: 'release', signatureTier: 'cosign', at: '2024-01-08T00:00:00.000Z' };
    assert.deepEqual(r, entry);
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify({ tools: { keep, 'tool-h': entry } }, null, 2)}\n`);
  });
});

test('The timestamp comes from CW_NOW in the environment when now is omitted', () => {
  const prev = process.env.CW_NOW;
  process.env.CW_NOW = '2025-05-05T05:05:05.000Z';
  try {
    withDir((dir) => {
      const path = emptyStore(dir);
      const r = recordProvenance('tool-i', { via: 'npm' }, path);
      assert.deepEqual(r, { channel: 'npm', via: 'npm', at: '2025-05-05T05:05:05.000Z' });
    });
  } finally {
    if (prev === undefined) delete process.env.CW_NOW;
    else process.env.CW_NOW = prev;
  }
});

test('A file that is not a provenance store throws an error naming the path', () => {
  withDir((dir) => {
    const path = join(dir, 'store.json');
    writeFileSync(path, JSON.stringify({ items: [] }));
    assert.throws(() => recordProvenance('tool-j', { via: 'git', now: '2024-01-09T00:00:00.000Z' }, path), { name: 'Error', message: `${path}: not a provenance store` });
    writeFileSync(path, JSON.stringify({ tools: 'text' }));
    assert.throws(() => recordProvenance('tool-j', { via: 'git', now: '2024-01-09T00:00:00.000Z' }, path), { name: 'Error', message: `${path}: not a provenance store` });
    writeFileSync(path, 'null');
    assert.throws(() => recordProvenance('tool-j', { via: 'git', now: '2024-01-09T00:00:00.000Z' }, path), { name: 'Error', message: `${path}: not a provenance store` });
  });
});
