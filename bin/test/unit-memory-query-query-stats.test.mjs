// Local store state and remote veld status for the stats subcommand (bin/memory-query.mjs queryStats).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryStats } from '../memory-query.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const noCredential = () => ({ ok: false, source: null });
const envCredential = () => ({ ok: true, source: 'env' });
const refused = async () => { throw new Error('connect ECONNREFUSED'); };
const healthy = async () => new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } });
const NO_CRED_REASON = 'VELD_API_KEY unresolvable \u2014 a configuration failure on this box, not the remote being down';
const ABSENT_REASON = 'no store file \u2014 nothing has ever been written here, which is not the same as an empty store';
const UNINIT_REASON = 'the file exists but holds no memory_record table \u2014 the memory store has never been written at this path. '
  + 'Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.';

test('withholds every count and marks the store absent when the db file does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const path = join(dir, 'memory.db');
    const r = await queryStats({ env: { CW_MEMORY_DB: path, HOME: dir }, fetchImpl: refused, credentialImpl: noCredential });
    assert.equal(r.subcommand, 'stats');
    assert.deepEqual(r.local, {
      state: 'absent',
      path,
      bytes: null,
      reason: ABSENT_REASON,
      records: null,
      receipts: null,
      adapters: {},
      neverObserved: true,
      storeAbsent: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to CW_DB for the store path when CW_MEMORY_DB is empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const path = join(dir, 'fallback.db');
    const r = await queryStats({ env: { CW_MEMORY_DB: '', CW_DB: path, HOME: dir }, fetchImpl: refused, credentialImpl: noCredential });
    assert.equal(r.local.path, path);
    assert.equal(r.local.state, 'absent');
    assert.equal(r.local.storeAbsent, true);
    assert.equal(r.local.neverObserved, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects with the stat error when the db path runs through a regular file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const file = join(dir, 'plain');
    writeFileSync(file, 'x');
    const path = join(file, 'memory.db');
    await assert.rejects(
      queryStats({ env: { CW_MEMORY_DB: path, HOME: dir }, fetchImpl: refused, credentialImpl: noCredential }),
      { name: 'Error', code: 'ENOTDIR', message: `ENOTDIR: not a directory, stat '${path}'` },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports an uninitialised store that is not absent when the db file has no memory_record table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const path = join(dir, 'empty.db');
    writeFileSync(path, Buffer.alloc(0));
    const r = await queryStats({ env: { CW_MEMORY_DB: path, HOME: dir }, fetchImpl: refused, credentialImpl: noCredential });
    assert.deepEqual(r.local, {
      state: 'uninitialised',
      path,
      bytes: null,
      reason: UNINIT_REASON,
      records: null,
      receipts: null,
      adapters: {},
      neverObserved: true,
      storeAbsent: false,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes the no-credential state and its configuration reason through when the credential is unresolvable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const r = await queryStats({ env: { CW_MEMORY_DB: join(dir, 'memory.db'), HOME: dir }, fetchImpl: refused, credentialImpl: noCredential });
    assert.deepEqual(Object.keys(r.remote), ['state', 'matches', 'reason', 'adapter']);
    assert.equal(r.remote.state, 'no-credential');
    assert.equal(r.remote.matches, null);
    assert.equal(r.remote.reason, NO_CRED_REASON);
    assert.equal(r.remote.adapter.state, 'no-credential');
    assert.equal(r.remote.adapter.reason, NO_CRED_REASON);
    assert.deepEqual(r.remote.adapter.credential, { present: false, source: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps the no-credential state even when the health endpoint answers 200', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const r = await queryStats({ env: { CW_MEMORY_DB: join(dir, 'memory.db'), HOME: dir }, fetchImpl: healthy, credentialImpl: noCredential });
    assert.equal(r.remote.state, 'no-credential');
    assert.equal(r.remote.matches, null);
    assert.equal(r.remote.reason, NO_CRED_REASON);
    assert.deepEqual(r.remote.adapter.credential, { present: false, source: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes the unreachable state and the health failure reason through when the remote refuses the connection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queryStats-'));
  try {
    const r = await queryStats({ env: { CW_MEMORY_DB: join(dir, 'memory.db'), HOME: dir }, fetchImpl: refused, credentialImpl: envCredential });
    assert.equal(r.remote.state, 'unreachable');
    assert.equal(r.remote.matches, null);
    assert.equal(r.remote.adapter.state, 'unreachable');
    assert.equal(r.remote.adapter.reachable, false);
    assert.deepEqual(r.remote.adapter.credential, { present: true, source: 'env' });
    assert.equal(r.remote.reason, r.remote.adapter.reason);
    assert.equal(r.remote.reason.slice(0, 21), 'health check failed: ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
