// Tag-filtered local and remote memory matches and whether they correlate (bin/memory-query.mjs queryTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryTags } from '../memory-query.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = 4096;
const DASH = '\u2014';
const EMPTY = `--tags needs at least one tag ${DASH} an empty filter would return the whole store as if it had matched`;
const NOTHING = `${DASH} nothing was observed there, so no comparison exists to make`;
const NOTE = 'local-only is the NORMAL state under local-first write ordering; it is not a discrepancy.';
const NO_CRED = { state: 'no-credential', matches: null, ids: null, unidentified: null, reason: `VELD_API_KEY unresolvable ${DASH} a configuration failure on this box, not the remote being down` };
const RECORD_COLS = 'id INTEGER PRIMARY KEY, external_id TEXT, tags TEXT, content TEXT, created_at TEXT, updated_at TEXT, kind TEXT, source TEXT, metadata TEXT, deleted_at TEXT';
const SAME = '2026-09-07T10:00:00.000Z';
const LATER = '2026-09-08T10:00:00.000Z';
const ROWS = [['b', 1, SAME], ['a', 3, SAME], ['d', 4, LATER], ['c', 2, SAME]]
  .map(([id, day, at]) => [null, id, '["alpha"]', `note ${id}`, `2026-09-0${day}T10:00:00.000Z`, at]);

const noCred = () => ({ ok: false });
const okCred = () => ({ ok: true, key: 'test-key' });
const deadFetch = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:9'); };
const liveFetch = (memories) => async () => new Response(JSON.stringify({ memories }), { status: 200, headers: { 'content-type': 'application/json' } });
const unseen = (local, reason) => ({ determined: false, local, remote: null, both: null, localOnly: null, remoteOnly: null, remoteUnidentified: null, reason });

const varint = (n) => {
  const out = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) out.unshift((n & 0x7f) | 0x80);
  return out;
};

const record = (values) => {
  const types = [];
  const parts = [];
  for (const v of values) {
    if (v === null) types.push(0);
    else if (typeof v === 'number') { types.push(1); parts.push(Buffer.from([v])); }
    else { const b = Buffer.from(v, 'utf8'); types.push(b.length * 2 + 13); parts.push(b); }
  }
  const head = types.flatMap(varint);
  return Buffer.concat([Buffer.from([head.length + 1, ...head]), ...parts]);
};

const leafPage = (rows, at) => {
  const page = Buffer.alloc(PAGE);
  let top = PAGE;
  rows.forEach((values, i) => {
    const body = record(values);
    const cell = Buffer.concat([Buffer.from([...varint(body.length), ...varint(i + 1)]), body]);
    top -= cell.length;
    cell.copy(page, top);
    page.writeUInt16BE(top, at + 8 + 2 * i);
  });
  page[at] = 0x0d;
  page.writeUInt16BE(rows.length, at + 3);
  page.writeUInt16BE(top, at + 5);
  return page;
};

const writeDb = (file, tables) => {
  const first = leafPage(tables.map(([name, cols], i) => ['table', name, name, i + 2, `CREATE TABLE ${name} (${cols})`]), 100);
  first.write('SQLite format 3\0', 0, 'latin1');
  first.writeUInt16BE(PAGE, 16);
  first.set([1, 1, 0, 64, 32, 32], 18);
  for (const [at, v] of [[24, 1], [28, tables.length + 1], [40, 1], [44, 4], [56, 1], [92, 1], [96, 3045000]]) first.writeUInt32BE(v, at);
  writeFileSync(file, Buffer.concat([first, ...tables.map(([, , rows]) => leafPage(rows, 0))]));
};

async function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'queryTags-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('null tags are rejected as an empty filter before the remote is asked', () => inDir(async (dir) => {
  const asked = [];
  const credentialImpl = (o) => { asked.push(o); return { ok: false }; };
  await assert.rejects(queryTags(null, { env: { CW_MEMORY_DB: join(dir, 'm.db') }, fetchImpl: deadFetch, credentialImpl }), { name: 'Error', message: EMPTY });
  assert.deepEqual(asked, []);
}));

test('tags that are all empty strings are rejected as an empty filter', () => inDir(async (dir) => {
  await assert.rejects(queryTags(['', ''], { env: { CW_MEMORY_DB: join(dir, 'm.db') }, fetchImpl: deadFetch, credentialImpl: noCred }), { name: 'Error', message: EMPTY });
}));

