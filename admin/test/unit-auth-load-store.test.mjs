// Reads the auth store file, failing closed on any error except a genuinely absent path (admin/auth.mjs loadStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore } from '../auth.mjs';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadStore-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('returns empty store when file is absent', () => {
  withStore((dir) => {
    const p = join(dir, 'nope.json');
    const s = loadStore(p);
    assert.deepEqual(s, { version: 1, users: [], settings: { allowExternalSso: false } });
  });
});

test('returns parsed object with users array', () => {
  withStore((dir) => {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ version: 1, users: [{ id: 1 }], settings: { allowExternalSso: true } }));
    const s = loadStore(p);
    assert.equal(s.users.length, 1);
    assert.equal(s.users[0].id, 1);
    assert.equal(s.settings.allowExternalSso, true);
  });
});

test('throws when file contains invalid JSON', () => {
  withStore((dir) => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    assert.throws(() => loadStore(p), /not valid JSON/);
  });
});

test('throws when parsed value is an array', () => {
  withStore((dir) => {
    const p = join(dir, 'arr.json');
    writeFileSync(p, '[1,2,3]');
    assert.throws(() => loadStore(p), /not an object/);
  });
});

test('throws when parsed value is null', () => {
  withStore((dir) => {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.throws(() => loadStore(p), /not an object/);
  });
});

test('throws when users is not an array', () => {
  withStore((dir) => {
    const p = join(dir, 'noUsers.json');
    writeFileSync(p, JSON.stringify({ version: 1, users: 'oops' }));
    assert.throws(() => loadStore(p), /no users array/);
  });
});

test('throws when users key is missing', () => {
  withStore((dir) => {
    const p = join(dir, 'missingUsers.json');
    writeFileSync(p, JSON.stringify({ version: 1 }));
    assert.throws(() => loadStore(p), /no users array/);
  });
});

test('defaults settings to allowExternalSso false when missing', () => {
  withStore((dir) => {
    const p = join(dir, 'noSettings.json');
    writeFileSync(p, JSON.stringify({ version: 1, users: [] }));
    const s = loadStore(p);
    assert.deepEqual(s.settings, { allowExternalSso: false });
  });
});

test('throws on permission denied error', () => {
  withStore((dir) => {
    const p = join(dir, 'locked.json');
    writeFileSync(p, '{}');
    chmodSync(p, 0o000);
    try {
      assert.throws(() => loadStore(p), /unreadable/);
    } finally {
      chmodSync(p, 0o644);
    }
  });
});