test('an absent store and a missing credential observe nothing, with tags stringified, deduped and sorted', () => inDir(async (dir) => {
  const path = join(dir, 'never-written.db');
  const r = await queryTags(['beta', 0, 'alpha', 'beta', ''], { limit: 5, env: { CW_MEMORY_DB: path }, fetchImpl: deadFetch, credentialImpl: noCred });
  assert.deepEqual(r, {
    subcommand: 'tags',
    tags: ['0', 'alpha', 'beta'],
    limit: 5,
    local: { state: 'absent', path, bytes: null, reason: `no store file ${DASH} nothing has ever been written here, which is not the same as an empty store`, matches: null, records: [] },
    remote: NO_CRED,
    correlation: unseen(null, `the local store is absent and the remote did not answer (no-credential) ${NOTHING}`),
  });
}));

test('a file holding only a receipts table is uninitialised, and a throwing fetch leaves the remote unreachable', () => inDir(async (dir) => {
  const path = join(dir, 'shared.db');
  writeDb(path, [['memory_receipt', 'external_id TEXT, remote_id TEXT, receipted_at TEXT', []]]);
  const r = await queryTags(['alpha'], { env: { CW_DB: path }, fetchImpl: deadFetch, credentialImpl: okCred });
  const { reason: _why, ...remote } = r.remote;
  assert.deepEqual(remote, { state: 'unreachable', matches: null, ids: null, unidentified: null });
  assert.deepEqual(r.local, { state: 'uninitialised', path, bytes: 2 * PAGE, reason: `the file exists but holds no memory_record table ${DASH} the memory store has never been written at this path. Check that CW_MEMORY_DB/CW_DB point where the writer writes; monitor/commitwork.db is the taxonomy database and shares this default filename.`, matches: null, records: [] });
  assert.deepEqual(r.correlation, unseen(null, `the local store is uninitialised and the remote did not answer (unreachable) ${NOTHING}`));
}));

test('a readable store sorts newest first with external_id breaking ties, and a missing credential alone blocks correlation', () => inDir(async (dir) => {
  const path = join(dir, 'memory.db');
  writeDb(path, [['memory_record', RECORD_COLS, ROWS]]);
  const r = await queryTags(['alpha'], { env: { CW_MEMORY_DB: path }, fetchImpl: deadFetch, credentialImpl: noCred });
  const { records, ...local } = r.local;
  assert.deepEqual(local, { state: 'ok', path, bytes: 2 * PAGE, receiptsTable: false, reason: null, matches: 4 });
  assert.deepEqual(records.map((x) => x.external_id), ['d', 'a', 'b', 'c']);
  assert.deepEqual(r.remote, NO_CRED);
  assert.deepEqual(r.correlation, unseen(4, `the remote did not answer (no-credential) ${NOTHING}`));
}));

test('when both halves answer, ids split into both, local-only and remote-only, with unidentified remote rows counted apart', () => inDir(async (dir) => {
  const path = join(dir, 'memory.db');
  writeDb(path, [['memory_record', RECORD_COLS, ROWS]]);
  const memories = [{ external_id: 'a' }, { experience: { external_id: 'q' } }, { metadata: { external_id: 'a' } }, { content: 'no id' }];
  const r = await queryTags(['alpha'], { env: { CW_MEMORY_DB: path }, fetchImpl: liveFetch(memories), credentialImpl: okCred });
  assert.deepEqual(r.remote, { state: 'ok', matches: 4, ids: ['a', 'q'], unidentified: 1, reason: null });
  assert.deepEqual(r.local.records.map((x) => x.external_id), ['d', 'a', 'b', 'c']);
  assert.deepEqual(r.correlation, { determined: true, local: 4, remote: 2, both: ['a'], localOnly: ['b', 'c', 'd'], remoteOnly: ['q'], remoteUnidentified: 1, note: NOTE });
}));

test('an answering remote is not correlated against an absent store', () => inDir(async (dir) => {
  const r = await queryTags(['alpha'], { env: { CW_MEMORY_DB: join(dir, 'gone.db') }, fetchImpl: liveFetch([]), credentialImpl: okCred });
  assert.deepEqual(r.remote, { state: 'ok', matches: 0, ids: [], unidentified: 0, reason: null });
  assert.equal(r.local.matches, null);
  assert.deepEqual(r.correlation, unseen(null, `the local store is absent ${NOTHING}`));
}));
